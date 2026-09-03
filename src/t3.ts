import { createHash } from "node:crypto";

import { parseGitHubPullRequestUrl } from "./github";

/**
 * The T3 transport deliberately exposes a narrow read seam.  Callers cannot
 * turn this reader into a general T3 proxy, and the implementation owns all
 * authentication, bounds, version checks, and source-shape normalization.
 */
export type T3ActivityReader = {
  readShell: () => Promise<T3ShellObservation>;
  readThread: (input: {
    threadId: string;
    turnLimit: number;
  }) => Promise<T3ThreadObservation>;
};

export type T3TransportState =
  | "not_configured"
  | "unreachable"
  | "authentication_failed"
  | "permission_denied"
  | "incompatible"
  | "invalid_response"
  | "unavailable";

export type T3ObservationFailure = {
  ok: false;
  status: T3TransportState;
  fetchedAt: string;
  error: string;
};

export type T3RepositoryIdentity = {
  canonicalKey: string;
  remoteUrl?: string;
  provider?: string;
  owner?: string;
  name?: string;
};

export type T3ProjectObservation = {
  id: string;
  title: string;
  workspaceRoot: string;
  repositoryIdentity?: T3RepositoryIdentity;
  createdAt: string;
  updatedAt: string;
};

export type T3LatestTurnObservation = {
  turnId: string;
  state: "running" | "interrupted" | "completed" | "error";
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
};

export type T3SessionObservation = {
  status:
    | "idle"
    | "starting"
    | "running"
    | "ready"
    | "interrupted"
    | "stopped"
    | "error";
  providerName?: string;
  activeTurnId?: string;
  updatedAt: string;
};

export type T3ThreadShellObservation = {
  id: string;
  projectId: string;
  title: string;
  branch?: string;
  worktreePath?: string;
  linkedPullRequestUrl?: string;
  latestTurn?: T3LatestTurnObservation;
  session?: T3SessionObservation;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  settledAt?: string;
  latestUserMessageAt?: string;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  hasActionableProposedPlan: boolean;
  backgroundLiveness?: "working" | "monitoring";
  planProgress?: {
    step: string;
    completedSteps: number;
    totalSteps: number;
  };
};

export type T3ShellObservation =
  | (T3ObservationFailure & { kind?: never })
  | {
      ok: true;
      status: "ok";
      sourceStream: "shell";
      fetchedAt: string;
      sourceSequence: number;
      sourceUpdatedAt: string;
      sourceDigest: string;
      projects: T3ProjectObservation[];
      threads: T3ThreadShellObservation[];
    };

export type T3CheckpointFileObservation = {
  path: string;
  kind: string;
  additions: number;
  deletions: number;
};

export type T3CheckpointObservation = {
  turnId: string;
  status: "ready" | "missing" | "error";
  completedAt: string;
  files: T3CheckpointFileObservation[];
};

export type T3ActivityObservation = {
  id: string;
  tone: "info" | "tool" | "approval" | "error";
  kind: string;
  turnId?: string;
  sequence?: number;
  createdAt: string;
};

export type T3MessageObservation = {
  id: string;
  role: "user" | "assistant" | "system";
  turnId?: string;
  streaming: boolean;
  createdAt: string;
  updatedAt: string;
};

