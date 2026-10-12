import type {
  Project,
  StatusReport,
  Subtask,
  Task,
  TaskStatus,
  Verification,
} from "./application";
import type { GitHubStatusSnapshot } from "./github";
import type {
  T3ObservedActivity,
  T3ObservedConnection,
  T3ObservedThread,
} from "./t3-coordinator";

/** The timezone used by the Floor when the caller does not provide one. */
export const FLOOR_DEFAULT_TIMEZONE = "America/Indiana/Indianapolis";
/** A live Floor observation must come from a recent successful source fetch. */
export const FLOOR_SOURCE_FRESH_WINDOW_MS = 60_000;
const FLOOR_SOURCE_FUTURE_SKEW_MS = 5_000;

export type FloorWorkState =
  | "backlog"
  | "planned"
  | "active"
  | "blocked"
  | "awaiting_verification";

export type FloorTarget = {
  projectId: string;
  taskId: string;
  taskSimpleId: string;
  taskName: string;
  subtaskId?: string;
  subtaskSimpleId?: string;
  subtaskName?: string;
};

export type FloorWorkItem = FloorTarget & {
  state: FloorWorkState;
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
  stateReason?: string;
  createdAt: string;
};

export type FloorClaim = FloorTarget & {
  reportId: string;
  reportedAt: string;
  reporter: string;
  evidence?: string;
  reason?: string;
};

export type FloorWorker = {
  /** Neutral when T3 did not provide a trustworthy agent identity. */
  initials: string;
  identity: "claude" | "codex" | "unknown";
};

export type FloorStation = {
  id: string;
  state:
    | "working"
    | "idle"
    | "waiting_approval"
    | "waiting_input"
    | "error"
    | "blocked";
  target?: FloorTarget;
  worker?: FloorWorker;
  threadId?: string;
  threadTitle?: string;
  sourceId?: string;
  association: "linked" | "unmatched" | "ambiguous" | "none";
  observedAt?: string;
  relatedTargets?: FloorTarget[];
};

export type FloorTaskCard = FloorTarget & {
  state: FloorWorkState | "completed";
  priority?: "low" | "medium" | "high" | "urgent";
  sortOrder?: number;
  owner?: string;
  stateReason?: string;
  manualHold: boolean;
  steps?: { done: number; total: number };
  finish: {
    kind: "pr_merge" | "agent_report";
    requireHumanCheck: boolean;
    humanCheckReady: boolean;
    requiredPrCount: number;
    mergedPrCount: number;
    agentReportedFinished: boolean;
  };
  sessions: FloorStation[];
  sessionsAvailable: boolean;
  handoff?: {
    nextOwner: string;
    nextOwnerKind: "human" | "agent" | "unknown";
    nextAction: string;
    reporter: string;
    reportedAt: string;
    additionalCount: number;
  };
  needsYou: {
    count: number;
    verbs: FloorQueueAction[];
    oldestAt?: string;
  };
  completedAt?: string;
  finishProvenance?: string;
};

export type FloorProject = {
  id: string;
  name: string;
  bench: FloorWorkItem[];
  stations: FloorStation[];
  counter: FloorClaim[];
  reviewNeeded: FloorWorkItem[];
  counts: {
    working: number;
    waiting: number;
    blocked: number;
  };
  tasks?: FloorTaskCard[];
  recentlyDone?: FloorTaskCard[];
  unmatchedSessions?: FloorStation[];
  sessionsAvailable?: boolean;
};

export type FloorQueueAction = "review" | "check" | "decide" | "unblock";

export type FloorQueueTarget =
  | { kind: "work"; target: FloorTarget }
  | {
      kind: "thread";
      projectId: string;
      threadId: string;
      threadTitle: string;
      sourceId: string;
      target?: FloorTarget;
    }
  | {
      kind: "finding";
      projectId: string;
      findingId: string;
      threadId?: string;
    };

export type FloorQueueItem = {
  id: string;
  action: FloorQueueAction;
  target: FloorQueueTarget;
  timestamp: string;
  projectId: string;
  projectName: string;
  summary: string;
  reason?: string;
  relatedTargets?: FloorTarget[];
};

export type FloorEvent = {
  id: string;
  kind: "report" | "verification" | "turn" | "session";
  timestamp: string;
  actor: string;
  summary: string;
  projectId: string;
  target?: FloorTarget;
};

export type FloorConnection = {
  sourceId: string;
  machineId: string;
  state: T3ObservedConnection["state"];
  fresh: boolean;
  observedAt?: string;
  lastSuccessfulFetchAt?: string;
  sourceVersion?: string;
  error?: string;
};

export type FloorScoreboard = {
  stampedToday: number;
  finishedToday?: number;
  reportsToday: number;
  workingNow: number;
  oldestPendingAt?: string;
};

export type FloorSnapshot = {
  generatedAt: string;
  timezone: string;
  projects: FloorProject[];
  queue: FloorQueueItem[];
  events: FloorEvent[];
  scoreboard: FloorScoreboard;
  connections: FloorConnection[];
  trackingNotes?: FloorQueueItem[];
};

export type FloorTaskInput = {
  task: Task;
  status: TaskStatus;
  subtasks: Subtask[];
};

export type FloorProjectionInput = {
  projects: Project[];
  tasks: FloorTaskInput[];
  statusReports: StatusReport[];
  verifications: Verification[];
  activities: FloorProjectActivity[];
  githubStatuses?: Readonly<Record<string, GitHubStatusSnapshot | undefined>>;
  now: Date;
  timezone?: string;
};

export type FloorProjectActivity = {
  projectId: string;
  activity: T3ObservedActivity;
};

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return parsed.toISOString();
}

