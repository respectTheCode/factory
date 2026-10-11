import { describe, expect, test } from "bun:test";
import { FactoryApplication, type FactoryState } from "../../src/application";

function fixture() {
  let nextId = 0;
  const app = new FactoryApplication({
    clock: () => new Date("2026-09-04T12:00:00Z"),
    idGenerator: () => `id-${++nextId}`,
  });
  const project = app.createProject({ name: "Readiness" });
  const task = app.createTask({
    name: "Deliver both slices",
    projectId: project.id,
  });
  const first = app.createSubtask({ taskId: task.id, name: "First slice" });
  const second = app.createSubtask({ taskId: task.id, name: "Second slice" });
  const complete = (subtaskId: string) =>
    app.reportSubtaskStatus({
      subtaskId,
      reportedState: "complete",
      reporter: "codex",
      reason: "Check the delivered slice.",
    });
  return { app, task, first, second, complete };
}

describe("Task finish readiness", () => {
  test("legacy Step-derived review state does not imply Task completion", () => {
    const now = new Date("2026-09-04T12:00:00Z");
    const state: FactoryState = {
      projects: [{ id: "p", name: "Legacy", createdAt: now }],
      tasks: [
        {
          id: "t",
          projectId: "p",
          name: "Legacy task",
          createdAt: now,
          workState: "awaiting_verification",
          workStateSource: "rollup",
          acceptanceCriteria: [],
          dependencies: [],
          repositoryLinks: [],
          priority: "medium",
        },
      ],
      subtasks: [
        { id: "a", taskId: "t", name: "Legacy child", createdAt: now },
        { id: "b", taskId: "t", name: "Remaining child", createdAt: now },
      ],
      statusReports: [
        {
          id: "old",
          subtaskId: "a",
          reportedState: "complete",
          reporter: "codex",
          createdAt: now,
        },
      ],
      verifications: [],
      trackerLinks: [],
    };
    const app = new FactoryApplication({
      state,
      clock: () => now,
      idGenerator: () => "new",
    });

    expect(app.getTaskStatus("t")).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });
    app.reportSubtaskStatus({
      subtaskId: "b",
      reportedState: "complete",
      reporter: "codex",
      reason: "Review second child.",
    });
    expect(app.getTaskStatus("t")).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });
    expect(app.getTaskStatus("t").stateReason).toBeUndefined();
    expect(app.getSubtaskReportHistory("a")[0]).not.toHaveProperty("reason");
  });

  test("Step scope changes update automatic ordering while manual holds persist", () => {
    const { app, task, first, second, complete } = fixture();
    const planned = app.createTask({
      projectId: task.projectId,
      name: "Planned peer",
    });
    app.reportSubtaskStatus({
      subtaskId: first.id,
      reportedState: "in_progress",
      reporter: "codex",
    });
    complete(first.id);
    complete(second.id);
    app.archiveSubtask(first.id, "released");
    app.archiveSubtask(second.id, "released");
    expect(app.getTaskStatus(task.id).taskState).toBe("active");
    expect(app.getTaskDetail(task.id).sortOrder).toBeLessThan(
      app.getTaskDetail(planned.id).sortOrder!,
    );

    app.restoreSubtask(first.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "active",
    });
    app.removeSubtask(first.id);
    expect(app.getTaskStatus(task.id).taskState).toBe("active");
    app.setTaskWorkState({
      taskId: task.id,
      workState: "blocked",
      reason: "Wait for owner scope decision.",
    });
    app.restoreSubtask(second.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      stateReason: "Wait for owner scope decision.",
      taskState: "blocked",
    });
  });

  test("restoring a parent reconciles Step changes without finishing it", () => {
    const { app, task, first, second, complete } = fixture();
    complete(first.id);
    complete(second.id);
    const peer = app.createTask({
      projectId: task.projectId,
      name: "Active peer",
    });
    app.setTaskWorkState({ taskId: peer.id, workState: "active" });
    app.archiveTask(task.id, "released");
    app.reportSubtaskStatus({
      subtaskId: first.id,
      reportedState: "in_progress",
      reporter: "codex",
    });
    app.restoreTask(task.id);
    app.restoreSubtask(first.id);
    app.restoreSubtask(second.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "active",
    });
    expect(app.getTaskDetail(task.id).sortOrder).toBeGreaterThan(
      app.getTaskDetail(peer.id).sortOrder!,
    );
  });

  test("Step completion and acceptance leave Task finish to its own report", () => {
    const { app, task, first, second, complete } = fixture();
    const firstReport = complete(first.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });
    app.verifyStatusReport({
      reportId: firstReport.id,
      decision: "accepted",
      verifier: "kevin",
    });

    const secondReport = complete(second.id);
    app.verifyStatusReport({
      reportId: secondReport.id,
      decision: "accepted",
      verifier: "kevin",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });

    const status = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: status.workflowEpoch,
      reportedState: "finished",
      reporter: "codex",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      taskState: "completed",
    });
  });

  test("adding or restoring Steps does not create Task finish readiness", () => {
    const { app, task, first, second, complete } = fixture();
    complete(first.id);
    app.archiveSubtask(second.id, "wont_do");
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });
    app.restoreSubtask(second.id);
    expect(app.getTaskStatus(task.id).taskState).toBe("planned");
    complete(second.id);
    app.createSubtask({ taskId: task.id, name: "New scope" });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });
  });

  test("resuming the automatic rollup never accepts or finishes Steps", () => {
    const { app, task, first, second, complete } = fixture();
    complete(first.id);
    complete(second.id);
    app.setTaskWorkState({ taskId: task.id, workState: "active" });
    const before = app.getTaskStatus(task.id);
    app.resumeTaskRollup(task.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "active",
      subtasks: before.subtasks,
    });
    for (const subtask of before.subtasks) {
      app.verifyStatusReport({
        reportId: subtask.reportId!,
        decision: "accepted",
        verifier: "kevin",
      });
    }
    app.setTaskWorkState({ taskId: task.id, workState: "planned" });
    app.resumeTaskRollup(task.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });
  });

  test("the first Doing Step promotes a Planned Task; Blocked Steps do not", () => {
    const { app, task, first } = fixture();

    app.reportSubtaskStatus({
      subtaskId: first.id,
      reportedState: "blocked",
      reporter: "codex",
      reason: "Waiting on the Step dependency.",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "planned",
    });

    app.reportSubtaskStatus({
      subtaskId: first.id,
      reportedState: "in_progress",
      reporter: "codex",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "active",
    });
  });
});
