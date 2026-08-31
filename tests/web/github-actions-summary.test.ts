import { describe, expect, test } from "bun:test";

import type { GitHubWorkflowRunStatus } from "../../src/github";
import {
  githubActionsSummaryLabel,
  summarizeGitHubActions,
} from "../../src/web/github-status";

function status(runs: GitHubWorkflowRunStatus[]) {
  return {
    checkRuns: runs,
    checkRunsStatus: "ok" as const,
    fetchedAt: "2026-08-31T15:00:00.000Z",
    status: "ok" as const,
    workflowRuns: runs,
    workflowRunsStatus: "ok" as const,
  };
}

function run(
  id: number,
  statusValue: string,
  conclusion?: string,
): GitHubWorkflowRunStatus {
  return {
    ...(conclusion ? { conclusion } : {}),
    createdAt: "2026-08-31T14:00:00.000Z",
    id,
    name: `Run ${id}`,
    status: statusValue,
    updatedAt: "2026-08-31T14:02:00.000Z",
    url: `https://github.com/acme/repo/actions/runs/${id}`,
  };
}

describe("GitHub Actions row summaries", () => {
  test("counts completed checks inside one running workflow", () => {
    const summary = summarizeGitHubActions([
      {
        ...status([run(10, "in_progress")]),
        checkRuns: [
          run(11, "completed", "success"),
          run(12, "completed", "success"),
          run(13, "completed", "success"),
          run(14, "in_progress"),
        ],
        checkRunsStatus: "ok" as const,
      },
    ]);

    expect(summary).toEqual({
      failing: 0,
      passing: 3,
      running: 1,
      skipped: 0,
      total: 4,
    });
  });

  test("counts running, passing, failing, and skipped runs across a task and subtasks", () => {
    const summary = summarizeGitHubActions([
      status([
        run(1, "in_progress"),
        run(2, "completed", "success"),
        run(3, "completed", "failure"),
      ]),
      status([run(4, "completed", "success"), run(5, "completed", "skipped")]),
    ]);

    expect(summary).toEqual({
      failing: 1,
      passing: 2,
      running: 1,
      skipped: 1,
      total: 5,
    });
    expect(githubActionsSummaryLabel(summary!)).toBe(
      "1 running, 2 passing, 1 failing, 1 skipped",
    );
  });

  test("deduplicates a run shared by task and subtask statuses", () => {
    const sharedRun = run(7, "completed", "success");

    expect(
      summarizeGitHubActions([status([sharedRun]), status([sharedRun])]),
    ).toMatchObject({
      failing: 0,
      passing: 1,
      running: 0,
      skipped: 0,
      total: 1,
    });
  });

  test("does not show an Actions summary without readable workflow runs", () => {
    expect(summarizeGitHubActions([undefined])).toBeUndefined();
    expect(
      summarizeGitHubActions([
        {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          fetchedAt: "2026-08-31T15:00:00.000Z",
          status: "ok",
          workflowRuns: [],
          workflowRunsStatus: "unavailable",
        },
      ]),
    ).toBeUndefined();
  });
});