function timestamp(value: Date | string | undefined): number {
  if (value === undefined) return Number.NEGATIVE_INFINITY;
  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function validIso(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function compareOldest<T extends { timestamp: string }>(left: T, right: T) {
  return timestamp(left.timestamp) - timestamp(right.timestamp);
}

function compareNewest<T extends { timestamp: string }>(left: T, right: T) {
  return timestamp(right.timestamp) - timestamp(left.timestamp);
}

function isToday(value: Date | string, now: Date, timezone: string): boolean {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(value)) === formatter.format(now);
}

function targetFor(
  project: Project,
  task: Task,
  subtask?: Subtask,
): FloorTarget {
  return {
    projectId: project.id,
    taskId: task.id,
    taskName: task.name,
    taskSimpleId: task.simpleId ?? task.id,
    ...(subtask
      ? {
          subtaskId: subtask.id,
          subtaskName: subtask.name,
          subtaskSimpleId: subtask.simpleId ?? subtask.id,
        }
      : {}),
  };
}

function taskItem(
  project: Project,
  task: Task,
  status: TaskStatus,
): FloorWorkItem | undefined {
  const state = status.taskState;
  if (
    state !== "backlog" &&
    state !== "planned" &&
    state !== "active" &&
    state !== "blocked" &&
    state !== "awaiting_verification"
  )
    return undefined;
  return {
    ...targetFor(project, task),
    createdAt: iso(task.createdAt),
    state,
    ...(task.owner ? { owner: task.owner } : {}),
    ...(task.priority ? { priority: task.priority } : {}),
    ...(status.stateReason ? { stateReason: status.stateReason } : {}),
  };
}

function reportById(
  reports: readonly StatusReport[],
  id: string | undefined,
): StatusReport | undefined {
  return id === undefined
    ? undefined
    : reports.find((report) => report.id === id);
}

function verificationByReportId(
  verifications: readonly Verification[],
  reportId: string,
): Verification | undefined {
  return verifications
    .filter((verification) => verification.reportId === reportId)
    .sort(
      (left, right) => timestamp(right.createdAt) - timestamp(left.createdAt),
    )[0];
}

function latestReportForSubtask(
  reports: readonly StatusReport[],
  subtaskId: string,
): StatusReport | undefined {
  return reports
    .filter((report) => report.subtaskId === subtaskId)
    .sort(
      (left, right) => timestamp(right.createdAt) - timestamp(left.createdAt),
    )[0];
}

function activeTarget(
  projects: Map<string, Project>,
  taskInputs: Map<string, FloorTaskInput>,
  taskId: string | undefined,
  subtaskId: string | undefined,
): FloorTarget | undefined {
  if (!taskId) return undefined;
  const input = taskInputs.get(taskId);
  const project = input && projects.get(input.task.projectId);
  if (!input || !project || input.task.archiveState !== undefined)
    return undefined;
  const subtask = subtaskId
    ? input.subtasks.find((candidate) => candidate.id === subtaskId)
    : undefined;
  if (subtaskId && (!subtask || subtask.archiveState !== undefined))
    return undefined;
  return targetFor(project, input.task, subtask);
}

function targetForLink(
  projects: Map<string, Project>,
  inputs: readonly FloorTaskInput[],
  projectId: string,
  link: T3ObservedThread["association"]["links"][number] | undefined,
): FloorTarget | undefined {
  if (!link) return undefined;
  const input = inputs.find(
    (candidate) =>
      candidate.task.projectId === projectId &&
      (candidate.task.id === link.target.id ||
        candidate.subtasks.some((subtask) => subtask.id === link.target.id)),
  );
  const project = projects.get(projectId);
  if (!input || !project || input.task.archiveState !== undefined)
    return undefined;
  const subtask =
    link.target.kind === "subtask"
      ? input.subtasks.find((candidate) => candidate.id === link.target.id)
      : undefined;
  if (subtask && subtask.archiveState !== undefined) return undefined;
  return targetFor(project, input.task, subtask);
}

function targetsForLinks(
  projects: Map<string, Project>,
  inputs: readonly FloorTaskInput[],
  projectId: string,
  links: T3ObservedThread["association"]["links"],
): FloorTarget[] {
  const values = links
    .map((link) => targetForLink(projects, inputs, projectId, link))
    .filter((value): value is FloorTarget => value !== undefined);
  return [
    ...new Map(
      values.map((value) => [
        `${value.taskId}:${value.subtaskId ?? ""}`,
        value,
      ]),
    ).values(),
  ];
}

function identityFor(thread: T3ObservedThread): FloorWorker {
  const agent = thread.agent?.trim().toLowerCase();
  if (agent === "claude") return { identity: "claude", initials: "CL" };
  if (agent === "codex") return { identity: "codex", initials: "CX" };
  return { identity: "unknown", initials: "?" };
}

function workerName(workerValue: FloorWorker): string {
  if (workerValue.identity === "claude") return "Claude";
  if (workerValue.identity === "codex") return "Codex";
  return "Worker";
}

function threadState(thread: T3ObservedThread): FloorStation["state"] {
  if (
    thread.latestSessionState === "error" ||
    thread.latestTurnState === "error"
  )
    return "error";
  if (thread.hasPendingApprovals) return "waiting_approval";
  if (thread.hasPendingUserInput) return "waiting_input";
  if (
    thread.latestSessionState === "running" ||
    thread.latestTurnState === "running"
  )
    return "working";
  return "idle";
}

function currentConnection(
  activity: T3ObservedActivity,
  sourceId: string,
): T3ObservedConnection | undefined {
  return (
    activity.sources.find((source) => source.sourceId === sourceId)
      ?.connection ??
    (activity.sourceId === sourceId ? activity.connection : undefined)
  );
}

function sourceIsFresh(
  activity: T3ObservedActivity,
  sourceId: string,
  now: Date,
): boolean {
  const source = activity.sources.find(
    (candidate) => candidate.sourceId === sourceId,
  );
  if (activity.sources.length > 0 && !source) return false;
  return (
    (source?.status ?? activity.status) === "ok" &&
    connectionIsFresh(activity, sourceId, now)
  );
}

function hasFreshRunningChildObservation(
  activities: readonly FloorProjectActivity[],
  projects: Map<string, Project>,
  taskInputs: readonly FloorTaskInput[],
  projectId: string,
  taskId: string,
  subtaskId: string,
  now: Date,
): boolean {
  return activities.some(({ projectId: activityProjectId, activity }) => {
    if (activityProjectId !== projectId) return false;
    return activityThreads([activity]).some(
      (thread) =>
        sourceIsFresh(activity, thread.sourceId, now) &&
        thread.association.state === "linked" &&
        thread.sourceCurrent !== false &&
        threadState(thread) === "working" &&
        targetsForLinks(
          projects,
          taskInputs,
          projectId,
          thread.association.links,
        ).some(
          (target) =>
            target.taskId === taskId && target.subtaskId === subtaskId,
        ),
    );
  });
}

function hasFreshAgentHandoffChildren(
  task: Task,
  status: TaskStatus,
  subtasks: readonly Subtask[],
  projects: Map<string, Project>,
  taskInputs: readonly FloorTaskInput[],
  activities: readonly FloorProjectActivity[],
  now: Date,
): boolean {
  if (task.workStateSource !== "rollup") return false;
  const blockedSubtasks = status.subtasks.filter(
    (subtask) =>
      subtask.archiveState === undefined &&
      subtask.subtaskId &&
      subtask.effectiveState === "blocked",
  );
  if (blockedSubtasks.length === 0) return false;

  const activeStatusIds = new Set(
    status.subtasks
      .filter(
        (subtask) =>
          subtask.archiveState === undefined &&
          subtask.effectiveState === "active",
      )
      .map((subtask) => subtask.subtaskId),
  );
  const activeSubtaskIds = new Set(
    subtasks
      .filter(
        (subtask) =>
          subtask.taskId === task.id && subtask.archiveState === undefined,
      )
      .map((subtask) => subtask.id),
  );

  return blockedSubtasks.every((blockedSubtask) => {
    const handoff = blockedSubtask.handoff;
    const waitingOnSubtaskIds = handoff?.waitingOnSubtaskIds;
    if (
      handoff?.nextOwnerKind !== "agent" ||
      !waitingOnSubtaskIds ||
      waitingOnSubtaskIds.length === 0
    ) {
      return false;
    }
    return waitingOnSubtaskIds.every(
      (subtaskId) =>
        activeStatusIds.has(subtaskId) &&
        activeSubtaskIds.has(subtaskId) &&
        hasFreshRunningChildObservation(
          activities,
          projects,
          taskInputs,
          task.projectId,
          task.id,
          subtaskId,
          now,
        ),
    );
  });
}

function connectionIsFresh(
  activity: T3ObservedActivity,
  sourceId: string,
  now: Date,
): boolean {
  const connection = currentConnection(activity, sourceId);
  if (connection?.state !== "connected" || connection === undefined)
    return false;
  const fetchedAt = timestamp(
    connection.lastSuccessfulFetchAt ?? connection.observedAt,
  );
  if (!Number.isFinite(fetchedAt)) return false;
  const age = now.getTime() - fetchedAt;
  return (
    age <= FLOOR_SOURCE_FRESH_WINDOW_MS && age >= -FLOOR_SOURCE_FUTURE_SKEW_MS
  );
}

function threadKey(thread: T3ObservedThread): string {
  return `${thread.sourceId}:${thread.threadId}`;
}

function queueTargetForThread(
  project: Project,
  thread: T3ObservedThread,
  target: FloorTarget | undefined,
): FloorQueueTarget {
  return {
    kind: "thread",
    projectId: project.id,
    sourceId: thread.sourceId,
    threadId: thread.threadId,
    threadTitle: thread.title,
    ...(target ? { target } : {}),
  };
}

function activityThreads(
  activities: readonly T3ObservedActivity[],
): T3ObservedThread[] {
  const deduped = new Map<string, T3ObservedThread>();
  for (const activity of activities) {
    for (const source of activity.sources) {
      for (const thread of source.threads) {
        const key = threadKey(thread);
        const current = deduped.get(key);
        if (
          !current ||
          timestamp(thread.observedAt) >= timestamp(current.observedAt)
        ) {
          deduped.set(key, thread);
        }
      }
    }
    for (const thread of activity.threads) {
      const key = threadKey(thread);
      const current = deduped.get(key);
      if (
        !current ||
        timestamp(thread.observedAt) >= timestamp(current.observedAt)
      ) {
        deduped.set(key, thread);
      }
    }
  }
  return [...deduped.values()];
}

function actionable(thread: T3ObservedThread): boolean {
  return (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    thread.latestSessionState === "running" ||
    thread.latestTurnState === "running" ||
    thread.latestSessionState === "error" ||
    thread.latestTurnState === "error"
  );
}

function connectionViews(
  activities: readonly FloorProjectActivity[],
  now: Date,
): FloorConnection[] {
  const views = new Map<string, FloorConnection>();
  for (const { activity } of activities) {
    const sources = activity.sources.length
      ? activity.sources
      : [
          {
            sourceId: activity.sourceId,
            machineId: activity.machineId,
            connection: activity.connection,
          },
        ];
    for (const source of sources) {
      const connection = source.connection;
      const view: FloorConnection = {
        error: connection.error,
        fresh: activityStatus(activities, source.sourceId, now),
        lastSuccessfulFetchAt: connection.lastSuccessfulFetchAt,
        machineId: source.machineId,
        observedAt: connection.observedAt,
        sourceId: source.sourceId,
        sourceVersion: connection.sourceVersion,
        state: connection.state,
      };
      const current = views.get(source.sourceId);
      if (!current) {
        views.set(source.sourceId, view);
      } else if (!view.fresh) {
        // A source is not globally fresh when any scoped Project reports it
        // unavailable; fail closed for the aggregate Floor connection.
        views.set(source.sourceId, {
          ...current,
          error: view.error ?? current.error,
          fresh: false,
          state: view.state,
          ...(timestamp(view.observedAt) >= timestamp(current.observedAt)
            ? { observedAt: view.observedAt }
            : {}),
        });
      } else if (
        timestamp(view.observedAt) >= timestamp(current.observedAt) &&
        current.fresh
      ) {
        views.set(source.sourceId, view);
      }
    }
  }
  return [...views.values()].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId),
  );
}

