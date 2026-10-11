export type WorkStatus =
  | "completed"
  | "blocked"
  | "awaiting_verification"
  | "active"
  | "planned"
  | "backlog"
  | "released"
  | "wont_do";

export type ReportedStatus =
  | "backlog"
  | "not_started"
  | "in_progress"
  | "blocked"
  | "complete";

export type VerificationStatus =
  | "accepted"
  | "awaiting_verification"
  | "deferred"
  | "rejected"
  | "not_required"
  | "unreported";

export type StatusDefinition = {
  color: string;
  dial: WorkStatus;
  label: string;
};

export const liveWorkStatusOrder = [
  "awaiting_verification",
  "blocked",
  "active",
  "planned",
  "backlog",
  "completed",
] as const satisfies ReadonlyArray<Exclude<WorkStatus, "released" | "wont_do">>;

/** States a human can assign directly to a Task; completion follows its finish rule or an explicit reasoned override. */
export const taskStatusOrder = [
  "blocked",
  "awaiting_verification",
  "active",
  "planned",
  "backlog",
] as const satisfies ReadonlyArray<
  Exclude<WorkStatus, "completed" | "released" | "wont_do">
>;

export const archiveStatusOrder = ["released", "wont_do"] as const;

export const statusDefinitions: Record<WorkStatus, StatusDefinition> = {
  completed: { color: "#2FBE6B", dial: "completed", label: "Done" },
  blocked: { color: "#E5484D", dial: "blocked", label: "Blocked" },
  awaiting_verification: {
    color: "#F0B429",
    dial: "awaiting_verification",
    label: "In review",
  },
  active: { color: "#4AA3E0", dial: "active", label: "Active" },
  planned: { color: "#A2988A", dial: "planned", label: "Planned" },
  backlog: { color: "#746B5D", dial: "backlog", label: "Backlog" },
  released: { color: "#2FBE6B", dial: "released", label: "Released" },
  wont_do: { color: "#635A4D", dial: "wont_do", label: "Won't do" },
};

export function requiresStateReason(state: WorkStatus): boolean {
  return state === "blocked" || state === "awaiting_verification";
}

export const dispositionStatusOptions = [
  { label: "Released", workStatus: "released" },
  { label: "Won't do", workStatus: "wont_do" },
] as const satisfies ReadonlyArray<{
  label: string;
  workStatus: "released" | "wont_do";
}>;

export function workStatusForReportedState(
  reportedState: ReportedStatus,
  verificationState?: VerificationStatus,
): WorkStatus {
  if (reportedState === "backlog") return "backlog";
  if (reportedState === "not_started") return "planned";
  if (reportedState === "in_progress") return "active";
  if (reportedState === "blocked") return "blocked";
  return verificationState === "accepted"
    ? "completed"
    : "awaiting_verification";
}
