import type { Issue, IssueStatus } from "../issues";

export const ISSUE_STATUSES: IssueStatus[] = [
  "todo",
  "in_progress",
  "needs_attention",
  "done",
];

export function groupIssues(issues: Issue[]): Array<[IssueStatus, Issue[]]> {
  return ISSUE_STATUSES.map((status) => [
    status,
    issues.filter((issue) => issue.status === status),
  ]);
}