function activityStatus(
  activities: readonly FloorProjectActivity[],
  sourceId: string,
  now: Date,
): boolean {
  const scoped = activities.filter(
    ({ activity }) =>
      activity.sources.some((source) => source.sourceId === sourceId) ||
      activity.sourceId === sourceId,
  );
  return (
    scoped.length > 0 &&
    scoped.every(({ activity }) => connectionIsFresh(activity, sourceId, now))
  );
}

function cardState(status: TaskStatus): FloorTaskCard["state"] | undefined {
  switch (status.taskState) {
    case "backlog":
    case "planned":
    case "active":
    case "blocked":
    case "awaiting_verification":
    case "completed":
      return status.taskState;
    default:
      return undefined;
  }
}

function currentFinishMetadata(
  status: TaskStatus,
): TaskStatus["finishMetadata"] {
  return status.finishMetadata?.epoch === status.workflowEpoch
    ? status.finishMetadata
    : undefined;
}

function taskSteps(input: FloorTaskInput): FloorTaskCard["steps"] {
  const subtasks = new Map(
    input.subtasks.map((subtask) => [subtask.id, subtask]),
  );
  const rows = input.status.subtasks.flatMap((stepStatus) => {
    const subtask = subtasks.get(stepStatus.subtaskId);
    if (
      !subtask ||
      subtask.archiveState === "wont_do" ||
      stepStatus.archiveState === "wont_do"
    )
      return [];
    return [{ stepStatus, subtask }];
  });
  if (rows.length === 0) return undefined;
  return {
    done: rows.filter(
      ({ stepStatus, subtask }) =>
        stepStatus.effectiveState === "completed" ||
        stepStatus.archiveState === "released" ||
        subtask.archiveState === "released",
    ).length,
    total: rows.length,
  };
}

