import { parseGitHubPullRequestUrl } from "./github";
import type {
  T3ActivityObservation,
  T3CheckpointObservation,
  T3MessageObservation,
  T3ProjectObservation,
  T3RepositoryIdentity,
  T3SessionObservation,
  T3ShellObservation,
  T3ThreadObservation,
  T3ThreadShellObservation,
} from "./t3";

type T3ShellSuccess = Extract<T3ShellObservation, { ok: true }>;
type T3ThreadSuccess = Extract<T3ThreadObservation, { ok: true }>;

const ISO_DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const MIN_ISO_DATE = "1970-01-01T00:00:00.000Z";
const RUN_STATUSES = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
  "rolled_back",
]);
const REQUEST_KINDS = new Set([
  "command",
  "file-read",
  "file-change",
  "mcp-elicitation",
  "permission",
  "dynamic_tool_call",
  "user_input",
  "auth_refresh",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nullableString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_DATE_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function finiteNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveInt(value: unknown): value is number {
  return finiteNonNegativeInt(value) && value >= 1;
}

function parseOptionalDate(
  record: Record<string, unknown>,
  field: string,
): { valid: true; value?: string } | { valid: false } {
  const value = record[field];
  if (value === null || value === undefined) return { valid: true };
  return isIsoDate(value) ? { valid: true, value } : { valid: false };
}

function parseRepositoryIdentity(
  value: unknown,
): T3RepositoryIdentity | undefined | null {
  if (value === null || value === undefined) return undefined;
  if (!isRecord(value) || !nonEmptyString(value.canonicalKey)) return null;
  const locator = value.locator;
  if (locator !== undefined && locator !== null && !isRecord(locator))
    return null;
  const remoteUrl = isRecord(locator)
    ? nullableString(locator.remoteUrl)
    : undefined;
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
    repositoryIdentity === null ||
    (value.repositoryIdentity !== null &&
      value.repositoryIdentity !== undefined &&
      repositoryIdentity === undefined)
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

function parsePullRequestUrl(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || !nonEmptyString(value.url)) return null;
  try {
    return parseGitHubPullRequestUrl(value.url).url;
  } catch {
    return null;
  }
}

function classifyPendingRequest(kind: string): {
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
} {
  if (
    kind === "permission" ||
    kind === "dynamic_tool_call" ||
    kind === "command" ||
    kind === "file-read" ||
    kind === "file-change"
  ) {
    return { hasPendingApprovals: true, hasPendingUserInput: false };
  }
  if (
    kind === "mcp-elicitation" ||
    kind === "user_input" ||
    kind === "auth_refresh"
  ) {
    return { hasPendingApprovals: false, hasPendingUserInput: true };
  }
  return { hasPendingApprovals: false, hasPendingUserInput: false };
}

function parsePendingRequest(
  value: unknown,
):
  | { valid: true; flags: ReturnType<typeof classifyPendingRequest> }
  | { valid: false } {
  if (value === undefined || value === null) {
    return {
      valid: true,
      flags: { hasPendingApprovals: false, hasPendingUserInput: false },
    };
  }
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.kind) ||
    !REQUEST_KINDS.has(value.kind) ||
    !isIsoDate(value.createdAt)
  ) {
    return { valid: false };
  }
  return { valid: true, flags: classifyPendingRequest(value.kind) };
}

type T3RunState = "running" | "interrupted" | "completed" | "error";

function stateForRunStatus(status: string): T3RunState | undefined {
  if (
    status === "preparing" ||
    status === "queued" ||
    status === "starting" ||
    status === "running" ||
    status === "waiting"
  ) {
    return "running";
  }
  if (status === "completed") return "completed";
  if (
    status === "interrupted" ||
    status === "cancelled" ||
    status === "rolled_back"
  ) {
    return "interrupted";
  }
  if (status === "failed") return "error";
  return undefined;
}

