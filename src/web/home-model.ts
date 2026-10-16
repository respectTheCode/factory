import type {
  FloorQueueAction,
  FloorTarget as ServerFloorTarget,
} from "../floor";
import type {
  FloorAction,
  FloorBay,
  FloorSnapshot,
  FloorTaskCard,
} from "./floor";

export type HomeRow = {
  id: string;
  projectId: string;
  projectName: string;
  taskId?: string;
  taskSimpleId?: string;
  title: string;
  task?: FloorTaskCard;
  requests: FloorAction[];
};

export type HomeGroups = {
  needsYou: HomeRow[];
  inProgress: HomeRow[];
  doneToday: HomeRow[];
  plannedNotStarted: number;
  trackingNotes: number;
  projectionAvailable: boolean;
};

export type HomeFreshness = {
  staleT3: boolean;
  snapshotAged: boolean;
  staleTime?: string;
  updatedAt?: string;
};

type TaskTarget = Pick<ServerFloorTarget, "projectId" | "taskId">;

function targetKey(target: TaskTarget): string {
  return JSON.stringify([target.projectId, target.taskId]);
}

function queueTargets(item: FloorAction): TaskTarget[] {
  const targets: TaskTarget[] = [];
  if (item.taskId)
    targets.push({ projectId: item.projectId, taskId: item.taskId });
  for (const target of item.relatedTargets ?? []) {
    if (target.taskId) targets.push(target);
  }
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queueTime(item: FloorAction): number {
  const time = Date.parse(item.timestamp);
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

export function normalizeHomeRequests(
  requests: readonly FloorAction[],
): FloorAction[] {
  return Array.from(
    new Map(requests.map((item) => [item.id, item])).values(),
  ).sort(
    (left, right) =>
      queueTime(left) - queueTime(right) || left.id.localeCompare(right.id),
  );
}

export function homeRequestsForTask(
  projectId: string,
  taskId: string,
  subtaskIds: readonly string[],
  queue: readonly FloorAction[],
): FloorAction[] {
  const subtaskIdSet = new Set(subtaskIds);
  return normalizeHomeRequests(queue).filter((item) => {
    const directTarget =
      item.projectId === projectId &&
      (item.taskId === taskId ||
        Boolean(item.subtaskId && subtaskIdSet.has(item.subtaskId)));
    const relatedTarget = item.relatedTargets?.some(
      (target) =>
        target.projectId === projectId &&
        (target.taskId === taskId ||
          Boolean(target.subtaskId && subtaskIdSet.has(target.subtaskId))),
    );
    return directTarget || relatedTarget;
  });
}

export function homeTimeOf(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });
}

export function homeFreshness(
  snapshot: FloorSnapshot | null,
  now = Date.now(),
): HomeFreshness {
  const staleConnections = (snapshot?.connections ?? []).filter(
    (connection) => {
      const fetchedAt = Date.parse(
        connection.lastSuccessfulFetchAt ?? connection.observedAt ?? "",
      );
      const age = now - fetchedAt;
      return (
        !connection.fresh ||
        !Number.isFinite(fetchedAt) ||
        age > 60_000 ||
        age < -5_000
      );
    },
  );
  const lastSuccessfulFetchAt = staleConnections
    .map((connection) => connection.lastSuccessfulFetchAt)
    .filter((time): time is string => Boolean(time))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const snapshotTimestamp = Date.parse(snapshot?.generatedAt ?? "");
  return {
    staleT3: staleConnections.length > 0,
    snapshotAged: Boolean(
      snapshot &&
      (!Number.isFinite(snapshotTimestamp) || now - snapshotTimestamp > 30_000),
    ),
    ...(homeTimeOf(lastSuccessfulFetchAt)
      ? { staleTime: homeTimeOf(lastSuccessfulFetchAt) }
      : {}),
    ...(homeTimeOf(snapshot?.generatedAt)
      ? { updatedAt: homeTimeOf(snapshot?.generatedAt) }
      : {}),
  };
}