export type T3ThreadObservation =
  | (T3ObservationFailure & { kind?: never })
  | {
      ok: true;
      status: "ok";
      sourceStream: string;
      fetchedAt: string;
      sourceSequence: number;
      sourceUpdatedAt: string;
      sourceDigest: string;
      thread: T3ThreadShellObservation & {
        messages: T3MessageObservation[];
        activities: T3ActivityObservation[];
        checkpoints: T3CheckpointObservation[];
      };
    };

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type T3ActivityReaderOptions = {
  baseUrl?: string;
  token?: string;
  expectedServerVersion?: string;
  fetcher?: Fetcher;
  now?: () => Date;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

export const DEFAULT_T3_BASE_URL = "http://127.0.0.1:3773";
export const DEFAULT_T3_TIMEOUT_MS = 6_000;
export const DEFAULT_T3_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_T3_SERVER_VERSION = "0.0.38";
export const MAX_T3_THREAD_TURN_LIMIT = 10;

const DESCRIPTOR_PATH = "/.well-known/t3/environment";
const SHELL_PATH = "/api/orchestration/shell";
const THREAD_PATH = "/api/orchestration/threads/";

const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

type ParsedDescriptor = {
  serverVersion: string;
};

type T3ErrorResponse = {
  readonly status: T3TransportState;
  readonly message: string;
};

type T3HttpReadResult =
  | { classified: T3ErrorResponse }
  | { parseError: unknown }
  | { payload: unknown };

const failure = (
  state: T3TransportState,
  fetchedAt: string,
  error: string,
): T3ObservationFailure => ({
  error,
  fetchedAt,
  ok: false,
  status: state,
});

function fetchedAt(now: () => Date): string {
  return now().toISOString();
}

/** Validate and normalize a T3 base URL without echoing it in errors. */
export function normalizeT3BaseUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("T3_BASE_URL must be an absolute http:// or https:// URL.");
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "T3_BASE_URL must be an absolute http:// or https:// URL without credentials, query, or fragment.",
    );
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const isLoopback =
    hostname === "localhost" ||
    hostname === "::1" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname);
  if (parsed.protocol === "http:" && !isLoopback) {
    throw new Error(
      "T3_BASE_URL must use https:// for non-loopback hosts; plain http:// is allowed only for loopback.",
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && ISO_DATE_PATTERN.test(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function finiteNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInt(value: unknown): value is number {
  return finiteNonNegativeInt(value) && value >= 1;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function parseLatestTurn(value: unknown): T3LatestTurnObservation | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const state = value.state;
  if (
    (state !== "running" &&
      state !== "interrupted" &&
      state !== "completed" &&
      state !== "error") ||
    !nonEmptyString(value.turnId) ||
    !isIsoDate(value.requestedAt)
  ) {
    return undefined;
  }
  const startedAt = value.startedAt === null ? undefined : value.startedAt;
  const completedAt =
    value.completedAt === null ? undefined : value.completedAt;
  if (startedAt !== undefined && !isIsoDate(startedAt)) return undefined;
  if (completedAt !== undefined && !isIsoDate(completedAt)) return undefined;
  return {
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(startedAt === undefined ? {} : { startedAt }),
    requestedAt: value.requestedAt,
    state,
    turnId: value.turnId,
  };
}

function parseSession(value: unknown): T3SessionObservation | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value)) return undefined;
  const status = value.status;
  if (
    (status !== "idle" &&
      status !== "starting" &&
      status !== "running" &&
      status !== "ready" &&
      status !== "interrupted" &&
      status !== "stopped" &&
      status !== "error") ||
    !isIsoDate(value.updatedAt)
  ) {
    return undefined;
  }
  const providerName = nullableString(value.providerName);
  const activeTurnId = nullableString(value.activeTurnId);
  return {
    ...(activeTurnId === undefined ? {} : { activeTurnId }),
    ...(providerName === undefined ? {} : { providerName }),
    status,
    updatedAt: value.updatedAt,
  };
}

