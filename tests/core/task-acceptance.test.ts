import { describe, expect, test } from "bun:test";

import {
  createFactoryApplication,
  FactoryApplication,
} from "../../src/application";

function createInMemoryApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => new Date("2026-10-03T12:00:00.000Z"),
    idGenerator: () => `acceptance-${++nextId}`,
  });
}

function reviewedSnapshot(app: FactoryApplication, taskId: string) {
  const status = app.getTaskStatus(taskId);
  return {
    expectedTaskRevision: status.taskRevision,
    reviewedSubtasks: status.subtasks.map((subtask) => ({
      currentReportId: subtask.reportId ?? null,
      currentVerificationId: subtask.verificationId ?? null,
      revision: subtask.revision,
      subtaskId: subtask.subtaskId,
    })),
  };
}

function accept(app: FactoryApplication, taskId: string) {
  return app.acceptTask({
    ...reviewedSnapshot(app, taskId),
    reason: "Reviewed and accepted with the Task.",
    taskId,
    verifier: "kevin",
  });
}

describe("human task-wide acceptance", () => {
  test("accepts mixed child states, preserves history, and clears dispositions and manual holds", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Close the release",
      projectId: project.id,
    });
    const awaiting = app.createSubtask({
      name: "Awaiting review",
      taskId: task.id,
    });
    const unreported = app.createSubtask({
      name: "No report yet",
      taskId: task.id,
    });
    const rejected = app.createSubtask({
      name: "Rejected report",
      taskId: task.id,
    });
    const alreadyAccepted = app.createSubtask({
      name: "Already accepted",
      taskId: task.id,
    });
    const awaitingReport = app.reportSubtaskStatus({
      evidence: "Evidence from the existing complete report.",
      reason: "Check the deployed page.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: awaiting.id,
    });
    app.updateSubtask({
      evidence: "Draft evidence to retain.",
      subtaskId: unreported.id,
    });
    const rejectedReport = app.reportSubtaskStatus({
      reason: "Check the failed rollout.",
      reporter: "claude",
      reportedState: "complete",
      subtaskId: rejected.id,
    });
    app.verifyStatusReport({
      decision: "rejected",
      reason: "The rollout still fails.",
      reportId: rejectedReport.id,
      verifier: "kevin",
    });
    const acceptedReport = app.reportSubtaskStatus({
      reason: "Check the verified output.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: alreadyAccepted.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: acceptedReport.id,
      verifier: "kevin",
    });
    app.archiveSubtask(awaiting.id, "released");
    app.archiveSubtask(rejected.id, "wont_do");
    app.setTaskWorkState({
      reason: "Review the stalled task.",
      taskId: task.id,
      workState: "blocked",
    });
    app.archiveTask(task.id, "wont_do");
    const beforeAcceptance = app.getTaskStatus(task.id);

    accept(app, task.id);

    const status = app.getTaskStatus(task.id);
    expect(status).toMatchObject({
      taskCompleted: true,
      taskState: "completed",
    });
    expect(status.archiveState).toBeUndefined();
    expect(status.subtasks).toHaveLength(4);
    expect(
      status.subtasks.every((child) => child.effectiveState === "completed"),
    ).toBe(true);
    expect(
      status.subtasks.every((child) => child.verificationState === "accepted"),
    ).toBe(true);
    expect(
      status.subtasks.every((child) => child.archiveState === undefined),
    ).toBe(true);
    const beforeById = new Map(
      beforeAcceptance.subtasks.map((child) => [
        child.subtaskId,
        child.revision,
      ]),
    );
    for (const child of status.subtasks) {
      if (child.subtaskId === alreadyAccepted.id) continue;
      expect(child.revision).toBeGreaterThan(beforeById.get(child.subtaskId)!);
    }

    const awaitingHistory = app.getSubtaskReportHistory(awaiting.id);
    expect(awaitingHistory).toHaveLength(1);
    expect(awaitingHistory[0]).toEqual(awaitingReport);
    const unreportedHistory = app.getSubtaskReportHistory(unreported.id);
    expect(unreportedHistory).toHaveLength(1);
    expect(unreportedHistory[0]).toMatchObject({
      evidence: "Draft evidence to retain.",
      reporter: "kevin",
      reportedState: "complete",
      reason: "Reviewed and accepted with the Task.",
    });
    expect(app.getSubtaskVerificationHistory(awaiting.id)).toEqual([
      expect.objectContaining({
        decision: "accepted",
        verifier: "kevin",
        reason: "Reviewed and accepted with the Task.",
      }),
    ]);
    expect(app.getSubtaskReportHistory(rejected.id)).toHaveLength(1);
    expect(
      app
        .getSubtaskVerificationHistory(rejected.id)
        .map((item) => item.decision),
    ).toEqual(["rejected", "accepted"]);
    expect(app.getSubtaskReportHistory(alreadyAccepted.id)).toEqual([
      acceptedReport,
    ]);
    expect(app.getSubtaskVerificationHistory(alreadyAccepted.id)).toHaveLength(
      1,
    );
  });

  test("is idempotent for already accepted work and does not bump revisions twice", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Ship the release",
      projectId: project.id,
    });
    const child = app.createSubtask({
      name: "Verify release",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the published build.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });

    accept(app, task.id);
    const accepted = app.getTaskStatus(task.id);
    const reportHistory = app.getSubtaskReportHistory(child.id);
    const verificationHistory = app.getSubtaskVerificationHistory(child.id);
    accept(app, task.id);

    expect(app.getTaskStatus(task.id).taskRevision).toBe(accepted.taskRevision);
    expect(app.getTaskStatus(task.id).subtasks[0]?.revision).toBe(
      accepted.subtasks[0]?.revision,
    );
    expect(app.getSubtaskReportHistory(child.id)).toEqual(reportHistory);
    expect(app.getSubtaskVerificationHistory(child.id)).toEqual(
      verificationHistory,
    );
  });

  test("rejects empty tasks, stale children, and same-state reports changed after review", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const emptyTask = app.createTask({ name: "Empty", projectId: project.id });
    expect(() => accept(app, emptyTask.id)).toThrow("cannot be accepted");

    const task = app.createTask({
      name: "Review current work",
      projectId: project.id,
    });
    const child = app.createSubtask({
      name: "Current report",
      taskId: task.id,
    });
    const first = app.reportSubtaskStatus({
      evidence: "Same evidence.",
      reason: "Check the current output.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    app.setTaskWorkState({ taskId: task.id, workState: "active" });
    const snapshot = reviewedSnapshot(app, task.id);
    app.reportSubtaskStatus({
      evidence: "Same evidence.",
      reason: "Updated same-state report.",
      reporter: "claude",
      reportedState: "complete",
      subtaskId: child.id,
    });
    expect(app.getTaskStatus(task.id).subtasks[0]?.revision).toBe(
      snapshot.reviewedSubtasks[0]?.revision,
    );
    expect(() =>
      app.acceptTask({
        ...snapshot,
        reason: "Review accepted.",
        taskId: task.id,
        verifier: "kevin",
      }),
    ).toThrow("changed its current report or verification");
    expect(app.getSubtaskReportHistory(child.id)).toHaveLength(2);
    expect(app.getSubtaskVerificationHistory(child.id)).toHaveLength(0);
    expect(app.getSubtaskReportHistory(child.id)[0]).toEqual(first);

    const stale = reviewedSnapshot(app, task.id);
    app.createSubtask({ name: "Added after review", taskId: task.id });
    expect(() =>
      app.acceptTask({
        ...stale,
        reason: "Review accepted.",
        taskId: task.id,
        verifier: "kevin",
      }),
    ).toThrow("every current Subtask exactly once");
  });

  test("new child work reopens a task accepted through rollup", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Ship the release",
      projectId: project.id,
    });
    const child = app.createSubtask({
      name: "Verify release",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the published build.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });

    accept(app, task.id);
    app.createSubtask({ name: "New work after acceptance", taskId: task.id });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "active",
    });
  });

  test("reviewers cannot verify a Subtask while its parent Task is archived", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Archived task",
      projectId: project.id,
    });
    const child = app.createSubtask({ name: "Current work", taskId: task.id });
    const report = app.reportSubtaskStatus({
      reason: "Check the current build.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    app.assignReviewer({
      assignedBy: "kevin",
      reviewer: {
        id: "bitsy-credential",
        machineId: "bitsy-reviewer",
        reviewerName: "Bitsy",
      },
      targetId: child.id,
      targetType: "subtask",
    });
    app.archiveTask(task.id, "wont_do");

    expect(() =>
      app.verifyStatusReport({
        decision: "accepted",
        expectedRevision: app.getTaskStatus(task.id).subtasks[0]!.revision,
        reportId: report.id,
        reportText: "Checked the current build.",
        reviewerCredentialId: "bitsy-credential",
        source: "reviewer",
        verifier: "Bitsy",
      }),
    ).toThrow("Subtasks under archived Tasks cannot be reviewed");
    expect(app.getSubtaskVerificationHistory(child.id)).toEqual([]);
  });

  test("reviewer Task rejection supersedes accepted current decisions and records findings", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({ name: "Review task", projectId: project.id });
    const child = app.createSubtask({ name: "Release check", taskId: task.id });
    const report = app.reportSubtaskStatus({
      reason: "Check the release.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    app.assignReviewer({
      assignedBy: "kevin",
      reviewer: {
        id: "bitsy-credential",
        machineId: "bitsy-reviewer",
        reviewerName: "Bitsy",
      },
      targetId: task.id,
      targetType: "task",
    });
    const reviewerInput = {
      decision: "accepted" as const,
      reportText: "Verified the release checks.",
      reviewerCredentialId: "bitsy-credential",
      source: "reviewer" as const,
      taskId: task.id,
      verifier: "Bitsy",
    };
    app.acceptTask({
      ...reviewedSnapshot(app, task.id),
      ...reviewerInput,
      reason: "Verified the release checks.",
    });
    app.acceptTask({
      ...reviewedSnapshot(app, task.id),
      ...reviewerInput,
      decision: "rejected",
      reason: "The smoke test is missing.",
      reportText: "The smoke test is missing from the evidence.",
    });

    expect(app.getSubtaskVerificationHistory(child.id)).toMatchObject([
      { decision: "accepted", source: "reviewer" },
      {
        decision: "rejected",
        source: "reviewer",
        reason: "The smoke test is missing.",
        reportText: "The smoke test is missing from the evidence.",
      },
    ]);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskVerification: {
        decision: "rejected",
        reportText: "The smoke test is missing from the evidence.",
      },
      subtasks: [
        {
          reportId: report.id,
          verificationState: "rejected",
        },
      ],
    });
  });

  test("reviewer Task decisions require at least one active child", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "No active work",
      projectId: project.id,
    });
    const child = app.createSubtask({
      name: "Archived child",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the child.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    app.archiveSubtask(child.id, "wont_do");
    app.assignReviewer({
      assignedBy: "kevin",
      reviewer: {
        id: "bitsy-credential",
        machineId: "bitsy-reviewer",
        reviewerName: "Bitsy",
      },
      targetId: task.id,
      targetType: "task",
    });

    expect(() =>
      app.acceptTask({
        ...reviewedSnapshot(app, task.id),
        decision: "accepted",
        reason: "Review the Task.",
        reportText: "Reviewed the Task.",
        reviewerCredentialId: "bitsy-credential",
        source: "reviewer",
        taskId: task.id,
        verifier: "Bitsy",
      }),
    ).toThrow("Reviewer Task decisions require at least one active Subtask");
    expect(app.getSubtaskVerificationHistory(child.id)).toEqual([]);
  });

  test("reviewer Task acceptance rejects a same-state report created after the pinned snapshot", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Pinned review",
      projectId: project.id,
    });
    const child = app.createSubtask({
      name: "Current report",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the current build.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    const snapshot = reviewedSnapshot(app, task.id);
    app.assignReviewer({
      assignedBy: "kevin",
      reviewer: {
        id: "bitsy-credential",
        machineId: "bitsy-reviewer",
        reviewerName: "Bitsy",
      },
      targetId: task.id,
      targetType: "task",
    });
    const revisionBeforeNewReport = app.getTaskStatus(task.id).subtasks[0]!
      .revision;
    app.reportSubtaskStatus({
      reason: "Check the current build.",
      reporter: "claude",
      reportedState: "complete",
      subtaskId: child.id,
    });
    expect(app.getTaskStatus(task.id).subtasks[0]!.revision).toBe(
      revisionBeforeNewReport,
    );

    expect(() =>
      app.acceptTask({
        ...snapshot,
        decision: "accepted",
        reason: "Review the pinned report.",
        reportText: "Reviewed the pinned report.",
        reviewerCredentialId: "bitsy-credential",
        source: "reviewer",
        taskId: task.id,
        verifier: "Bitsy",
      }),
    ).toThrow("changed its current report or verification after review");
    expect(app.getSubtaskVerificationHistory(child.id)).toEqual([]);
  });

  test("a same-state verification invalidates an older direct reviewer revision", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Review version",
      projectId: project.id,
    });
    const child = app.createSubtask({
      name: "Complete report",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      reason: "Check the release.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    app.assignReviewer({
      assignedBy: "kevin",
      reviewer: {
        id: "bitsy-credential",
        machineId: "bitsy-reviewer",
        reviewerName: "Bitsy",
      },
      targetId: child.id,
      targetType: "subtask",
    });
    const reviewedRevision = app.getTaskStatus(task.id).subtasks[0]!.revision;
    app.verifyStatusReport({
      decision: "deferred",
      reason: "The video needs another check.",
      reportId: report.id,
      verifier: "kevin",
    });

    expect(app.getTaskStatus(task.id).subtasks[0]!.revision).toBeGreaterThan(
      reviewedRevision,
    );
    expect(() =>
      app.verifyStatusReport({
        decision: "accepted",
        expectedRevision: reviewedRevision,
        reportId: report.id,
        reportText: "The earlier review snapshot is still current.",
        reviewerCredentialId: "bitsy-credential",
        source: "reviewer",
        verifier: "Bitsy",
      }),
    ).toThrow("current revision");
    expect(app.getSubtaskVerificationHistory(child.id)).toMatchObject([
      { decision: "deferred", verifier: "kevin" },
    ]);
  });

  test("persists task-wide acceptance across application instances", () => {
    const databasePath = `/tmp/factory-task-acceptance-${crypto.randomUUID()}.sqlite`;
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Ship the release",
      projectId: project.id,
    });
    const child = app.createSubtask({
      name: "Verify release",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the published build.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: child.id,
    });
    accept(app, task.id);

    const reopened = createFactoryApplication({ databasePath });
    expect(reopened.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      taskState: "completed",
      subtasks: [expect.objectContaining({ verificationState: "accepted" })],
    });
    app.close();
    reopened.close();
  });
});