function parseThreadShell(
  value: unknown,
  archived: boolean,
): T3ThreadShellObservation | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.projectId) ||
    !nonEmptyString(value.title) ||
    !nonEmptyString(value.providerInstanceId) ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt) ||
    typeof value.hasActionableProposedPlan !== "boolean" ||
    typeof value.status !== "string" ||
    (value.status !== "idle" && !RUN_STATUSES.has(value.status))
  ) {
    return undefined;
  }

  if (
    value.latestRunId !== undefined &&
    value.latestRunId !== null &&
    !nonEmptyString(value.latestRunId)
  ) {
    return undefined;
  }
  const latestRunId = nullableString(value.latestRunId);
  const latestRunRequestedAt = parseOptionalDate(value, "latestRunRequestedAt");
  const latestRunStartedAt = parseOptionalDate(value, "latestRunStartedAt");
  const latestRunCompletedAt = parseOptionalDate(value, "latestRunCompletedAt");
  if (
    !latestRunRequestedAt.valid ||
    !latestRunStartedAt.valid ||
    !latestRunCompletedAt.valid
  ) {
    return undefined;
  }
  const latestState =
    value.status === "idle" && latestRunCompletedAt.value !== undefined
      ? "completed"
      : stateForRunStatus(value.status);
  const shellSessionStatus: T3SessionObservation["status"] | undefined =
    value.status === "idle"
      ? "idle"
      : value.status === "preparing" ||
          value.status === "queued" ||
          value.status === "starting"
        ? "starting"
        : value.status === "running"
          ? "running"
          : value.status === "waiting" || value.status === "completed"
            ? "ready"
            : value.status === "interrupted" ||
                value.status === "cancelled" ||
                value.status === "rolled_back"
              ? "interrupted"
              : value.status === "failed"
                ? "error"
                : undefined;
  const session =
    shellSessionStatus === undefined
      ? undefined
      : {
          providerName: value.providerInstanceId,
          status: shellSessionStatus,
          updatedAt: value.updatedAt,
        };
  const latestTurn =
    latestRunId !== undefined &&
    latestRunRequestedAt.value !== undefined &&
    latestState !== undefined
      ? {
          ...(latestRunCompletedAt.value === undefined
            ? {}
            : { completedAt: latestRunCompletedAt.value }),
          ...(latestRunStartedAt.value === undefined
            ? {}
            : { startedAt: latestRunStartedAt.value }),
          requestedAt: latestRunRequestedAt.value,
          state: latestState,
          turnId: latestRunId,
        }
      : undefined;

  const pendingRequest = parsePendingRequest(value.pendingRuntimeRequest);
  if (!pendingRequest.valid) return undefined;
  const pendingBackgroundTasks = value.pendingBackgroundTasks;
  if (
    pendingBackgroundTasks !== undefined &&
    pendingBackgroundTasks !== null &&
    (!Array.isArray(pendingBackgroundTasks) ||
      pendingBackgroundTasks.some(
        (task) =>
          !isRecord(task) ||
          !nonEmptyString(task.taskId) ||
          !nonEmptyString(task.kind) ||
          (task.description !== undefined &&
            task.description !== null &&
            typeof task.description !== "string"),
      ))
  ) {
    return undefined;
  }
  const backgroundKinds = Array.isArray(pendingBackgroundTasks)
    ? pendingBackgroundTasks.map(
        (task) => (task as Record<string, unknown>).kind,
      )
    : [];
  const backgroundLiveness =
    backgroundKinds.length === 0
      ? undefined
      : backgroundKinds.every((kind) => kind === "monitor")
        ? "monitoring"
        : backgroundKinds.some(
              (kind) => kind === "subagent" || kind === "command",
            )
          ? "working"
          : undefined;

  const archivedAt = parseOptionalDate(value, "archivedAt");
  const settledAt = parseOptionalDate(value, "settledAt");
  const latestUserMessageAt = parseOptionalDate(value, "latestUserMessageAt");
  if (
    !archivedAt.valid ||
    !settledAt.valid ||
    !latestUserMessageAt.valid ||
    (archived && archivedAt.value === undefined) ||
    (!archived && archivedAt.value !== undefined)
  ) {
    return undefined;
  }
  const branch = nullableString(value.branch);
  const worktreePath = nullableString(value.worktreePath);
  const linkedPullRequestUrl = parsePullRequestUrl(value.linkedPullRequest);
  if (
    linkedPullRequestUrl === null ||
    (value.branch !== undefined &&
      value.branch !== null &&
      typeof value.branch !== "string") ||
    (value.worktreePath !== undefined &&
      value.worktreePath !== null &&
      typeof value.worktreePath !== "string")
  ) {
    return undefined;
  }

  return {
    ...(archivedAt.value === undefined ? {} : { archivedAt: archivedAt.value }),
    ...(backgroundLiveness === undefined ? {} : { backgroundLiveness }),
    ...(branch === undefined ? {} : { branch }),
    ...(latestTurn === undefined ? {} : { latestTurn }),
    ...(session === undefined ? {} : { session }),
    ...(linkedPullRequestUrl === undefined ? {} : { linkedPullRequestUrl }),
    ...(latestUserMessageAt.value === undefined
      ? {}
      : { latestUserMessageAt: latestUserMessageAt.value }),
    ...(settledAt.value === undefined ? {} : { settledAt: settledAt.value }),
    ...(worktreePath === undefined ? {} : { worktreePath }),
    createdAt: value.createdAt,
    hasActionableProposedPlan: value.hasActionableProposedPlan,
    hasPendingApprovals: pendingRequest.flags.hasPendingApprovals,
    hasPendingUserInput: pendingRequest.flags.hasPendingUserInput,
    id: value.id,
    projectId: value.projectId,
    title: value.title,
    updatedAt: value.updatedAt,
  };
}