function taskHandoff(
  input: FloorTaskInput,
  statusReports: readonly StatusReport[],
): FloorTaskCard["handoff"] {
  const taskReport = input.status.latestTaskReport;
  const taskReportedAt = validIso(taskReport?.createdAt);
  const taskHandoff = taskReport?.handoff;
  const stepsById = new Map(
    input.subtasks.map((subtask) => [subtask.id, subtask]),
  );
  const stepHandoffs = input.status.subtasks.flatMap((stepStatus) => {
    const subtask = stepsById.get(stepStatus.subtaskId);
    if (
      !subtask ||
      !stepStatus.handoff ||
      subtask.archiveState !== undefined ||
      stepStatus.archiveState !== undefined ||
      stepStatus.effectiveState === "completed"
    )
      return [];
    const report =
      reportById(statusReports, stepStatus.reportId) ??
      latestReportForSubtask(statusReports, stepStatus.subtaskId);
    const reportedAt = validIso(
      stepStatus.reportCreatedAt ?? report?.createdAt,
    );
    if (!reportedAt) return [];
    return [
      {
        handoff: stepStatus.handoff,
        reporter: stepStatus.reporter ?? report?.reporter ?? "Unknown",
        reportedAt,
        subtaskId: stepStatus.subtaskId,
      },
    ];
  });

  if (taskHandoff && taskReport && taskReportedAt) {
    return {
      nextOwner: taskHandoff.nextOwner,
      nextOwnerKind: taskHandoff.nextOwnerKind,
      nextAction: taskHandoff.nextAction,
      reporter: taskReport.reporter,
      reportedAt: taskReportedAt,
      additionalCount: stepHandoffs.length,
    };
  }

  const newestStepHandoff = stepHandoffs.sort(
    (left, right) =>
      timestamp(right.reportedAt) - timestamp(left.reportedAt) ||
      left.subtaskId.localeCompare(right.subtaskId),
  )[0];
  return newestStepHandoff
    ? {
        nextOwner: newestStepHandoff.handoff.nextOwner,
        nextOwnerKind: newestStepHandoff.handoff.nextOwnerKind,
        nextAction: newestStepHandoff.handoff.nextAction,
        reporter: newestStepHandoff.reporter,
        reportedAt: newestStepHandoff.reportedAt,
        additionalCount: stepHandoffs.length - 1,
      }
    : undefined;
}

function queueTargetsTask(item: FloorQueueItem, taskId: string): boolean {
  const directTarget =
    item.target.kind === "work" || item.target.kind === "thread"
      ? item.target.target
      : undefined;
  return (
    directTarget?.taskId === taskId ||
    item.relatedTargets?.some((target) => target.taskId === taskId) === true
  );
}

function finishProvenance(status: TaskStatus): string | undefined {
  const metadata = currentFinishMetadata(status);
  if (!metadata) return undefined;
  if (metadata.kind === "pr_merge" && metadata.mergeProofs?.length) {
    const proofs = metadata.mergeProofs.map((proof) => {
      const number = proof.pullRequestUrl.match(/\/pull\/(\d+)(?:\/|$)/)?.[1];
      return `${number ? `PR #${number}` : "Required PR"} merged to ${proof.defaultBranch}`;
    });
    return `${proofs.join(" · ")} · by ${metadata.actor}`;
  }
  const kind =
    metadata.kind === "agent_report"
      ? "Agent report"
      : metadata.kind === "human_check"
        ? "Human check"
        : metadata.kind === "human_mark_done"
          ? "Marked done"
          : metadata.kind === "pr_merge"
            ? "Required PRs merged"
            : "Legacy completion";
  return `${kind} by ${metadata.actor}`;
}

function taskCard(
  project: Project,
  input: FloorTaskInput,
  queue: readonly FloorQueueItem[],
  statusReports: readonly StatusReport[],
  sessions: FloorStation[],
  sessionsAvailable: boolean,
  stateOverride?: FloorTaskCard["state"],
): FloorTaskCard | undefined {
  const state = stateOverride ?? cardState(input.status);
  if (!state) return undefined;
  const steps = taskSteps(input);
  const handoff = taskHandoff(input, statusReports);
  const provenance = finishProvenance(input.status);
  const required = input.status.requiredPullRequests.filter(
    (pullRequest) => pullRequest.required,
  );
  const matchingQueue = queue.filter((item) =>
    queueTargetsTask(item, input.task.id),
  );
  const verbs = new Set(matchingQueue.map((item) => item.action));
  const metadata = currentFinishMetadata(input.status);
  const completedAt = metadata && validIso(metadata.completedAt);
  const latestTaskReport = input.status.latestTaskReport;
  return {
    ...targetFor(project, input.task),
    state,
    ...(input.task.priority ? { priority: input.task.priority } : {}),
    ...(input.task.sortOrder === undefined
      ? {}
      : { sortOrder: input.task.sortOrder }),
    ...(input.task.owner ? { owner: input.task.owner } : {}),
    ...((input.status.stateReason ?? input.task.stateReason)
      ? { stateReason: input.status.stateReason ?? input.task.stateReason }
      : {}),
    manualHold: input.status.manualHold,
    ...(steps ? { steps } : {}),
    finish: {
      kind: input.status.finishRule.kind,
      requireHumanCheck: input.status.finishRule.requireHumanCheck,
      humanCheckReady: input.status.humanCheckReady,
      requiredPrCount: required.length,
      mergedPrCount: required.filter(
        (pullRequest) =>
          pullRequest.merge?.workflowEpoch === input.status.workflowEpoch &&
          pullRequest.merge.reachedDefaultBranch === true,
      ).length,
      agentReportedFinished:
        latestTaskReport?.workflowEpoch === input.status.workflowEpoch &&
        latestTaskReport.reportedState === "finished",
    },
    sessions: sessions.sort(
      (left, right) =>
        (left.sourceId ?? "").localeCompare(right.sourceId ?? "") ||
        (left.threadId ?? "").localeCompare(right.threadId ?? ""),
    ),
    sessionsAvailable,
    ...(handoff ? { handoff } : {}),
    needsYou: {
      count: matchingQueue.length,
      verbs: (["review", "check", "decide", "unblock"] as const).filter(
        (action) => verbs.has(action),
      ),
      ...(matchingQueue.length > 0
        ? {
            oldestAt: matchingQueue
              .map((item) => item.timestamp)
              .sort((left, right) => timestamp(left) - timestamp(right))[0],
          }
        : {}),
    },
    ...(completedAt ? { completedAt } : {}),
    ...(provenance ? { finishProvenance: provenance } : {}),
  };
}

