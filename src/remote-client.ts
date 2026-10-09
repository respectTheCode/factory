import { Buffer } from "node:buffer";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  createTRPCProxyClient,
  httpLink,
  isTRPCClientError,
} from "@trpc/client";

import type {
  FactoryApplication,
  Project,
  ProjectHierarchy,
  ProjectMetadata,
  ProjectSummary,
  StatusReport,
  Subtask,
  Task,
  TaskDetail,
  TaskFinishMetadata,
  TaskFinishRule,
  TaskPullRequestMergeEvidence,
  TaskPullRequestRequirement,
  TaskRequiredPullRequest,
  TaskStatus,
  TaskStatusReport,
  TaskStatusVerification,
  TrackerLink,
  Verification,
  WorkState,
} from "./application";
import { FACTORY_API_VERSION } from "./api-version";
import type { GitHubStatusSnapshot } from "./github";
import type { T3ProjectMapping } from "./t3-source-identity";
import type { FactoryRouter } from "./server";
import type {
  ScreenshotContentType,
  ScreenshotEvidence,
  ScreenshotEvidenceSummary,
} from "./screenshot-evidence";

export const MAX_FACTORY_ACCESS_TOKEN_BYTES = 16 * 1024;
export const FACTORY_REMOTE_TIMEOUT_MS = 10_000;
export const FACTORY_REQUEST_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

export type FactoryRequestKeyInput = {
  requestKey?: string;
};

type WithRequestKey<T> = T & FactoryRequestKeyInput;

type TaskPullRequestStatus = TaskStatus["requiredPullRequests"][number] & {
  githubStatus: GitHubStatusSnapshot;
};

type TaskActivity = Awaited<
  ReturnType<FactoryApplication["getTaskActivityHistory"]>
>[number];

export type TaskActivityHistoryPage = {
  events: TaskActivity[];
  nextCursor: string | null;
  totalCount: number;
  truncated: boolean;
};

export type FactoryVersion = {
  apiVersion: number;
  revision: string;
  schemaVersion: 1;
};

export type FactoryRemoteIdentity = {
  human: { name: string } | null;
  machine: { machineId: string; projectIds: string[] } | null;
};

export type FactoryRemoteBriefData = {
  hierarchy: ProjectHierarchy;
  project: ProjectSummary;
  projectDetail: ProjectMetadata;
  reports: Record<string, StatusReport[]>;
  taskDetails: TaskDetail[];
  taskStatuses: TaskStatus[];
};

type RemoteEnvironment = {
  FACTORY_ACCESS_TOKEN_FILE?: string;
  FACTORY_URL?: string;
};

type RemoteClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;

