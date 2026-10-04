import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

function createInMemoryApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => new Date("2026-10-03T12:00:00.000Z"),
    idGenerator: () => `merge-${++nextId}`,
  });
}

describe("PR merge reconciliation", () => {
  test("matches a linked PR URL to the configured Project repository and is idempotent", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/reviewer-demo.git",
      name: "Merge evidence",
    });
    const task = app.createTask({
      name: "Review the merged release",
      projectId: project.id,
      pullRequestUrl: "https://github.com/example/reviewer-demo/pull/1",
    });
    const child = app.createSubtask({
      name: "Verify release",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      reason: "Check the merged release.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    const evidence = {
      mergedAt: new Date("2026-10-04T10:00:00.000Z"),
      mergeSha: "0123456789abcdef0123456789abcdef01234567",
      pullRequestUrl: "https://github.com/example/reviewer-demo/pull/1",
    };

    const first = app.reconcileMergedPullRequest({
      evidence,
      targetId: task.id,
      targetType: "task",
    });
    const second = app.reconcileMergedPullRequest({
      evidence,
      targetId: task.id,
      targetType: "task",
    });

    expect(first).toMatchObject({
      reconciled: true,
      mergeSha: evidence.mergeSha,
    });
    expect(second.reconciled).toBe(false);
    expect(app.getSubtaskVerificationHistory(child.id)).toMatchObject([
      {
        reportId: report.id,
        decision: "accepted",
        source: "pr_merge",
        pullRequestUrl: evidence.pullRequestUrl,
        mergeSha: evidence.mergeSha,
      },
    ]);
  });

  test("rejects merge evidence from a different repository", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/reviewer-demo.git",
      name: "Wrong repository",
    });
    const task = app.createTask({
      name: "Wrong repository PR",
      projectId: project.id,
      pullRequestUrl: "https://github.com/other/repo/pull/4",
    });
    const child = app.createSubtask({
      name: "Verify release",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the merged release.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });

    expect(
      app.reconcileMergedPullRequest({
        evidence: {
          mergedAt: new Date("2026-10-04T10:00:00.000Z"),
          mergeSha: "0123456789abcdef0123456789abcdef01234567",
          pullRequestUrl: "https://github.com/other/repo/pull/4",
        },
        targetId: task.id,
        targetType: "task",
      }),
    ).toMatchObject({
      reconciled: false,
      reason:
        "The Project has no matching configured GitHub repository identity.",
    });
    expect(app.getSubtaskVerificationHistory(child.id)).toEqual([]);
  });

  test("does not use a merge to accept a report created after that merge", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/reconciler.git",
      name: "Newer report",
    });
    const task = app.createTask({
      name: "Newer report",
      projectId: project.id,
      pullRequestUrl: "https://github.com/example/reconciler/pull/11",
    });
    const child = app.createSubtask({
      name: "Verify release",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "This report was created after merge.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });

    expect(
      app.reconcileMergedPullRequest({
        evidence: {
          mergedAt: new Date("2026-10-02T10:00:00.000Z"),
          mergeSha: "0123456789abcdef0123456789abcdef01234567",
          pullRequestUrl: "https://github.com/example/reconciler/pull/11",
        },
        targetId: task.id,
        targetType: "task",
      }),
    ).toMatchObject({
      reconciled: false,
      reason: expect.stringContaining("predates the current report"),
    });
    expect(app.getSubtaskVerificationHistory(child.id)).toEqual([]);
  });

  test("preserves a current rejection instead of accepting it from PR merge evidence", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/reconciler.git",
      name: "Rejected report",
    });
    const task = app.createTask({
      name: "Rejected report",
      projectId: project.id,
      pullRequestUrl: "https://github.com/example/reconciler/pull/12",
    });
    const child = app.createSubtask({
      name: "Verify release",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      reason: "Check the merged implementation.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    app.verifyStatusReport({
      decision: "rejected",
      reason: "The implementation is incomplete.",
      reportId: report.id,
      verifier: "kevin",
    });

    expect(
      app.reconcileMergedPullRequest({
        evidence: {
          mergedAt: new Date("2026-10-04T10:00:00.000Z"),
          mergeSha: "0123456789abcdef0123456789abcdef01234567",
          pullRequestUrl: "https://github.com/example/reconciler/pull/12",
        },
        targetId: task.id,
        targetType: "task",
      }),
    ).toMatchObject({
      reconciled: false,
      reason: expect.stringContaining(
        "already has a current rejected verification",
      ),
    });
    expect(app.getSubtaskVerificationHistory(child.id)).toMatchObject([
      { decision: "rejected", verifier: "kevin" },
    ]);
  });

  test("does not let the Task PR cover a child linked to a different PR", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/reconciler.git",
      name: "Child PR",
    });
    const task = app.createTask({
      name: "Parent PR",
      projectId: project.id,
      pullRequestUrl: "https://github.com/example/reconciler/pull/13",
    });
    const child = app.createSubtask({
      name: "Separate pull request",
      pullRequestUrl: "https://github.com/example/reconciler/pull/14",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the merged implementation.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });

    expect(
      app.reconcileMergedPullRequest({
        evidence: {
          mergedAt: new Date("2026-10-04T10:00:00.000Z"),
          mergeSha: "0123456789abcdef0123456789abcdef01234567",
          pullRequestUrl: "https://github.com/example/reconciler/pull/13",
        },
        targetId: task.id,
        targetType: "task",
      }),
    ).toMatchObject({
      reconciled: false,
      reason: expect.stringContaining("linked to a different PR"),
    });
    expect(app.getSubtaskVerificationHistory(child.id)).toEqual([]);
  });
});