function parseThreadShell(
  value: unknown,
): T3ThreadShellObservation | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.projectId) ||
    !nonEmptyString(value.title) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt) ||
    typeof value.hasPendingApprovals !== "boolean" ||
    typeof value.hasPendingUserInput !== "boolean" ||
    typeof value.hasActionableProposedPlan !== "boolean"
  ) {
    return undefined;
  }

  const latestTurn = parseLatestTurn(value.latestTurn);
  if (
    value.latestTurn !== null &&
    value.latestTurn !== undefined &&
    !latestTurn
  ) {
    return undefined;
  }
  const session = parseSession(value.session);
  if (value.session !== null && value.session !== undefined && !session) {
    return undefined;
  }

  const optionalDates = [
    ["archivedAt", value.archivedAt],
    ["settledAt", value.settledAt],
    ["latestUserMessageAt", value.latestUserMessageAt],
  ] as const;
  for (const [, date] of optionalDates) {
    if (date !== null && date !== undefined && !isIsoDate(date))
      return undefined;
  }

  const backgroundLiveness =
    value.backgroundLiveness === null || value.backgroundLiveness === undefined
      ? undefined
      : value.backgroundLiveness;
  if (
    backgroundLiveness !== undefined &&
    backgroundLiveness !== "working" &&
    backgroundLiveness !== "monitoring"
  ) {
    return undefined;
  }

  let planProgress: T3ThreadShellObservation["planProgress"] | undefined;
  if (value.planProgress !== null && value.planProgress !== undefined) {
    if (
      !isRecord(value.planProgress) ||
      !nonEmptyString(value.planProgress.step) ||
      !finiteNonNegativeInt(value.planProgress.completedSteps) ||
      !finiteNonNegativeInt(value.planProgress.totalSteps)
    ) {
      return undefined;
    }
    planProgress = {
      completedSteps: value.planProgress.completedSteps,
      step: value.planProgress.step,
      totalSteps: value.planProgress.totalSteps,
    };
  }

  const branch = nullableString(value.branch);
  const worktreePath = nullableString(value.worktreePath);
  const linkedPullRequestUrl = parseLinkedPullRequestUrl(
    value.linkedPullRequest,
  );
  if (
    value.linkedPullRequest !== null &&
    value.linkedPullRequest !== undefined &&
    linkedPullRequestUrl === undefined
  ) {
    return undefined;
  }

  const archivedAt = archivedDate(value.archivedAt);
  const settledAt = settledDate(value.settledAt);
  const latestUserMessageAt = latestMessageDate(value.latestUserMessageAt);

  return {
    ...(archivedAt === undefined ? {} : { archivedAt }),
    ...(backgroundLiveness === undefined ? {} : { backgroundLiveness }),
    ...(branch === undefined ? {} : { branch }),
    ...(latestTurn === undefined ? {} : { latestTurn }),
    ...(linkedPullRequestUrl === undefined ? {} : { linkedPullRequestUrl }),
    ...(planProgress === undefined ? {} : { planProgress }),
    ...(session === undefined ? {} : { session }),
    ...(settledAt === undefined ? {} : { settledAt }),
    ...(latestUserMessageAt === undefined ? {} : { latestUserMessageAt }),
    ...(worktreePath === undefined ? {} : { worktreePath }),
    createdAt: value.createdAt,
    hasActionableProposedPlan: value.hasActionableProposedPlan,
    hasPendingApprovals: value.hasPendingApprovals,
    hasPendingUserInput: value.hasPendingUserInput,
    id: value.id,
    projectId: value.projectId,
    title: value.title,
    updatedAt: value.updatedAt,
  };
}

function archivedDate(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : isIsoDate(value)
      ? value
      : undefined;
}

function settledDate(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : isIsoDate(value)
      ? value
      : undefined;
}

function latestMessageDate(value: unknown): string | undefined {
  return value === null || value === undefined
    ? undefined
    : isIsoDate(value)
      ? value
      : undefined;
}

function parseLinkedPullRequestUrl(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value) || !nonEmptyString(value.url)) return undefined;
  try {
    return parseGitHubPullRequestUrl(value.url).url;
  } catch {
    return undefined;
  }
}

function parseRepositoryIdentity(
  value: unknown,
): T3RepositoryIdentity | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value) || !nonEmptyString(value.canonicalKey)) return undefined;
  const locator = isRecord(value.locator) ? value.locator : undefined;
  const remoteUrl = locator ? nullableString(locator.remoteUrl) : undefined;
  const provider = nullableString(value.provider);
  const owner = nullableString(value.owner);
  const name = nullableString(value.name);
  return {
    ...(name === undefined ? {} : { name }),
    ...(owner === undefined ? {} : { owner }),
    ...(provider === undefined ? {} : { provider }),
    ...(remoteUrl === undefined ? {} : { remoteUrl }),
    canonicalKey: value.canonicalKey,
  };
}

