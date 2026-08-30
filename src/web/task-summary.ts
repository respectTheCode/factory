import {
  archiveStatusOrder,
  liveWorkStatusOrder,
  type WorkStatus,
} from "./status-presentation";

export type SummarySubtask = {
  archiveState?: "released" | "wont_do";
  id: string;
  name: string;
};

export type SummarySubtaskStatus = {
  archiveState?: "released" | "wont_do";
  reportedState?:
    | "backlog"
    | "not_started"
    | "in_progress"
    | "blocked"
    | "complete";
  verificationState:
    | "accepted"
    | "awaiting_verification"
    | "deferred"
    | "rejected"
    | "unreported";
};

export type TaskProgressSummary = {
  completedSubtasks: number;
  nextSubtaskName?: string;
  openSubtasks: number;
  totalSubtasks: number;
};

export type AttentionFilter =
  | "all"
  | "backlog"
  | "planned"
  | "active"
  | "awaiting_verification"
  | "blocked";

export type AttentionSummary = {
  state: Exclude<AttentionFilter, "all">;
  taskId: string;
};

export const taskGroupOrder: WorkStatus[] = [
  ...liveWorkStatusOrder,
  ...archiveStatusOrder,
];

type OrderedItem = {
  archiveState?: "released" | "wont_do";
  id: string;
  sortOrder?: number;
  workState?: WorkStatus;
};

type StatusSummary = {
  archiveState?: "released" | "wont_do";
  sortOrder?: number;
  taskState?: WorkStatus;
  workState?: WorkStatus;
};

function orderItems<T extends { sortOrder?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftOrder = left.item.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.item.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ item }) => item);
}

export function groupTasksByStatus<T extends OrderedItem>(
  tasks: T[],
  statuses: Record<string, StatusSummary | undefined>,
): Array<{ state: WorkStatus; tasks: T[] }> {
  const grouped = new Map<WorkStatus, T[]>();

  for (const task of tasks) {
    const status = statuses[task.id];
    const state =
      task.archiveState ??
      status?.archiveState ??
      status?.taskState ??
      status?.workState ??
      task.workState ??
      "planned";
    const group = grouped.get(state) ?? [];
    group.push({
      ...task,
      sortOrder: task.sortOrder ?? status?.sortOrder,
    });
    grouped.set(state, group);
  }

  return taskGroupOrder
    .map((state) => ({
      state,
      tasks: orderItems(grouped.get(state) ?? []),
    }))
    .filter((group) => group.tasks.length > 0);
}

export function groupSubtasksByStatus<
  T extends OrderedItem & { state?: WorkStatus },
>(subtasks: T[]): Array<{ state: WorkStatus; subtasks: T[] }> {
  const grouped = new Map<WorkStatus, T[]>();

  for (const subtask of subtasks) {
    const state =
      subtask.archiveState ?? subtask.state ?? subtask.workState ?? "planned";
    const group = grouped.get(state) ?? [];
    group.push(subtask);
    grouped.set(state, group);
  }

  return taskGroupOrder
    .map((state) => ({
      state,
      subtasks: orderItems(grouped.get(state) ?? []),
    }))
    .filter((group) => group.subtasks.length > 0);
}

/** Return a new order with one item moved before the target, or to the tail. */
export function reorderIds(
  ids: string[],
  itemId: string,
  beforeId?: string,
): string[] {
  if (!ids.includes(itemId)) return ids;
  if (beforeId === itemId) return ids;

  const next = ids.filter((id) => id !== itemId);
  const destination = beforeId ? next.indexOf(beforeId) : next.length;
  next.splice(destination < 0 ? next.length : destination, 0, itemId);
  return next;
}

export function filterArchivedTasks<T extends { archiveState?: string }>(
  items: T[],
  includeArchived: boolean,
): T[] {
  return includeArchived
    ? items
    : items.filter((item) => item.archiveState === undefined);
}

export function filterAttention<T extends AttentionSummary>(
  items: T[],
  filter: AttentionFilter,
): T[] {
  return filter === "all"
    ? items
    : items.filter((item) => item.state === filter);
}

export function summarizeTaskProgress(
  task: { subtasks: SummarySubtask[] },
  status: { subtasks: SummarySubtaskStatus[] } | undefined,
): TaskProgressSummary {
  const visibleSubtasks = task.subtasks
    .map((subtask, index) => ({
      status: status?.subtasks[index],
      subtask,
    }))
    .filter(
      ({ status: subtaskStatus, subtask }) =>
        subtask.archiveState !== "wont_do" &&
        subtaskStatus?.archiveState !== "wont_do",
    );
  const isComplete = ({
    status: subtaskStatus,
  }: (typeof visibleSubtasks)[number]) =>
    subtaskStatus?.archiveState === "released" ||
    (subtaskStatus?.reportedState === "complete" &&
      subtaskStatus.verificationState === "accepted");
  const completedSubtasks = visibleSubtasks.filter(isComplete).length;
  const nextSubtask = visibleSubtasks.find((entry) => !isComplete(entry));

  return {
    completedSubtasks,
    ...(nextSubtask ? { nextSubtaskName: nextSubtask.subtask.name } : {}),
    openSubtasks: visibleSubtasks.length - completedSubtasks,
    totalSubtasks: visibleSubtasks.length,
  };
}
