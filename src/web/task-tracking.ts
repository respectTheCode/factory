import type { GitHubStatusSnapshot } from "../github";
import type {
  ObservedActivityViewModel,
  ObservedThread,
} from "./observed-activity";

export type TrackingArtifact = {
  label: string;
  url: string;
  kind: "artifact" | "preview" | "test" | "review";
  testedRevision?: string;
};

export type TrackingHandoff = {
  nextOwner: string;
  nextOwnerKind: "human" | "agent" | "unknown";
  nextAction: string;
  dependency?: string;
  waitingOnSubtaskIds?: string[];
};

export type TrackingSessionRef = {
  provider: "t3";
  sourceId?: string;
  externalThreadId: string;
};

export type TrackingScreenshot = {
  id: string;
  subtaskId?: string;
  caption: string;
  testedRevision?: string;
  uploadedAt?: string | Date;
};

export type TrackingSubtask = {
  id: string;
  simpleId: string;
  name: string;
  pullRequestUrl?: string;
  screenshots?: TrackingScreenshot[];
  evidence?: string;
};

export type TrackingTask = {
  id: string;
  simpleId: string;
  name: string;
  pullRequestUrl?: string;
  branchName?: string;
  acceptanceCriteria?: string[];
  screenshots?: TrackingScreenshot[];
  subtasks: TrackingSubtask[];
};

export type TrackingSubtaskStatus = {
  subtaskId: string;
  reportedState?:
    | "backlog"
    | "not_started"
    | "in_progress"
    | "blocked"
    | "complete";
  effectiveState?: string;
  reason?: string;
  verificationState?:
    | "accepted"
    | "awaiting_verification"
    | "deferred"
    | "rejected"
    | "unreported";
  reportId?: string;
  reportCreatedAt?: Date | string;
  machineId?: string;
  reporter?: string;
  sessionRef?: TrackingSessionRef;
  handoff?: TrackingHandoff;
  testedRevision?: string;
  reportEvidence?: string;
  evidence?: string;
  artifacts?: TrackingArtifact[];
};

export type TrackingStatus = {
  taskState?: string;
  stateReason?: string;
  taskCompleted?: boolean;
  taskVerification?: { decision?: string; verifier?: string; reason?: string };
  subtasks: TrackingSubtaskStatus[];
};

export type TrackingReview = {
  status: "ok" | "unavailable";
  headSha: string;
  completed: boolean;
  unresolvedThreads?: number;
  decision: "approved" | "changes_requested" | "commented" | "pending";
  reviewers: string[];
  error?: string;
};

export type TrackingGitHubStatus = GitHubStatusSnapshot & {
  review?: TrackingReview;
  allCheckRuns?: GitHubStatusSnapshot["checkRuns"];
  allCheckRunsStatus?: "not_requested" | "ok" | "unavailable";
};

export type SessionFreshness = "fresh" | "stale" | "unavailable" | "unknown";
export type CheckState =
  | "passing"
  | "failing"
  | "pending"
  | "stale"
  | "unknown";
export type ReviewState =
  | "finished"
  | "changes_requested"
  | "pending"
  | "stale"
  | "unavailable"
  | "unknown"
  | "untied";
export type RevisionMatch = "matches" | "mismatch" | "unknown";

export const SESSION_FRESHNESS_MS = 5 * 60 * 1000;
export const EVIDENCE_FRESHNESS_MS = 5 * 60 * 1000;
export const FUTURE_TOLERANCE_MS = 30 * 1000;

function epoch(value: Date | string | undefined): number | undefined {
  if (!value) return undefined;
  const milliseconds =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : undefined;
}

export function compositeSessionId(
  sourceId: string | undefined,
  threadId: string,
): string {
  return `${sourceId ?? "legacy"}:${threadId}`;
}

export function elapsedLabel(
  value: Date | string | undefined,
  now = new Date(),
): string {
  const timestamp = epoch(value);
  if (timestamp === undefined) return "time unknown";
  const delta = now.getTime() - timestamp;
  if (delta < -FUTURE_TOLERANCE_MS) return "timestamp in future";
  if (delta < 0) return "just now";
  if (delta < 60_000) return "less than a minute ago";
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000)
    return `${Math.floor(delta / (60 * 60_000))}h ago`;
  return `${Math.floor(delta / (24 * 60 * 60_000))}d ago`;
}

