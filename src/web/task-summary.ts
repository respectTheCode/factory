export type SummarySubtask = {
  archiveState?: "released" | "wont_do";
  id: string;
  name: string;
};

export type SummarySubtaskStatus = {
  archiveState?: "released" | "wont_do";
  reportedState?: "not_started" | "in_progress" | "blocked" | "complete";
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
  | "planned"
  | "active"
  | "awaiting_verification"
  | "blocked";

export type AttentionSummary = {
  state: Exclude<AttentionFilter, "all">;
  taskId: string;
};

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