export type FactoryRemoteClient = {
  readonly url: string;
  ensureReady: () => Promise<FactoryVersion>;
  version: () => Promise<FactoryVersion>;
  whoami: () => Promise<FactoryRemoteIdentity>;
  listProjects: () => Promise<ProjectSummary[]>;
  getProjectContext: (input: {
    projectId: string;
    branchName?: string;
  }) => Promise<{
    id: string;
    name: string;
    gitOriginUrl?: string;
    t3Mappings?: T3ProjectMapping[];
    workspaceRoot?: string;
    trackerLinks: TrackerLink[];
    tasks: Array<
      TaskDetail & { subtasks: ProjectHierarchy["tasks"][number]["subtasks"] }
    >;
  }>;
  getProjectBriefData: (projectId: string) => Promise<FactoryRemoteBriefData>;
  createProject: (
    input: Parameters<FactoryApplication["createProject"]>[0],
  ) => Promise<Project>;
  updateProject: (
    input: Parameters<FactoryApplication["updateProject"]>[0],
  ) => Promise<Project>;
  removeProject: (projectId: string) => Promise<void>;
  getProjectDetail: (projectId: string) => Promise<ProjectMetadata>;
  getProjectStatus: (
    projectId: string,
  ) => Promise<ReturnType<FactoryApplication["getProjectStatus"]>>;
  getPortfolioStatus: () => Promise<
    ReturnType<FactoryApplication["getPortfolioStatus"]>
  >;
  getAttentionProjection: () => Promise<
    ReturnType<FactoryApplication["getAttentionProjection"]>
  >;
  addProjectTrackerLink: (
    input: Parameters<FactoryApplication["addProjectTrackerLink"]>[0],
  ) => Promise<TrackerLink>;
  projectT3Status: (projectId?: string, sourceId?: string) => Promise<unknown>;
  sessionDetail: (
    threadId: string,
    turnLimit: number,
    sourceId?: string,
  ) => Promise<unknown>;
  sessionLink: (
    input: {
      projectId: string;
      taskId?: string;
      subtaskId?: string;
      threadId: string;
      sourceId?: string;
    } & FactoryRequestKeyInput,
  ) => Promise<unknown>;
  sessionAutoLink: (
    input: {
      branchName: string;
      projectId: string;
      taskId?: string;
      subtaskId?: string;
      sourceId?: string;
      threadId?: string;
    } & FactoryRequestKeyInput,
  ) => Promise<unknown>;
  sessionUnlink: (
    threadId: string,
    associationId?: string,
    sourceId?: string,
  ) => Promise<unknown>;
  createTask: (
    input: WithRequestKey<Parameters<FactoryApplication["createTask"]>[0]>,
  ) => Promise<Task>;
  getTaskDetail: (taskId: string) => Promise<TaskDetail>;
  getTaskStatus: (taskId: string) => Promise<TaskStatus>;
  getTaskActivityHistory: (input: {
    cursor?: string;
    direction?: "forward" | "backward";
    limit?: number;
    since?: string;
    taskId: string;
  }) => Promise<TaskActivityHistoryPage>;
  reportTaskStatus: (
    input: WithRequestKey<
      Parameters<FactoryApplication["reportTaskStatus"]>[0]
    >,
  ) => Promise<TaskStatusReport>;
  updateTaskFinishRule: (input: {
    actor?: string;
    expectedRevision: number;
    expectedWorkflowEpoch: number;
    finishRule: TaskFinishRule;
    humanCheckText?: string | null;
    pullRequestRequirements: TaskPullRequestRequirement[];
    taskId: string;
  }) => Promise<Task>;
  checkTask: (
    input: Parameters<FactoryApplication["checkTask"]>[0],
  ) => Promise<Task>;
  reopenTask: (
    input: Parameters<FactoryApplication["reopenTask"]>[0],
  ) => Promise<Task>;
  markTaskDone: (
    input: Parameters<FactoryApplication["markTaskDone"]>[0],
  ) => Promise<Task>;
  reviewSubtask: (input: {
    decision: "accepted" | "rejected" | "deferred";
    expectedRevision: number;
    reason?: string;
    reportId: string;
    reportText: string;
    screenshotIds?: string[];
  }) => Promise<unknown>;
  reviewTask: (input: {
    decision: "accepted" | "rejected" | "deferred";
    expectedTaskRevision: number;
    reason?: string;
    reportText: string;
    reviewedSubtasks: Array<{
      currentReportId: string | null;
      currentVerificationId: string | null;
      revision: number;
      subtaskId: string;
    }>;
    screenshotIds?: string[];
    taskId: string;
  }) => Promise<unknown>;
  setTaskWorkState: (
    input: {
      reason?: string;
      taskId: string;
      workState: Exclude<WorkState, "completed">;
    } & FactoryRequestKeyInput,
  ) => Promise<Task>;
  resumeTaskRollup: (taskId: string) => Promise<Task>;
  reorderTasks: (
    input: Parameters<FactoryApplication["reorderTasks"]>[0],
  ) => Promise<Task[]>;
  updateTask: (
    input: WithRequestKey<Parameters<FactoryApplication["updateTask"]>[0]>,
  ) => Promise<Task>;
  archiveTask: (
    taskId: string,
    archiveState: "released" | "wont_do",
  ) => Promise<void>;
  restoreTask: (taskId: string) => Promise<void>;
  addTaskTrackerLink: (
    input: Parameters<FactoryApplication["addTaskTrackerLink"]>[0],
  ) => Promise<TrackerLink>;
  createSubtask: (
    input: WithRequestKey<Parameters<FactoryApplication["createSubtask"]>[0]>,
  ) => Promise<Subtask>;
  getSubtaskDetail: (
    subtaskId: string,
  ) => Promise<ReturnType<FactoryApplication["getSubtaskDetail"]>>;
  updateSubtask: (
    input: WithRequestKey<Parameters<FactoryApplication["updateSubtask"]>[0]>,
  ) => Promise<Subtask>;
  reportSubtaskStatus: (
    input: WithRequestKey<
      Parameters<FactoryApplication["reportSubtaskStatus"]>[0]
    >,
  ) => Promise<StatusReport>;
  reorderSubtasks: (
    input: Parameters<FactoryApplication["reorderSubtasks"]>[0],
  ) => Promise<Subtask[]>;
  archiveSubtask: (
    subtaskId: string,
    archiveState: "released" | "wont_do",
  ) => Promise<void>;
  restoreSubtask: (subtaskId: string) => Promise<void>;
  getSubtaskReportHistory: (subtaskId: string) => Promise<StatusReport[]>;
  getSubtaskVerificationHistory: (subtaskId: string) => Promise<Verification[]>;
  taskGithubStatus: (taskId: string) => Promise<unknown>;
  taskPullRequestStatuses: (taskId: string) => Promise<TaskPullRequestStatus[]>;
  subtaskGithubStatus: (subtaskId: string) => Promise<unknown>;
  uploadScreenshotEvidence: (
    input: {
      capturedAt?: string;
      captureContext?: string;
      caption: string;
      contentType: ScreenshotContentType;
      dataBase64: string;
      label?: "before" | "after";
      pairId?: string;
      subtaskId?: string;
      taskId?: string;
      testedRevision?: string;
    } & FactoryRequestKeyInput,
  ) => Promise<ScreenshotEvidenceSummary>;
  listScreenshotEvidence: (input: {
    taskId?: string;
    subtaskId?: string;
  }) => Promise<ScreenshotEvidenceSummary[]>;
  getScreenshotEvidence: (screenshotId: string) => Promise<ScreenshotEvidence>;
};