function isFreshTimestamp(
  value: Date | string | undefined,
  now: Date,
  threshold: number,
): boolean | undefined {
  const timestamp = epoch(value);
  if (timestamp === undefined) return undefined;
  const age = now.getTime() - timestamp;
  if (age < -FUTURE_TOLERANCE_MS) return false;
  return age <= threshold;
}

export function sessionFreshness(
  activity: ObservedActivityViewModel | null,
  thread: ObservedThread,
  now = new Date(),
): SessionFreshness {
  if (!activity || thread.sourceCurrent === false) return "stale";
  const source = thread.sourceId
    ? activity.sources?.find(
        (candidate) => candidate.sourceId === thread.sourceId,
      )
    : undefined;
  if (thread.sourceId && activity.sources?.length && !source)
    return "unavailable";
  const connection = source?.connection ?? activity.connection;
  if (
    connection.state !== "connected" ||
    connection.warning ||
    connection.error ||
    source?.error ||
    (source && source.status !== "ok")
  ) {
    return "unavailable";
  }
  const current = isFreshTimestamp(
    connection.observedAt,
    now,
    SESSION_FRESHNESS_MS,
  );
  if (current === undefined) return "unknown";
  return current ? "fresh" : "stale";
}

function linkedTargets(
  thread: ObservedThread,
): Array<{ id: string; kind: "task" | "subtask" }> {
  if (thread.association.state !== "linked") return [];
  return thread.association.links.map(({ target }) => ({
    id: target.id,
    kind: target.kind,
  }));
}

export type TrackedSession = {
  id: string;
  thread: ObservedThread;
  targetLabels: string[];
  freshness: SessionFreshness;
  activityAge: string;
  humanAttention: "approval" | "user_input" | "approval_and_input" | null;
  isRunning: boolean;
  latestReport?: TrackingSubtaskStatus;
  reportAttributionAmbiguous?: boolean;
};

function reportForSession(
  reports: TrackingSubtaskStatus[],
  thread: ObservedThread,
  allThreads: readonly ObservedThread[],
): { report?: TrackingSubtaskStatus; ambiguous: boolean } {
  const sameThread = allThreads.filter(
    (candidate) => candidate.threadId === thread.threadId,
  );
  const sameThreadDifferentSources =
    new Set(sameThread.map((candidate) => candidate.sourceId ?? "legacy"))
      .size > 1;
  const matchingRefs = reports.filter(
    (report) =>
      report.sessionRef?.provider === "t3" &&
      report.sessionRef.externalThreadId === thread.threadId,
  );
  const matches = matchingRefs.filter((report) => {
    const sourceId = report.sessionRef?.sourceId;
    if (sourceId !== undefined) return sourceId === thread.sourceId;
    return !sameThreadDifferentSources;
  });
  const ambiguousRefs = matchingRefs.some(
    (report) => report.sessionRef?.sourceId === undefined,
  );
  const withTime = matches
    .map((report) => ({ report, timestamp: epoch(report.reportCreatedAt) }))
    .filter(
      (entry): entry is { report: TrackingSubtaskStatus; timestamp: number } =>
        entry.timestamp !== undefined,
    )
    .sort((left, right) => right.timestamp - left.timestamp);
  if (withTime.length > 0)
    return { report: withTime[0]?.report, ambiguous: false };
  if (matches.length === 1) return { report: matches[0], ambiguous: false };
  if (matches.length > 1) return { ambiguous: true };
  return { ambiguous: ambiguousRefs && sameThreadDifferentSources };
}