function compareTaskCards(left: FloorTaskCard, right: FloorTaskCard): number {
  const leftNeedsYou = left.needsYou.count > 0;
  const rightNeedsYou = right.needsYou.count > 0;
  if (leftNeedsYou !== rightNeedsYou) return leftNeedsYou ? -1 : 1;
  if (leftNeedsYou && rightNeedsYou) {
    const attention =
      timestamp(left.needsYou.oldestAt) - timestamp(right.needsYou.oldestAt);
    if (attention !== 0) return attention;
  }
  const stateOrder: Record<FloorTaskCard["state"], number> = {
    blocked: 0,
    awaiting_verification: 1,
    active: 2,
    planned: 3,
    backlog: 4,
    completed: 5,
  };
  const state = stateOrder[left.state] - stateOrder[right.state];
  if (state !== 0) return state;
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  const priority =
    (left.priority ? priorityOrder[left.priority] : 4) -
    (right.priority ? priorityOrder[right.priority] : 4);
  if (priority !== 0) return priority;
  const sortOrder =
    (left.sortOrder ?? Number.POSITIVE_INFINITY) -
    (right.sortOrder ?? Number.POSITIVE_INFINITY);
  return sortOrder || left.taskId.localeCompare(right.taskId);
}

function projectSourceAvailability(
  activities: readonly FloorProjectActivity[],
  now: Date,
): boolean {
  if (
    activities.some(({ activity }) => {
      if (activity.sources.length === 0) return false;
      const sourceIds = new Set(
        activity.sources.map((source) => source.sourceId),
      );
      return activityThreads([activity]).some(
        (thread) => !sourceIds.has(thread.sourceId),
      );
    })
  )
    return false;
  const sources = activities.flatMap(({ activity }) =>
    activity.sources.length > 0
      ? activity.sources.map((source) => ({
          activity,
          sourceId: source.sourceId,
        }))
      : [{ activity, sourceId: activity.sourceId }],
  );
  return (
    sources.length > 0 &&
    sources.every(({ activity, sourceId }) =>
      sourceIsFresh(activity, sourceId, now),
    )
  );
}

/**
 * Build the read-only Floor view. This function receives already-scoped T3
 * activity and never persists or exposes transcript/file/path data.
 */