function parseProject(value: unknown): T3ProjectObservation | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.workspaceRoot) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    return undefined;
  }
  const repositoryIdentity = parseRepositoryIdentity(value.repositoryIdentity);
  if (
    value.repositoryIdentity !== null &&
    value.repositoryIdentity !== undefined &&
    repositoryIdentity === undefined
  ) {
    return undefined;
  }
  return {
    ...(repositoryIdentity === undefined ? {} : { repositoryIdentity }),
    createdAt: value.createdAt,
    id: value.id,
    title: value.title,
    updatedAt: value.updatedAt,
    workspaceRoot: value.workspaceRoot,
  };
}

function parseShellPayload(
  value: unknown,
):
  | Omit<
      Extract<T3ShellObservation, { ok: true }>,
      "ok" | "status" | "fetchedAt" | "sourceDigest"
    >
  | undefined {
  if (
    !isRecord(value) ||
    !finiteNonNegativeInt(value.snapshotSequence) ||
    !isIsoDate(value.updatedAt) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.threads)
  ) {
    return undefined;
  }
  const projects = value.projects.flatMap((project) => {
    const parsed = parseProject(project);
    return parsed ? [parsed] : [];
  });
  const threads = value.threads.flatMap((thread) => {
    const parsed = parseThreadShell(thread);
    return parsed ? [parsed] : [];
  });
  if (
    projects.length !== value.projects.length ||
    threads.length !== value.threads.length
  ) {
    return undefined;
  }
  return {
    projects,
    sourceStream: "shell",
    sourceSequence: value.snapshotSequence,
    sourceUpdatedAt: value.updatedAt,
    threads,
  };
}

function parseMessage(value: unknown): T3MessageObservation | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    (value.role !== "user" &&
      value.role !== "assistant" &&
      value.role !== "system") ||
    typeof value.streaming !== "boolean" ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    return undefined;
  }
  const turnId = nullableString(value.turnId);
  return {
    ...(turnId === undefined ? {} : { turnId }),
    createdAt: value.createdAt,
    id: value.id,
    role: value.role,
    streaming: value.streaming,
    updatedAt: value.updatedAt,
  };
}

function parseActivity(value: unknown): T3ActivityObservation | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    (value.tone !== "info" &&
      value.tone !== "tool" &&
      value.tone !== "approval" &&
      value.tone !== "error") ||
    !nonEmptyString(value.kind) ||
    !isIsoDate(value.createdAt)
  ) {
    return undefined;
  }
  const turnId = nullableString(value.turnId);
  const sequence = value.sequence === undefined ? undefined : value.sequence;
  if (sequence !== undefined && !finiteNonNegativeInt(sequence))
    return undefined;
  return {
    ...(sequence === undefined ? {} : { sequence }),
    ...(turnId === undefined ? {} : { turnId }),
    createdAt: value.createdAt,
    id: value.id,
    kind: value.kind,
    tone: value.tone,
  };
}

function safeRelativePath(value: unknown): value is string {
  if (!nonEmptyString(value)) return false;
  const normalized = value.replaceAll("\\", "/");
  return (
    !normalized.startsWith("/") &&
    !normalized.includes("\0") &&
    !normalized.split("/").includes("..")
  );
}

function parseCheckpoint(value: unknown): T3CheckpointObservation | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.turnId) ||
    (value.status !== "ready" &&
      value.status !== "missing" &&
      value.status !== "error") ||
    !isIsoDate(value.completedAt) ||
    !Array.isArray(value.files)
  ) {
    return undefined;
  }
  const files = value.files.flatMap((file) => {
    if (
      !isRecord(file) ||
      !safeRelativePath(file.path) ||
      !nonEmptyString(file.kind) ||
      !finiteNonNegativeInt(file.additions) ||
      !finiteNonNegativeInt(file.deletions)
    ) {
      return [];
    }
    return [
      {
        additions: file.additions,
        deletions: file.deletions,
        kind: file.kind,
        path: file.path,
      },
    ];
  });
  if (files.length !== value.files.length) return undefined;
  return {
    completedAt: value.completedAt,
    files,
    status: value.status,
    turnId: value.turnId,
  };
}