export function taskLinkedSessions(
  task: TrackingTask,
  status: TrackingStatus | undefined,
  activity: ObservedActivityViewModel | null,
  now = new Date(),
): TrackedSession[] {
  if (!activity) return [];
  const childById = new Map(
    task.subtasks.map((subtask) => [subtask.id, subtask]),
  );
  const allTaskIds = new Set([task.id, ...childById.keys()]);
  const chosen = new Map<string, ObservedThread>();
  for (const thread of activity.threads) {
    if (thread.provider !== "t3") continue;
    const linked = linkedTargets(thread).filter((target) =>
      allTaskIds.has(target.id),
    );
    if (linked.length === 0) continue;
    const id = compositeSessionId(thread.sourceId, thread.threadId);
    const existing = chosen.get(id);
    if (
      !existing ||
      (epoch(thread.sourceUpdatedAt) ?? 0) >
        (epoch(existing.sourceUpdatedAt) ?? 0)
    ) {
      chosen.set(id, thread);
    }
  }
  const reports = (status?.subtasks ?? []).filter(
    (entry) => entry.sessionRef?.provider === "t3",
  );
  return [...chosen.entries()]
    .map(([id, thread]) => {
      const targets = linkedTargets(thread).filter((target) =>
        allTaskIds.has(target.id),
      );
      const freshness = sessionFreshness(activity, thread, now);
      const report = reportForSession(reports, thread, activity.threads);
      const humanAttention: TrackedSession["humanAttention"] =
        freshness !== "fresh"
          ? null
          : thread.hasPendingApprovals && thread.hasPendingUserInput
            ? "approval_and_input"
            : thread.hasPendingApprovals
              ? "approval"
              : thread.hasPendingUserInput
                ? "user_input"
                : null;
      return {
        id,
        thread,
        targetLabels: targets.map((target) =>
          target.kind === "task"
            ? task.name
            : (childById.get(target.id)?.name ?? target.id),
        ),
        freshness,
        activityAge: elapsedLabel(
          thread.sourceUpdatedAt ?? thread.observedAt,
          now,
        ),
        humanAttention,
        isRunning:
          freshness === "fresh" &&
          !thread.hasPendingApprovals &&
          !thread.hasPendingUserInput &&
          thread.latestTurnState !== "error" &&
          thread.latestSessionState !== "error" &&
          (thread.latestTurnState === "running" ||
            thread.latestSessionState === "running"),
        ...(report.report ? { latestReport: report.report } : {}),
        ...(report.ambiguous ? { reportAttributionAmbiguous: true } : {}),
      };
    })
    .sort(
      (left, right) =>
        (epoch(right.thread.sourceUpdatedAt ?? right.thread.observedAt) ?? 0) -
        (epoch(left.thread.sourceUpdatedAt ?? left.thread.observedAt) ?? 0),
    );
}

export type TaskTrackingSummary = {
  sessions: TrackedSession[];
  activeChildCount: number;
  activeChildNames: string[];
  waitHandoffSubtaskIds: string[];
  handoffs: Array<{ subtask: TrackingSubtask; handoff: TrackingHandoff }>;
  humanHandoffs: Array<{ subtask: TrackingSubtask; handoff: TrackingHandoff }>;
  blockedReasons: Array<{ label: string; reason?: string }>;
};

export function buildTaskTrackingSummary(
  task: TrackingTask,
  status: TrackingStatus | undefined,
  activity: ObservedActivityViewModel | null,
  now = new Date(),
): TaskTrackingSummary {
  const sessions = taskLinkedSessions(task, status, activity, now);
  const activeChildren = new Set<string>();
  for (const session of sessions) {
    if (!session.isRunning) continue;
    for (const target of linkedTargets(session.thread)) {
      if (
        target.kind === "subtask" &&
        task.subtasks.some((item) => item.id === target.id)
      )
        activeChildren.add(target.id);
    }
  }
  const statusById = new Map(
    (status?.subtasks ?? []).map((entry) => [entry.subtaskId, entry]),
  );
  const waitHandoffSubtaskIds = [
    ...new Set(
      (status?.subtasks ?? []).flatMap(
        (entry) => entry.handoff?.waitingOnSubtaskIds ?? [],
      ),
    ),
  ];
  const handoffs = task.subtasks.flatMap((subtask) => {
    const handoff = statusById.get(subtask.id)?.handoff;
    return handoff ? [{ subtask, handoff }] : [];
  });
  const humanHandoffs = handoffs.filter(
    ({ handoff }) => handoff.nextOwnerKind === "human",
  );
  const blockedReasons = [
    ...(status?.taskState === "blocked"
      ? [{ label: `Task ${task.simpleId}`, reason: status.stateReason }]
      : []),
    ...task.subtasks.flatMap((subtask) => {
      const subtaskStatus = statusById.get(subtask.id);
      return subtaskStatus?.effectiveState === "blocked" ||
        subtaskStatus?.reportedState === "blocked"
        ? [
            {
              label: `${subtask.simpleId} · ${subtask.name}`,
              reason: subtaskStatus.reason,
            },
          ]
        : [];
    }),
  ];
  return {
    sessions,
    activeChildCount: activeChildren.size,
    activeChildNames: task.subtasks
      .filter((subtask) => activeChildren.has(subtask.id))
      .map((subtask) => subtask.name),
    waitHandoffSubtaskIds,
    handoffs,
    humanHandoffs,
    blockedReasons,
  };
}

function currentReport(status: TrackingSubtaskStatus | undefined): boolean {
  return Boolean(
    status &&
    (status.reportId ||
      status.reportedState ||
      status.reportCreatedAt ||
      status.reporter),
  );
}