export function homeSessionIsFresh(
  sourceId: string | undefined,
  snapshot: FloorSnapshot | null,
  now = Date.now(),
): boolean {
  if (!sourceId) return true;
  const connection = snapshot?.connections.find(
    (source) => source.sourceId === sourceId,
  );
  if (!connection?.fresh) return false;
  const fetchedAt = Date.parse(
    connection.lastSuccessfulFetchAt ?? connection.observedAt ?? "",
  );
  const age = now - fetchedAt;
  return Number.isFinite(fetchedAt) && age <= 60_000 && age >= -5_000;
}

function withSentencePeriod(value: string): string {
  return `${value.trim().replace(/[.!?…]+$/u, "")}.`;
}

export function homeTaskSentence(
  task: FloorTaskCard | undefined,
  snapshot: FloorSnapshot | null,
  now = Date.now(),
): string {
  if (!task)
    return "This request is attached to a task that is not in the current task list.";
  if (task.state === "completed") {
    return task.finishProvenance ?? "Finished today.";
  }
  if (task.state === "blocked") {
    if (task.handoff?.nextOwnerKind === "agent") {
      return `Blocked on ${task.handoff.nextOwner}: ${withSentencePeriod(task.handoff.nextAction)} Nothing needed from you.`;
    }
    return task.stateReason
      ? withSentencePeriod(`Blocked: ${task.stateReason}`)
      : "Blocked. No reason was recorded.";
  }
  if (task.finish.agentReportedFinished && task.finish.kind === "pr_merge") {
    return "An agent reported it finished. Waiting for the required pull requests to merge.";
  }
  const working = task.sessions.find(
    (session) =>
      session.state === "working" &&
      homeSessionIsFresh(session.sourceId, snapshot, now),
  );
  if (working) {
    const agent =
      working.worker?.identity === "claude"
        ? "Claude"
        : working.worker?.identity === "codex"
          ? "Codex"
          : "An agent";
    const thread = working.threadTitle ? ` in “${working.threadTitle}”` : "";
    const steps = task.steps
      ? ` ${task.steps.done} of ${task.steps.total} steps done.`
      : "";
    if (homeFreshness(snapshot, now).snapshotAged) {
      const observedAt = homeTimeOf(snapshot?.generatedAt);
      return `Last observed by Factory${observedAt ? ` at ${observedAt}` : ""}: ${agent} was working${thread}.${steps}`;
    }
    return `${agent} is working${thread}.${steps}`;
  }
  if (homeFreshness(snapshot, now).staleT3)
    return "Factory has no fresh agent session for this task.";
  if (!task.sessionsAvailable) {
    return "Session status isn't available, so Factory can't confirm this task's agent.";
  }
  if (task.handoff && task.handoff.nextOwnerKind !== "unknown") {
    return `Waiting on ${task.handoff.nextOwner}: ${withSentencePeriod(task.handoff.nextAction)}`;
  }
  return "No agent is working on it right now.";
}

function makeTaskRow(
  project: FloorBay,
  task: FloorTaskCard | undefined,
  taskId: string,
  requests: FloorAction[],
): HomeRow {
  const ordered = normalizeHomeRequests(requests);
  const first = ordered[0];
  return {
    id: `task:${project.id}:${taskId}`,
    projectId: project.id,
    projectName: project.name,
    taskId,
    taskSimpleId: task?.taskSimpleId,
    title: task?.taskName ?? first?.label ?? "Task request",
    ...(task ? { task } : {}),
    requests: ordered,
  };
}

/**
 * Build the three Home groups from the canonical queue and current task cards.
 * Requests without a visible card remain rows, and a request linked to several
 * tasks is represented on every linked task row.
 */