function parseThreadDetailPayload(value: unknown):
  | {
      sourceSequence: number;
      sourceUpdatedAt: string;
      sourceThreadSequence?: number;
      thread: T3ThreadShellObservation & {
        messages: T3MessageObservation[];
        activities: T3ActivityObservation[];
        checkpoints: T3CheckpointObservation[];
      };
    }
  | undefined {
  if (
    !isRecord(value) ||
    !finiteNonNegativeInt(value.snapshotSequence) ||
    !isRecord(value.thread)
  ) {
    return undefined;
  }
  // T3's detail model omits the derived attention fields carried by its shell
  // model. Populate conservative placeholders for transport normalization;
  // the coordinator merges the fresh shell values before persistence or
  // presentation.
  const shell = parseThreadShell({
    ...value.thread,
    hasActionableProposedPlan:
      typeof value.thread.hasActionableProposedPlan === "boolean"
        ? value.thread.hasActionableProposedPlan
        : false,
    hasPendingApprovals:
      typeof value.thread.hasPendingApprovals === "boolean"
        ? value.thread.hasPendingApprovals
        : false,
    hasPendingUserInput:
      typeof value.thread.hasPendingUserInput === "boolean"
        ? value.thread.hasPendingUserInput
        : false,
  });
  if (
    !shell ||
    !Array.isArray(value.thread.messages) ||
    !Array.isArray(value.thread.activities) ||
    !Array.isArray(value.thread.checkpoints)
  ) {
    return undefined;
  }
  const messages = value.thread.messages.flatMap((message) => {
    const parsed = parseMessage(message);
    return parsed ? [parsed] : [];
  });
  const activities = value.thread.activities.flatMap((activity) => {
    const parsed = parseActivity(activity);
    return parsed ? [parsed] : [];
  });
  const checkpoints = value.thread.checkpoints.flatMap((checkpoint) => {
    const parsed = parseCheckpoint(checkpoint);
    return parsed ? [parsed] : [];
  });
  if (
    messages.length !== value.thread.messages.length ||
    activities.length !== value.thread.activities.length ||
    checkpoints.length !== value.thread.checkpoints.length
  ) {
    return undefined;
  }
  const page = value.page;
  let sourceThreadSequence: number | undefined;
  if (page !== undefined) {
    if (page === null || !isRecord(page)) return undefined;
    if (
      page.threadSequence !== undefined &&
      !finiteNonNegativeInt(page.threadSequence)
    )
      return undefined;
    sourceThreadSequence = page.threadSequence;
  }
  return {
    ...(sourceThreadSequence === undefined ? {} : { sourceThreadSequence }),
    sourceSequence: value.snapshotSequence,
    sourceUpdatedAt: shell.updatedAt,
    thread: {
      ...shell,
      activities,
      checkpoints,
      messages,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (Number.isSafeInteger(parsedLength) && parsedLength > maxBytes) {
      throw new Error("response_too_large");
    }
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes)
      throw new Error("response_too_large");
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const body = await readBody(response, maxBytes);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
}

function classifyHttpResponse(
  response: Response,
  path: string,
): T3ErrorResponse | undefined {
  if (response.ok) return undefined;
  if (response.status === 401) {
    return {
      message: "T3 Code rejected the read credential.",
      status: "authentication_failed",
    };
  }
  if (response.status === 403) {
    return {
      message: "T3 Code denied the read credential.",
      status: "permission_denied",
    };
  }
  if (response.status === 404 && path === DESCRIPTOR_PATH) {
    return {
      message: "T3 Code does not expose the required environment descriptor.",
      status: "incompatible",
    };
  }
  if (response.status === 404) {
    return {
      message: "The requested T3 Code thread was not found.",
      status: "unavailable",
    };
  }
  if (
    response.status === 408 ||
    response.status === 429 ||
    response.status >= 500
  ) {
    return {
      message: `T3 Code returned HTTP ${response.status}.`,
      status: "unavailable",
    };
  }
  return {
    message: `T3 Code returned HTTP ${response.status}.`,
    status: "unavailable",
  };
}

function requestWithTimeout(
  fetcher: Fetcher,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  readResponse: (response: Response) => Promise<T3HttpReadResult>,
): Promise<T3HttpReadResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetcher(url, {
    headers,
    method: "GET",
    redirect: "error",
    signal: controller.signal,
  })
    .then((response) => readResponse(response))
    .finally(() => clearTimeout(timeout));
}

