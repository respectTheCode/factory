import { Buffer } from "node:buffer";
import { accessSync, constants, existsSync } from "node:fs";
import { resolve } from "node:path";

import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { getWSConnectionHandler } from "@trpc/server/adapters/ws";
import { initTRPC, TRPCError } from "@trpc/server";
import { observable } from "@trpc/server/observable";
import { z } from "zod";
import { Database } from "bun:sqlite";

import {
  checkFactoryDatabase,
  createFactoryApplication,
  FactoryConflictError,
  type DashboardSnapshot,
  type PortfolioStatus,
  type ProjectHierarchy,
} from "./application";
import {
  createBackupRestoreCoordinator,
  createDisabledBackupService,
  applyPendingRestore,
  type BackupRestoreCoordinator,
  type RestorePreparation,
} from "./backup-restore";
import { createBackupService, type BackupService } from "./backup-service";
import { FACTORY_API_VERSION } from "./api-version";
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
  DEFAULT_T3_MACHINE_ID,
  LEGACY_T3_SOURCE_ID,
  resolveT3Sources,
  type T3Source,
} from "./t3-sources";
import {
  createHumanSessionStore,
  getHumanSessionToken,
  resolveFactoryOperator,
  secretsMatch,
  HUMAN_SESSION_COOKIE,
  type FactoryOperator,
  type HumanIdentity,
} from "./human-session";
import {
  createMachineCredentialStore,
  resolveMachineToken,
  type MachineCredentialIdentity,
} from "./machine-credential";
import {
  SCREENSHOT_CONTENT_TYPES,
  type ScreenshotContentType,
} from "./screenshot-evidence";
import { canonicalPayloadDigest, createIdempotencyStore } from "./idempotency";
import {
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  resolveFactoryEnvironment,
  resolveGitHubToken,
  resolveRequireExistingDatabase,
  resolveRevision,
  resolveShutdownTimeout,
  withTimeout,
  type FactoryEnvironment,
} from "./server-runtime";

type ConnectionEvent = "close" | "error" | "message";
type ConnectionListener = (...args: unknown[]) => void;

type SocketData = {
  listeners: Map<ConnectionEvent, Set<ConnectionListener>>;
  request: Request;
};

export type FactoryServer = {
  stop: (options?: { timeoutMs?: number }) => Promise<void>;
  shutdownTimeoutMs: number;
  url: URL;
};