export function buildHomeGroups(
  projects: readonly FloorBay[],
  queue: readonly FloorAction[],
  trackingNotes = 0,
): HomeGroups {
  const taskByKey = new Map<string, FloorTaskCard>();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  for (const project of projects) {
    for (const task of project.tasks ?? []) {
      taskByKey.set(
        targetKey({ projectId: task.projectId, taskId: task.taskId }),
        task,
      );
    }
    for (const task of project.recentlyDone ?? []) {
      taskByKey.set(
        targetKey({ projectId: task.projectId, taskId: task.taskId }),
        task,
      );
    }
  }

  const dedupedQueue = normalizeHomeRequests(queue);
  const requestsByTask = new Map<string, FloorAction[]>();
  const unlinkedRequests: FloorAction[] = [];
  for (const item of dedupedQueue) {
    const targets = queueTargets(item);
    if (targets.length === 0) {
      unlinkedRequests.push(item);
      continue;
    }
    for (const target of targets) {
      const key = targetKey(target);
      const rows = requestsByTask.get(key) ?? [];
      if (!rows.some((row) => row.id === item.id)) rows.push(item);
      requestsByTask.set(key, rows);
    }
  }

  const needsYou: HomeRow[] = [];
  for (const [key, requests] of requestsByTask) {
    const [projectId, taskId] = JSON.parse(key) as [string, string];
    const project =
      projectById.get(projectId) ??
      ({
        id: projectId,
        name: requests[0]?.projectName ?? "Unknown project",
        tasks: [],
        recentlyDone: [],
        bench: [],
        counter: [],
        stations: [],
        working: 0,
        waiting: 0,
        blocked: 0,
        quiet: false,
        taskProjectionAvailable: false,
      } satisfies FloorBay);
    needsYou.push(makeTaskRow(project, taskByKey.get(key), taskId, requests));
  }
  for (const item of unlinkedRequests) {
    needsYou.push({
      id: `request:${item.id}`,
      projectId: item.projectId,
      projectName: item.projectName,
      title: item.label,
      requests: [item],
    });
  }
  needsYou.sort((left, right) => {
    const leftAt = left.requests[0]
      ? queueTime(left.requests[0])
      : Number.POSITIVE_INFINITY;
    const rightAt = right.requests[0]
      ? queueTime(right.requests[0])
      : Number.POSITIVE_INFINITY;
    return leftAt - rightAt || left.id.localeCompare(right.id);
  });

  const needsTaskKeys = new Set(
    needsYou
      .filter((row) => row.taskId)
      .map((row) =>
        targetKey({ projectId: row.projectId, taskId: row.taskId! }),
      ),
  );
  const inProgress: HomeRow[] = [];
  const doneToday: HomeRow[] = [];
  const placedTaskKeys = new Set(needsTaskKeys);
  let plannedNotStarted = 0;
  let projectionAvailable = projects.length > 0;

  for (const project of projects) {
    if (!project.taskProjectionAvailable) projectionAvailable = false;
    for (const task of project.recentlyDone ?? []) {
      const key = targetKey({ projectId: project.id, taskId: task.taskId });
      if (placedTaskKeys.has(key)) continue;
      placedTaskKeys.add(key);
      doneToday.push({
        id: `task:${project.id}:${task.taskId}`,
        projectId: project.id,
        projectName: project.name,
        taskId: task.taskId,
        taskSimpleId: task.taskSimpleId,
        title: task.taskName,
        task,
        requests: [],
      });
    }
    for (const task of project.tasks ?? []) {
      const key = targetKey({ projectId: project.id, taskId: task.taskId });
      if (placedTaskKeys.has(key)) continue;
      placedTaskKeys.add(key);
      if (task.state === "backlog") {
        plannedNotStarted += 1;
        continue;
      }
      if (task.state === "planned") {
        if (task.sessions.length === 0 && !task.handoff) {
          plannedNotStarted += 1;
          continue;
        }
      }
      if (task.state === "completed") continue;
      inProgress.push({
        id: `task:${project.id}:${task.taskId}`,
        projectId: project.id,
        projectName: project.name,
        taskId: task.taskId,
        taskSimpleId: task.taskSimpleId,
        title: task.taskName,
        task,
        requests: [],
      });
    }
  }

  doneToday.sort((left, right) => {
    const leftAt = Date.parse(left.task?.completedAt ?? "");
    const rightAt = Date.parse(right.task?.completedAt ?? "");
    const leftTime = Number.isFinite(leftAt)
      ? leftAt
      : Number.NEGATIVE_INFINITY;
    const rightTime = Number.isFinite(rightAt)
      ? rightAt
      : Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.id.localeCompare(right.id);
  });

  return {
    needsYou,
    inProgress,
    doneToday,
    plannedNotStarted,
    trackingNotes,
    projectionAvailable,
  };
}

export function homeRequestLabel(
  action: FloorQueueAction,
  hasThread: boolean,
): string | undefined {
  if (action === "check") return "Check it";
  if (action === "review") return "Review PR";
  if (hasThread) return "Thread details";
  if (action === "unblock") return undefined;
  return "Task details";
}
