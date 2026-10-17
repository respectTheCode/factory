import type { Issue, IssueStatus } from "../issues";

export const ISSUE_STATUSES: IssueStatus[] = [
  "done",
  "needs_attention",
  "in_progress",
  "todo",
];

const COLLAPSED_STATUSES_STORAGE_KEY =
  "factory.issue-board.collapsed-statuses.v1";

type StatusStorageReader = Pick<Storage, "getItem">;
type StatusStorageWriter = Pick<Storage, "setItem">;

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCollapsedStatuses(
  storage?: StatusStorageReader | null,
): IssueStatus[] {
  try {
    const availableStorage = storage === undefined ? browserStorage() : storage;
    const saved = availableStorage?.getItem(COLLAPSED_STATUSES_STORAGE_KEY);
    if (!saved) return [];

    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(
        parsed.filter(
          (status): status is IssueStatus =>
            typeof status === "string" &&
            ISSUE_STATUSES.includes(status as IssueStatus),
        ),
      ),
    );
  } catch {
    return [];
  }
}

export function writeCollapsedStatuses(
  statuses: IssueStatus[],
  storage?: StatusStorageWriter | null,
): void {
  try {
    const availableStorage = storage === undefined ? browserStorage() : storage;
    availableStorage?.setItem(
      COLLAPSED_STATUSES_STORAGE_KEY,
      JSON.stringify(
        ISSUE_STATUSES.filter((status) => statuses.includes(status)),
      ),
    );
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function groupIssues(issues: Issue[]): Array<[IssueStatus, Issue[]]> {
  return ISSUE_STATUSES.map((status) => [
    status,
    issues.filter((issue) => issue.status === status),
  ]);
}