export function compareRevisionEvidence(
  reportRevision: string | undefined,
  headRevision: string | undefined,
): RevisionMatch {
  const report = reportRevision?.trim();
  const head = headRevision?.trim();
  if (
    !report ||
    !head ||
    !/^[a-f0-9]{40}$/i.test(report) ||
    !/^[a-f0-9]{40}$/i.test(head)
  )
    return "unknown";
  return report.toLowerCase() === head.toLowerCase() ? "matches" : "mismatch";
}

function freshSnapshot(
  snapshot: TrackingGitHubStatus | undefined,
  now: Date,
): boolean | undefined {
  if (!snapshot) return undefined;
  if (snapshot.status !== "ok") return false;
  return (
    isFreshTimestamp(snapshot.fetchedAt, now, EVIDENCE_FRESHNESS_MS) ??
    undefined
  );
}

export type CheckEvidenceScope =
  | "all-checks"
  | "all-checks-partial"
  | "actions-only"
  | "actions-and-workflows"
  | "workflows-only"
  | "unavailable";

function checkRuns(snapshot: TrackingGitHubStatus):
  | {
      runs: Array<{ status: string; conclusion?: string }>;
      scope: CheckEvidenceScope;
    }
  | undefined {
  if (snapshot.allCheckRunsStatus === "unavailable") return undefined;
  if (snapshot.allCheckRunsStatus === "ok") {
    if (snapshot.workflowRunsStatus !== "ok") return undefined;
    const runs = [...(snapshot.allCheckRuns ?? []), ...snapshot.workflowRuns];
    return runs.length > 0 ? { runs, scope: "all-checks" } : undefined;
  }
  if (
    snapshot.checkRunsStatus === "unavailable" ||
    snapshot.workflowRunsStatus === "unavailable"
  )
    return undefined;
  const actions = snapshot.checkRunsStatus === "ok" ? snapshot.checkRuns : [];
  const workflows =
    snapshot.workflowRunsStatus === "ok" ? snapshot.workflowRuns : [];
  const runs = [...actions, ...workflows];
  if (runs.length === 0) return undefined;
  const scope: CheckEvidenceScope =
    actions.length > 0 && workflows.length > 0
      ? "actions-and-workflows"
      : actions.length > 0
        ? "actions-only"
        : "workflows-only";
  return { runs, scope };
}

function checkEvidenceScope(
  snapshot: TrackingGitHubStatus | undefined,
): CheckEvidenceScope {
  if (!snapshot) return "unavailable";
  if (snapshot.allCheckRunsStatus === "unavailable") return "unavailable";
  if (snapshot.allCheckRunsStatus === "ok") {
    return snapshot.workflowRunsStatus === "ok"
      ? "all-checks"
      : "all-checks-partial";
  }
  return checkRuns(snapshot)?.scope ?? "unavailable";
}

export function evaluateCheckState(
  snapshot: TrackingGitHubStatus | undefined,
  reportRevision: string | undefined,
  now = new Date(),
): CheckState {
  const freshness = freshSnapshot(snapshot, now);
  if (freshness === false)
    return snapshot?.status === "ok" ? "stale" : "unknown";
  if (freshness === undefined || !snapshot?.pullRequest?.headSha)
    return "unknown";
  if (
    compareRevisionEvidence(reportRevision, snapshot.pullRequest.headSha) !==
    "matches"
  )
    return "unknown";
  // The legacy Actions/workflow snapshots are useful to display, but they are
  // only a subset of GitHub's checks. Do not promote partial evidence to a
  // passing (or failing) conclusion.
  if (
    snapshot.allCheckRunsStatus !== "ok" ||
    snapshot.workflowRunsStatus !== "ok"
  )
    return "unknown";
  const evidence = checkRuns(snapshot);
  if (!evidence) return "unknown";
  let pending = false;
  let failing = false;
  for (const run of evidence.runs) {
    if (run.status !== "completed") {
      pending = true;
      continue;
    }
    if (
      run.conclusion === "success" ||
      run.conclusion === "neutral" ||
      run.conclusion === "skipped"
    )
      continue;
    if (
      [
        "failure",
        "cancelled",
        "timed_out",
        "action_required",
        "startup_failure",
        "stale",
      ].includes(run.conclusion ?? "")
    )
      failing = true;
    else return "unknown";
  }
  if (failing) return "failing";
  if (pending) return "pending";
  return "passing";
}