function maxDate(values: string[]): string {
  if (values.length === 0) return MIN_ISO_DATE;
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

export function parseT3V2ShellPayload(
  value: unknown,
):
  | Omit<T3ShellSuccess, "ok" | "status" | "fetchedAt" | "sourceDigest">
  | undefined {
  if (
    !isRecord(value) ||
    !positiveInt(value.schemaVersion) ||
    !finiteNonNegativeInt(value.snapshotSequence) ||
    !Array.isArray(value.projects) ||
    !Array.isArray(value.threads) ||
    !Array.isArray(value.archivedThreads)
  ) {
    return undefined;
  }
  const projects = value.projects.map(parseProject);
  if (projects.some((project) => project === undefined)) return undefined;
  const projectRows = projects as T3ProjectObservation[];
  if (
    new Set(projectRows.map((project) => project.id)).size !==
    projectRows.length
  )
    return undefined;

  const activeThreads = value.threads.map((thread) =>
    parseThreadShell(thread, false),
  );
  const archivedThreads = value.archivedThreads.map((thread) =>
    parseThreadShell(thread, true),
  );
  if (
    activeThreads.some((thread) => thread === undefined) ||
    archivedThreads.some((thread) => thread === undefined)
  ) {
    return undefined;
  }
  const activeRows = activeThreads as T3ThreadShellObservation[];
  const archivedRows = archivedThreads as T3ThreadShellObservation[];
  const allThreadIds = [
    ...activeRows.map((thread) => thread.id),
    ...archivedRows.map((thread) => thread.id),
  ];
  if (new Set(allThreadIds).size !== allThreadIds.length) return undefined;

  // Protocol 2 has no snapshot-level updatedAt. Use only projects and active
  // rows so an old archived row cannot make living observations look fresh.
  const sourceUpdatedAt = maxDate([
    ...projectRows.map((project) => project.updatedAt),
    ...activeRows.map((thread) => thread.updatedAt),
  ]);
  return {
    projects: projectRows,
    sourceSequence: value.snapshotSequence,
    sourceStream: "shell",
    sourceUpdatedAt,
    threads: [...activeRows, ...archivedRows],
  };
}

function parseRun(
  value: unknown,
  threadId: string,
):
  | {
      id: string;
      ordinal: number;
      requestedAt: string;
      startedAt?: string;
      completedAt?: string;
      state: "running" | "interrupted" | "completed" | "error";
    }
  | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    value.threadId !== threadId ||
    !positiveInt(value.ordinal) ||
    typeof value.status !== "string" ||
    !RUN_STATUSES.has(value.status) ||
    !isIsoDate(value.requestedAt)
  ) {
    return undefined;
  }
  const startedAt = parseOptionalDate(value, "startedAt");
  const completedAt = parseOptionalDate(value, "completedAt");
  if (!startedAt.valid || !completedAt.valid) return undefined;
  const state = stateForRunStatus(value.status);
  if (state === undefined) return undefined;
  return {
    ...(startedAt.value === undefined ? {} : { startedAt: startedAt.value }),
    ...(completedAt.value === undefined
      ? {}
      : { completedAt: completedAt.value }),
    id: value.id,
    ordinal: value.ordinal,
    requestedAt: value.requestedAt,
    state,
  };
}

function parseSession(value: unknown): T3SessionObservation | undefined | null {
  if (value === null || value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    !nonEmptyString(value.providerInstanceId) ||
    !isIsoDate(value.updatedAt) ||
    (value.status !== "starting" &&
      value.status !== "ready" &&
      value.status !== "running" &&
      value.status !== "waiting" &&
      value.status !== "stopped" &&
      value.status !== "error")
  ) {
    return null;
  }
  return {
    providerName: value.providerInstanceId,
    status: value.status === "waiting" ? "ready" : value.status,
    updatedAt: value.updatedAt,
  };
}

