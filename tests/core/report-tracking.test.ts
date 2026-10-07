import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("bounded report tracking", () => {
  test("keeps earlier accepted reports unchanged and projects current report claims", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-10-06T12:00:00.000Z"),
      idGenerator: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const project = app.createProject({ name: "Report tracking" });
    const task = app.createTask({
      name: "Ship reports",
      projectId: project.id,
    });
    const first = app.createSubtask({ name: "First item", taskId: task.id });
    const waiting = app.createSubtask({
      name: "Waiting item",
      taskId: task.id,
    });

    const accepted = app.reportSubtaskStatus({
      evidence: "Initial immutable report evidence.",
      reason: "Ready for human review.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: first.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: accepted.id,
      verifier: "kevin",
    });
    const originalReport = structuredClone(accepted);

    const handoffInput = {
      nextAction: "Review the linked CI run.",
      nextOwner: "Release engineer",
      nextOwnerKind: "human" as const,
      waitingOnSubtaskIds: [waiting.simpleId!, waiting.id, waiting.simpleId!],
    };
    const artifactInput = [
      {
        kind: "test" as const,
        label: "Focused report tests",
        testedRevision: " ABCDEF1234567 ",
        url: "https://ci.example.test/runs/42",
      },
    ];
    const current = app.reportSubtaskStatus({
      artifacts: artifactInput,
      evidence: "Current report evidence.",
      handoff: handoffInput,
      machineId: "codex-workstation",
      reportedState: "in_progress",
      reporter: "codex",
      sessionRef: {
        externalThreadId: "thread-42",
        provider: "t3",
        sourceId: "legacy",
      },
      subtaskId: first.id,
      testedRevision: " ABCDEF1234567 ",
    });

    handoffInput.waitingOnSubtaskIds.splice(
      0,
      handoffInput.waitingOnSubtaskIds.length,
      "ST-999",
    );
    artifactInput[0]!.label = "caller mutation";
    expect(accepted).toEqual(originalReport);
    expect(app.getSubtaskReportHistory(first.id)).toEqual([
      originalReport,
      current,
    ]);
    expect(current).toMatchObject({
      artifacts: [
        {
          kind: "test",
          label: "Focused report tests",
          testedRevision: "abcdef1234567",
        },
      ],
      handoff: {
        nextAction: "Review the linked CI run.",
        nextOwner: "Release engineer",
        nextOwnerKind: "human",
        waitingOnSubtaskIds: [waiting.id],
      },
      testedRevision: "abcdef1234567",
    });
    expect(app.getSubtaskVerificationHistory(first.id)).toMatchObject([
      { decision: "accepted", reportId: accepted.id },
    ]);

    app.updateSubtask({
      evidence: "Edited dashboard evidence.",
      subtaskId: first.id,
    });
    const status = app.getTaskStatus(task.id);
    expect(status.subtasks[0]).toMatchObject({
      effectiveState: "active",
      evidence: "Edited dashboard evidence.",
      handoff: current.handoff,
      machineId: "codex-workstation",
      reportCreatedAt: new Date("2026-10-06T12:00:00.000Z"),
      reportEvidence: "Current report evidence.",
      reporter: "codex",
      sessionRef: {
        externalThreadId: "thread-42",
        provider: "t3",
        sourceId: "legacy",
      },
      testedRevision: "abcdef1234567",
    });
    expect(status.taskState).toBe("active");
    expect(status.taskCompleted).toBe(false);
    expect(app.getDashboardSnapshot(project.id).taskStatuses).toEqual([status]);

    const unreported = app.createTask({
      name: "No fabricated report fields",
      projectId: project.id,
    });
    const unreportedSubtask = app.createSubtask({
      name: "Not reported",
      taskId: unreported.id,
    });
    expect(app.getTaskStatus(unreported.id).subtasks[0]).not.toHaveProperty(
      "reportCreatedAt",
    );
    expect(app.getTaskStatus(unreported.id).subtasks[0]).not.toHaveProperty(
      "handoff",
    );
    expect(unreportedSubtask.id).toBeTruthy();
  });

  test("rejects invalid dependencies and tracking claims before changing evidence", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-10-06T12:00:00.000Z"),
      idGenerator: (() => {
        let next = 0;
        return () => `id-${++next}`;
      })(),
    });
    const firstProject = app.createProject({ name: "First" });
    const firstTask = app.createTask({
      name: "First task",
      projectId: firstProject.id,
    });
    const target = app.createSubtask({ name: "Target", taskId: firstTask.id });
    const sibling = app.createSubtask({
      name: "Sibling",
      taskId: firstTask.id,
    });
    const otherProject = app.createProject({ name: "Other" });
    const otherTask = app.createTask({
      name: "Other task",
      projectId: otherProject.id,
    });
    const foreign = app.createSubtask({
      name: "Foreign",
      taskId: otherTask.id,
    });
    const validHandoff = {
      nextAction: "Continue implementation.",
      nextOwner: "Codex",
      nextOwnerKind: "agent" as const,
    };
    const invalidWaits = [target.simpleId!, foreign.simpleId!, "ST-999"];

    for (const waitingId of invalidWaits) {
      expect(() =>
        app.reportSubtaskStatus({
          evidence: "This must not be saved.",
          handoff: { ...validHandoff, waitingOnSubtaskIds: [waitingId] },
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: target.id,
        }),
      ).toThrow();
      expect(app.getSubtaskReportHistory(target.id)).toEqual([]);
      expect(app.getSubtaskDetail(target.id)).not.toHaveProperty("evidence");
    }

    for (const tracking of [
      { testedRevision: "not-a-revision" },
      {
        artifacts: [
          {
            kind: "preview",
            label: "Unsafe URL",
            url: "javascript:alert(1)",
          },
        ],
      },
      {
        artifacts: [
          {
            kind: "review",
            label: "Credential URL",
            url: "https://user:secret@example.test/review",
          },
        ],
      },
    ]) {
      expect(() =>
        app.reportSubtaskStatus({
          evidence: "This must not be saved either.",
          ...tracking,
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: target.id,
        } as Parameters<FactoryApplication["reportSubtaskStatus"]>[0]),
      ).toThrow();
      expect(app.getSubtaskReportHistory(target.id)).toEqual([]);
      expect(app.getSubtaskDetail(target.id)).not.toHaveProperty("evidence");
    }

    expect(sibling.id).toBeTruthy();
  });
});