export function evaluateReviewState(
  review: TrackingReview | undefined,
  currentHead: string | undefined,
  reportRevision: string | undefined,
  snapshot: TrackingGitHubStatus | undefined,
  now = new Date(),
): ReviewState {
  if (!review || review.status === "unavailable") return "unavailable";
  const freshness = freshSnapshot(snapshot, now);
  if (freshness === false)
    return snapshot?.status === "ok" ? "stale" : "unavailable";
  if (freshness === undefined || !currentHead || !review.headSha)
    return "unknown";
  if (compareRevisionEvidence(reportRevision, currentHead) !== "matches")
    return "untied";
  if (review.headSha !== currentHead) return "stale";
  if (!review.completed || review.decision === "pending") return "pending";
  if (review.decision === "changes_requested") return "changes_requested";
  if (review.unresolvedThreads === undefined) return "unknown";
  if (review.unresolvedThreads > 0) return "pending";
  return "finished";
}

export type ReviewPacketItem = {
  subtask: TrackingSubtask;
  status: TrackingSubtaskStatus;
  pullRequestUrl?: string;
  snapshot?: TrackingGitHubStatus;
  headSha?: string;
  revisionMatch: RevisionMatch;
  checks: CheckState;
  review: ReviewState;
  screenshots: Array<{
    screenshot: TrackingScreenshot;
    revisionMatch: RevisionMatch;
  }>;
  checkEvidenceScope: CheckEvidenceScope;
};

export function buildReviewPacket(
  task: TrackingTask,
  status: TrackingStatus | undefined,
  githubStatuses: Readonly<Record<string, TrackingGitHubStatus | undefined>>,
  now = new Date(),
): ReviewPacketItem[] {
  const taskStatus = githubStatuses[`task:${task.id}`];
  return task.subtasks.flatMap((subtask) => {
    const report = status?.subtasks.find(
      (entry) => entry.subtaskId === subtask.id,
    );
    if (!currentReport(report) || !report) return [];
    const useParentPr = !subtask.pullRequestUrl && Boolean(task.pullRequestUrl);
    const pullRequestUrl =
      subtask.pullRequestUrl ?? (useParentPr ? task.pullRequestUrl : undefined);
    const snapshot = useParentPr
      ? taskStatus
      : githubStatuses[`subtask:${subtask.id}`];
    const headSha = snapshot?.pullRequest?.headSha;
    const revisionMatch = compareRevisionEvidence(
      report.testedRevision,
      headSha,
    );
    const screenshots = (subtask.screenshots ?? []).map((screenshot) => ({
      screenshot,
      revisionMatch: compareRevisionEvidence(
        screenshot.testedRevision,
        report.testedRevision,
      ),
    }));
    return [
      {
        subtask,
        status: report,
        ...(pullRequestUrl ? { pullRequestUrl } : {}),
        ...(snapshot ? { snapshot } : {}),
        ...(headSha ? { headSha } : {}),
        revisionMatch,
        checks: evaluateCheckState(snapshot, report.testedRevision, now),
        review: evaluateReviewState(
          snapshot?.review,
          headSha,
          report.testedRevision,
          snapshot,
          now,
        ),
        screenshots,
        checkEvidenceScope: checkEvidenceScope(snapshot),
      },
    ];
  });
}

export function buildTaskScreenshotEvidence(
  task: TrackingTask,
  githubStatuses: Readonly<Record<string, TrackingGitHubStatus | undefined>>,
): Array<{ screenshot: TrackingScreenshot; revisionMatch: RevisionMatch }> {
  const parentHead = githubStatuses[`task:${task.id}`]?.pullRequest?.headSha;
  return (task.screenshots ?? []).map((screenshot) => ({
    screenshot,
    revisionMatch: compareRevisionEvidence(
      screenshot.testedRevision,
      parentHead,
    ),
  }));
}

export function revisionMatchLabel(value: RevisionMatch): string {
  return value === "matches"
    ? "Exact match"
    : value === "mismatch"
      ? "Revision differs"
      : "Revision unknown";
}

export function checkStateLabel(value: CheckState): string {
  return {
    passing: "Passing",
    failing: "Failing",
    pending: "Pending",
    stale: "Stale snapshot",
    unknown: "Unknown",
  }[value];
}

export function reviewStateLabel(value: ReviewState): string {
  return {
    finished: "Finished",
    changes_requested: "Changes requested",
    pending: "Pending",
    stale: "Old review head",
    unavailable: "Unavailable",
    unknown: "Unknown",
    untied: "Not tied to report revision",
  }[value];
}