export type FactoryContext = {
  human: HumanIdentity | null;
  machine: MachineCredentialIdentity | null;
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
const requestKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{8,128}$/, "Invalid request key.");
const sourceIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Invalid T3 source ID.");
const t3ProjectMappingSchema = z
  .object({
    sourceId: sourceIdSchema,
    t3ProjectId: z.string().trim().min(1).optional(),
    workspaceRoot: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (mapping) =>
      mapping.t3ProjectId !== undefined || mapping.workspaceRoot !== undefined,
    "A T3 source mapping requires t3ProjectId or workspaceRoot.",
  );
const t3MappingsSchema = z
  .array(t3ProjectMappingSchema)
  .superRefine((mappings, context) => {
    const sourceIds = new Set<string>();
    for (const [index, mapping] of mappings.entries()) {
      if (sourceIds.has(mapping.sourceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate T3 source mapping ${mapping.sourceId}.`,
          path: [index, "sourceId"],
        });
      }
      sourceIds.add(mapping.sourceId);
    }
  });

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

type ProjectIdResolver = (
  input: unknown,
  ctx?: FactoryContext,
) => string | undefined;

const unauthenticatedMessage = "Authentication is required.";

function humanProcedure(message = unauthenticatedMessage) {
  return trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.human) {
      throw new TRPCError({ code: "UNAUTHORIZED", message });
    }
    return next();
  });
}

function scopedProcedure(resolveProjectId?: ProjectIdResolver) {
  return trpc.procedure.use(async ({ ctx, getRawInput, next }) => {
    if (!ctx.human && !ctx.machine) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: unauthenticatedMessage,
      });
    }
    if (ctx.machine && resolveProjectId) {
      // This middleware runs before .input(), so the parsed input is not yet
      // available; resolve the Project from the raw input instead.
      const projectId = resolveProjectId(await getRawInput(), ctx);
      if (!projectId || !ctx.machine.projectIds.includes(projectId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: projectId
            ? "The machine credential is not scoped to this Project."
            : "A Project-scoped request is required for a machine credential.",
        });
      }
    }
    return next();
  });
}

function createMutationMutex() {
  let tail = Promise.resolve();
  let accepting = true;
  let maintenance = false;
  return {
    run<T>(
      operation: () => T | PromiseLike<T>,
      options: { allowMaintenance?: boolean } = {},
    ): Promise<T> {
      if (!accepting) {
        return Promise.reject(new Error("Factory server is shutting down."));
      }
      if (maintenance && !options.allowMaintenance) {
        return Promise.reject(
          new Error("Factory server is in maintenance mode."),
        );
      }
      const current = tail.then(
        () => {
          if (maintenance && !options.allowMaintenance) {
            throw new Error("Factory server is in maintenance mode.");
          }
          return operation();
        },
        () => {
          if (maintenance && !options.allowMaintenance) {
            throw new Error("Factory server is in maintenance mode.");
          }
          return operation();
        },
      );
      tail = current.then(
        () => undefined,
        () => undefined,
      );
      return current;
    },
    enterMaintenance(): Promise<void> {
      maintenance = true;
      return tail;
    },
    runMaintenance<T>(operation: () => T | PromiseLike<T>): Promise<T> {
      if (maintenance) {
        return Promise.reject(
          new Error("Factory server is in maintenance mode."),
        );
      }
      maintenance = true;
      return tail.then(
        () => this.run(operation, { allowMaintenance: true }),
        () => this.run(operation, { allowMaintenance: true }),
      );
    },
    leaveMaintenance(): void {
      maintenance = false;
    },
    isInMaintenance(): boolean {
      return maintenance;
    },
    stopAccepting(): Promise<void> {
      accepting = false;
      return tail;
    },
  };
}

function idempotencyScope(ctx: FactoryContext): string {
  if (ctx.machine) return ctx.machine.id;
  if (ctx.human) return `human:${ctx.human.name}`;
  throw new Error("Idempotency requires an authenticated caller.");
}

function withoutRequestKey(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }
  const { requestKey: _requestKey, ...payload } = input as Record<
    string,
    unknown
  >;
  return payload;
}

function fieldProjectId(field: string): ProjectIdResolver {
  return (input) => {
    const value = (input as Record<string, unknown> | null | undefined)?.[
      field
    ];
    return typeof value === "string" ? value : undefined;
  };
}

function scopePortfolioStatus(
  portfolioStatus: PortfolioStatus,
  projectIds: Set<string>,
): PortfolioStatus {
  const projects = portfolioStatus.projects.filter(({ projectId }) =>
    projectIds.has(projectId),
  );
  const counts = { ...portfolioStatus.counts };
  for (const state of Object.keys(counts) as Array<keyof typeof counts>) {
    counts[state] = projects.reduce(
      (total, project) => total + project.counts[state],
      0,
    );
  }
  return {
    counts,
    projects,
    totalTasks: projects.reduce(
      (total, project) => total + project.totalTasks,
      0,
    ),
  };
}

function scopeDashboardSnapshot(
  dashboard: DashboardSnapshot,
  machine: MachineCredentialIdentity | null,
): DashboardSnapshot {
  if (!machine) return dashboard;
  const projectIds = new Set(machine.projectIds);
  const projectDetail =
    dashboard.projectDetail && projectIds.has(dashboard.projectDetail.id)
      ? dashboard.projectDetail
      : undefined;
  return {
    attention: dashboard.attention.filter(({ projectId }) =>
      projectIds.has(projectId),
    ),
    ...(projectDetail ? { projectDetail } : {}),
    portfolioStatus: scopePortfolioStatus(
      dashboard.portfolioStatus,
      projectIds,
    ),
    projects: dashboard.projects.filter(({ id }) => projectIds.has(id)),
    taskDetails: projectDetail ? dashboard.taskDetails : [],
    taskStatuses: projectDetail ? dashboard.taskStatuses : [],
  };
}

function withContextDashboard<T extends object>(
  ctx: FactoryContext,
  value: T,
  dashboard: DashboardSnapshot,
): T & { dashboard: DashboardSnapshot } {
  return withDashboard(value, scopeDashboardSnapshot(dashboard, ctx.machine));
}

function withContextDashboardItems<T>(
  ctx: FactoryContext,
  items: T[],
  dashboard: DashboardSnapshot,
): { items: T[]; dashboard: DashboardSnapshot } {
  return withDashboardItems(
    items,
    scopeDashboardSnapshot(dashboard, ctx.machine),
  );
}

function createRouter(
  application: ReturnType<typeof createFactoryApplication>,
  githubStatusReader: GitHubStatusReader,
  t3Coordinator: ReturnType<typeof createT3Coordinator>,
  humanSessionConfigured: boolean,
  idempotencyStore: ReturnType<typeof createIdempotencyStore>,
  mutationMutex = createMutationMutex(),
  backupRestore: BackupRestoreCoordinator,
  t3Sources: readonly T3Source[] = [],
) {
  const sourceAwareCoordinator = t3Coordinator;
  const sourceById = new Map(
    t3Sources.map((source) => [source.sourceId, source]),
  );
  const resolveSourceForContext = (
    ctx: FactoryContext,
    requestedSourceId: string | undefined,
    options: { requireMachineSource?: boolean } = {},
  ): string | undefined => {
    if (requestedSourceId !== undefined) {
      const source = sourceById.get(requestedSourceId);
      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `T3 source ${requestedSourceId} does not exist.`,
        });
      }
      if (ctx.machine && source.machineId !== ctx.machine.machineId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "The machine credential is not authorized for this T3 source.",
        });
      }
      return requestedSourceId;
    }
    if (!ctx.machine) return undefined;
    const matches = t3Sources.filter(
      (source) => source.machineId === ctx.machine?.machineId,
    );
    if (matches.length === 1) return matches[0]?.sourceId;
    if (options.requireMachineSource) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "The machine credential is not bound to exactly one T3 source; provide an authorized --source-id.",
      });
    }
    return undefined;
  };

  const sourceProjectId = (
    input: unknown,
    ctx?: FactoryContext,
  ): string | undefined => {
    const candidate = input as Record<string, unknown> | null | undefined;
    const threadId = candidate?.threadId;
    if (typeof threadId !== "string") return undefined;
    const sourceId =
      typeof candidate?.sourceId === "string" ? candidate.sourceId : undefined;
    const scopedSourceId = ctx
      ? resolveSourceForContext(ctx, sourceId, {
          requireMachineSource: true,
        })
      : sourceId;
    return application.getProjectIdForThread(threadId, scopedSourceId);
  };

  const screenshotTargetProjectId: ProjectIdResolver = (input) => {
    const candidate = input as Record<string, unknown> | null | undefined;
    if (typeof candidate?.screenshotId === "string") {
      return application.getProjectIdForScreenshot(candidate.screenshotId);
    }
    if (typeof candidate?.taskId === "string") {
      return application.getProjectIdForTask(candidate.taskId);
    }
    if (typeof candidate?.subtaskId === "string") {
      return application.getProjectIdForSubtask(candidate.subtaskId);
    }
    return undefined;
  };
  const screenshotTargetSchema = z
    .object({
      subtaskId: z.string().trim().min(1).optional(),
      taskId: z.string().trim().min(1).optional(),
    })
    .refine(
      ({ taskId, subtaskId }) => Boolean(taskId) !== Boolean(subtaskId),
      "Provide exactly one Task or Subtask ID.",
    );

  const projectUpdates = new ProjectUpdateBus(application);
  const serializedMutation = trpc.middleware(async ({ next }) => {
    try {
      return await mutationMutex.run(async () => {
        const result = await next();
        if (!result.ok && result.error.cause instanceof FactoryConflictError) {
          return {
            ...result,
            error: new TRPCError({
              code: "CONFLICT",
              message: result.error.cause.message,
            }),
          };
        }
        return result;
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "Factory server is in maintenance mode."
      ) {
        throw new TRPCError({ code: "CONFLICT", message: error.message });
      }
      throw error;
    }
  });
  const idempotentMutation = trpc.middleware(async ({ ctx, input, next }) => {
    const requestKey = (input as { requestKey?: unknown } | null | undefined)
      ?.requestKey;
    if (typeof requestKey !== "string") return next();

    const scope = idempotencyScope(ctx);
    const payloadDigest = canonicalPayloadDigest(withoutRequestKey(input));
    idempotencyStore.purgeExpired();
    const existing = idempotencyStore.get(scope, requestKey);
    if (existing) {
      if (existing.payloadDigest !== payloadDigest) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "request key reused with a different payload",
        });
      }
      return {
        data: JSON.parse(existing.response),
        marker: "middlewareMarker",
        ok: true,
      } as never;
    }

    const result = await next();
    if (!result.ok) return result;
    idempotencyStore.put({
      createdAt: new Date().toISOString(),
      payloadDigest,
      requestKey,
      response: JSON.stringify(result.data),
      scope,
    });
    return result;
  });
  const backupOperation = trpc.middleware(async ({ next }) => {
    if (mutationMutex.isInMaintenance()) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Factory server is in maintenance mode.",
      });
    }
    return next();
  });

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
    session: trpc.router({
      whoami: scopedProcedure().query(({ ctx }) => ({
        human: ctx.human ? { name: ctx.human.name } : null,
        machine: ctx.machine
          ? {
              machineId: ctx.machine.machineId,
              projectIds: ctx.machine.projectIds,
            }
          : null,
      })),
    }),
    backups: trpc.router({
      status: humanProcedure().query(() => backupRestore.status()),
      list: humanProcedure().query(() => backupRestore.list()),
      create: humanProcedure()
        .input(
          z
            .object({
              trigger: z
                .enum(["manual", "pre-deploy"] as const)
                .default("manual"),
            })
            .optional(),
        )
        .use(backupOperation)
        .mutation(({ input }) =>
          backupRestore.create(input?.trigger ?? "manual"),
        ),
      updateSettings: humanProcedure()
        .input(
          z.object({
            enabled: z.boolean(),
            intervalMinutes: z.number().int().positive(),
            keepRecent: z.number().int().nonnegative(),
            keepDaily: z.number().int().nonnegative(),
          }),
        )
        .use(backupOperation)
        .mutation(({ input }) => backupRestore.updateSettings(input)),
      delete: humanProcedure()
        .input(z.object({ backupId: z.string().trim().min(1) }))
        .use(backupOperation)
        .mutation(({ input }) => backupRestore.delete(input.backupId)),
      restore: humanProcedure()
        .input(
          z.object({
            backupId: z.string().trim().min(1),
            confirm: z.literal(true),
          }),
        )
        .mutation(async ({ input }) => {
          if (mutationMutex.isInMaintenance()) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Factory server is in maintenance mode.",
            });
          }
          const prepared = await backupRestore.prepareRestore(input.backupId);
          return { ...prepared, status: "restarting" as const };
        }),
    }),
    screenshots: trpc.router({
      upload: scopedProcedure(screenshotTargetProjectId)
        .input(
          z
            .object({
              capturedAt: z.string().trim().min(1).optional(),
              captureContext: z.string().trim().max(500).optional(),
              caption: z.string().trim().min(1).max(2_000),
              contentType: z.enum(
                SCREENSHOT_CONTENT_TYPES as readonly [
                  ScreenshotContentType,
                  ...ScreenshotContentType[],
                ],
              ),
              dataBase64: z.string().min(4).max(7_000_000),
              label: z.enum(["before", "after"]).optional(),
              pairId: z.string().trim().max(200).optional(),
              requestKey: requestKeySchema.optional(),
              subtaskId: z.string().trim().min(1).optional(),
              taskId: z.string().trim().min(1).optional(),
              testedRevision: z.string().trim().max(200).optional(),
            })
            .refine(
              ({ taskId, subtaskId }) => Boolean(taskId) !== Boolean(subtaskId),
              "Provide exactly one Task or Subtask ID.",
            ),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const uploader = ctx.machine?.machineId ?? ctx.human?.name;
          if (!uploader) throw new TRPCError({ code: "UNAUTHORIZED" });
          const { requestKey: _requestKey, ...evidenceInput } = input;
          let evidence;
          try {
            evidence = application.addScreenshotEvidence({
              ...evidenceInput,
              uploader,
              uploaderKind: ctx.machine ? "machine" : "human",
            });
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error instanceof Error ? error.message : String(error),
            });
          }
          const projectId = screenshotTargetProjectId(input);
          if (!projectId)
            throw new Error("Screenshot Project could not be resolved.");
          return withContextDashboard(
            ctx,
            evidence,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      list: scopedProcedure(screenshotTargetProjectId)
        .input(screenshotTargetSchema)
        .query(({ input }) => application.listScreenshotEvidence(input)),
      get: scopedProcedure(screenshotTargetProjectId)
        .input(z.object({ screenshotId: z.string().trim().min(1) }))
        .query(({ input }) =>
          application.getScreenshotEvidence(input.screenshotId),
        ),
    }),
    projects: trpc.router({
      create: humanProcedure()
        .input(
          z.object({
            gitOriginUrl: z.string().trim().min(1).optional(),
            name: z.string().min(1),
            t3Mappings: t3MappingsSchema.optional(),
            t3ProjectId: z.string().trim().min(1).optional(),
            workspaceRoot: z.string().trim().min(1).optional(),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) =>
          withContextDashboard(
            ctx,
            application.createProject(input),
            application.getDashboardSnapshot(),
          ),
        ),
      update: humanProcedure()
        .input(
          z.object({
            gitOriginUrl: z.string().trim().min(1).nullable(),
            projectId: z.string().min(1),
            t3Mappings: t3MappingsSchema.nullable().optional(),
            t3ProjectId: z.string().trim().min(1).nullable().optional(),
            workspaceRoot: z.string().trim().min(1).nullable().optional(),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const project = application.updateProject(input);
          return withContextDashboard(
            ctx,
            project,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      remove: humanProcedure()
        .input(
          z.object({
            confirm: z.literal(true),
            projectId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          application.removeProject(input.projectId);
          projectUpdates.publishAll();
          return withContextDashboard(
            ctx,
            { projectId: input.projectId },
            application.getDashboardSnapshot(),
          );
        }),
      link: humanProcedure()
        .input(
          z.object({
            projectId: z.string().min(1),
            stableId: z.string().min(1),
            system: z.enum(["linear", "notion"]),
            title: z.string().optional(),
            url: z.string().url(),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const link = application.addProjectTrackerLink(input);
          return withContextDashboard(
            ctx,
            link,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      list: scopedProcedure().query(({ ctx }) => {
        const projects = application.listProjects();
        return ctx.machine
          ? projects.filter(({ id }) => ctx.machine!.projectIds.includes(id))
          : projects;
      }),
      attention: scopedProcedure().query(({ ctx }) => {
        const attention = application.getAttentionProjection();
        return ctx.machine
          ? attention.filter(({ projectId }) =>
              ctx.machine!.projectIds.includes(projectId),
            )
          : attention;
      }),
      portfolio: scopedProcedure().query(({ ctx }) => {
        const portfolio = application.getPortfolioStatus();
        return ctx.machine
          ? scopePortfolioStatus(portfolio, new Set(ctx.machine.projectIds))
          : portfolio;
      }),
      snapshot: scopedProcedure(fieldProjectId("projectId"))
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ ctx, input }) =>
          scopeDashboardSnapshot(
            application.getDashboardSnapshot(input.projectId),
            ctx.machine,
          ),
        ),
      status: scopedProcedure(fieldProjectId("projectId"))
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => application.getProjectStatus(input.projectId)),
      detail: scopedProcedure(fieldProjectId("projectId"))
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
      context: scopedProcedure(fieldProjectId("projectId"))
        .input(
          z.object({
            branchName: z.string().trim().min(1).optional(),
            projectId: z.string().min(1),
          }),
        )
        .query(({ input }) => {
          const hierarchy = application.getProjectHierarchy(input.projectId);
          const projectDetail = application.getProjectDetail(input.projectId);
          let tasks = hierarchy.tasks.map((task) => ({
            ...application.getTaskDetail(task.id),
            subtasks: task.subtasks,
          }));
          if (input.branchName) {
            tasks = tasks.filter(
              (task) => task.branchName === input.branchName,
            );
            if (tasks.length === 0) {
              throw new Error(
                `No Factory Task in Project ${input.projectId} matches branch ${input.branchName}.`,
              );
            }
            if (tasks.length > 1) {
              throw new Error(
                `Branch ${input.branchName} matches multiple Factory Tasks in Project ${input.projectId}: ${tasks
                  .map((task) => task.id)
                  .join(", ")}.`,
              );
            }
          }
          return {
            id: hierarchy.id,
            name: hierarchy.name,
            ...(hierarchy.gitOriginUrl
              ? { gitOriginUrl: hierarchy.gitOriginUrl }
              : {}),
            ...(hierarchy.t3Mappings
              ? { t3Mappings: hierarchy.t3Mappings }
              : {}),
            ...(hierarchy.workspaceRoot
              ? { workspaceRoot: hierarchy.workspaceRoot }
              : {}),
            trackerLinks: projectDetail.trackerLinks,
            tasks,
          };
        }),
      brief: scopedProcedure(fieldProjectId("projectId"))
        .input(z.object({ projectId: z.string().min(1) }))
        .query(({ input }) => {
          const project = application
            .listProjects()
            .find((candidate) => candidate.id === input.projectId);
          if (!project) {
            throw new Error(`Project ${input.projectId} does not exist.`);
          }
          const hierarchy = application.getProjectHierarchy(input.projectId);
          const taskDetails = hierarchy.tasks.map((task) =>
            application.getTaskDetail(task.id),
          );
          const taskStatuses = hierarchy.tasks.map((task) =>
            application.getTaskStatus(task.id),
          );
          const reports = Object.fromEntries(
            hierarchy.tasks.flatMap((task) =>
              task.subtasks.map((subtask) => [
                subtask.id,
                application.getSubtaskReportHistory(subtask.id),
              ]),
            ),
          );
          return {
            hierarchy,
            project,
            projectDetail: application.getProjectDetail(input.projectId),
            reports,
            taskDetails,
            taskStatuses,
          };
        }),
      updates: scopedProcedure(fieldProjectId("projectId"))
        .input(z.object({ projectId: z.string().min(1) }))
        .subscription(({ ctx, input }) =>
          observable<DashboardSnapshot>((emit) =>
            projectUpdates.subscribe(input.projectId, (snapshot) =>
              emit.next(scopeDashboardSnapshot(snapshot, ctx.machine)),
            ),
          ),
        ),
    }),
    t3: trpc.router({
      status: scopedProcedure((input) => {
        const projectId = (input as { projectId?: unknown } | null | undefined)
          ?.projectId;
        return typeof projectId === "string" ? projectId : undefined;
      })
        .input(
          z
            .object({
              projectId: z.string().min(1).optional(),
              sourceId: sourceIdSchema.optional(),
            })
            .nullable()
            .optional(),
        )
        .query(({ ctx, input }) => {
          const sourceId = resolveSourceForContext(ctx, input?.sourceId, {
            requireMachineSource: true,
          });
          return sourceAwareCoordinator.status(input?.projectId, sourceId);
        }),
      projectActivity: scopedProcedure(fieldProjectId("projectId"))
        .input(
          z.object({
            projectId: z.string().min(1),
            sourceId: sourceIdSchema.optional(),
          }),
        )
        .query(({ ctx, input }) => {
          const sourceId = resolveSourceForContext(ctx, input.sourceId, {
            requireMachineSource: true,
          });
          return sourceAwareCoordinator.projectActivity(
            input.projectId,
            sourceId,
          );
        }),
      threadDetail: scopedProcedure((input, ctx) => {
        const threadId = (input as { threadId?: unknown } | undefined)
          ?.threadId;
        return typeof threadId === "string"
          ? sourceProjectId(input, ctx)
          : undefined;
      })
        .input(
          z.object({
            sourceId: sourceIdSchema.optional(),
            threadId: z.string().min(1),
            turnLimit: z.number().int().min(1).max(10).default(1),
          }),
        )
        .query(({ ctx, input }) => {
          const sourceId = resolveSourceForContext(ctx, input.sourceId, {
            requireMachineSource: true,
          });
          return sourceAwareCoordinator.threadDetail(
            input.threadId,
            input.turnLimit,
            sourceId,
          );
        }),
      linkThread: scopedProcedure(fieldProjectId("projectId"))
        .input(
          z.object({
            projectId: z.string().min(1),
            subtaskId: z.string().min(1).optional(),
            sourceId: sourceIdSchema.optional(),
            taskId: z.string().min(1).optional(),
            threadId: z.string().min(1),
            requestKey: requestKeySchema.optional(),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const sourceId = resolveSourceForContext(ctx, input.sourceId, {
            requireMachineSource: true,
          });
          const result = sourceAwareCoordinator.linkThread({
            ...input,
            ...(sourceId === undefined ? {} : { sourceId }),
          });
          return withContextDashboard(
            ctx,
            result,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      autoLinkThread: scopedProcedure(fieldProjectId("projectId"))
        .input(
          z.object({
            branchName: z.string().min(1),
            projectId: z.string().min(1),
            sourceId: sourceIdSchema.optional(),
            threadId: z.string().min(1).optional(),
            taskId: z.string().min(1).optional(),
            subtaskId: z.string().min(1).optional(),
            requestKey: requestKeySchema.optional(),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(async ({ ctx, input }) => {
          // Let the coordinator report an ambiguous or unmatched automatic
          // link when a machine cannot be selected uniquely.
          const sourceId = resolveSourceForContext(ctx, input.sourceId);
          const result = await sourceAwareCoordinator.autoLinkThread({
            ...input,
            ...(sourceId === undefined ? {} : { sourceId }),
            ...(ctx.machine ? { machineId: ctx.machine.machineId } : {}),
          });
          const dashboard =
            result.status === "linked"
              ? (projectUpdates.publish(input.projectId) ??
                application.getDashboardSnapshot(input.projectId))
              : application.getDashboardSnapshot(input.projectId);
          return withContextDashboard(ctx, result, dashboard);
        }),
      unlinkThread: scopedProcedure((input, ctx) => {
        const threadId = (input as { threadId?: unknown } | undefined)
          ?.threadId;
        return typeof threadId === "string"
          ? sourceProjectId(input, ctx)
          : undefined;
      })
        .input(
          z.object({
            associationId: z.string().min(1).optional(),
            sourceId: sourceIdSchema.optional(),
            threadId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const sourceId = resolveSourceForContext(ctx, input.sourceId, {
            requireMachineSource: true,
          });
          const result = sourceAwareCoordinator.unlinkThread(
            input.threadId,
            input.associationId,
            sourceId,
          );
          return withContextDashboard(
            ctx,
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
      create: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(
          z.object({
            description: z.string().optional(),
            name: z.string().min(1),
            pullRequestUrl: z.string().nullable().optional(),
            requestKey: requestKeySchema.optional(),
            taskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const subtask = application.createSubtask(input);
          const projectId = application.getProjectIdForTask(input.taskId);
          return withContextDashboard(
            ctx,
            subtask,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      update: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
        .input(
          z.object({
            description: z.string().nullable().optional(),
            evidence: z.string().nullable().optional(),
            expectedRevision: z.number().int().min(1).optional(),
            name: z.string().trim().min(1).optional(),
            pullRequestUrl: z.string().nullable().optional(),
            requestKey: requestKeySchema.optional(),
            subtaskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForSubtask(input.subtaskId);
          const subtask = application.updateSubtask(input);
          return withContextDashboard(
            ctx,
            subtask,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      remove: humanProcedure()
        .input(
          z.object({
            confirm: z.literal(true),
            subtaskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForSubtask(input.subtaskId);
          application.removeSubtask(input.subtaskId);
          return withContextDashboard(
            ctx,
            { subtaskId: input.subtaskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      report: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
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
            requestKey: requestKeySchema.optional(),
            sessionRef: z
              .object({
                externalThreadId: z.string().min(1),
                provider: z.literal("t3"),
                sourceId: sourceIdSchema.optional(),
              })
              .optional(),
            subtaskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForSubtask(input.subtaskId);
          const sourceId = resolveSourceForContext(
            ctx,
            input.sessionRef?.sourceId,
            input.sessionRef === undefined
              ? {}
              : { requireMachineSource: true },
          );
          const report = application.reportSubtaskStatus({
            ...input,
            ...(ctx.machine ? { machineId: ctx.machine.machineId } : {}),
            ...(input.sessionRef
              ? {
                  sessionRef: {
                    ...input.sessionRef,
                    ...(sourceId === undefined ? {} : { sourceId }),
                  },
                }
              : {}),
          });
          return withContextDashboard(
            ctx,
            report,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      archive: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            subtaskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForSubtask(input.subtaskId);
          application.archiveSubtask(input.subtaskId, input.archiveState);
          return withContextDashboard(
            ctx,
            {
              archiveState: input.archiveState,
              subtaskId: input.subtaskId,
            },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      restore: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
        .input(z.object({ subtaskId: z.string().min(1) }))
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForSubtask(input.subtaskId);
          application.restoreSubtask(input.subtaskId);
          return withContextDashboard(
            ctx,
            { subtaskId: input.subtaskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      reorder: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(
          z.object({
            orderedSubtaskIds: z.array(z.string().min(1)).min(1),
            taskId: z.string().min(1),
            workState: workStateSchema,
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const result = application.reorderSubtasks(input);
          const projectId = application.getProjectIdForTask(input.taskId);
          return withContextDashboardItems(
            ctx,
            result,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      verify: humanProcedure(
        humanSessionConfigured
          ? "A human session is required to verify status reports."
          : "Human session not configured; verification is unavailable.",
      )
        .input(
          z.object({
            decision: z.enum(["accepted", "rejected", "deferred"]),
            reportId: z.string().min(1),
            reason: z.string().trim().min(1).optional(),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getStatusReportProjectId(
            input.reportId,
          );
          application.verifyStatusReport({
            ...input,
            verifier: ctx.human!.name,
          });
          return withContextDashboard(
            ctx,
            { ok: true },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      history: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          application.getSubtaskReportHistory(input.subtaskId),
        ),
      detail: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) => application.getSubtaskDetail(input.subtaskId)),
      verifications: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          application.getSubtaskVerificationHistory(input.subtaskId),
        ),
      githubStatus: scopedProcedure((input) => {
        const subtaskId = (input as { subtaskId?: unknown } | undefined)
          ?.subtaskId;
        return typeof subtaskId === "string"
          ? application.getProjectIdForSubtask(subtaskId)
          : undefined;
      })
        .input(z.object({ subtaskId: z.string().min(1) }))
        .query(({ input }) =>
          githubStatus(
            application.getSubtaskDetail(input.subtaskId).pullRequestUrl,
          ),
        ),
    }),
    tasks: trpc.router({
      create: scopedProcedure(fieldProjectId("projectId"))
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
            requestKey: requestKeySchema.optional(),
            repositoryLinks: z.array(z.string().url()).default([]),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const task = application.createTask(input);
          return withContextDashboard(
            ctx,
            task,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      remove: humanProcedure()
        .input(
          z.object({
            confirm: z.literal(true),
            taskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForTask(input.taskId);
          application.removeTask(input.taskId);
          return withContextDashboard(
            ctx,
            { taskId: input.taskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      status: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskStatus(input.taskId)),
      detail: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) => application.getTaskDetail(input.taskId)),
      githubStatus: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(z.object({ taskId: z.string().min(1) }))
        .query(({ input }) =>
          githubStatus(application.getTaskDetail(input.taskId).pullRequestUrl),
        ),
      update: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(
          z.object({
            acceptanceCriteria: z.array(z.string()).optional(),
            branchName: z.string().trim().min(1).nullable().optional(),
            expectedRevision: z.number().int().min(1).optional(),
            name: z.string().trim().min(1).optional(),
            objective: z.string().nullable().optional(),
            pullRequestUrl: z.string().nullable().optional(),
            requestKey: requestKeySchema.optional(),
            taskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const task = application.updateTask(input);
          return withContextDashboard(
            ctx,
            task,
            dashboardAfterPublish(application, projectUpdates, task.projectId),
          );
        }),
      archive: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(
          z.object({
            archiveState: z.enum(["released", "wont_do"]),
            taskId: z.string().min(1),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForTask(input.taskId);
          application.archiveTask(input.taskId, input.archiveState);
          return withContextDashboard(
            ctx,
            {
              archiveState: input.archiveState,
              taskId: input.taskId,
            },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      restore: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(z.object({ taskId: z.string().min(1) }))
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const projectId = application.getProjectIdForTask(input.taskId);
          application.restoreTask(input.taskId);
          return withContextDashboard(
            ctx,
            { taskId: input.taskId },
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
      reorder: scopedProcedure(fieldProjectId("projectId"))
        .input(
          z.object({
            orderedTaskIds: z.array(z.string().min(1)).min(1),
            projectId: z.string().min(1),
            workState: workStateSchema,
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const result = application.reorderTasks(input);
          return withContextDashboardItems(
            ctx,
            result,
            dashboardAfterPublish(application, projectUpdates, input.projectId),
          );
        }),
      resumeRollup: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(z.object({ taskId: z.string().min(1) }))
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const result = application.resumeTaskRollup(input.taskId);
          return withContextDashboard(
            ctx,
            result,
            dashboardAfterPublish(
              application,
              projectUpdates,
              result.projectId,
            ),
          );
        }),
      setState: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(
          z.object({
            reason: z.string().trim().min(1).optional(),
            taskId: z.string().min(1),
            workState: editableTaskStateSchema,
            requestKey: requestKeySchema.optional(),
          }),
        )
        .use(serializedMutation)
        .use(idempotentMutation)
        .mutation(({ ctx, input }) => {
          const result = application.setTaskWorkState(input);
          return withContextDashboard(
            ctx,
            result,
            dashboardAfterPublish(
              application,
              projectUpdates,
              result.projectId,
            ),
          );
        }),
      link: scopedProcedure((input) => {
        const taskId = (input as { taskId?: unknown } | undefined)?.taskId;
        return typeof taskId === "string"
          ? application.getProjectIdForTask(taskId)
          : undefined;
      })
        .input(
          z.object({
            system: z.enum(["linear", "notion"]),
            stableId: z.string().min(1),
            taskId: z.string().min(1),
            title: z.string().optional(),
            url: z.string().url(),
          }),
        )
        .use(serializedMutation)
        .mutation(({ ctx, input }) => {
          const link = application.addTaskTrackerLink(input);
          const projectId = application.getProjectIdForTask(input.taskId);
          return withContextDashboard(
            ctx,
            link,
            dashboardAfterPublish(application, projectUpdates, projectId),
          );
        }),
    }),
  });
}

export type FactoryRouter = ReturnType<typeof createRouter>;

export type FactoryServerOptions = {
  backupDirectory?: string;
  backupRequireNfs?: boolean;
  backupService?: BackupService;
  databasePath: string;
  environment?: FactoryEnvironment;
  githubToken?: string;
  hostname: string;
  operator?: FactoryOperator;
  port: number;
  requireExistingDatabase?: boolean;
  revision?: string;
  shutdownTimeoutMs?: number;
  allowedOrigins?: string[];
  t3AccessToken?: string;
  t3BaseUrl?: string;
  t3Sources?: T3Source[];
  t3TimeoutMs?: number;
  onRestorePrepared?: (prepared: RestorePreparation) => void | Promise<void>;
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

  const configuredT3SourcesFile = environment.FACTORY_T3_SOURCES_FILE?.trim();
  const t3Sources = configuredT3SourcesFile
    ? resolveT3Sources(environment, {
        ...(t3TimeoutMs === undefined ? {} : { timeoutMs: t3TimeoutMs }),
      })
    : undefined;
  const t3BaseUrl = configuredT3SourcesFile
    ? undefined
    : configuredT3BaseUrl
      ? normalizeT3BaseUrl(configuredT3BaseUrl)
      : undefined;
  const t3AccessToken = configuredT3SourcesFile
    ? undefined
    : resolveT3AccessToken(environment);
  const factoryEnvironment = resolveFactoryEnvironment(environment);
  const configuredRequireExistingDatabase =
    resolveRequireExistingDatabase(environment);
  const requireExistingDatabase =
    factoryEnvironment === "production" &&
    environment.FACTORY_REQUIRE_EXISTING_DB?.trim() === "false"
      ? (() => {
          throw new Error(
            "FACTORY_REQUIRE_EXISTING_DB cannot be false in production.",
          );
        })()
      : environment.FACTORY_REQUIRE_EXISTING_DB?.trim()
        ? configuredRequireExistingDatabase
        : factoryEnvironment === "production";
  const shutdownTimeoutMs = resolveShutdownTimeout(environment);
  const githubToken = resolveGitHubToken(environment);
  const revision = resolveRevision(environment);
  const operator = resolveFactoryOperator(environment);
  const allowedOrigins = (environment.FACTORY_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    ...(environment.FACTORY_BACKUP_DIR?.trim()
      ? { backupDirectory: environment.FACTORY_BACKUP_DIR.trim() }
      : {}),
    ...(environment.FACTORY_BACKUP_REQUIRE_NFS?.trim()
      ? {
          backupRequireNfs: parseBooleanEnvironment(
            "FACTORY_BACKUP_REQUIRE_NFS",
            environment.FACTORY_BACKUP_REQUIRE_NFS,
          ),
        }
      : {}),
    databasePath: environment.FACTORY_DB ?? "factory.sqlite",
    ...(environment.FACTORY_ENVIRONMENT?.trim()
      ? { environment: factoryEnvironment }
      : {}),
    ...(githubToken ? { githubToken } : {}),
    hostname: environment.FACTORY_HOST ?? "127.0.0.1",
    ...(operator ? { operator } : {}),
    port,
    ...(environment.FACTORY_REQUIRE_EXISTING_DB?.trim() ||
    factoryEnvironment === "production"
      ? { requireExistingDatabase }
      : {}),
    ...(revision ? { revision } : {}),
    ...(environment.FACTORY_SHUTDOWN_TIMEOUT_MS?.trim()
      ? { shutdownTimeoutMs }
      : {}),
    ...(allowedOrigins.length > 0 ? { allowedOrigins } : {}),
    ...(t3AccessToken ? { t3AccessToken } : {}),
    ...(t3BaseUrl ? { t3BaseUrl } : {}),
    ...(t3Sources === undefined ? {} : { t3Sources }),
    ...(t3TimeoutMs === undefined ? {} : { t3TimeoutMs }),
  };
}

function parseBooleanEnvironment(name: string, configured: string): boolean {
  const value = configured.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(
    `${name} must be true or false; received ${JSON.stringify(configured)}.`,
  );
}

export function createFactoryServer({
  backupDirectory,
  backupRequireNfs = false,
  backupService,
  allowedOrigins = [],
  databasePath = "factory.sqlite",
  environment: configuredFactoryEnvironment,
  githubStatusReader,
  githubToken,
  hostname = "127.0.0.1",
  operator,
  port,
  requireExistingDatabase: configuredRequireExistingDatabase,
  revision,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  t3AccessToken: _t3AccessToken,
  t3BaseUrl: _t3BaseUrl,
  t3Sources: configuredT3Sources,
  t3TimeoutMs: _t3TimeoutMs,
  t3ActivityReader,
  onRestorePrepared: configuredOnRestorePrepared,
}: {
  backupDirectory?: string;
  backupRequireNfs?: boolean;
  backupService?: BackupService;
  allowedOrigins?: string[];
  databasePath?: string;
  environment?: FactoryEnvironment;
  githubStatusReader?: GitHubStatusReader;
  githubToken?: string;
  hostname?: string;
  operator?: FactoryOperator;
  port: number;
  requireExistingDatabase?: boolean;
  revision?: string;
  shutdownTimeoutMs?: number;
  t3AccessToken?: string;
  t3BaseUrl?: string;
  t3Sources?: T3Source[];
  t3TimeoutMs?: number;
  t3ActivityReader?: T3ActivityReader;
  onRestorePrepared?: (prepared: RestorePreparation) => void | Promise<void>;
}): FactoryServer {
  const factoryEnvironment = configuredFactoryEnvironment ?? "development";
  const requireExistingDatabase =
    configuredRequireExistingDatabase ?? factoryEnvironment === "production";
  applyPendingRestore(databasePath);
  if (requireExistingDatabase) {
    try {
      checkFactoryDatabase({ databasePath, requireSnapshot: true });
      assertDatabaseWritable(databasePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `FACTORY_REQUIRE_EXISTING_DB=true requires a compatible existing Factory database: ${detail}`,
      );
    }
  }
  const configuredOperator =
    operator && operator.name.trim() && operator.secret
      ? { ...operator, name: operator.name.trim() }
      : undefined;
  let shuttingDown = false;
  const sockets = new Set<Bun.ServerWebSocket<SocketData>>();
  const application = createFactoryApplication({
    databasePath,
    refreshBeforeOperations: false,
  });
  const humanSessions = createHumanSessionStore({ databasePath });
  const machineCredentials = createMachineCredentialStore({ databasePath });
  const idempotencyStore = createIdempotencyStore({ databasePath });
  const mutationMutex = createMutationMutex();
  let onRestorePrepared: (
    prepared: RestorePreparation,
  ) => void | Promise<void> = async () => undefined;
  const backupRestore = createBackupRestoreCoordinator({
    databasePath,
    gate: mutationMutex,
    service:
      backupService ??
      (backupDirectory
        ? createBackupService({
            databasePath,
            directory: backupDirectory,
            requireNfs: backupRequireNfs,
            revision,
          })
        : createDisabledBackupService()),
    onRestorePrepared: (prepared) => onRestorePrepared(prepared),
  });
  const legacyReader =
    t3ActivityReader ??
    createT3ActivityReader({
      baseUrl: _t3BaseUrl,
      timeoutMs: _t3TimeoutMs,
      token: _t3AccessToken,
    });
  const t3Sources =
    configuredT3Sources ??
    ([
      {
        accessTokenFile: "<legacy-server-config>",
        baseUrl: _t3BaseUrl ?? "http://127.0.0.1:3773",
        label: "Legacy T3",
        machineId:
          Bun.env.FACTORY_T3_MACHINE_ID?.trim() || DEFAULT_T3_MACHINE_ID,
        reader: legacyReader,
        sourceId: LEGACY_T3_SOURCE_ID,
      },
    ] satisfies T3Source[]);
  const t3Coordinator = createT3Coordinator({
    application,
    reader: legacyReader,
    sources: t3Sources,
  });
  const router = createRouter(
    application,
    githubStatusReader ?? createGitHubStatusReader({ token: githubToken }),
    t3Coordinator,
    configuredOperator !== undefined,
    idempotencyStore,
    mutationMutex,
    backupRestore,
    t3Sources,
  );
  const deploymentIdentity = {
    apiVersion: FACTORY_API_VERSION,
    revision: revision?.trim() || Bun.env.FACTORY_REVISION?.trim() || "dev",
    schemaVersion: 1 as const,
    ...(configuredFactoryEnvironment
      ? { environment: factoryEnvironment }
      : {}),
  };
  const optionalIntegrations = {
    github: githubToken ? "configured" : "unavailable",
    t3:
      configuredT3Sources?.length || _t3BaseUrl || _t3AccessToken
        ? "configured"
        : "unavailable",
  } as const;
  const checkReadiness = (): {
    database: "ok" | "unavailable";
    staticAssets: "ok" | "unavailable";
  } => ({
    database:
      !shuttingDown && databaseIsReady(databasePath, requireExistingDatabase)
        ? "ok"
        : "unavailable",
    staticAssets:
      !shuttingDown && staticAssetsAreReady() ? "ok" : "unavailable",
  });
  const resolveContext = (
    headers: Headers | Record<string, string | string[] | undefined>,
  ): FactoryContext => {
    const human = configuredOperator
      ? humanSessions.get(getHumanSessionToken(getHeader(headers, "cookie")))
      : null;
    return {
      human,
      machine: human
        ? null
        : machineCredentials.authenticate(
            resolveMachineToken(getHeader(headers, "authorization")),
          ),
    };
  };
  const onConnection = getWSConnectionHandler({
    createContext: ({ req }) => resolveContext(req.headers),
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
        if (mutationMutex.isInMaintenance()) {
          return jsonResponse(
            { error: "Factory server is in maintenance mode." },
            { status: 503 },
          );
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
        if (mutationMutex.isInMaintenance()) {
          return jsonResponse(
            { error: "Factory server is in maintenance mode." },
            { status: 503 },
          );
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

      if (url.pathname === "/version" && request.method === "GET") {
        return jsonResponse(deploymentIdentity);
      }

      if (url.pathname === "/deployment.json" && request.method === "GET") {
        return jsonResponse(deploymentIdentity);
      }

      if (url.pathname === "/healthz" && request.method === "GET") {
        return jsonResponse({ status: "ok" });
      }

      if (url.pathname === "/readyz" && request.method === "GET") {
        const checks = checkReadiness();
        const ready = checks.database === "ok" && checks.staticAssets === "ok";
        return jsonResponse(
          {
            checks,
            integrations: optionalIntegrations,
            ready,
            status: ready ? "ready" : "not_ready",
          },
          { status: ready ? 200 : 503 },
        );
      }

      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        if (!originAllowed(request, allowedOrigins)) {
          return new Response("Forbidden", { status: 403 });
        }
        if (url.pathname === "/api/projects.updates") {
          return new Response("Not Found", { status: 404 });
        }
        return fetchRequestHandler({
          createContext: ({ req }) => resolveContext(req.headers),
          endpoint: "/api",
          req: request,
          router,
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
        sockets.add(socket);
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
        sockets.delete(socket);
        emit(socket.data, "close");
      },
    },
  });

  // `BackupService.start()` may have an in-flight initial filesystem probe.
  // Keep shutdown behind that promise so a test/operator stop cannot remove
  // the configured backup directory while its worker is still reading it.
  let backupStartPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  const stopServer = (
    options: { timeoutMs?: number; forRestore?: boolean } = {},
  ): Promise<void> => {
    if (!stopPromise) {
      shuttingDown = true;
      const timeoutMs = options.timeoutMs ?? shutdownTimeoutMs;
      stopPromise = (async () => {
        backupRestore.stop();
        await backupStartPromise?.catch(() => undefined);
        return stopServerResources({
          application,
          closeWebSockets: () => {
            for (const socket of sockets) socket.terminate();
            sockets.clear();
          },
          forceStop: () => server.stop(true),
          humanSessions,
          idempotencyStore,
          machineCredentials,
          mutationMutex,
          stopListening: () =>
            stopListeningGracefully(
              () => server.stop(false),
              () => server.stop(true),
              Math.min(timeoutMs, 250),
            ),
          drainMutations: !options.forRestore,
          timeoutMs,
        });
      })();
    }
    return stopPromise;
  };
  onRestorePrepared =
    configuredOnRestorePrepared ??
    (() => {
      // Let the tRPC response carrying the durable preparation identifiers
      // leave the process before the listener is stopped. The maintenance gate
      // remains closed during this short handoff window.
      setTimeout(() => {
        void stopServer({ forRestore: true });
      }, 25);
    });
  backupStartPromise = backupRestore.start().catch((error) => {
    console.error(
      `Factory backup service failed to start: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  return {
    stop: stopServer,
    shutdownTimeoutMs,
    url: server.url,
  };
}

async function stopServerResources({
  application,
  closeWebSockets,
  forceStop,
  stopListening,
  humanSessions,
  idempotencyStore,
  machineCredentials,
  mutationMutex,
  drainMutations = true,
  timeoutMs,
}: {
  application: ReturnType<typeof createFactoryApplication>;
  closeWebSockets: () => void;
  forceStop: () => void | Promise<void>;
  stopListening: () => void | Promise<void>;
  humanSessions: ReturnType<typeof createHumanSessionStore>;
  idempotencyStore: ReturnType<typeof createIdempotencyStore>;
  machineCredentials: ReturnType<typeof createMachineCredentialStore>;
  mutationMutex: ReturnType<typeof createMutationMutex>;
  drainMutations?: boolean;
  timeoutMs: number;
}): Promise<void> {
  const gracefulOperation = (async () => {
    if (drainMutations) await mutationMutex.stopAccepting();
    closeWebSockets();
    await stopListening();
  })();

  try {
    await withTimeout(gracefulOperation, timeoutMs);
  } catch {
    // A mutation or transport that does not finish in the bounded window must
    // not keep the process alive. Bun's forceful stop closes active WebSockets.
    try {
      await forceStop();
    } catch {
      // Resource closure below is still required if Bun has already stopped.
    }
  } finally {
    application.close();
    humanSessions.close();
    machineCredentials.close();
    idempotencyStore.close();
  }
}

async function stopListeningGracefully(
  stopListening: () => void | Promise<void>,
  forceStop: () => void | Promise<void>,
  graceMs: number,
): Promise<void> {
  let settled = false;
  const graceful = Promise.resolve()
    .then(stopListening)
    .then(
      () => {
        settled = true;
      },
      (error) => {
        settled = true;
        throw error;
      },
    );
  await Promise.race([
    graceful,
    new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
  ]);
  if (!settled) await forceStop();
}

export function installFactoryServerSignalHandlers(
  server: FactoryServer,
): () => void {
  let shutdownPromise: Promise<void> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const shutdown = () => {
    if (shutdownPromise) return;
    timeout = setTimeout(() => {
      console.error("Factory server shutdown timed out; forcing exit.");
      process.exit(1);
    }, server.shutdownTimeoutMs + 100);
    shutdownPromise = server.stop();
    void shutdownPromise
      .then(
        () => process.exit(0),
        (error) => {
          console.error(
            `Factory server shutdown failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          process.exit(1);
        },
      )
      .finally(() => {
        if (timeout !== undefined) clearTimeout(timeout);
      });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
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

function getHeader(
  headers: Headers | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value.join(",") : value;
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
  const sourceRoot = import.meta.dir;
  if (
    pathname.startsWith("/projects/") ||
    pathname === "/backups" ||
    pathname === "/backups/"
  ) {
    return resolve(sourceRoot, "web/index.html");
  }

  const files: Record<string, string> = {
    "/": resolve(sourceRoot, "web/index.html"),
    "/icon.svg": resolve(sourceRoot, "web/icon.svg"),
    "/icons/icon-192.png": resolve(sourceRoot, "web/icons/icon-192.png"),
    "/icons/icon-512.png": resolve(sourceRoot, "web/icons/icon-512.png"),
    "/icons/apple-touch-icon.png": resolve(
      sourceRoot,
      "web/icons/apple-touch-icon.png",
    ),
    "/manifest.webmanifest": resolve(sourceRoot, "web/manifest.webmanifest"),
    "/main.css": resolve(sourceRoot, "../dist/main.css"),
    "/main.js": resolve(sourceRoot, "../dist/main.js"),
    "/service-worker.js": resolve(sourceRoot, "../dist/service-worker.js"),
    "/fonts/ibm-plex-sans-latin-400-normal.woff2": resolve(
      sourceRoot,
      "web/fonts/ibm-plex-sans-latin-400-normal.woff2",
    ),
    "/fonts/ibm-plex-sans-latin-500-normal.woff2": resolve(
      sourceRoot,
      "web/fonts/ibm-plex-sans-latin-500-normal.woff2",
    ),
    "/fonts/ibm-plex-sans-latin-600-normal.woff2": resolve(
      sourceRoot,
      "web/fonts/ibm-plex-sans-latin-600-normal.woff2",
    ),
    "/fonts/ibm-plex-sans-latin-700-normal.woff2": resolve(
      sourceRoot,
      "web/fonts/ibm-plex-sans-latin-700-normal.woff2",
    ),
    "/fonts/ibm-plex-mono-latin-400-normal.woff2": resolve(
      sourceRoot,
      "web/fonts/ibm-plex-mono-latin-400-normal.woff2",
    ),
    "/fonts/ibm-plex-mono-latin-500-normal.woff2": resolve(
      sourceRoot,
      "web/fonts/ibm-plex-mono-latin-500-normal.woff2",
    ),
    "/fonts/ibm-plex-mono-latin-600-normal.woff2": resolve(
      sourceRoot,
      "web/fonts/ibm-plex-mono-latin-600-normal.woff2",
    ),
  };

  return files[pathname] ?? null;
}

function staticAssetsAreReady(): boolean {
  return ["/", "/main.css", "/main.js", "/service-worker.js"].every(
    (pathname) => {
      const file = getStaticFile(pathname);
      return file !== null && existsSync(file);
    },
  );
}

function databaseIsReady(
  databasePath: string,
  requireExistingDatabase: boolean,
): boolean {
  // A memory database belongs to the running application and cannot be
  // inspected by checkFactoryDatabase's independent read-only connection.
  if (databasePath === ":memory:") return true;
  try {
    checkFactoryDatabase({
      databasePath,
      requireSnapshot: requireExistingDatabase,
    });
    assertDatabaseWritable(databasePath);
    return true;
  } catch {
    return false;
  }
}

function assertDatabaseWritable(databasePath: string): void {
  const resolvedDatabasePath = resolve(databasePath);
  accessSync(resolve(resolvedDatabasePath, ".."), constants.W_OK);
  accessSync(resolvedDatabasePath, constants.W_OK);

  // Exercise the same SQLite write path used by snapshot upserts without
  // changing the durable state.
  const database = new Database(resolvedDatabasePath);
  try {
    database.exec("BEGIN IMMEDIATE; ROLLBACK;");
  } finally {
    database.close();
  }
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
  const options = getFactoryServerOptions(Bun.env);
  const server = createFactoryServer(options);
  installFactoryServerSignalHandlers(server);
  console.info(`Software Factory listening at ${server.url}`);
}