export function buildFloorSnapshot(input: FloorProjectionInput): FloorSnapshot {
  const timezone = input.timezone?.trim() || FLOOR_DEFAULT_TIMEZONE;
  // Validate the timezone once, before projecting anything.
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(input.now);
  const generatedAt = input.now.toISOString();
  const projects = new Map(
    input.projects.map((project) => [project.id, project]),
  );
  const activeTasks = input.tasks.filter(
    ({ task }) => task.archiveState === undefined,
  );

  const queue: FloorQueueItem[] = [];
  const events: FloorEvent[] = [];
  const trackingNotes: FloorQueueItem[] = [];
  const claimsByTask = new Map<string, FloorClaim[]>();
  const reviewByTask = new Map<string, FloorWorkItem[]>();

  for (const { task, status, subtasks } of activeTasks) {
    const project = projects.get(task.projectId);
    if (!project) continue;
    const target = targetFor(project, task);
    if (status.latestTaskReport)
      events.push({
        id: `task-report:${status.latestTaskReport.id}`,
        kind: "report",
        actor: status.latestTaskReport.reporter,
        timestamp: iso(status.latestTaskReport.createdAt),
        projectId: project.id,
        target,
        summary: `${status.latestTaskReport.reporter} ${status.latestTaskReport.reportedState === "finished" ? (status.finishMetadata?.kind === "agent_report" ? "finished" : "reported ready on") : "reported on"} ${task.name}${status.latestTaskReport.summary ? `: ${status.latestTaskReport.summary}` : ""}`,
      });
    if (status.finishMetadata)
      events.push({
        id: `task-finish:${task.id}:${status.finishMetadata.epoch}`,
        kind: "verification",
        actor: status.finishMetadata.actor,
        timestamp: iso(status.finishMetadata.completedAt),
        projectId: project.id,
        target,
        summary: `${status.finishMetadata.actor} ${status.finishMetadata.kind === "pr_merge" ? "confirmed required PRs reached the default branch" : status.finishMetadata.kind === "human_check" ? "checked" : status.finishMetadata.kind === "human_mark_done" ? "marked done" : "finished"} ${task.name} · Done${status.finishMetadata.reason ? `: ${status.finishMetadata.reason}` : ""}`,
      });
    if (
      status.taskCompleted ||
      status.taskState === "completed" ||
      status.archiveState
    )
      continue;
    const add = (
      action: FloorQueueAction,
      id: string,
      summary: string,
      reason?: string,
      at?: Date | string,
      subtask?: Subtask,
    ) =>
      queue.push({
        action,
        id,
        projectId: project.id,
        projectName: project.name,
        summary,
        ...(reason ? { reason } : {}),
        target: {
          kind: "work",
          target: subtask ? targetFor(project, task, subtask) : target,
        },
        timestamp: iso(at ?? task.createdAt),
      });
    const latest = status.latestTaskReport;
    if (status.humanCheckReady)
      add(
        "check",
        `check:${task.id}`,
        task.humanCheckText || task.name,
        `${task.simpleId} · ${task.name} · Finished by ${latest?.reporter || "the recorded agent"}`,
        latest?.createdAt,
      );
    else if (
      status.finishRule.kind === "pr_merge" &&
      latest?.reportedState === "finished"
    ) {
      const required = status.requiredPullRequests.filter(
        (row) => row.required,
      );
      if (!required.length)
        add(
          "decide",
          `decide:no-pr:${task.id}`,
          `Choose a finish rule or link a PR for ${task.name}`,
          "The agent reported finished without a required PR.",
          latest.createdAt,
        );
      for (const row of required) {
        if (row.merge) continue;
        const observation = input.githubStatuses?.[row.pullRequestUrl];
        if (!observation) continue;
        const age = input.now.getTime() - timestamp(observation.fetchedAt);
        if (!Number.isFinite(age) || age > 15 * 60_000 || age < -5_000)
          continue;
        if (observation.status === "not_configured") {
          if (!queue.some((item) => item.id === `decide:github:${project.id}`))
            add(
              "decide",
              `decide:github:${project.id}`,
              `Connect GitHub for ${project.name}`,
              "Factory cannot check required PRs until GitHub is connected.",
              latest.createdAt,
            );
        } else if (
          observation.status === "not_found" ||
          observation.status === "permission_denied"
        )
          add(
            "decide",
            `decide:pr:${task.id}:${row.pullRequestUrl}`,
            `Resolve the required PR for ${task.name}`,
            observation.status === "not_found"
              ? "PR not found"
              : "No access to this PR",
            latest.createdAt,
          );
        else if (observation.status === "ok" && observation.pullRequest) {
          const pr = observation.pullRequest;
          if (pr.mergedAt) continue; // Stacked code waits for default-branch reachability, without a human decision.
          if (pr.state === "closed")
            add(
              "decide",
              `decide:closed:${task.id}:${row.pullRequestUrl}`,
              `Decide how to handle closed PR #${pr.number}`,
              `PR #${pr.number} closed without merging`,
              latest.createdAt,
            );
          else if (!pr.draft)
            add(
              "review",
              `review:${task.id}:${row.pullRequestUrl}`,
              `PR #${pr.number} · ${task.name}`,
              `Required PR is open`,
              latest.createdAt,
            );
        }
      }
    }
    const hasFreshSession = input.activities
      .filter((entry) => entry.projectId === project.id)
      .some(({ activity }) =>
        activityThreads([activity]).some(
          (thread) =>
            sourceIsFresh(activity, thread.sourceId, input.now) &&
            thread.association.state === "linked" &&
            targetsForLinks(
              projects,
              activeTasks,
              project.id,
              thread.association.links,
            ).some((link) => link.taskId === task.id) &&
            (thread.latestSessionState === "running" ||
              thread.latestTurnState === "running"),
        ),
      );
    if (
      status.taskState === "blocked" &&
      (latest ||
        task.workStateSource === "manual" ||
        !status.subtasks.some((step) => step.reportedState === "blocked")) &&
      (latest?.handoff?.nextOwnerKind === "human" ||
        ((!latest?.handoff || latest.handoff.nextOwnerKind === "unknown") &&
          !hasFreshSession))
    )
      add(
        "unblock",
        `unblock:${task.id}`,
        status.stateReason || task.name,
        `${task.simpleId} · ${task.name}`,
        latest?.createdAt,
      );
    for (const stepStatus of status.subtasks) {
      if (stepStatus.reportedState !== "blocked" || stepStatus.archiveState)
        continue;
      const step = subtasks.find((item) => item.id === stepStatus.subtaskId);
      if (!step || step.archiveState) continue;
      if (
        stepStatus.handoff?.nextOwnerKind === "human" ||
        ((!stepStatus.handoff ||
          stepStatus.handoff.nextOwnerKind === "unknown") &&
          !hasFreshSession)
      )
        add(
          "unblock",
          `unblock:${step.id}`,
          stepStatus.reason || step.name,
          `${task.simpleId} · ${task.name} / ${step.name}`,
          stepStatus.reportCreatedAt,
          step,
        );
    }
  }

  for (const report of input.statusReports) {
    const inputTask = input.tasks.find((candidate) =>
      candidate.subtasks.some((subtask) => subtask.id === report.subtaskId),
    );
    const subtask = inputTask?.subtasks.find(
      (candidate) => candidate.id === report.subtaskId,
    );
    const project = inputTask && projects.get(inputTask.task.projectId);
    if (!inputTask || !subtask || !project) continue;
    events.push({
      actor: report.reporter,
      id: `report:${report.id}`,
      kind: "report",
      projectId: project.id,
      summary: `${report.reporter} reported ${report.reportedState} on ${inputTask.task.name} / ${subtask.name}`,
      target: targetFor(project, inputTask.task, subtask),
      timestamp: iso(report.createdAt),
    });
  }

  const stampedReportIds = new Set(
    input.verifications
      .filter((verification) => verification.decision === "accepted")
      .map((verification) => verification.reportId),
  );
  for (const verification of input.verifications) {
    if (verification.decision !== "accepted") continue;
    const report = reportById(input.statusReports, verification.reportId);
    if (!report) continue;
    const taskInput = input.tasks.find(({ subtasks }) =>
      subtasks.some((subtask) => subtask.id === report.subtaskId),
    );
    if (!taskInput) continue;
    const project = projects.get(taskInput.task.projectId);
    const subtask = taskInput.subtasks.find(
      (candidate) => candidate.id === report.subtaskId,
    );
    if (!project || !subtask) continue;
    const target = targetFor(project, taskInput.task, subtask);
    events.push({
      actor: verification.verifier,
      id: `verification:${verification.id}`,
      kind: "verification",
      projectId: project.id,
      summary: `${verification.verifier} accepted ${taskInput.task.name} / ${subtask.name} · earlier review`,
      target,
      timestamp: iso(verification.createdAt),
    });
  }

  for (const { projectId, activity } of input.activities) {
    const project = projects.get(projectId);
    if (!project) continue;
    const observedThreads = activityThreads([activity]);
    const actionableThreadKeys = new Set(
      observedThreads
        .filter(
          (thread) =>
            thread.hasPendingApprovals ||
            thread.hasPendingUserInput ||
            thread.latestSessionState === "error" ||
            thread.latestTurnState === "error",
        )
        .map((thread) => `${thread.sourceId}:${thread.threadId}`),
    );
    const archivedThreadKeys = new Set(
      observedThreads
        .filter(
          (thread) =>
            thread.association.state === "linked" &&
            targetsForLinks(
              projects,
              activeTasks,
              project.id,
              thread.association.links,
            ).length === 0,
        )
        .map(threadKey),
    );
    for (const thread of observedThreads) {
      if (!sourceIsFresh(activity, thread.sourceId, input.now)) continue;
      if (archivedThreadKeys.has(threadKey(thread))) continue;
      const relatedTargets =
        thread.association.state === "linked"
          ? targetsForLinks(
              projects,
              activeTasks,
              project.id,
              thread.association.links,
            )
          : [];
      const target = relatedTargets[0];
      const actionTimestamp =
        validIso(thread.sourceUpdatedAt) ??
        validIso(thread.observedAt) ??
        iso(input.now);
      if (thread.hasPendingApprovals)
        queue.push({
          action: "decide",
          id: `approve:${thread.sourceId}:${thread.threadId}`,
          reason: `Approval in T3${thread.agent ? ` · ${thread.agent}` : ""}`,
          projectId: project.id,
          projectName: project.name,
          summary: thread.title,
          target: queueTargetForThread(project, thread, target),
          timestamp: actionTimestamp,
          ...(relatedTargets.length > 1 ? { relatedTargets } : {}),
        });
      if (thread.hasPendingUserInput)
        queue.push({
          action: "decide",
          id: `input:${thread.sourceId}:${thread.threadId}`,
          reason: `Question in T3${thread.agent ? ` · ${thread.agent}` : ""}`,
          projectId: project.id,
          projectName: project.name,
          summary: thread.title,
          target: queueTargetForThread(project, thread, target),
          timestamp: actionTimestamp,
          ...(relatedTargets.length > 1 ? { relatedTargets } : {}),
        });
      if (
        thread.latestTurnState === "completed" &&
        (target !== undefined ||
          thread.association.state !== "linked" ||
          relatedTargets.length > 0)
      ) {
        const completedAt = validIso(thread.latestTurnCompletedAt);
        const actor = workerName(identityFor(thread));
        if (completedAt)
          events.push({
            actor,
            id: `turn:${thread.sourceId}:${thread.threadId}:${completedAt}`,
            kind: "turn",
            projectId: project.id,
            summary: `${actor} completed a turn${target ? ` on ${target.taskName}` : ` in ${thread.title}`}`,
            ...(target ? { target } : {}),
            timestamp: completedAt,
          });
      }
    }
    const pendingSubtaskIds = new Set(
      (claimsByTask.get(project.id) ?? [])
        .map((claim) => claim.subtaskId)
        .filter((id): id is string => id !== undefined),
    );
    const findings = new Map(
      activity.findings
        .filter((finding) => {
          if (finding.status !== "open") return false;
          if (
            finding.externalThreadId &&
            archivedThreadKeys.has(
              `${finding.sourceId}:${finding.externalThreadId}`,
            )
          )
            return false;
          if (
            finding.kind === "session_needs_attention" &&
            finding.externalThreadId &&
            actionableThreadKeys.has(
              `${finding.sourceId}:${finding.externalThreadId}`,
            )
          )
            return false;
          if (
            finding.kind === "reported_state_stale" &&
            finding.subtaskId &&
            pendingSubtaskIds.has(finding.subtaskId)
          )
            return false;
          if (
            (finding.taskId || finding.subtaskId) &&
            !targetForLink(projects, activeTasks, project.id, {
              linkId: finding.id,
              target: {
                id: finding.subtaskId ?? finding.taskId!,
                kind: finding.subtaskId ? "subtask" : "task",
                label: finding.explanation,
              },
            })
          )
            return false;
          return true;
        })
        .map((finding) => [finding.dedupeKey, finding]),
    );
    for (const finding of findings.values()) {
      const findingTarget = targetForLink(
        projects,
        activeTasks,
        project.id,
        finding.subtaskId || finding.taskId
          ? {
              linkId: finding.id,
              target: {
                id: finding.subtaskId ?? finding.taskId!,
                kind: finding.subtaskId ? "subtask" : "task",
                label: finding.explanation,
              },
            }
          : undefined,
      );
      trackingNotes.push({
        action: "decide",
        id: `reconcile:${finding.dedupeKey}`,
        projectId: project.id,
        projectName: project.name,
        reason: finding.explanation,
        summary: finding.suggestedAction,
        target: findingTarget
          ? { kind: "work", target: findingTarget }
          : {
              kind: "finding",
              projectId: project.id,
              findingId: finding.id,
              ...(finding.externalThreadId
                ? { threadId: finding.externalThreadId }
                : {}),
            },
        // Finding updatedAt changes on every reconciliation refresh. Use the
        // first detection time so oldest-first attention age remains stable.
        timestamp: iso(finding.createdAt),
      });
    }
  }

  const uniqueQueue = new Map(queue.map((item) => [item.id, item]));
  const canonicalQueue = [...uniqueQueue.values()];
  const floorProjects: FloorProject[] = input.projects.map((project) => {
    const projectTasks = activeTasks.filter(
      ({ task }) => task.projectId === project.id,
    );
    const bench = projectTasks
      .filter(
        ({ status }) =>
          status.taskState === "planned" || status.taskState === "backlog",
      )
      .map((item) => taskItem(project, item.task, item.status))
      .filter((item): item is FloorWorkItem => item !== undefined);
    const reviewNeeded = reviewByTask.get(project.id) ?? [];
    const counter = (claimsByTask.get(project.id) ?? []).sort(
      (left, right) => timestamp(left.reportedAt) - timestamp(right.reportedAt),
    );
    const stations: FloorStation[] = [];
    const projectActivities = input.activities.filter(
      ({ projectId }) => projectId === project.id,
    );
    const projectThreadMap = new Map<
      string,
      { activity: T3ObservedActivity; thread: T3ObservedThread }
    >();
    for (const { activity } of projectActivities) {
      for (const thread of activityThreads([activity])) {
        const key = threadKey(thread);
        const prior = projectThreadMap.get(key);
        if (
          !prior ||
          timestamp(thread.observedAt) >= timestamp(prior.thread.observedAt)
        )
          projectThreadMap.set(key, { activity, thread });
      }
    }
    const projectThreads = [...projectThreadMap.values()];
    const sessionsByTask = new Map<string, FloorStation[]>();
    for (const { activity, thread } of projectThreads) {
      if (
        !sourceIsFresh(activity, thread.sourceId, input.now) ||
        thread.sourceCurrent === false ||
        thread.association.state !== "linked"
      )
        continue;
      const relatedTargets = targetsForLinks(
        projects,
        activeTasks,
        project.id,
        thread.association.links,
      );
      for (const taskId of new Set(
        relatedTargets.map((target) => target.taskId),
      )) {
        const station: FloorStation = {
          association: "linked",
          id: `thread:${thread.sourceId}:${thread.threadId}:${taskId}`,
          observedAt: thread.observedAt,
          sourceId: thread.sourceId,
          state: threadState(thread),
          target: relatedTargets.find((target) => target.taskId === taskId),
          relatedTargets:
            relatedTargets.length > 1 ? relatedTargets : undefined,
          threadId: thread.threadId,
          threadTitle: thread.title,
          worker: identityFor(thread),
        };
        const taskSessions = sessionsByTask.get(taskId) ?? [];
        taskSessions.push(station);
        sessionsByTask.set(taskId, taskSessions);
      }
    }
    const sessionsAvailable = projectSourceAvailability(
      projectActivities,
      input.now,
    );
    const taskCards = projectTasks
      .flatMap((taskInput) => {
        const state = cardState(taskInput.status);
        if (
          taskInput.status.archiveState !== undefined ||
          taskInput.status.taskCompleted ||
          state === undefined ||
          state === "completed"
        )
          return [];
        const card = taskCard(
          project,
          taskInput,
          canonicalQueue,
          input.statusReports,
          sessionsByTask.get(taskInput.task.id) ?? [],
          sessionsAvailable,
        );
        return card ? [card] : [];
      })
      .sort(compareTaskCards);
    const recentlyDone = input.tasks
      .filter(({ task }) => task.projectId === project.id)
      .flatMap((taskInput) => {
        const metadata = currentFinishMetadata(taskInput.status);
        if (!metadata || !isToday(metadata.completedAt, input.now, timezone))
          return [];
        const card = taskCard(
          project,
          taskInput,
          canonicalQueue,
          input.statusReports,
          sessionsByTask.get(taskInput.task.id) ?? [],
          sessionsAvailable,
          "completed",
        );
        return card ? [card] : [];
      })
      .sort(
        (left, right) =>
          timestamp(right.completedAt) - timestamp(left.completedAt) ||
          left.taskId.localeCompare(right.taskId),
      );
    for (const { task, status } of projectTasks) {
      if (status.taskState !== "active" && status.taskState !== "blocked")
        continue;
      const target = targetFor(project, task);
      const linked = projectThreads.filter(
        ({ activity, thread }) =>
          thread.association.state === "linked" &&
          targetsForLinks(
            projects,
            projectTasks,
            project.id,
            thread.association.links,
          ).some((linkedTarget) => linkedTarget.taskId === task.id) &&
          sourceIsFresh(activity, thread.sourceId, input.now),
      );
      if (linked.length === 0) {
        stations.push({
          association: "none",
          id: `task:${task.id}`,
          state: status.taskState === "blocked" ? "blocked" : "idle",
          target,
        });
      } else {
        for (const { activity, thread } of linked) {
          const relatedTargets = targetsForLinks(
            projects,
            projectTasks,
            project.id,
            thread.association.links,
          );
          stations.push({
            association: "linked",
            id: `thread:${thread.sourceId}:${thread.threadId}:${task.id}`,
            observedAt: thread.observedAt,
            sourceId: thread.sourceId,
            state: threadState(thread),
            target:
              relatedTargets.find(
                (linkedTarget) => linkedTarget.taskId === task.id,
              ) ?? target,
            relatedTargets:
              relatedTargets.length > 1 ? relatedTargets : undefined,
            threadId: thread.threadId,
            threadTitle: thread.title,
            worker: identityFor(thread),
          });
        }
      }
    }
    for (const { activity, thread } of projectThreads) {
      if (
        !sourceIsFresh(activity, thread.sourceId, input.now) ||
        thread.association.state !== "linked" ||
        !actionable(thread)
      )
        continue;
      const relatedTargets = targetsForLinks(
        projects,
        projectTasks,
        project.id,
        thread.association.links,
      );
      const linkedTarget = relatedTargets[0];
      const id = `thread:${thread.sourceId}:${thread.threadId}`;
      // The task pass above already emits one station for every active or
      // blocked target of a multi-target thread. Do not add a second generic
      // row for that same source/thread; this pass is needed only when the
      // thread links to work in another state (for example planned work).
      if (
        !linkedTarget ||
        stations.some(
          (station) =>
            station.sourceId === thread.sourceId &&
            station.threadId === thread.threadId,
        )
      )
        continue;
      stations.push({
        association: "linked",
        id,
        observedAt: thread.observedAt,
        sourceId: thread.sourceId,
        state: threadState(thread),
        target: linkedTarget,
        relatedTargets: relatedTargets.length > 1 ? relatedTargets : undefined,
        threadId: thread.threadId,
        threadTitle: thread.title,
        worker: identityFor(thread),
      });
    }
    for (const { activity, thread } of projectThreads) {
      if (
        !sourceIsFresh(activity, thread.sourceId, input.now) ||
        !(
          thread.latestSessionState === "running" ||
          thread.latestTurnState === "running" ||
          thread.hasPendingApprovals ||
          thread.hasPendingUserInput ||
          thread.latestSessionState === "error" ||
          thread.latestTurnState === "error"
        )
      )
        continue;
      if (thread.association.state === "linked") continue;
      stations.push({
        association:
          thread.association.state === "suggested"
            ? "unmatched"
            : thread.association.state,
        id: `thread:${thread.sourceId}:${thread.threadId}`,
        observedAt: thread.observedAt,
        sourceId: thread.sourceId,
        state: threadState(thread),
        threadId: thread.threadId,
        threadTitle: thread.title,
        worker: identityFor(thread),
      });
    }
    const working = new Set(
      stations
        .filter((station) => station.state === "working" && station.threadId)
        .map((station) => `${station.sourceId}:${station.threadId}`),
    ).size;
    const blocked =
      projectTasks.filter(({ status }) => status.taskState === "blocked")
        .length +
      stations.filter((station) => station.state === "error").length;
    const waiting = queue.filter(
      (item) => item.projectId === project.id,
    ).length;
    const currentThreadKeys = new Set(
      projectThreads
        .filter(
          ({ activity, thread }) =>
            sourceIsFresh(activity, thread.sourceId, input.now) &&
            thread.sourceCurrent !== false,
        )
        .map(({ thread }) => threadKey(thread)),
    );
    return {
      bench,
      counter,
      counts: { blocked, waiting, working },
      id: project.id,
      name: project.name,
      reviewNeeded,
      stations,
      tasks: taskCards,
      recentlyDone,
      unmatchedSessions: stations.filter(
        (station) =>
          (station.association === "unmatched" ||
            station.association === "ambiguous") &&
          currentThreadKeys.has(`${station.sourceId}:${station.threadId}`),
      ),
      sessionsAvailable,
    };
  });

  const orderedQueue = canonicalQueue.sort(compareOldest);
  const orderedEvents = [
    ...new Map(events.map((event) => [event.id, event])).values(),
  ]
    .sort(compareNewest)
    .slice(0, 20);
  const counterClaims = floorProjects.flatMap((project) => project.counter);
  const todayReports = input.statusReports.filter(
    (report) =>
      isToday(report.createdAt, input.now, timezone) &&
      input.tasks.some((candidate) =>
        candidate.subtasks.some((subtask) => subtask.id === report.subtaskId),
      ),
  );
  const workingNow = new Set(
    input.activities.flatMap(({ activity, projectId }) => {
      const project = projects.get(projectId);
      return activityThreads([activity])
        .filter(
          (thread) =>
            sourceIsFresh(activity, thread.sourceId, input.now) &&
            thread.sourceCurrent !== false &&
            !(
              project &&
              thread.association.state === "linked" &&
              targetsForLinks(
                projects,
                activeTasks,
                project.id,
                thread.association.links,
              ).length === 0
            ) &&
            threadState(thread) === "working",
        )
        .map((thread) => `${thread.sourceId}:${thread.threadId}`);
    }),
  ).size;
  const scoreboard: FloorScoreboard = {
    reportsToday:
      todayReports.length +
      input.tasks.filter(
        ({ status }) =>
          status.latestTaskReport &&
          isToday(status.latestTaskReport.createdAt, input.now, timezone),
      ).length,
    finishedToday: input.tasks.filter(({ status }) => {
      const metadata = currentFinishMetadata(status);
      return (
        metadata !== undefined &&
        isToday(metadata.completedAt, input.now, timezone)
      );
    }).length,
    stampedToday: input.verifications.filter(
      (verification) =>
        verification.decision === "accepted" &&
        isToday(verification.createdAt, input.now, timezone) &&
        stampedReportIds.has(verification.reportId),
    ).length,
    workingNow,
    ...(orderedQueue[0] ? { oldestPendingAt: orderedQueue[0].timestamp } : {}),
  };
  return {
    connections: connectionViews(input.activities, input.now),
    trackingNotes: trackingNotes.sort(compareOldest),
    events: orderedEvents,
    generatedAt,
    projects: floorProjects,
    queue: orderedQueue,
    scoreboard,
    timezone,
  };
}