function parseMessage(
  value: unknown,
  threadId: string,
): (T3MessageObservation & { runId?: string }) | undefined {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    value.threadId !== threadId ||
    (value.role !== "user" &&
      value.role !== "assistant" &&
      value.role !== "system") ||
    typeof value.streaming !== "boolean" ||
    !isIsoDate(value.createdAt) ||
    !isIsoDate(value.updatedAt)
  ) {
    return undefined;
  }
  if (
    value.runId !== undefined &&
    value.runId !== null &&
    !nonEmptyString(value.runId)
  ) {
    return undefined;
  }
  const runId = nullableString(value.runId);
  return {
    ...(runId === undefined ? {} : { runId, turnId: runId }),
    createdAt: value.createdAt,
    id: value.id,
    role: value.role,
    streaming: value.streaming,
    updatedAt: value.updatedAt,
  };
}

function parseRuntimeRequestFlags(
  value: unknown,
):
  | { valid: true; hasPendingApprovals: boolean; hasPendingUserInput: boolean }
  | { valid: false } {
  if (!Array.isArray(value)) return { valid: false };
  let hasPendingApprovals = false;
  let hasPendingUserInput = false;
  for (const request of value) {
    if (
      !isRecord(request) ||
      !nonEmptyString(request.id) ||
      !nonEmptyString(request.nodeId) ||
      (request.providerTurnId !== undefined &&
        request.providerTurnId !== null &&
        !nonEmptyString(request.providerTurnId)) ||
      !nonEmptyString(request.kind) ||
      !REQUEST_KINDS.has(request.kind) ||
      (request.status !== "pending" &&
        request.status !== "resolved" &&
        request.status !== "expired" &&
        request.status !== "cancelled") ||
      !isIsoDate(request.createdAt)
    ) {
      return { valid: false };
    }
    if (request.status === "pending") {
      const flags = classifyPendingRequest(request.kind);
      hasPendingApprovals ||= flags.hasPendingApprovals;
      hasPendingUserInput ||= flags.hasPendingUserInput;
    }
  }
  return { valid: true, hasPendingApprovals, hasPendingUserInput };
}

function parseCheckpoint(
  value: unknown,
  threadId: string,
  runIds: Set<string>,
): T3CheckpointObservation | undefined | null {
  if (
    !isRecord(value) ||
    !nonEmptyString(value.id) ||
    value.threadId !== threadId ||
    (value.runId !== undefined &&
      value.runId !== null &&
      !nonEmptyString(value.runId)) ||
    !isIsoDate(value.capturedAt) ||
    !Array.isArray(value.files) ||
    (value.status !== "ready" &&
      value.status !== "missing" &&
      value.status !== "error" &&
      value.status !== "stale")
  ) {
    return null;
  }
  const files: T3CheckpointObservation["files"] = [];
  for (const file of value.files) {
    if (
      !isRecord(file) ||
      !nonEmptyString(file.path) ||
      !nonEmptyString(file.kind) ||
      !finiteNonNegativeInt(file.additions) ||
      !finiteNonNegativeInt(file.deletions)
    ) {
      return null;
    }
    files.push({
      additions: file.additions,
      deletions: file.deletions,
      kind: file.kind,
      path: file.path,
    });
  }
  if (!nonEmptyString(value.runId) || !runIds.has(value.runId))
    return undefined;
  return {
    completedAt: value.capturedAt,
    files,
    status: value.status === "stale" ? "error" : value.status,
    turnId: value.runId,
  };
}

function parseActivity(
  value: unknown,
  threadId: string,
  runIds: Set<string>,
): T3ActivityObservation | undefined | null {
  if (
    !isRecord(value) ||
    !finiteNonNegativeInt(value.position) ||
    (value.visibility !== "local" &&
      value.visibility !== "inherited" &&
      value.visibility !== "synthetic") ||
    !nonEmptyString(value.sourceThreadId) ||
    !nonEmptyString(value.sourceItemId) ||
    !isRecord(value.item)
  ) {
    return null;
  }
  const item = value.item;
  if (
    !nonEmptyString(item.id) ||
    !nonEmptyString(item.type) ||
    !isIsoDate(item.updatedAt)
  ) {
    return null;
  }
  if (
    item.runId !== undefined &&
    item.runId !== null &&
    !nonEmptyString(item.runId)
  ) {
    return null;
  }
  const runId = nullableString(item.runId);
  if (runId === undefined || !runIds.has(runId)) return undefined;
  if (value.sourceThreadId !== threadId) return undefined;
  const type = item.type;
  const tone: T3ActivityObservation["tone"] =
    type === "approval_request" || type === "user_input_request"
      ? "approval"
      : type.includes("error") ||
          item.status === "failed" ||
          item.status === "interrupted"
        ? "error"
        : /command|tool|file_change|file_search|web_search/.test(type)
          ? "tool"
          : "info";
  return {
    createdAt: item.updatedAt,
    id: `${value.sourceThreadId}:${value.sourceItemId}`,
    kind: type,
    sequence: finiteNonNegativeInt(item.ordinal)
      ? item.ordinal
      : value.position,
    tone,
    turnId: runId,
  };
}