export function createT3ActivityReader({
  baseUrl,
  expectedServerVersion = DEFAULT_T3_SERVER_VERSION,
  fetcher = fetch,
  maxResponseBytes = DEFAULT_T3_MAX_RESPONSE_BYTES,
  now = () => new Date(),
  timeoutMs = DEFAULT_T3_TIMEOUT_MS,
  token,
}: T3ActivityReaderOptions = {}): T3ActivityReader {
  const configuredToken = token?.trim();
  const configuredBaseUrl = baseUrl?.trim();
  let normalizedBaseUrl: string | undefined;
  let configurationError: string | undefined;
  if (configuredBaseUrl) {
    try {
      normalizedBaseUrl = normalizeT3BaseUrl(configuredBaseUrl);
    } catch (error) {
      configurationError =
        error instanceof Error ? error.message : "T3_BASE_URL is invalid.";
    }
  }
  if (timeoutMs < 1 || !Number.isSafeInteger(timeoutMs)) {
    configurationError = "T3_TIMEOUT_MS must be a positive integer.";
  }
  if (maxResponseBytes < 1 || !Number.isSafeInteger(maxResponseBytes)) {
    configurationError = "T3_MAX_RESPONSE_BYTES must be a positive integer.";
  }
  let descriptorPromise:
    | Promise<ParsedDescriptor | T3ObservationFailure>
    | undefined;

  const readDescriptor = async (): Promise<
    ParsedDescriptor | T3ObservationFailure
  > => {
    if (descriptorPromise) return descriptorPromise;
    descriptorPromise = (async () => {
      const time = fetchedAt(now);
      if (configurationError)
        return failure("invalid_response", time, configurationError);
      if (!normalizedBaseUrl || !configuredToken)
        return failure(
          "not_configured",
          time,
          "T3 Code is not configured for Factory.",
        );
      let result: T3HttpReadResult;
      try {
        result = await requestWithTimeout(
          fetcher,
          `${normalizedBaseUrl}${DESCRIPTOR_PATH}`,
          { Accept: "application/json" },
          timeoutMs,
          async (response) => {
            const classified = classifyHttpResponse(response, DESCRIPTOR_PATH);
            if (classified) return { classified };
            try {
              return { payload: await readJson(response, maxResponseBytes) };
            } catch (error) {
              if (isAbortError(error)) throw error;
              return { parseError: error };
            }
          },
        );
      } catch (error) {
        return failure(
          isAbortError(error) ? "unavailable" : "unreachable",
          time,
          isAbortError(error)
            ? "T3 Code did not respond before the timeout."
            : "T3 Code could not be reached.",
        );
      }
      if ("classified" in result) {
        return failure(
          result.classified.status,
          time,
          result.classified.message,
        );
      }
      if ("parseError" in result) {
        return failure(
          "invalid_response",
          time,
          result.parseError instanceof Error &&
            result.parseError.message === "response_too_large"
            ? "T3 Code returned an oversized response."
            : "T3 Code returned invalid JSON.",
        );
      }
      const payload = result.payload;
      if (!isRecord(payload) || !nonEmptyString(payload.serverVersion))
        return failure(
          "invalid_response",
          time,
          "T3 Code returned an invalid environment descriptor.",
        );
      if (payload.serverVersion !== expectedServerVersion)
        return failure(
          "incompatible",
          time,
          "T3 Code server version is incompatible with this Factory adapter.",
        );
      return { serverVersion: payload.serverVersion };
    })();
    const result = await descriptorPromise;
    if ("ok" in result && result.ok === false) descriptorPromise = undefined;
    return result;
  };

  const readProtectedJson = async (
    path: string,
    time: string,
  ): Promise<{ payload: unknown } | T3ObservationFailure> => {
    if (configurationError)
      return failure("invalid_response", time, configurationError);
    if (!normalizedBaseUrl || !configuredToken)
      return failure(
        "not_configured",
        time,
        "T3 Code is not configured for Factory.",
      );
    let result: T3HttpReadResult;
    try {
      result = await requestWithTimeout(
        fetcher,
        `${normalizedBaseUrl}${path}`,
        {
          Accept: "application/json",
          Authorization: `Bearer ${configuredToken}`,
        },
        timeoutMs,
        async (response) => {
          const classified = classifyHttpResponse(response, path);
          if (classified) return { classified };
          try {
            return { payload: await readJson(response, maxResponseBytes) };
          } catch (error) {
            if (isAbortError(error)) throw error;
            return { parseError: error };
          }
        },
      );
    } catch (error) {
      const timedOut = isAbortError(error);
      return failure(
        timedOut ? "unavailable" : "unreachable",
        time,
        timedOut
          ? "T3 Code did not respond before the timeout."
          : "T3 Code could not be reached.",
      );
    }
    if ("classified" in result) {
      return failure(result.classified.status, time, result.classified.message);
    }
    if ("parseError" in result) {
      return failure(
        "invalid_response",
        time,
        result.parseError instanceof Error &&
          result.parseError.message === "response_too_large"
          ? "T3 Code returned an oversized response."
          : "T3 Code returned invalid JSON.",
      );
    }
    return { payload: result.payload };
  };

  return {
    async readShell() {
      const time = fetchedAt(now);
      const descriptor = await readDescriptor();
      if ("ok" in descriptor && descriptor.ok === false) return descriptor;
      const result = await readProtectedJson(SHELL_PATH, time);
      if ("status" in result) return result;
      const parsed = parseShellPayload(result.payload);
      if (!parsed)
        return failure(
          "invalid_response",
          time,
          "T3 Code returned an invalid shell snapshot.",
        );
      return {
        ...parsed,
        fetchedAt: time,
        ok: true as const,
        sourceStream: "shell" as const,
        sourceDigest: digest(parsed),
        status: "ok" as const,
      };
    },
    async readThread(input) {
      const time = fetchedAt(now);
      if (
        !nonEmptyString(input.threadId) ||
        !positiveInt(input.turnLimit) ||
        input.turnLimit > MAX_T3_THREAD_TURN_LIMIT
      ) {
        return failure(
          "invalid_response",
          time,
          `T3 thread reads require a turnLimit from 1 through ${MAX_T3_THREAD_TURN_LIMIT}.`,
        );
      }
      const descriptor = await readDescriptor();
      if ("ok" in descriptor && descriptor.ok === false) return descriptor;
      const result = await readProtectedJson(
        `${THREAD_PATH}${encodeURIComponent(input.threadId)}?turnLimit=${input.turnLimit}`,
        time,
      );
      if ("status" in result) return result;
      const parsed = parseThreadDetailPayload(result.payload);
      if (!parsed)
        return failure(
          "invalid_response",
          time,
          "T3 Code returned an invalid bounded thread snapshot.",
        );
      return {
        fetchedAt: time,
        ok: true as const,
        sourceDigest: digest(parsed),
        sourceSequence: parsed.sourceThreadSequence ?? parsed.sourceSequence,
        sourceStream:
          parsed.sourceThreadSequence === undefined
            ? "shell"
            : `thread:${input.threadId}`,
        sourceUpdatedAt: parsed.sourceUpdatedAt,
        status: "ok" as const,
        thread: parsed.thread,
      };
    },
  };
}