export function createRemoteFactoryClient(
  environment: RemoteEnvironment,
): FactoryRemoteClient {
  const configuredUrl = environment.FACTORY_URL?.trim();
  if (!configuredUrl) {
    throw new Error("FACTORY_URL is required for remote mode.");
  }

  const serviceUrl = validateFactoryUrl(configuredUrl);
  const token = resolveFactoryAccessToken(
    environment.FACTORY_ACCESS_TOKEN_FILE,
  );
  if (!token) {
    throw new Error(
      "Remote Factory mode requires FACTORY_ACCESS_TOKEN_FILE to name an absolute regular file containing a valid access token.",
    );
  }

  const apiUrl = `${serviceUrl}/api`;
  const remoteFetch = createTimedFetch();
  const client = createTRPCProxyClient<FactoryRouter>({
    links: [
      httpLink({
        fetch: remoteFetch,
        headers: { Authorization: `Bearer ${token}` },
        url: apiUrl,
      }),
    ],
  });

  let versionPromise: Promise<FactoryVersion> | undefined;

  const fetchVersion = async (): Promise<FactoryVersion> => {
    let response: Response;
    try {
      response = await remoteFetch(`${serviceUrl}/version`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "GET",
      });
    } catch (error) {
      throw unavailableError(serviceUrl, error);
    }
    if (!response.ok) {
      throw errorForHttpStatus(response.status, serviceUrl);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(
        `Factory service unavailable at ${serviceUrl}: invalid /version response.`,
      );
    }
    if (!isFactoryVersion(payload)) {
      throw new Error(
        `Factory service unavailable at ${serviceUrl}: invalid /version response.`,
      );
    }
    return payload;
  };

  const version = (): Promise<FactoryVersion> => {
    versionPromise ??= fetchVersion();
    return versionPromise;
  };

  const ensureReady = async (): Promise<FactoryVersion> => {
    const serviceVersion = await version();
    if (serviceVersion.apiVersion !== FACTORY_API_VERSION) {
      throw new Error(
        `Factory service at ${serviceUrl} speaks API ${serviceVersion.apiVersion}; this CLI needs ${FACTORY_API_VERSION}.`,
      );
    }
    return serviceVersion;
  };

  async function invoke<T>(operation: () => Promise<T>): Promise<T> {
    await ensureReady();
    try {
      return await operation();
    } catch (error) {
      throw normalizeRemoteError(error, serviceUrl);
    }
  }

  async function invokeMutation<T>(
    operation: () => Promise<T>,
    requestKey: string | undefined,
  ): Promise<T> {
    await ensureReady();
    const backoffs = [250, 1_000];
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (
          requestKey !== undefined &&
          attempt < backoffs.length &&
          isRetryableTransportFailure(error)
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, backoffs[attempt] ?? 1_000),
          );
          continue;
        }
        throw normalizeRemoteError(error, serviceUrl);
      }
    }
  }

  const unwrapDashboard = <T>(value: T & { dashboard?: unknown }): T => {
    const { dashboard: _dashboard, ...withoutDashboard } = value as T & {
      dashboard?: unknown;
    };
    return withoutDashboard as T;
  };

  return {
    url: serviceUrl,
    ensureReady,
    version,
    whoami: () => invoke(() => client.session.whoami.query()),
    listProjects: () => invoke(() => client.projects.list.query()),
    getProjectContext: (input) =>
      invoke(async () => {
        const context = await client.projects.context.query(input);
        return {
          ...context,
          tasks: context.tasks.map((task) => ({
            ...hydrateTaskDetail(task),
            subtasks: task.subtasks,
          })),
        };
      }),
    getProjectBriefData: (projectId) =>
      invoke(async () =>
        hydrateRemoteBriefData(
          await client.projects.brief.query({ projectId }),
        ),
      ),
    createProject: (input) =>
      invoke(async () =>
        coerce<Project>(
          unwrapDashboard(await client.projects.create.mutate(input)),
        ),
      ),
    updateProject: (input) =>
      invoke(async () =>
        coerce<Project>(
          unwrapDashboard(await client.projects.update.mutate(input)),
        ),
      ),
    removeProject: (projectId) =>
      invoke(async () => {
        await client.projects.remove.mutate({ confirm: true, projectId });
      }),
    getProjectDetail: (projectId) =>
      invoke(() => client.projects.detail.query({ projectId })),
    getProjectStatus: (projectId) =>
      invoke(() => client.projects.status.query({ projectId })),
    getPortfolioStatus: () => invoke(() => client.projects.portfolio.query()),
    getAttentionProjection: () =>
      invoke(() => client.projects.attention.query()),
    addProjectTrackerLink: (input) =>
      invoke(async () =>
        unwrapDashboard(await client.projects.link.mutate(input)),
      ),
    projectT3Status: (projectId, sourceId) =>
      invoke(() =>
        client.t3.status.query(
          projectId === undefined && sourceId === undefined
            ? undefined
            : {
                ...(projectId === undefined ? {} : { projectId }),
                ...(sourceId === undefined ? {} : { sourceId }),
              },
        ),
      ),
    sessionDetail: (threadId, turnLimit, sourceId) =>
      invoke(() =>
        client.t3.threadDetail.query({
          ...(sourceId === undefined ? {} : { sourceId }),
          threadId,
          turnLimit,
        }),
      ),
    sessionLink: (input) =>
      invokeMutation(
        async () => unwrapDashboard(await client.t3.linkThread.mutate(input)),
        input.requestKey,
      ),
    sessionAutoLink: (input) =>
      invokeMutation(
        async () =>
          unwrapDashboard(await client.t3.autoLinkThread.mutate(input)),
        input.requestKey,
      ),
    sessionUnlink: (threadId, associationId, sourceId) =>
      invoke(async () =>
        unwrapDashboard(
          await client.t3.unlinkThread.mutate({
            ...(associationId === undefined ? {} : { associationId }),
            ...(sourceId === undefined ? {} : { sourceId }),
            threadId,
          }),
        ),
      ),
    createTask: (input) =>
      invokeMutation(
        async () =>
          hydrateTask(unwrapDashboard(await client.tasks.create.mutate(input))),
        input.requestKey,
      ),
    getTaskDetail: (taskId) =>
      invoke(async () =>
        hydrateTaskDetail(await client.tasks.detail.query({ taskId })),
      ),
    getTaskStatus: (taskId) =>
      invoke(async () =>
        hydrateTaskStatus(await client.tasks.status.query({ taskId })),
      ),
    getTaskActivityHistory: (input) =>
      invoke(async () =>
        hydrateTaskActivityHistory(await client.tasks.history.query(input)),
      ),
    reportTaskStatus: (input) =>
      invokeMutation(
        async () =>
          hydrateTaskStatusReport(
            unwrapDashboard(await client.tasks.report.mutate(input)),
          ),
        input.requestKey,
      ),
    updateTaskFinishRule: (input) =>
      invoke(async () =>
        hydrateTask(
          unwrapDashboard(await client.tasks.updateFinishRule.mutate(input)),
        ),
      ),
    checkTask: (input) =>
      invoke(async () =>
        hydrateTask(unwrapDashboard(await client.tasks.check.mutate(input))),
      ),
    reopenTask: (input) =>
      invoke(async () =>
        hydrateTask(unwrapDashboard(await client.tasks.reopen.mutate(input))),
      ),
    markTaskDone: (input) =>
      invoke(async () =>
        hydrateTask(unwrapDashboard(await client.tasks.markDone.mutate(input))),
      ),
    reviewSubtask: (input) =>
      invoke(() => client.subtasks.review.mutate(input)),
    reviewTask: (input) => invoke(() => client.tasks.review.mutate(input)),
    setTaskWorkState: (input) =>
      invokeMutation(
        async () =>
          hydrateTask(
            unwrapDashboard(await client.tasks.setState.mutate(input)),
          ),
        input.requestKey,
      ),
    resumeTaskRollup: (taskId) =>
      invoke(async () =>
        hydrateTask(
          unwrapDashboard(await client.tasks.resumeRollup.mutate({ taskId })),
        ),
      ),
    reorderTasks: (input) =>
      invoke(async () =>
        (await client.tasks.reorder.mutate(input)).items.map(hydrateTask),
      ),
    updateTask: (input) =>
      invokeMutation(
        async () =>
          hydrateTask(unwrapDashboard(await client.tasks.update.mutate(input))),
        input.requestKey,
      ),
    archiveTask: (taskId, archiveState) =>
      invoke(async () => {
        await client.tasks.archive.mutate({ archiveState, taskId });
      }),
    restoreTask: (taskId) =>
      invoke(async () => {
        await client.tasks.restore.mutate({ taskId });
      }),
    addTaskTrackerLink: (input) =>
      invoke(async () =>
        unwrapDashboard(await client.tasks.link.mutate(input)),
      ),
    createSubtask: (input) =>
      invokeMutation(
        async () =>
          hydrateSubtask(
            unwrapDashboard(await client.subtasks.create.mutate(input)),
          ),
        input.requestKey,
      ),
    getSubtaskDetail: (subtaskId) =>
      invoke(() => client.subtasks.detail.query({ subtaskId })),
    updateSubtask: (input) =>
      invokeMutation(
        async () =>
          hydrateSubtask(
            unwrapDashboard(await client.subtasks.update.mutate(input)),
          ),
        input.requestKey,
      ),
    reportSubtaskStatus: (input) =>
      invokeMutation(
        async () =>
          hydrateStatusReport(
            unwrapDashboard(await client.subtasks.report.mutate(input)),
          ),
        input.requestKey,
      ),
    reorderSubtasks: (input) =>
      invoke(async () =>
        coerce<Subtask[]>((await client.subtasks.reorder.mutate(input)).items),
      ),
    archiveSubtask: (subtaskId, archiveState) =>
      invoke(async () => {
        await client.subtasks.archive.mutate({ archiveState, subtaskId });
      }),
    restoreSubtask: (subtaskId) =>
      invoke(async () => {
        await client.subtasks.restore.mutate({ subtaskId });
      }),
    getSubtaskReportHistory: (subtaskId) =>
      invoke(async () =>
        coerce<unknown[]>(
          await client.subtasks.history.query({ subtaskId }),
        ).map(hydrateStatusReport),
      ),
    getSubtaskVerificationHistory: (subtaskId) =>
      invoke(async () =>
        coerce<unknown[]>(
          await client.subtasks.verifications.query({ subtaskId }),
        ).map(hydrateVerification),
      ),
    taskGithubStatus: (taskId) =>
      invoke(() => client.tasks.githubStatus.query({ taskId })),
    taskPullRequestStatuses: (taskId) =>
      invoke(async () =>
        (await client.tasks.pullRequestStatuses.query({ taskId })).map(
          hydrateTaskPullRequestStatus,
        ),
      ),
    subtaskGithubStatus: (subtaskId) =>
      invoke(() => client.subtasks.githubStatus.query({ subtaskId })),
    uploadScreenshotEvidence: (input) =>
      invokeMutation(
        async () =>
          coerce<ScreenshotEvidenceSummary>(
            unwrapDashboard(await client.screenshots.upload.mutate(input)),
          ),
        input.requestKey,
      ),
    listScreenshotEvidence: (input) =>
      invoke(() => client.screenshots.list.query(input)),
    getScreenshotEvidence: (screenshotId) =>
      invoke(() => client.screenshots.get.query({ screenshotId })),
  };
}

