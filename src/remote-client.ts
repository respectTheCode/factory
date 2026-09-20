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
  TaskStatus,
  TrackerLink,
  Verification,
  WorkState,
} from "./application";
import { FACTORY_API_VERSION } from "./api-version";
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
      invoke(() => client.projects.context.query(input)),
    getProjectBriefData: (projectId) =>
      invoke(async () =>
        coerce<FactoryRemoteBriefData>(
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
          coerce<Task>(
            unwrapDashboard(await client.tasks.create.mutate(input)),
          ),
        input.requestKey,
      ),
    getTaskDetail: (taskId) =>
      invoke(() => client.tasks.detail.query({ taskId })),
    getTaskStatus: (taskId) =>
      invoke(() => client.tasks.status.query({ taskId })),
    setTaskWorkState: (input) =>
      invokeMutation(
        async () =>
          coerce<Task>(
            unwrapDashboard(await client.tasks.setState.mutate(input)),
          ),
        input.requestKey,
      ),
    resumeTaskRollup: (taskId) =>
      invoke(async () =>
        coerce<Task>(
          unwrapDashboard(await client.tasks.resumeRollup.mutate({ taskId })),
        ),
      ),
    reorderTasks: (input) =>
      invoke(async () =>
        coerce<Task[]>((await client.tasks.reorder.mutate(input)).items),
      ),
    updateTask: (input) =>
      invokeMutation(
        async () =>
          coerce<Task>(
            unwrapDashboard(await client.tasks.update.mutate(input)),
          ),
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
          coerce<Subtask>(
            unwrapDashboard(await client.subtasks.create.mutate(input)),
          ),
        input.requestKey,
      ),
    getSubtaskDetail: (subtaskId) =>
      invoke(() => client.subtasks.detail.query({ subtaskId })),
    updateSubtask: (input) =>
      invokeMutation(
        async () =>
          coerce<Subtask>(
            unwrapDashboard(await client.subtasks.update.mutate(input)),
          ),
        input.requestKey,
      ),
    reportSubtaskStatus: (input) =>
      invokeMutation(
        async () =>
          coerce<StatusReport>(
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
        coerce<StatusReport[]>(
          await client.subtasks.history.query({ subtaskId }),
        ),
      ),
    getSubtaskVerificationHistory: (subtaskId) =>
      invoke(async () =>
        coerce<Verification[]>(
          await client.subtasks.verifications.query({ subtaskId }),
        ),
      ),
    taskGithubStatus: (taskId) =>
      invoke(() => client.tasks.githubStatus.query({ taskId })),
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
