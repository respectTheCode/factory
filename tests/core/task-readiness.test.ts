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

describe("whole-task readiness", () => {
  test("keeps legacy report reasons missing without blocking sibling updates", () => {
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
    expect(app.getTaskStatus("t").taskState).toBe("active");
    app.reportSubtaskStatus({
      subtaskId: "b",
      reportedState: "complete",
      reporter: "codex",
      reason: "Review second child.",
    });
    expect(app.getTaskStatus("t")).toMatchObject({
      taskState: "awaiting_verification",
      taskCompleted: false,
    });
    expect(app.getTaskStatus("t").stateReason).toContain("historical report");
    expect(app.getSubtaskReportHistory("a")[0]).not.toHaveProperty("reason");
    state.tasks[0]!.stateReason = "Check the legacy task against the release.";
    const legacy = new FactoryApplication({
      state,
      clock: () => now,
      idGenerator: () => "legacy-new",
    });
    expect(legacy.getTaskStatus("t").stateReason).toBe(
      "Check the legacy task against the release.",
    );
  });

  test("scope changes move automatic parents to the destination tail and preserve holds", () => {
    const { app, task, first, second, complete } = fixture();
    const planned = app.createTask({
      projectId: task.projectId,
      name: "Planned peer",
    });
    complete(first.id);
    complete(second.id);
    app.archiveSubtask(first.id, "released");
    app.archiveSubtask(second.id, "released");
    expect(app.getTaskStatus(task.id).taskState).toBe("planned");
    expect(app.getTaskDetail(task.id).sortOrder).toBeGreaterThan(
      app.getTaskDetail(planned.id).sortOrder!,
    );
    app.restoreSubtask(first.id);
    expect(app.getTaskStatus(task.id).taskState).toBe("awaiting_verification");
    app.removeSubtask(first.id);
    expect(app.getTaskStatus(task.id).taskState).toBe("planned");
    app.setTaskWorkState({
      taskId: task.id,
      workState: "blocked",
      reason: "Wait for owner scope decision.",
    });
    app.restoreSubtask(second.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskState: "blocked",
      stateReason: "Wait for owner scope decision.",
    });
  });

  test("restoring a parent reconciles child changes made while archived", () => {
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
    expect(app.getTaskStatus(task.id).taskState).toBe("active");
    expect(app.getTaskDetail(task.id).sortOrder).toBeGreaterThan(
      app.getTaskDetail(peer.id).sortOrder!,
    );
  });

  test("waits for every non-archived child before requesting verification", () => {
    const { app, task, first, second, complete } = fixture();
    const firstReport = complete(first.id);
    expect(app.getTaskStatus(task.id).taskState).toBe("active");
    app.verifyStatusReport({
      reportId: firstReport.id,
      decision: "accepted",
      verifier: "kevin",
    });
    expect(app.getTaskStatus(task.id).taskState).toBe("active");
    const secondReport = complete(second.id);
    expect(app.getTaskStatus(task.id).taskState).toBe("awaiting_verification");
    app.verifyStatusReport({
      reportId: secondReport.id,
      decision: "accepted",
      verifier: "kevin",
    });
    expect(app.getTaskStatus(task.id).taskState).toBe("completed");
  });

  test("adding and restoring unfinished scope removes automatic readiness", () => {
    const { app, task, first, second, complete } = fixture();
    complete(first.id);
    app.archiveSubtask(second.id, "wont_do");
    expect(app.getTaskStatus(task.id).taskState).toBe("awaiting_verification");
    app.restoreSubtask(second.id);
    expect(app.getTaskStatus(task.id).taskState).toBe("active");
    complete(second.id);
    app.createSubtask({ taskId: task.id, name: "New scope" });
    expect(app.getTaskStatus(task.id).taskState).toBe("active");
  });

  test("explicitly resumes child status without creating reports or acceptance", () => {
    const { app, task, first, second, complete } = fixture();
    complete(first.id);
    complete(second.id);
    app.setTaskWorkState({ taskId: task.id, workState: "active" });
    const before = app.getTaskStatus(task.id);
    app.resumeTaskRollup(task.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskState: "awaiting_verification",
      taskCompleted: false,
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
      taskState: "completed",
      taskCompleted: true,
    });
  });
});
