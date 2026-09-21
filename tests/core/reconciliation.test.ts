import { describe, expect, test } from "bun:test";

import {
  computeReconciliationFindings,
  matchReconciliationTarget,
  type ReconciliationSession,
  type ReconciliationTarget,
} from "../../src/reconciliation";

const sourceUpdatedAt = new Date();

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

  test("keeps pull-request matches at Subtask precision", () => {
    const result = matchReconciliationTarget(
      session({
        linkedPullRequestUrl: "https://github.com/app-press/watchtower/pull/4",
      }),
      [
        target({ taskId: "task-parent" }),
        target({
          pullRequestUrl: "https://github.com/app-press/watchtower/pull/4",
          subtaskId: "subtask-pr",
          subtaskName: "Implement the pull request",
          taskId: "task-parent",
        }),
      ],
    );

    expect(result).toMatchObject({
      basis: "pull_request",
      candidate: { subtaskId: "subtask-pr", taskId: "task-parent" },
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

  test("collapses repository branch matches to one Task despite Subtasks", () => {
    const result = matchReconciliationTarget(session(), [
      target({ taskId: "task-a" }),
      target({
        subtaskId: "subtask-a-1",
        subtaskName: "Implement the API",
        taskId: "task-a",
      }),
    ]);

    expect(result).toMatchObject({
      basis: "repository_branch",
      candidate: { taskId: "task-a" },
      status: "matched",
    });
    expect(result).not.toHaveProperty("candidate.subtaskId");
    expect(result.candidates).toHaveLength(1);
  });

  test("reports only Task candidates when branch matches span multiple Tasks", () => {
    const result = matchReconciliationTarget(session(), [
      target({ taskId: "task-a" }),
      target({
        subtaskId: "subtask-a-1",
        subtaskName: "Implement A",
        taskId: "task-a",
      }),
      target({ taskId: "task-b", taskName: "Document Watchtower" }),
      target({
        subtaskId: "subtask-b-1",
        subtaskName: "Document B",
        taskId: "task-b",
        taskName: "Document Watchtower",
      }),
    ]);

    expect(result).toMatchObject({
      basis: "repository_branch",
      status: "ambiguous",
      candidates: [{ taskId: "task-a" }, { taskId: "task-b" }],
    });
    expect(result.candidates).toHaveLength(2);
    expect(
      result.candidates.every((candidate) => candidate.subtaskId === undefined),
    ).toBe(true);
  });

  test("collapses workspace branch matches to the Task level", () => {
    const result = matchReconciliationTarget(
      session({ repositoryIdentity: undefined }),
      [
        target({
          repositoryIdentity: undefined,
          workspaceRoot: "/work/watchtower",
          taskId: "task-workspace",
        }),
        target({
          repositoryIdentity: undefined,
          subtaskId: "subtask-workspace",
          subtaskName: "Implement workspace matching",
          taskId: "task-workspace",
          workspaceRoot: "/work/watchtower",
        }),
      ],
    );

    expect(result).toMatchObject({
      basis: "workspace_branch",
      candidate: { taskId: "task-workspace" },
      status: "matched",
    });
    expect(result.candidates).toHaveLength(1);
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
          latestReportAt: new Date(sourceUpdatedAt.getTime() - 60 * 60 * 1000),
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
      now: sourceUpdatedAt,
      sessions: [
        session({
          latestSessionState: "ready",
          latestTurnState: "completed",
          latestTurnCompletedAt: new Date(
            sourceUpdatedAt.getTime() - 32 * 24 * 60 * 60 * 1000,
          ),
          sourceUpdatedAt: new Date(
            sourceUpdatedAt.getTime() - 32 * 24 * 60 * 60 * 1000,
          ),
        }),
      ],
      targets: [target()],
    });

    expect(findings.map((finding) => finding.kind)).not.toContain(
      "planned_but_running",
    );
  });

  test("reconciles every target associated with one session", () => {
    const findings = computeReconciliationFindings({
      links: [
        {
          externalThreadId: "t3-thread",
          provider: "t3",
          taskId: "task-1",
        },
        {
          externalThreadId: "t3-thread",
          provider: "t3",
          taskId: "task-2",
        },
      ],
      now: sourceUpdatedAt,
      sessions: [session()],
      targets: [
        target({ taskId: "task-1" }),
        target({ taskId: "task-2", taskName: "Document Watchtower" }),
      ],
    });

    expect(
      findings
        .filter((finding) => finding.kind === "planned_but_running")
        .map((finding) => finding.taskId),
    ).toEqual(["task-1", "task-2"]);
  });

  test("suppresses branch mismatch when any linked Task matches the session branch", () => {
    const findings = computeReconciliationFindings({
      links: [
        {
          externalThreadId: "t3-thread",
          provider: "t3",
          taskId: "task-1",
        },
        {
          externalThreadId: "t3-thread",
          provider: "t3",
          taskId: "task-2",
        },
      ],
      now: sourceUpdatedAt,
      sessions: [session()],
      targets: [
        target({ taskId: "task-1" }),
        target({
          branchName: "feature/other",
          taskId: "task-2",
          taskName: "Document Watchtower",
        }),
      ],
    });

    expect(findings.map((finding) => finding.kind)).not.toContain(
      "branch_mismatch",
    );
  });

  test("uses a separate finding kind for unresolved Projects", () => {
    const findings = computeReconciliationFindings({
      links: [],
      now: sourceUpdatedAt,
      projectUnresolved: [
        {
          explanation: "No matching T3 Project.",
          observedAt: sourceUpdatedAt,
          projectId: "project-1",
        },
      ],
      sessions: [],
      targets: [],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        kind: "project_unresolved",
        suggestedAction: expect.stringContaining("Git origin URL"),
      }),
    ]);
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

  test("keeps archived linked targets out of matching and active drift", () => {
    const archivedTarget = target({
      archived: true,
      branchName: "feature/archived",
      subtaskId: "subtask-archived",
      subtaskName: "Archived implementation",
    });

    expect(
      matchReconciliationTarget(session({ branch: "feature/archived" }), [
        archivedTarget,
      ]),
    ).toEqual({ candidates: [], status: "unmatched" });

    expect(
      computeReconciliationFindings({
        links: [
          {
            externalThreadId: "t3-thread",
            provider: "t3",
            subtaskId: archivedTarget.subtaskId,
            taskId: archivedTarget.taskId,
          },
        ],
        now: sourceUpdatedAt,
        sessions: [
          session({
            branch: "feature/other",
            hasPendingUserInput: true,
            latestSessionState: "error",
          }),
        ],
        targets: [archivedTarget],
      }),
    ).toEqual([]);

    const activeTarget = target({
      branchName: "feature/active",
      taskId: "task-active",
    });
    const mixedFindings = computeReconciliationFindings({
      links: [
        {
          externalThreadId: "t3-thread",
          provider: "t3",
          subtaskId: archivedTarget.subtaskId,
          taskId: archivedTarget.taskId,
        },
        {
          externalThreadId: "t3-thread",
          provider: "t3",
          taskId: activeTarget.taskId,
        },
      ],
      now: sourceUpdatedAt,
      sessions: [session({ branch: "feature/archived" })],
      targets: [archivedTarget, activeTarget],
    });
    expect(mixedFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "branch_mismatch",
          taskId: activeTarget.taskId,
        }),
      ]),
    );
  });

  test("warns when a linked target was deleted", () => {
    expect(
      computeReconciliationFindings({
        links: [
          {
            externalThreadId: "t3-thread",
            provider: "t3",
            taskId: "deleted-task",
          },
        ],
        now: sourceUpdatedAt,
        sessions: [session()],
        targets: [],
      }),
    ).toEqual([
      expect.objectContaining({
        kind: "ambiguous_target",
      }),
    ]);
  });
});