export function resolveFactoryAccessToken(
  configuredFile: string | undefined,
): string | undefined {
  const path = configuredFile?.trim();
  if (!path || !isAbsolute(path)) return undefined;

  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > MAX_FACTORY_ACCESS_TOKEN_BYTES
    ) {
      return undefined;
    }
    const buffer = Buffer.alloc(MAX_FACTORY_ACCESS_TOKEN_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) return undefined;
    const token = buffer.toString("utf8", 0, bytesRead).trim();
    return token && /^[\x21-\x7e]+$/.test(token) ? token : undefined;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function validateFactoryUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("FACTORY_URL must be a valid absolute URL.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /:\/\/[^/?#]*@/.test(value) ||
    value.includes("?") ||
    value.includes("#")
  ) {
    throw new Error(
      "FACTORY_URL must not contain credentials, a query string, or a fragment.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(
      "FACTORY_URL must use https:// or permitted private http://.",
    );
  }
  if (url.protocol === "http:" && !isPrivateFactoryHttpHost(url.hostname)) {
    throw new Error(
      `FACTORY_URL uses plain HTTP for public host ${url.hostname}; machine tokens travel in the clear. Use HTTPS or a private LAN address.`,
    );
  }

  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

function isPrivateFactoryHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa")
  ) {
    return true;
  }

  const octets = host.split(".");
  if (octets.length !== 4 || octets.some((octet) => !/^\d+$/.test(octet))) {
    return false;
  }
  const numbers = octets.map(Number);
  if (numbers.some((octet) => octet < 0 || octet > 255)) return false;
  const first = numbers[0] ?? -1;
  const second = numbers[1] ?? -1;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function createTimedFetch(): (
  input: RequestInfo | URL | string,
  init?: RequestInit,
) => Promise<Response> {
  return async (input, init) => {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FACTORY_REMOTE_TIMEOUT_MS);
    const signal = init?.signal;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (timedOut) {
        throw new Error("request timed out after 10 seconds");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function record(value: unknown, description: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Factory returned an invalid ${description}.`);
  }
  return value as Record<string, unknown>;
}

function dateValue(value: unknown, description: string): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed;
  }
  throw new Error(`Factory returned an invalid ${description} timestamp.`);
}

function hydrateTaskFinishMetadata(
  value: unknown,
): TaskFinishMetadata | undefined {
  if (value === undefined || value === null) return undefined;
  const metadata = record(value, "Task finish metadata");
  const mergeProofs = Array.isArray(metadata.mergeProofs)
    ? metadata.mergeProofs.map((proof) => hydrateMergeEvidence(proof))
    : undefined;
  return {
    ...metadata,
    completedAt: dateValue(metadata.completedAt, "Task completion"),
    ...(mergeProofs === undefined ? {} : { mergeProofs }),
  } as TaskFinishMetadata;
}

function hydrateMergeEvidence(value: unknown): TaskPullRequestMergeEvidence {
  const evidence = record(value, "Task pull request merge evidence");
  return {
    ...evidence,
    mergedAt: dateValue(evidence.mergedAt, "pull request merge"),
    observedAt: dateValue(evidence.observedAt, "pull request observation"),
  } as TaskPullRequestMergeEvidence;
}

function hydrateTask(value: unknown): Task {
  const task = record(value, "Task");
  return {
    ...task,
    createdAt: dateValue(task.createdAt, "Task creation"),
    ...(task.workflowStartedAt === undefined
      ? {}
      : {
          workflowStartedAt: dateValue(
            task.workflowStartedAt,
            "Task workflow start",
          ),
        }),
    ...(task.finishMetadata === undefined
      ? {}
      : { finishMetadata: hydrateTaskFinishMetadata(task.finishMetadata) }),
  } as Task;
}

function hydrateTaskDetail(value: unknown): TaskDetail {
  const task = record(value, "Task detail");
  return {
    ...task,
    ...(task.workflowStartedAt === undefined
      ? {}
      : {
          workflowStartedAt: dateValue(
            task.workflowStartedAt,
            "Task workflow start",
          ),
        }),
    ...(task.finishMetadata === undefined
      ? {}
      : { finishMetadata: hydrateTaskFinishMetadata(task.finishMetadata) }),
  } as TaskDetail;
}

function hydrateTaskStatusReport(value: unknown): TaskStatusReport {
  const report = record(value, "Task report");
  return {
    ...report,
    createdAt: dateValue(report.createdAt, "Task report creation"),
  } as TaskStatusReport;
}

function hydrateStatusReport(value: unknown): StatusReport {
  const report = record(value, "Step report");
  return {
    ...report,
    createdAt: dateValue(report.createdAt, "Step report creation"),
  } as StatusReport;
}

function hydrateVerification(value: unknown): Verification {
  const verification = record(value, "Step verification");
  return {
    ...verification,
    createdAt: dateValue(verification.createdAt, "verification creation"),
  } as Verification;
}

function hydrateSubtask(value: unknown): Subtask {
  const subtask = record(value, "Step");
  return {
    ...subtask,
    createdAt: dateValue(subtask.createdAt, "Step creation"),
  } as Subtask;
}

function hydrateTaskVerification(value: unknown): TaskStatusVerification {
  const verification = record(value, "Task verification");
  return {
    ...verification,
    createdAt: dateValue(verification.createdAt, "verification creation"),
    ...(verification.mergedAt === undefined
      ? {}
      : { mergedAt: dateValue(verification.mergedAt, "verification merge") }),
  } as TaskStatusVerification;
}

function hydrateRequiredPullRequest(value: unknown): TaskRequiredPullRequest {
  const pullRequest = record(value, "required pull request");
  return {
    ...pullRequest,
    ...(pullRequest.merge === undefined
      ? {}
      : { merge: hydrateMergeEvidence(pullRequest.merge) }),
  } as TaskRequiredPullRequest;
}

function hydrateTaskStatus(value: unknown): TaskStatus {
  const status = record(value, "Task status");
  return {
    ...status,
    manualHold: status.manualHold === true,
    ...(status.latestTaskReport === undefined
      ? {}
      : { latestTaskReport: hydrateTaskStatusReport(status.latestTaskReport) }),
    ...(status.finishMetadata === undefined
      ? {}
      : { finishMetadata: hydrateTaskFinishMetadata(status.finishMetadata) }),
    ...(status.taskVerification === undefined
      ? {}
      : { taskVerification: hydrateTaskVerification(status.taskVerification) }),
    requiredPullRequests: Array.isArray(status.requiredPullRequests)
      ? status.requiredPullRequests.map(hydrateRequiredPullRequest)
      : [],
    subtasks: Array.isArray(status.subtasks)
      ? status.subtasks.map((value) => {
          const subtaskStatus = record(value, "Task Step status");
          return {
            ...subtaskStatus,
            ...(subtaskStatus.verification === undefined
              ? {}
              : {
                  verification: hydrateTaskVerification(
                    subtaskStatus.verification,
                  ),
                }),
          };
        })
      : [],
  } as TaskStatus;
}

function hydrateTaskActivityHistory(value: unknown): TaskActivityHistoryPage {
  const page = record(value, "Task activity history page");
  return {
    ...page,
    events: Array.isArray(page.events)
      ? page.events.map((value) => {
          const event = record(value, "Task activity event");
          return {
            ...event,
            createdAt: dateValue(event.createdAt, "Task activity"),
          };
        })
      : [],
  } as TaskActivityHistoryPage;
}

function hydrateTaskPullRequestStatus(value: unknown): TaskPullRequestStatus {
  const status = record(value, "Task pull request status");
  return {
    ...status,
    ...hydrateRequiredPullRequest(status),
  } as TaskPullRequestStatus;
}

function hydrateRemoteBriefData(value: unknown): FactoryRemoteBriefData {
  const data = record(value, "project brief");
  const hierarchy = record(data.hierarchy, "project hierarchy");
  const reports = record(data.reports, "Step report history");
  return {
    ...data,
    hierarchy: {
      ...hierarchy,
      tasks: Array.isArray(hierarchy.tasks)
        ? hierarchy.tasks.map((task) => {
            const item = record(task, "project hierarchy Task");
            return {
              ...item,
              ...(item.finishMetadata === undefined
                ? {}
                : {
                    finishMetadata: hydrateTaskFinishMetadata(
                      item.finishMetadata,
                    ),
                  }),
            };
          })
        : [],
    } as ProjectHierarchy,
    taskDetails: Array.isArray(data.taskDetails)
      ? data.taskDetails.map(hydrateTaskDetail)
      : [],
    taskStatuses: Array.isArray(data.taskStatuses)
      ? data.taskStatuses.map(hydrateTaskStatus)
      : [],
    reports: Object.fromEntries(
      Object.entries(reports).map(([subtaskId, rows]) => [
        subtaskId,
        Array.isArray(rows) ? rows.map(hydrateStatusReport) : [],
      ]),
    ),
  } as FactoryRemoteBriefData;
}

function coerce<T>(value: unknown): T {
  return value as T;
}

function isFactoryVersion(value: unknown): value is FactoryVersion {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.apiVersion !== undefined &&
    typeof candidate.apiVersion === "number" &&
    typeof candidate.revision === "string" &&
    candidate.schemaVersion === 1
  );
}

function errorForHttpStatus(status: number, url: string): Error {
  if (status === 401) {
    return new Error("Factory credential rejected (revoked or wrong token).");
  }
  if (status === 403) {
    return new Error("Factory request forbidden.");
  }
  return new Error(`Factory service unavailable at ${url}: HTTP ${status}.`);
}

function normalizeRemoteError(error: unknown, url: string): Error {
  if (isTRPCClientError(error)) {
    const code = error.data?.code;
    if (code === "UNAUTHORIZED") {
      return new Error("Factory credential rejected (revoked or wrong token).");
    }
    if (code === "FORBIDDEN") return new Error(error.message);
    if (code === "CONFLICT") return new Error(error.message);
    const response = error.meta?.response as Response | undefined;
    if (response && !response.ok) {
      return errorForHttpStatus(response.status, url);
    }
    if (error.cause) return unavailableError(url, error.cause);
    return new Error(error.message);
  }
  if (error instanceof Error && error.message.startsWith("Factory ")) {
    return error;
  }
  return unavailableError(url, error);
}

function isRetryableTransportFailure(error: unknown): boolean {
  if (isTRPCClientError(error)) {
    const response = error.meta?.response as Response | undefined;
    if (response) {
      return [502, 503, 504].includes(response.status);
    }
    return error.cause !== undefined;
  }

  if (!(error instanceof Error)) return false;
  return /(?:timed out|timeout|fetch failed|connection (?:refused|reset)|econnrefused|econnreset|etimedout|network|socket)/i.test(
    error.message,
  );
}

function unavailableError(url: string, cause: unknown): Error {
  const message = cause instanceof Error ? cause.message : String(cause);
  return new Error(`Factory service unavailable at ${url}: ${message}.`);
}
