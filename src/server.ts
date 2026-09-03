import { Buffer } from "node:buffer";

import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { initTRPC } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";

import { createFactoryApplication, type ProjectHierarchy } from "./application";
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

type ConnectionEvent = "close" | "error" | "message";
type ConnectionListener = (...args: unknown[]) => void;

type SocketData = {
  listeners: Map<ConnectionEvent, Set<ConnectionListener>>;
  request: Request;
};

export type FactoryServer = {
  stop: () => void;
  url: URL;
};

const trpc = initTRPC.create();

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
    Set<(detail: ProjectHierarchy) => void>
  >();

  constructor(
    private readonly application: ReturnType<typeof createFactoryApplication>,
  ) {}

  subscribe(
    projectId: string,
    listener: (detail: ProjectHierarchy) => void,
  ): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }

  publish(projectId: string): void {
    const detail = this.application.getProjectHierarchy(projectId);
    this.listeners.get(projectId)?.forEach((listener) => listener(detail));
  }

  publishAll(): void {
    this.application.listProjects().forEach(({ id }) => this.publish(id));
  }
}

function createRouter(
  application: ReturnType<typeof createFactoryApplication>,
  githubStatusReader: GitHubStatusReader,
  t3Coordinator: ReturnType<typeof createT3Coordinator>,
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
        .mutation(({ input }) => application.createProject(input)),
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
          projectUpdates.publish(input.projectId);
          return project;
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
          return { projectId: input.projectId };
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
          projectUpdates.publish(input.projectId);
          return link;
        }),
      list: trpc.procedure.query(() => application.listProjects()),
      attention: trpc.procedure.query(() =>
        application.getAttentionProjection(),
      ),
      portfolio: trpc.procedure.query(() => application.getPortfolioStatus()),
      status: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => application.getProjectStatus(input.projectId)),
      detail: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => ({
          ...application.getProjectHierarchy(input.projectId),
          trackerLinks: application.getProjectDetail(input.projectId)
            .trackerLinks,
        })),
      updates: trpc.procedure
        .input(z.object({ projectId: z.string().min(1) }))
        .subscription(({ input }) =>
          observable<ProjectHierarchy>((emit) =>
            projectUpdates.subscribe(input.projectId, (detail) =>
              emit.next(detail),
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
        .mutation(({ input }) => t3Coordinator.linkThread(input)),
      unlinkThread: trpc.procedure
        .input(z.object({ threadId: z.string().min(1) }))
        .mutation(({ input }) => t3Coordinator.unlinkThread(input.threadId)),
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
          projectUpdates.publishAll();
          return subtask;
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
          const subtask = application.updateSubtask(input);
          projectUpdates.publishAll();
          return subtask;
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.removeSubtask(input.subtaskId);
          projectUpdates.publishAll();
          return { subtaskId: input.subtaskId };
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
          const report = application.reportSubtaskStatus(input);
          projectUpdates.publishAll();
          return report;
        }),
      archive: trpc.procedure
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            subtaskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.archiveSubtask(input.subtaskId, input.archiveState);
          projectUpdates.publishAll();
          return {
            archiveState: input.archiveState,
            subtaskId: input.subtaskId,
          };
        }),
      restore: trpc.procedure
        .input(z.object({ subtaskId: z.string().min(1) }))
        .mutation(({ input }) => {
          application.restoreSubtask(input.subtaskId);
          projectUpdates.publishAll();
          return { subtaskId: input.subtaskId };
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
          projectUpdates.publishAll();
          return result;
        }),
      verify: trpc.procedure
        .input(
          z.object({
            decision: z.enum(["accepted", "rejected", "deferred"]),
            reportId: z.string().min(1),
            reason: z.string().trim().min(1).optional(),
            verifier: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.verifyStatusReport(input);
          projectUpdates.publishAll();
          return { ok: true };
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
          projectUpdates.publish(input.projectId);
          return task;
        }),
      remove: trpc.procedure
        .input(
          z.object({
            confirm: z.literal(true),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.removeTask(input.taskId);
          projectUpdates.publishAll();
          return { taskId: input.taskId };
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
          projectUpdates.publish(task.projectId);
          return task;
        }),
      archive: trpc.procedure
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            taskId: z.string().min(1),
          }),
        )
        .mutation(({ input }) => {
          application.archiveTask(input.taskId, input.archiveState);
          projectUpdates.publishAll();
          return {
            archiveState: input.archiveState,
            taskId: input.taskId,
          };
        }),
      restore: trpc.procedure
        .input(z.object({ taskId: z.string().min(1) }))
        .mutation(({ input }) => {
          application.restoreTask(input.taskId);
          projectUpdates.publishAll();
          return { taskId: input.taskId };
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
          projectUpdates.publish(input.projectId);
          return result;
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
          const task = application.getTaskDetail(input.taskId);
          projectUpdates.publish(task.projectId);
          return result;
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
          projectUpdates.publishAll();
          return link;
        }),
    }),
  });
}

export type FactoryRouter = ReturnType<typeof createRouter>;

export type FactoryServerOptions = {
  databasePath: string;
  githubToken?: string;
  hostname: string;
  port: number;
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

  return {
    databasePath: environment.FACTORY_DB ?? "factory.sqlite",
    ...(environment.GITHUB_TOKEN || environment.GH_TOKEN
      ? { githubToken: environment.GITHUB_TOKEN ?? environment.GH_TOKEN }
      : {}),
    hostname: environment.FACTORY_HOST ?? "127.0.0.1",
    port,
    ...(t3AccessToken ? { t3AccessToken } : {}),
    ...(t3BaseUrl ? { t3BaseUrl } : {}),
    ...(t3TimeoutMs === undefined ? {} : { t3TimeoutMs }),
  };
}

export function createFactoryServer({
  databasePath = "factory.sqlite",
  githubStatusReader,
  githubToken,
  hostname = "127.0.0.1",
  port,
  t3AccessToken: _t3AccessToken,
  t3BaseUrl: _t3BaseUrl,
  t3TimeoutMs: _t3TimeoutMs,
  t3ActivityReader,
}: {
  databasePath?: string;
  githubStatusReader?: GitHubStatusReader;
  githubToken?: string;
  hostname?: string;
  port: number;
  t3AccessToken?: string;
  t3BaseUrl?: string;
  t3TimeoutMs?: number;
  t3ActivityReader?: T3ActivityReader;
}): FactoryServer {
  const application = createFactoryApplication({ databasePath });
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
  );
  const onConnection = getWSConnectionHandler({
    createContext: () => ({}),
    router,
    wss: undefined as never,
  });

  const server = Bun.serve<SocketData>({
    hostname,
    port,
    fetch(request, bunServer) {
      const url = new URL(request.url);

      if (url.pathname === "/trpc") {
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
          headers: {},
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

  return server;
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