function parsePlanActionability(value: unknown): boolean | undefined {
  if (!Array.isArray(value)) return undefined;
  let actionable = false;
  for (const plan of value) {
    if (
      !isRecord(plan) ||
      !nonEmptyString(plan.id) ||
      (plan.kind !== "proposed_plan" && plan.kind !== "todo_list") ||
      !nonEmptyString(plan.status) ||
      (plan.status !== "draft" &&
        plan.status !== "active" &&
        plan.status !== "completed" &&
        plan.status !== "superseded")
    ) {
      return undefined;
    }
    if (
      plan.kind === "proposed_plan" &&
      (plan.status === "draft" || plan.status === "active")
    ) {
      actionable = true;
    }
  }
  return actionable;
}

export function parseT3V2ThreadPayload(
  value: unknown,
  input: { threadId: string; turnLimit: number },
):
  | Omit<T3ThreadSuccess, "ok" | "status" | "fetchedAt" | "sourceDigest">
  | undefined {
  if (
    !isRecord(value) ||
    !finiteNonNegativeInt(value.snapshotSequence) ||
    !isRecord(value.projection) ||
    typeof value.hasMoreHistory !== "boolean" ||
    (value.payloadBudgetExceeded !== undefined &&
      typeof value.payloadBudgetExceeded !== "boolean") ||
    value.payloadBudgetExceeded === true
  ) {
    return undefined;
  }
  const projection = value.projection;
  const threadValue = projection.thread;
  if (
    !isRecord(threadValue) ||
    threadValue.id !== input.threadId ||
    !nonEmptyString(threadValue.projectId) ||
    !nonEmptyString(threadValue.title) ||
    !nonEmptyString(threadValue.providerInstanceId) ||
    !isIsoDate(threadValue.createdAt) ||
    !isIsoDate(threadValue.updatedAt) ||
    !Array.isArray(projection.runs) ||
    !Array.isArray(projection.providerSessions) ||
    !Array.isArray(projection.runtimeRequests) ||
    !Array.isArray(projection.messages) ||
    !Array.isArray(projection.plans) ||
    !Array.isArray(projection.checkpoints) ||
    !Array.isArray(projection.visibleTurnItems) ||
    !isIsoDate(projection.updatedAt)
  ) {
    return undefined;
  }

  const runs = projection.runs.map((run) => parseRun(run, input.threadId));
  if (runs.some((run) => run === undefined)) return undefined;
  const runRows = runs as NonNullable<(typeof runs)[number]>[];
  if (
    new Set(runRows.map((run) => run.id)).size !== runRows.length ||
    new Set(runRows.map((run) => run.ordinal)).size !== runRows.length
  ) {
    return undefined;
  }
  const latestRun = [...runRows].sort(
    (left, right) => right.ordinal - left.ordinal,
  )[0];
  const selectedRuns = new Set(
    [...runRows]
      .sort((left, right) => right.ordinal - left.ordinal)
      .slice(0, input.turnLimit)
      .map((run) => run.id),
  );

  const sessions = projection.providerSessions.map(parseSession);
  if (sessions.some((session) => session === null)) return undefined;
  const sessionRows = sessions.filter(
    (session): session is T3SessionObservation =>
      session !== undefined &&
      session !== null &&
      session.providerName === threadValue.providerInstanceId,
  );
  const selectedSession = sessionRows.sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )[0];
  // An old provider session can outlive a cancelled or completed run. The
  // durable latest run status takes precedence for the current thread.
  const session =
    latestRun !== undefined &&
    latestRun.state !== "running" &&
    (selectedSession?.status === "running" ||
      selectedSession?.status === "starting")
      ? { ...selectedSession, status: "ready" as const }
      : selectedSession;

  const requestFlags = parseRuntimeRequestFlags(projection.runtimeRequests);
  if (!requestFlags.valid) return undefined;

  const messages = projection.messages.map((message) =>
    parseMessage(message, input.threadId),
  );
  if (messages.some((message) => message === undefined)) return undefined;
  const messageRows = messages as NonNullable<(typeof messages)[number]>[];
  const latestUserMessageAt = messageRows
    .filter((message) => message.role === "user")
    .map((message) => message.createdAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const selectedMessages: T3MessageObservation[] = messageRows
    .filter(
      (message) =>
        message.runId !== undefined && selectedRuns.has(message.runId),
    )
    .map(({ runId: _runId, ...message }) => message);

  const hasActionableProposedPlan = parsePlanActionability(projection.plans);
  if (hasActionableProposedPlan === undefined) return undefined;

  const checkpoints: T3CheckpointObservation[] = [];
  for (const checkpoint of projection.checkpoints) {
    const parsed = parseCheckpoint(checkpoint, input.threadId, selectedRuns);
    if (parsed === null) return undefined;
    if (parsed !== undefined) checkpoints.push(parsed);
  }

  const activities: T3ActivityObservation[] = [];
  for (const item of projection.visibleTurnItems) {
    const parsed = parseActivity(item, input.threadId, selectedRuns);
    if (parsed === null) return undefined;
    if (parsed !== undefined) activities.push(parsed);
  }

  const archivedDate = parseOptionalDate(threadValue, "archivedAt");
  const settledDate = parseOptionalDate(threadValue, "settledAt");
  const latestAuthoredDate = parseOptionalDate(
    threadValue,
    "latestUserAuthoredMessageAt",
  );
  const latestThreadUserDate = parseOptionalDate(
    threadValue,
    "latestUserMessageAt",
  );
  if (
    !archivedDate.valid ||
    !settledDate.valid ||
    !latestAuthoredDate.valid ||
    !latestThreadUserDate.valid
  ) {
    return undefined;
  }
  const archivedAt = archivedDate.value;
  const settledAt = settledDate.value;
  const latestUserDate =
    latestAuthoredDate.value ??
    latestThreadUserDate.value ??
    latestUserMessageAt;
  const linkedPullRequestUrl = parsePullRequestUrl(
    threadValue.linkedPullRequest,
  );
  if (linkedPullRequestUrl === null) return undefined;
  const branch = nullableString(threadValue.branch);
  const worktreePath = nullableString(threadValue.worktreePath);
  if (
    (threadValue.branch !== undefined &&
      threadValue.branch !== null &&
      typeof threadValue.branch !== "string") ||
    (threadValue.worktreePath !== undefined &&
      threadValue.worktreePath !== null &&
      typeof threadValue.worktreePath !== "string")
  ) {
    return undefined;
  }
  const thread: T3ThreadShellObservation & {
    messages: T3MessageObservation[];
    activities: T3ActivityObservation[];
    checkpoints: T3CheckpointObservation[];
  } = {
    ...(archivedAt === undefined ? {} : { archivedAt }),
    ...(branch === undefined ? {} : { branch }),
    ...(latestRun === undefined
      ? {}
      : {
          latestTurn: {
            ...(latestRun.completedAt === undefined
              ? {}
              : { completedAt: latestRun.completedAt }),
            ...(latestRun.startedAt === undefined
              ? {}
              : { startedAt: latestRun.startedAt }),
            requestedAt: latestRun.requestedAt,
            state: latestRun.state,
            turnId: latestRun.id,
          },
        }),
    ...(linkedPullRequestUrl === undefined ? {} : { linkedPullRequestUrl }),
    ...(latestUserDate === undefined
      ? {}
      : { latestUserMessageAt: latestUserDate }),
    ...(session === undefined ? {} : { session }),
    ...(settledAt === undefined ? {} : { settledAt }),
    ...(worktreePath === undefined ? {} : { worktreePath }),
    activities,
    checkpoints,
    createdAt: threadValue.createdAt,
    hasActionableProposedPlan,
    hasPendingApprovals: requestFlags.hasPendingApprovals,
    hasPendingUserInput: requestFlags.hasPendingUserInput,
    id: threadValue.id,
    messages: selectedMessages,
    projectId: threadValue.projectId,
    title: threadValue.title,
    updatedAt: threadValue.updatedAt,
  };
  return {
    hasMoreHistory: value.hasMoreHistory,
    sourceSequence: value.snapshotSequence,
    sourceStream: "shell",
    sourceUpdatedAt: projection.updatedAt,
    thread,
  };
}
