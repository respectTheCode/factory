import { describe, expect, test } from "bun:test";

import {
  computeReconciliationFindings,
  matchReconciliationTarget,
  type ReconciliationSession,
  type ReconciliationTarget,
} from "../../src/reconciliation";

const sourceUpdatedAt = new Date("2026-09-02T12:00:00.000Z");

function session(
  overrides: Partial<ReconciliationSession> = {},
): ReconciliationSession {
  return {
    branch: "feature/watchtower",
    externalProjectId: "t3-project",
    externalThreadId: "t3-thread",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "running",
    latestTurnState: "running",
    observedAt: sourceUpdatedAt,
    projectId: "project-1",
    provider: "t3",
    repositoryIdentity: "github.com/app-press/watchtower",
    sourceUpdatedAt,
    workspaceRoot: "/work/watchtower",
    ...overrides,
  };
}

function target(
  overrides: Partial<ReconciliationTarget> = {},
): ReconciliationTarget {
  return {
    branchName: "feature/watchtower",
    projectId: "project-1",
    repositoryIdentity: "github.com/app-press/watchtower",
    taskId: "task-1",
    taskName: "Build Watchtower",
    workState: "planned",
    ...overrides,
  };
}

describe("T3 reconciliation", () => {
  test("matches exact PR before repository and branch", () => {
    const result = matchReconciliationTarget(
      session({
        linkedPullRequestUrl: "https://github.com/app-press/watchtower/pull/4",
      }),
      [
        target({
          branchName: "another-branch",
          pullRequestUrl: "https://github.com/app-press/watchtower/pull/4",
          taskId: "task-pr",
        }),
        target({ taskId: "task-branch" }),
      ],
    );

    expect(result).toMatchObject({
      basis: "pull_request",
      candidate: { taskId: "task-pr" },
      status: "matched",
    });
  });

  test("fails closed on ambiguous deterministic matches", () => {
    const result = matchReconciliationTarget(session(), [
      target({ taskId: "task-a" }),
      target({ taskId: "task-b" }),
    ]);

    expect(result).toMatchObject({
      basis: "repository_branch",
      status: "ambiguous",
      candidates: [{ taskId: "task-a" }, { taskId: "task-b" }],
    });
  });

  test("emits findings for unlinked, stale, pending, and branch-drift cases", () => {
    const observed = session({
      branch: "feature/other",
      hasPendingUserInput: true,
      latestSessionState: "error",
    });
    const findings = computeReconciliationFindings({
      links: [
        {
          externalThreadId: observed.externalThreadId,
          provider: "t3",
          subtaskId: "subtask-1",
          taskId: "task-1",
        },
      ],
      now: sourceUpdatedAt,
      sessions: [observed],
      targets: [
        target({
          latestReportAt: new Date("2026-09-02T11:00:00.000Z"),
          subtaskId: "subtask-1",
          subtaskName: "Implement the shell",
        }),
      ],
    });

    expect(findings.map((finding) => finding.kind)).toEqual([
      "branch_mismatch",
      "planned_but_running",
      "reported_state_stale",
      "session_needs_attention",
    ]);
    expect(
      findings.every((finding) => !finding.explanation.includes("complete")),
    ).toBe(true);
  });

  test("unlinked recent activity remains advisory even when a deterministic candidate exists", () => {
    const findings = computeReconciliationFindings({
      links: [],
      now: sourceUpdatedAt,
      sessions: [session()],
      targets: [target()],
    });

    expect(findings).toMatchObject([
      {
        candidateIds: ["task-1"],
        kind: "unlinked_activity",
        suggestedAction: expect.stringContaining("link"),
      },
    ]);
  });

  test("does not call an old completed turn planned-but-running", () => {
    const findings = computeReconciliationFindings({
      links: [
        {
          externalThreadId: "t3-thread",
          provider: "t3",
          taskId: "task-1",
        },
      ],
      now: new Date("2026-09-02T12:00:00.000Z"),
      sessions: [
        session({
          latestSessionState: "ready",
          latestTurnState: "completed",
          latestTurnCompletedAt: new Date("2026-08-01T12:00:00.000Z"),
          sourceUpdatedAt: new Date("2026-08-01T12:00:00.000Z"),
        }),
      ],
      targets: [target()],
    });

    expect(findings.map((finding) => finding.kind)).not.toContain(
      "planned_but_running",
    );
  });

  test("canonicalizes equivalent pull-request and repository identifiers", () => {
    const pullRequest = matchReconciliationTarget(
      session({
        linkedPullRequestUrl:
          "https://www.github.com/App-Press/Watchtower/pull/4",
      }),
      [
        target({
          pullRequestUrl: "https://github.com/app-press/watchtower/pull/4",
        }),
      ],
    );
    expect(pullRequest).toMatchObject({
      basis: "pull_request",
      status: "matched",
    });

    const repository = matchReconciliationTarget(
      session({
        linkedPullRequestUrl: undefined,
        repositoryIdentity: "git@WWW.GITHUB.COM:APP-PRESS/WATCHTOWER.git",
      }),
      [
        target({
          pullRequestUrl: undefined,
          repositoryIdentity: "https://github.com/app-press/watchtower.git",
        }),
      ],
    );
    expect(repository).toMatchObject({
      basis: "repository_branch",
      status: "matched",
    });
  });
});
