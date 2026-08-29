import {
  CheckCircle,
  CircleDashed,
  CircleHalf,
  Eye,
  SealCheck,
  WarningCircle,
  XCircle,
  type Icon,
} from "@phosphor-icons/react";

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
  icon: Icon;
  label: string;
};

export const statusDefinitions: Record<WorkStatus, StatusDefinition> = {
  planned: { color: "#f97316", icon: CircleDashed, label: "Planned" },
  active: { color: "#facc15", icon: CircleHalf, label: "Active" },
  awaiting_verification: {
    color: "#22c55e",
    icon: Eye,
    label: "Awaiting verification",
  },
  completed: { color: "#818cf8", icon: CheckCircle, label: "Completed" },
  blocked: { color: "#ef4444", icon: WarningCircle, label: "Blocked" },
  released: { color: "#6366f1", icon: SealCheck, label: "Released" },
  wont_do: { color: "#94a3b8", icon: XCircle, label: "Won't do" },
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
