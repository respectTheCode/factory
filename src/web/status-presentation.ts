export type WorkStatus =
  | "planned"
  | "active"
  | "awaiting_verification"
  | "completed"
  | "blocked"
  | "released"
  | "wont_do";

export type ReportedStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "complete";

export type VerificationStatus =
  | "accepted"
  | "awaiting_verification"
  | "deferred"
  | "rejected"
  | "unreported";

export type StatusDefinition = {
  color: string;
  dial: WorkStatus;
  label: string;
};

export const statusDefinitions: Record<WorkStatus, StatusDefinition> = {
  planned: { color: "#A2988A", dial: "planned", label: "Planned" },
  active: { color: "#4AA3E0", dial: "active", label: "Active" },
  awaiting_verification: {
    color: "#F0B429",
    dial: "awaiting_verification",
    label: "Awaiting verification",
  },
  completed: { color: "#2FBE6B", dial: "completed", label: "Completed" },
  blocked: { color: "#E5484D", dial: "blocked", label: "Blocked" },
  released: { color: "#2FBE6B", dial: "released", label: "Released" },
  wont_do: { color: "#635A4D", dial: "wont_do", label: "Won't do" },
};

export const reportStatusOptions: Array<{
  label: string;
  reportedState: ReportedStatus;
  workStatus: WorkStatus;
}> = [
  { label: "Planned", reportedState: "not_started", workStatus: "planned" },
  { label: "Active", reportedState: "in_progress", workStatus: "active" },
  { label: "Blocked", reportedState: "blocked", workStatus: "blocked" },
  {
    label: "Complete for verification",
    reportedState: "complete",
    workStatus: "awaiting_verification",
  },
];

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
  if (reportedState === "not_started") return "planned";
  if (reportedState === "in_progress") return "active";
  if (reportedState === "blocked") return "blocked";
  return verificationState === "accepted"
    ? "completed"
    : "awaiting_verification";
}
