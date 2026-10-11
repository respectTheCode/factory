import type { TaskActivityItem } from "../application";
import { verificationAttribution } from "./reviewer-presentation";

export type ActivityDescriptionInput = Pick<
  TaskActivityItem,
  | "kind"
  | "actor"
  | "summary"
  | "reason"
  | "reportedState"
  | "subtaskId"
  | "pullRequestUrl"
  | "mergeSha"
  | "verificationDecision"
  | "verificationSource"
>;

/** Present the recorded actor and action; evidence never replaces the event. */
export function workflowActivityText(
  item: ActivityDescriptionInput,
  steps: ReadonlyArray<{ id: string; name: string }>,
  taskFinishedByAgent = false,
): string {
  const actor = item.actor.trim() || "Actor not recorded";
  const note = item.summary?.trim() || item.reason?.trim();
  const suffix = note ? `: ${note}` : "";
  const step = steps.find((step) => step.id === item.subtaskId);
  const stepName = step ? `“${step.name}”` : "an earlier Step";
  if (item.kind === "task_report")
    return `${actor} ${item.reportedState === "finished" ? (taskFinishedByAgent ? "finished the task" : "reported ready") : item.reportedState === "blocked" ? "reported a blocker" : "reported progress"}${suffix}`;
  if (item.kind === "step_report") {
    const state =
      item.reportedState === "complete"
        ? "Done"
        : item.reportedState === "blocked"
          ? "Blocked"
          : item.reportedState === "in_progress"
            ? "Doing"
            : "To do";
    return `${actor} set ${stepName} to ${state}${suffix}`;
  }
  if (item.kind === "finish_rule_changed") {
    const rule = note
      ?.replaceAll("agent_report", "agent finishes")
      .replaceAll("pr_merge", "required PRs merge")
      .replaceAll("with human check", "with your check");
    return `${actor} changed the finish rule${rule ? `: ${rule}` : ""}`;
  }
  if (item.kind === "checked") return `${actor} checked it${suffix}`;
  if (item.kind === "sent_back") return `${actor} sent it back${suffix}`;
  if (item.kind === "marked_done") return `${actor} marked it done${suffix}`;
  if (item.kind === "reopened") return `${actor} reopened the task${suffix}`;
  if (item.kind === "finished") return `${actor} finished the task${suffix}`;
  if (item.kind === "pull_request_merged")
    return `${actor}: PR #${item.pullRequestUrl?.split("/").pop() ?? "unknown"} merged${item.mergeSha ? ` · ${item.mergeSha.slice(0, 7)}` : ""}`;
  return `${verificationAttribution({ decision: item.verificationDecision ?? "review recorded", source: item.verificationSource, verifier: actor })} · ${stepName}${suffix}${item.mergeSha ? ` · merge ${item.mergeSha.slice(0, 7)}` : ""}`;
}
