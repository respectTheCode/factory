import type {
  GitHubCheckRunStatus,
  GitHubStatusSnapshot,
  GitHubWorkflowRunStatus,
} from "../github";

export type GitHubActionsSummary = {
  failing: number;
  passing: number;
  running: number;
  skipped: number;
  total: number;
};

const RUNNING_STATUSES = new Set([
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);
const FAILING_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "stale",
  "startup_failure",
  "timed_out",
]);

export function summarizeGitHubActions(
  statuses: Array<GitHubStatusSnapshot | undefined>,
): GitHubActionsSummary | undefined {
  const runs = new Map<
    number,
    GitHubWorkflowRunStatus | GitHubCheckRunStatus
  >();
  for (const status of statuses) {
    if (!status) continue;
    const statusRuns =
      status.checkRunsStatus === "ok"
        ? status.checkRuns
        : status.checkRunsStatus === undefined &&
            status.workflowRunsStatus === "ok"
          ? status.workflowRuns
          : [];
    for (const run of statusRuns) {
      runs.set(run.id, run);
    }
  }

  if (runs.size === 0) return undefined;

  let failing = 0;
  let passing = 0;
  let running = 0;
  let skipped = 0;
  for (const run of runs.values()) {
    if (RUNNING_STATUSES.has(run.status)) {
      running += 1;
    } else if (run.conclusion === "success") {
      passing += 1;
    } else if (FAILING_CONCLUSIONS.has(run.conclusion ?? "")) {
      failing += 1;
    } else if (run.conclusion === "skipped") {
      skipped += 1;
    }
  }

  return { failing, passing, running, skipped, total: runs.size };
}

export function githubActionsSummaryLabel(
  summary: GitHubActionsSummary,
): string {
  return [
    summary.running > 0 ? `${summary.running} running` : null,
    `${summary.passing} passing`,
    `${summary.failing} failing`,
    `${summary.skipped} skipped`,
  ]
    .filter((label): label is string => label !== null)
    .join(", ");
}
