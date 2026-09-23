import type {
  Project,
  StatusReport,
  Subtask,
  Task,
  TaskStatus,
  Verification,
} from "./application";
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
};

export type FloorQueueAction =
  | "approve"
  | "input"
  | "stamp"
  | "unblock"
  | "reconcile"
  | "review";

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
  return activity.status === "ok" && connectionIsFresh(activity, sourceId, now);
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
  const claimsByTask = new Map<string, FloorClaim[]>();
  const reviewByTask = new Map<string, FloorWorkItem[]>();

  for (const { task, status, subtasks } of activeTasks) {
    const project = projects.get(task.projectId);
    if (!project) continue;
    const target = targetFor(project, task);
    if (status.taskState === "awaiting_verification") {
      const latestComplete = status.subtasks
        .filter(
          (subtask) =>
            subtask.subtaskId &&
            subtask.reportedState === "complete" &&
            subtask.verificationState === "awaiting_verification",
        )
        .sort(
          (left, right) =>
            timestamp(
              left.reportId
                ? reportById(input.statusReports, left.reportId)?.createdAt
                : undefined,
            ) -
            timestamp(
              right.reportId
                ? reportById(input.statusReports, right.reportId)?.createdAt
                : undefined,
            ),
        )[0];
      if (!latestComplete?.subtaskId || !latestComplete.reportId) {
        const item = taskItem(project, task, status);
        if (item) {
          const items = reviewByTask.get(project.id) ?? [];
          items.push(item);
          reviewByTask.set(project.id, items);
          queue.push({
            action: "review",
            id: `review:${task.id}`,
            projectId: project.id,
            projectName: project.name,
            summary: `Review ${task.name}`,
            target: { kind: "work", target },
            timestamp: iso(task.createdAt),
          });
        }
      }
    }
    for (const subtaskStatus of status.subtasks) {
      if (
        subtaskStatus.archiveState ||
        !subtaskStatus.subtaskId ||
        subtaskStatus.reportedState !== "complete" ||
        subtaskStatus.verificationState !== "awaiting_verification"
      )
        continue;
      const subtask = subtasks.find(
        (candidate) => candidate.id === subtaskStatus.subtaskId,
      );
      const report =
        reportById(input.statusReports, subtaskStatus.reportId) ??
        latestReportForSubtask(input.statusReports, subtaskStatus.subtaskId);
      if (!subtask || subtask.archiveState !== undefined || !report) continue;
      const claim: FloorClaim = {
        ...targetFor(project, task, subtask),
        ...((subtaskStatus.evidence ?? report.evidence)
          ? { evidence: subtaskStatus.evidence ?? report.evidence }
          : {}),
        ...(report.reason ? { reason: report.reason } : {}),
        reportId: report.id,
        reportedAt: iso(report.createdAt),
        reporter: report.reporter,
      };
      const claims = claimsByTask.get(project.id) ?? [];
      claims.push(claim);
      claimsByTask.set(project.id, claims);
      queue.push({
        action: "stamp",
        id: `stamp:${report.id}`,
        projectId: project.id,
        projectName: project.name,
        reason: report.reason,
        summary: `Stamp ${task.name} / ${subtask.name}`,
        target: { kind: "work", target: claim },
        timestamp: claim.reportedAt,
      });
    }
    if (status.taskState === "blocked") {
      const blockedReport = status.subtasks
        .filter(
          (subtask) =>
            subtask.subtaskId && subtask.effectiveState === "blocked",
        )
        .map((subtask) => reportById(input.statusReports, subtask.reportId))
        .filter((report): report is StatusReport => report !== undefined)
        .sort(
          (left, right) =>
            timestamp(left.createdAt) - timestamp(right.createdAt),
        )[0];
      queue.push({
        action: "unblock",
        id: `unblock:${task.id}`,
        projectId: project.id,
        projectName: project.name,
        ...(status.stateReason ? { reason: status.stateReason } : {}),
        summary: `Unblock ${task.name}`,
        target: { kind: "work", target },
        timestamp: iso(blockedReport?.createdAt ?? task.createdAt),
      });
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
      summary: `${verification.verifier} stamped ${taskInput.task.name} / ${subtask.name}`,
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
          action: "approve",
          id: `approve:${thread.sourceId}:${thread.threadId}`,
          projectId: project.id,
          projectName: project.name,
          summary: `Approve ${thread.title}`,
          target: queueTargetForThread(project, thread, target),
          timestamp: actionTimestamp,
          ...(relatedTargets.length > 1 ? { relatedTargets } : {}),
        });
      if (thread.hasPendingUserInput)
        queue.push({
          action: "input",
          id: `input:${thread.sourceId}:${thread.threadId}`,
          projectId: project.id,
          projectName: project.name,
          summary: `Respond to ${thread.title}`,
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
      queue.push({
        action: "reconcile",
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
    const waiting =
      counter.length +
      reviewNeeded.length +
      stations.filter(
        (station) =>
          station.state === "waiting_approval" ||
          station.state === "waiting_input",
      ).length;
    return {
      bench,
      counter,
      counts: { blocked, waiting, working },
      id: project.id,
      name: project.name,
      reviewNeeded,
      stations,
    };
  });

  const uniqueQueue = new Map(queue.map((item) => [item.id, item]));
  const orderedQueue = [...uniqueQueue.values()].sort(compareOldest);
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
    reportsToday: todayReports.length,
    stampedToday: input.verifications.filter(
      (verification) =>
        verification.decision === "accepted" &&
        isToday(verification.createdAt, input.now, timezone) &&
        stampedReportIds.has(verification.reportId),
    ).length,
    workingNow,
    ...(counterClaims[0]
      ? {
          oldestPendingAt: counterClaims
            .slice()
            .sort(
              (left, right) =>
                timestamp(left.reportedAt) - timestamp(right.reportedAt),
            )[0]!.reportedAt,
        }
      : {}),
  };
  return {
    connections: connectionViews(input.activities, input.now),
    events: orderedEvents,
    generatedAt,
    projects: floorProjects,
    queue: orderedQueue,
    scoreboard,
    timezone,
  };
}
