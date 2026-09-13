import { Buffer } from "node:buffer";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { initTRPC, TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";

import {
  createFactoryApplication,
  type DashboardSnapshot,
  type ProjectHierarchy,
} from "./application";
import {
  createGitHubStatusReader,
  parseGitHubPullRequestUrl,
  type GitHubStatusReader,
  type GitHubStatusSnapshot,
} from "./github";
import { createT3Coordinator } from "./t3-coordinator";
import {
  createT3ActivityReader,
  normalizeT3BaseUrl,
  type T3ActivityReader,
} from "./t3";
import { resolveT3AccessToken } from "./t3-credential";
import {
  createHumanSessionStore,
  getHumanSessionToken,
  resolveFactoryOperator,
  secretsMatch,
  HUMAN_SESSION_COOKIE,
  type FactoryOperator,
  type HumanIdentity,
} from "./human-session";

type ConnectionEvent = "close" | "error" | "message";
type ConnectionListener = (...args: unknown[]) => void;

type SocketData = {
  listeners: Map<ConnectionEvent, Set<ConnectionListener>>;
  request: Request;
};

export type FactoryServer = {
  stop: () => Promise<void>;
  url: URL;
};

type FactoryContext = {
  human: HumanIdentity | null;
};

const trpc = initTRPC.context<FactoryContext>().create();

const workStateSchema = z.enum([
  "backlog",
  "planned",
  "active",
  "awaiting_verification",
  "blocked",
  "completed",
]);
const editableTaskStateSchema = z.enum([
  "backlog",
  "planned",
  "active",
  "awaiting_verification",
  "blocked",
]);

class ProjectUpdateBus {
  private readonly listeners = new Map<
    string,
    Set<(snapshot: DashboardSnapshot) => void>
  >();

  constructor(
    private readonly application: ReturnType<typeof createFactoryApplication>,
  ) {}

  subscribe(
    projectId: string,
    listener: (snapshot: DashboardSnapshot) => void,
  ): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }

  publish(projectId: string): DashboardSnapshot | undefined {
    const listeners = this.listeners.get(projectId);
    if (!listeners || listeners.size === 0) return undefined;
    const snapshot = this.application.getDashboardSnapshot(projectId);
    listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  publishAll(): void {
    if (this.listeners.size === 0) return;
    const projectIds = new Set(
      this.application.listProjects().map(({ id }) => id),
    );
    const globalSnapshot = this.application.getDashboardSnapshot();
    for (const projectId of this.listeners.keys()) {
      if (projectIds.has(projectId)) {
        this.publish(projectId);
        continue;
      }
      this.listeners
        .get(projectId)
        ?.forEach((listener) => listener(globalSnapshot));
    }
  }
}

function withDashboard<T extends object>(
  value: T,
  dashboard: DashboardSnapshot,
): T & { dashboard: DashboardSnapshot } {
  return { ...value, dashboard };
}

function withDashboardItems<T>(
  items: T[],
  dashboard: DashboardSnapshot,
): { items: T[]; dashboard: DashboardSnapshot } {
  return { dashboard, items };
}

function dashboardAfterPublish(
  application: ReturnType<typeof createFactoryApplication>,
  projectUpdates: ProjectUpdateBus,
  projectId: string,
): DashboardSnapshot {
  return (
    projectUpdates.publish(projectId) ??
    application.getDashboardSnapshot(projectId)
  );
}

function projectIdForSubtask(
  application: ReturnType<typeof createFactoryApplication>,
  subtaskId: string,
): string {
  const subtask = application.getSubtaskDetail(subtaskId);
  return application.getTaskDetail(subtask.taskId).projectId;
}

function createRouter(
  application: ReturnType<typeof createFactoryApplication>,
  githubStatusReader: GitHubStatusReader,
  t3Coordinator: ReturnType<typeof createT3Coordinator>,
  humanSessionConfigured: boolean,
) {
  const projectUpdates = new ProjectUpdateBus(application);

  const githubStatus = async (
    pullRequestUrl: string | undefined,
  ): Promise<GitHubStatusSnapshot> => {
    if (!pullRequestUrl) {
      return {
        checkRuns: [],
        checkRunsStatus: "not_requested",
        fetchedAt: new Date().toISOString(),
        status: "not_linked",
        workflowRuns: [],
        workflowRunsStatus: "not_requested",
      };
    }
    try {
      return await githubStatusReader.read(
        parseGitHubPullRequestUrl(pullRequestUrl),
      );
    } catch {
      return {
        checkRuns: [],
        checkRunsStatus: "not_requested",
        error: "The stored pull request URL is invalid.",
        fetchedAt: new Date().toISOString(),
        status: "unavailable",
        workflowRuns: [],
        workflowRunsStatus: "not_requested",
      };
    }
  };

  return trpc.router({
    projects: trpc.router({
      create: trpc.procedure
        .input(
          z.object({
            gitOriginUrl: z.string().trim().min(1).optional(),
            name: z.string().min(1),
            t3ProjectId: z.string().trim().min(1).optional(),
            workspaceRoot: z.string().trim().min(1).optional(),
          }),
        )
        .mutation(({ input }) =>
          withDashboard(
            application.createProject(input),
            application.getDashboardSnapshot(),
          ),
        ),
      update: trpc.procedure
        .input(
          z.object({
            gitOriginUrl: z.string().trim().min(1).nullable(),
            projectId: z.string().min(1),
            t3ProjectId: z.string().trim().min(1).nullable().optional(),
            workspaceRoot: z.string().trim().min(1).nullable().optional(),
          }),
        )
        .mutation(({ input }) => {
          const project = application.updateProject(input);
          return withDashboard(
            project,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            projectId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.removeProject(input.projectId);
          projectUpdates.publishAll();
          return withDashboard(
            { projectId: input.projectId },
            application.getDashboardSnapshot(),
          );
        }),
      link: trpc.procedure
        .input(
          z.object({
            projectId: z.string().min(1),
            stableId: z.string().min(1),
            system: z.enum(["linear", "notion"]),
            title: z.string().optional(),
            url: z.string().url(),
          }),
        )
        .mutation(({ input }) => {
          const link = application.addProjectTrackerLink(input);
          return withDashboard(
            link,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      list: trpc.procedure.query(() => application.listProjects()),
      attention: trpc.procedure.query(() =>
        application.getAttentionProjection(),
      ),
      portfolio: trpc.procedure.query(() => application.getPortfolioStatus()),
      snapshot: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) =>
          application.getDashboardSnapshot(input.projectId),
        ),
      status: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => application.getProjectStatus(input.projectId)),
      detail: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => {
          const detail = application.getDashboardSnapshot(
            input.projectId,
          ).projectDetail;
          if (!detail) {
            throw new Error(`Project ${input.projectId} does not exist.`);
          }
          return detail;
        }),
      updates: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .subscription(({ input }) =>
          observable<DashboardSnapshot>((emit) =>
            projectUpdates.subscribe(input.projectId, (snapshot) =>
              emit.next(snapshot),
            ),
          ),
        ),
    }),
    t3: trpc.router({
      status: trpc.procedure
        .input(
          z
            .object({ projectId: z.string().min(1).optional() })
            .nullable()
            .optional(),
        )
        .query(({ input }) => t3Coordinator.status(input?.projectId)),
      projectActivity: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => t3Coordinator.projectActivity(input.projectId)),
      threadDetail: trpc.procedure
        .input(
          z.object({
            threadId: z.string().min(1),
            turnLimit: z.number().int().min(1).max(10).default(1),
          }),
        )
        .query(({ input }) =>
          t3Coordinator.threadDetail(input.threadId, input.turnLimit),
        ),
      linkThread: trpc.procedure
        .input(
          z.object({
            projectId: z.string().min(1),
            subtaskId: z.string().min(1).optional(),
            taskId: z.string().min(1).optional(),
            threadId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const result = t3Coordinator.linkThread(input);
          return withDashboard(
            result,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      autoLinkThread: trpc.procedure
        .input(
          z.object({
            branchName: z.string().min(1),
            projectId: z.string().min(1),
            taskId: z.string().min(1).optional(),
            subtaskId: z.string().min(1).optional(),
          }),
        )
        .mutation(async ({ input }) => {
          const result = await t3Coordinator.autoLinkThread(input);
          const dashboard =
            result.status === "linked"
              ? (projectUpdates.publish(input.projectId) ??
                application.getDashboardSnapshot(input.projectId))
              : application.getDashboardSnapshot(input.projectId);
          return withDashboard(result, dashboard);
        }),
      unlinkThread: trpc.procedure
        .input(
          z.object({
            associationId: z.string().min(1).optional(),
            threadId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const result = t3Coordinator.unlinkThread(
            input.threadId,
            input.associationId,
          );
          return withDashboard(
            result,
            dashboardAfterPublish(
              application,
              projectUpdates,
              result.run.projectId,
            ),
          );
        }),
    }),
    subtasks: trpc.router({
      create: trpc.procedure
        .input(
          z.object({
            description: z.string().optional(),
            name: z.string().min(1),
            pullRequestUrl: z.string().nullable().optional(),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const subtask = application.createSubtask(input);
          const projectId = application.getTaskDetail(input.taskId).projectId;
          return withDashboard(
            subtask,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      update: trpc.procedure
        .input(
          z.object({
            description: z.string().nullable().optional(),
            evidence: z.string().nullable().optional(),
            name: z.string().trim().min(1).optional(),
            pullRequestUrl: z.string().nullable().optional(),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const projectId = projectIdForSubtask(application, input.subtaskId);
          const subtask = application.updateSubtask(input);
          return withDashboard(
            subtask,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const projectId = projectIdForSubtask(application, input.subtaskId);
          application.removeSubtask(input.subtaskId);
          return withDashboard(
            { subtaskId: input.subtaskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      report: trpc.procedure
        .input(
          z.object({
            evidence: z.string().optional(),
            reportedState: z.enum([
              "not_started",
              "in_progress",
              "blocked",
              "complete",
              "backlog",
            ]),
            reason: z.string().trim().min(1).optional(),
            reporter: z.string().min(1),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const projectId = projectIdForSubtask(application, input.subtaskId);
          const report = application.reportSubtaskStatus(input);
          return withDashboard(
            report,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      archive: trpc.procedure
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const projectId = projectIdForSubtask(application, input.subtaskId);
          application.archiveSubtask(input.subtaskId, input.archiveState);
          return withDashboard(
            {
              archiveState: input.archiveState,
              subtaskId: input.subtaskId,
            },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      restore: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .mutation(({ input }) => {
          const projectId = projectIdForSubtask(application, input.subtaskId);
          application.restoreSubtask(input.subtaskId);
          return withDashboard(
            { subtaskId: input.subtaskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      reorder: trpc.procedure
        .input(
          z.object({
            orderedSubtaskIds: z.array(z.string().min(1)).min(1),
            taskId: z.string().min(1),
            workState: workStateSchema,
          }),
        )
        .mutation(({ input }) => {
          const result = application.reorderSubtasks(input);
          const projectId = application.getTaskDetail(input.taskId).projectId;
          return withDashboardItems(
            result,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      verify: trpc.procedure
        .input(
          z.object({
            decision: z.enum(["accepted", "rejected", "deferred"]),
            reportId: z.string().min(1),
            reason: z.string().trim().min(1).optional(),
          }),
        )
        .mutation(({ ctx, input }) => {
          if (!humanSessionConfigured) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message:
                "Human session not configured; verification is unavailable.",
            });
          }
          if (!ctx.human) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "A human session is required to verify status reports.",
            });
          }
          const projectId = application.getStatusReportProjectId(
            input.reportId,
          );
          application.verifyStatusReport({
            ...input,
            verifier: ctx.human.name,
          });
          return withDashboard(
            { ok: true },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      history: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          application.getSubtaskReportHistory(input.subtaskId),
        ),
      verifications: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          application.getSubtaskVerificationHistory(input.subtaskId),
        ),
      githubStatus: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          githubStatus(
            application.getSubtaskDetail(input.subtaskId).pullRequestUrl,
          ),
        ),
    }),
    tasks: trpc.router({
      create: trpc.procedure
        .input(
          z.object({
            acceptanceCriteria: z.array(z.string()).default([]),
            branchName: z.string().trim().min(1).optional(),
            dependencies: z.array(z.string()).default([]),
            name: z.string().min(1),
            objective: z.string().optional(),
            owner: z.string().optional(),
            pullRequestUrl: z.string().nullable().optional(),
            priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
            projectId: z.string().min(1),
            repositoryLinks: z.array(z.string().url()).default([]),
          }),
        )
        .mutation(({ input }) => {
          const task = application.createTask(input);
          return withDashboard(
            task,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const projectId = application.getTaskDetail(input.taskId).projectId;
          application.removeTask(input.taskId);
          return withDashboard(
            { taskId: input.taskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      status: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskStatus(input.taskId)),
      detail: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskDetail(input.taskId)),
      githubStatus: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) =>
          githubStatus(application.getTaskDetail(input.taskId).pullRequestUrl),
        ),
      update: trpc.procedure
        .input(
          z.object({
            acceptanceCriteria: z.array(z.string()).optional(),
            branchName: z.string().trim().min(1).nullable().optional(),
            name: z.string().trim().min(1).optional(),
            objective: z.string().nullable().optional(),
            pullRequestUrl: z.string().nullable().optional(),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const task = application.updateTask(input);
          return withDashboard(
            task,
            dashboardAfterPublish(application, projectUpdates, task.projectId),
          );
        }),
      archive: trpc.procedure
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          const projectId = application.getTaskDetail(input.taskId).projectId;
          application.archiveTask(input.taskId, input.archiveState);
          return withDashboard(
            {
              archiveState: input.archiveState,
              taskId: input.taskId,
            },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      restore: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .mutation(({ input }) => {
          const projectId = application.getTaskDetail(input.taskId).projectId;
          application.restoreTask(input.taskId);
          return withDashboard(
            { taskId: input.taskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      reorder: trpc.procedure
        .input(
          z.object({
            orderedTaskIds: z.array(z.string().min(1)).min(1),
            projectId: z.string().min(1),
            workState: workStateSchema,
          }),
        )
        .mutation(({ input }) => {
          const result = application.reorderTasks(input);
          return withDashboardItems(
            result,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      resumeRollup: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .mutation(({ input }) => {
          const result = application.resumeTaskRollup(input.taskId);
          return withDashboard(
            result,
            dashboardAfterPublish(
              application,
              projectUpdates,
              result.projectId,
            ),
          );
        }),
      setState: trpc.procedure
        .input(
          z.object({
            reason: z.string().trim().min(1).optional(),
            taskId: z.string().min(1),
            workState: editableTaskStateSchema,
          }),
        )
        .mutation(({ input }) => {
          const result = application.setTaskWorkState(input);
          return withDashboard(
            result,
            dashboardAfterPublish(
              application,
              projectUpdates,
              result.projectId,
            ),
          );
        }),
      link: trpc.procedure
        .input(
          z.object({
            system: z.enum(["linear", "notion"]),
            stableId: z.string().min(1),
            taskId: z.string().min(1),
            title: z.string().optional(),
            url: z.string().url(),
          }),
        )
        .mutation(({ input }) => {
          const link = application.addTaskTrackerLink(input);
          const projectId = application.getTaskDetail(input.taskId).projectId;
          return withDashboard(
            link,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
    }),
  });
}

export type FactoryRouter = ReturnType<typeof createRouter>;

export type FactoryServerOptions = {
  databasePath: string;
  githubToken?: string;
  hostname: string;
  operator?: FactoryOperator;
  port: number;
  allowedOrigins?: string[];
  t3AccessToken?: string;
  t3BaseUrl?: string;
  t3TimeoutMs?: number;
};

export function getFactoryServerOptions(
  environment: Record<string, string | undefined>,
): FactoryServerOptions {
  const configuredPort = environment.FACTORY_PORT ?? "3000";
  const port = Number(configuredPort);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    String(port) !== configuredPort
  ) {
    throw new Error(
      `FACTORY_PORT must be an integer from 1 through 65535; received ${JSON.stringify(configuredPort)}.`,
    );
  }

  const configuredT3BaseUrl = environment.T3_BASE_URL?.trim();
  const configuredT3Timeout = environment.T3_TIMEOUT_MS?.trim();
  let t3TimeoutMs: number | undefined;
  if (configuredT3Timeout) {
    t3TimeoutMs = Number(configuredT3Timeout);
    if (
      !Number.isSafeInteger(t3TimeoutMs) ||
      t3TimeoutMs < 250 ||
      t3TimeoutMs > 60_000 ||
      String(t3TimeoutMs) !== configuredT3Timeout
    ) {
      throw new Error(
        `T3_TIMEOUT_MS must be an integer from 250 through 60000; received ${JSON.stringify(configuredT3Timeout)}.`,
      );
    }
  }

  const t3BaseUrl = configuredT3BaseUrl
    ? normalizeT3BaseUrl(configuredT3BaseUrl)
    : undefined;
  const t3AccessToken = resolveT3AccessToken(environment);
  const operator = resolveFactoryOperator(environment);
  const allowedOrigins = (environment.FACTORY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    databasePath: environment.FACTORY_DB ?? "factory.sqlite",
    ...(environment.GITHUB_TOKEN || environment.GH_TOKEN
      ? { githubToken: environment.GITHUB_TOKEN ?? environment.GH_TOKEN }
      : {}),
    hostname: environment.FACTORY_HOST ?? "127.0.0.1",
    ...(operator ? { operator } : {}),
    port,
    ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    ...(t3AccessToken ? { t3AccessToken } : {}),
    ...(t3BaseUrl ? { t3BaseUrl } : {}),
    ...(t3TimeoutMs === undefined ? {} : { t3TimeoutMs }),
  };
}

export function createFactoryServer({
  allowedOrigins = [],
  databasePath = "factory.sqlite",
  githubStatusReader,
  githubToken,
  hostname = "127.0.0.1",
  operator,
  port,
  t3AccessToken: _t3AccessToken,
  t3BaseUrl: _t3BaseUrl,
  t3TimeoutMs: _t3TimeoutMs,
  t3ActivityReader,
}: {
  allowedOrigins?: string[];
  databasePath?: string;
  githubStatusReader?: GitHubStatusReader;
  githubToken?: string;
  hostname?: string;
  operator?: FactoryOperator;
  port: number;
  t3AccessToken?: string;
  t3BaseUrl?: string;
  t3TimeoutMs?: number;
  t3ActivityReader?: T3ActivityReader;
}): FactoryServer {
  const configuredOperator =
    operator && operator.name.trim() && operator.secret
      ? { ...operator, name: operator.name.trim() }
      : undefined;
  const application = createFactoryApplication({ databasePath });
  const humanSessions = createHumanSessionStore({ databasePath });
  const t3Coordinator = createT3Coordinator({
    application,
    reader:
      t3ActivityReader ??
      createT3ActivityReader({
        baseUrl: _t3BaseUrl,
        timeoutMs: _t3TimeoutMs,
        token: _t3AccessToken,
      }),
  });
  const router = createRouter(
    application,
    githubStatusReader ?? createGitHubStatusReader({ token: githubToken }),
    t3Coordinator,
    configuredOperator !== undefined,
  );
  const onConnection = getWSConnectionHandler({
    createContext: ({ req }) => ({
      human: configuredOperator
        ? humanSessions.get(getHumanSessionToken(req.headers.cookie))
        : null,
    }),
    router,
    wss: undefined as never,
  });
  const loginFailures = new Map<string, number[]>();

  if (!configuredOperator) {
    console.warn(
      "Factory human verification disabled: human session not configured.",
    );
  }

  const server = Bun.serve<SocketData>({
    hostname,
    port,
    async fetch(request, bunServer) {
      const url = new URL(request.url);

      if (url.pathname === "/session/login" && request.method === "POST") {
        if (!originAllowed(request, allowedOrigins)) {
          return new Response("Forbidden", { status: 403 });
        }

        const clientAddress = getClientAddress(bunServer, request);
        const now = Date.now();
        const recentFailures = (loginFailures.get(clientAddress) ?? []).filter(
          (timestamp) => timestamp > now - 60_000,
        );
        if (recentFailures.length >= 5) {
          loginFailures.set(clientAddress, recentFailures);
          return jsonResponse(
            { error: "Too many login attempts. Try again later." },
            { status: 429 },
          );
        }

        let secret: unknown;
        try {
          const body = (await request.json()) as { secret?: unknown };
          secret = body?.secret;
        } catch {
          secret = undefined;
        }

        if (
          !configuredOperator ||
          typeof secret !== "string" ||
          !secretsMatch(secret, configuredOperator.secret)
        ) {
          recentFailures.push(now);
          loginFailures.set(clientAddress, recentFailures);
          return jsonResponse(
            { error: "Invalid credentials." },
            { status: 401 },
          );
        }

        loginFailures.delete(clientAddress);
        const token = humanSessions.create(configuredOperator.name);
        return jsonResponse(
          { human: { name: configuredOperator.name } },
          {
            headers: {
              "Set-Cookie": sessionCookie(token, request),
            },
          },
        );
      }

      if (url.pathname === "/session/logout" && request.method === "POST") {
        if (!originAllowed(request, allowedOrigins)) {
          return new Response("Forbidden", { status: 403 });
        }
        humanSessions.delete(
          getHumanSessionToken(request.headers.get("cookie") ?? undefined),
        );
        return jsonResponse(
          { ok: true },
          { headers: { "Set-Cookie": sessionCookie("", request, true) } },
        );
      }

      if (url.pathname === "/session" && request.method === "GET") {
        return jsonResponse({
          human: configuredOperator
            ? humanSessions.get(
                getHumanSessionToken(
                  request.headers.get("cookie") ?? undefined,
                ),
              )
            : null,
        });
      }

      if (url.pathname === "/trpc") {
        if (!originAllowed(request, allowedOrigins)) {
          return new Response("Forbidden", { status: 403 });
        }
        const upgraded = bunServer.upgrade(request, {
          data: { listeners: new Map(), request },
        });

        if (upgraded) {
          return undefined;
        }
      }

      const staticFile = getStaticFile(url.pathname);
      if (staticFile) {
        const response = new Response(Bun.file(staticFile));
        response.headers.set("Cache-Control", "no-cache");
        return response;
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open(socket) {
        const url = new URL(socket.data.request.url);
        const request = {
          headers: toNodeHeaders(socket.data.request.headers),
          url: `${url.pathname}${url.search}`,
        } as never;

        onConnection(createWebSocketAdapter(socket), request);
      },
      message(socket, message) {
        emit(socket.data, "message", toBuffer(message), false);
      },
      close(socket) {
        emit(socket.data, "close");
      },
    },
  });

  let stopPromise: Promise<void> | undefined;
  return {
    stop() {
      if (!stopPromise) {
        stopPromise = server.stop().finally(() => humanSessions.close());
      }
      return stopPromise;
    },
    url: server.url,
  };
}

function jsonResponse(
  body: unknown,
  options: { headers?: Record<string, string>; status?: number } = {},
): Response {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), {
    headers,
    status: options.status ?? 200,
  });
}

function sessionCookie(token: string, request: Request, clear = false): string {
  const secure = requestIsSecure(request) ? " Secure;" : "";
  return `${HUMAN_SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/;${secure}${clear ? " Max-Age=0;" : ""}`;
}

function requestIsSecure(request: Request): boolean {
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  return (
    forwardedProto === "https" || new URL(request.url).protocol === "https:"
  );
}

function originAllowed(request: Request, allowedOrigins: string[]): boolean {
  const origin = request.headers.get("origin");
  // A missing Origin is allowed for non-browser clients such as the future CLI;
  // a supplied cookie still authenticates the human session.
  if (!origin) return true;

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) return false;
  if (normalizedOrigin === requestOrigin(request)) return true;
  return allowedOrigins.some(
    (allowedOrigin) => normalizeOrigin(allowedOrigin) === normalizedOrigin,
  );
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProto === "http" || forwardedProto === "https"
      ? forwardedProto
      : url.protocol.slice(0, -1);
  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",", 1)[0]
    ?.trim();
  const host = forwardedHost || url.host;
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return url.origin;
  }
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function getClientAddress(
  server: Bun.Server<SocketData>,
  request: Request,
): string {
  return server.requestIP(request)?.address ?? "unknown";
}

function toNodeHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    Array.from(headers.entries(), ([name, value]) => [
      name.toLowerCase(),
      value,
    ]),
  );
}

function getStaticFile(pathname: string): string | null {
  if (pathname.startsWith("/projects/")) {
    return "src/web/index.html";
  }

  const files: Record<string, string> = {
    "/": "src/web/index.html",
    "/icon.svg": "src/web/icon.svg",
    "/icons/icon-192.png": "src/web/icons/icon-192.png",
    "/icons/icon-512.png": "src/web/icons/icon-512.png",
    "/icons/apple-touch-icon.png": "src/web/icons/apple-touch-icon.png",
    "/manifest.webmanifest": "src/web/manifest.webmanifest",
    "/main.css": "dist/main.css",
    "/main.js": "dist/main.js",
    "/service-worker.js": "dist/service-worker.js",
    "/fonts/ibm-plex-sans-latin-400-normal.woff2":
      "src/web/fonts/ibm-plex-sans-latin-400-normal.woff2",
    "/fonts/ibm-plex-sans-latin-500-normal.woff2":
      "src/web/fonts/ibm-plex-sans-latin-500-normal.woff2",
    "/fonts/ibm-plex-sans-latin-600-normal.woff2":
      "src/web/fonts/ibm-plex-sans-latin-600-normal.woff2",
    "/fonts/ibm-plex-sans-latin-700-normal.woff2":
      "src/web/fonts/ibm-plex-sans-latin-700-normal.woff2",
    "/fonts/ibm-plex-mono-latin-400-normal.woff2":
      "src/web/fonts/ibm-plex-mono-latin-400-normal.woff2",
    "/fonts/ibm-plex-mono-latin-500-normal.woff2":
      "src/web/fonts/ibm-plex-mono-latin-500-normal.woff2",
    "/fonts/ibm-plex-mono-latin-600-normal.woff2":
      "src/web/fonts/ibm-plex-mono-latin-600-normal.woff2",
  };

  return files[pathname] ?? null;
}

function createWebSocketAdapter(socket: Bun.ServerWebSocket<SocketData>) {
  return {
    close: () => socket.close(),
    get readyState() {
      return socket.readyState;
    },
    on(event: ConnectionEvent, listener: ConnectionListener) {
      addListener(socket.data, event, listener);
      return this;
    },
    once(event: ConnectionEvent, listener: ConnectionListener) {
      const onceListener: ConnectionListener = (...args) => {
        socket.data.listeners.get(event)?.delete(onceListener);
        listener(...args);
      };
      addListener(socket.data, event, onceListener);
      return this;
    },
    send(data: string | Uint8Array) {
      socket.send(data);
    },
  } as never;
}

function addListener(
  data: SocketData,
  event: ConnectionEvent,
  listener: ConnectionListener,
): void {
  const listeners = data.listeners.get(event) ?? new Set<ConnectionListener>();
  listeners.add(listener);
  data.listeners.set(event, listeners);
}

function emit(
  data: SocketData,
  event: ConnectionEvent,
  ...args: unknown[]
): void {
  data.listeners.get(event)?.forEach((listener) => listener(...args));
}

function toBuffer(message: string | ArrayBuffer | Uint8Array): Buffer {
  if (typeof message === "string") {
    return Buffer.from(message);
  }

  return Buffer.from(new Uint8Array(message));
}

if (import.meta.main) {
  const server = createFactoryServer(getFactoryServerOptions(Bun.env));
  console.info(`Software Factory listening at ${server.url}`);
}
