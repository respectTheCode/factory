import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => new Date("2026-08-29T12:00:00.000Z"),
    idGenerator: () => `id-${++nextId}`,
  });
}

describe("task work state", () => {
  test("allows a task to move in either direction and requires reasons for blocked and awaiting states", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Ship the work-state model",
      projectId: project.id,
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "planned" });
    app.setTaskWorkState({ taskId: task.id, workState: "active" });
    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "active" });
    app.setTaskWorkState({ taskId: task.id, workState: "planned" });
    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "planned" });
    app.setTaskWorkState({
      reason: "Waiting for the API contract to settle.",
      taskId: task.id,
      workState: "blocked",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      stateReason: "Waiting for the API contract to settle.",
      taskState: "blocked",
    });
    expect(() =>
      app.setTaskWorkState({
        taskId: task.id,
        workState: "awaiting_verification",
      }),
    ).toThrow("reason");
    app.setTaskWorkState({
      reason: "Check the mobile flow in the PWA.",
      taskId: task.id,
      workState: "awaiting_verification",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      stateReason: "Check the mobile flow in the PWA.",
      taskState: "awaiting_verification",
    });
  });

  test("promotes a parent on a higher child transition without overriding a later manual hold", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Build the feature",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Implement it",
      taskId: task.id,
    });

    app.setTaskWorkState({ taskId: task.id, workState: "planned" });
    app.reportSubtaskStatus({
      reason: "The implementation is underway.",
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "active" });

    app.setTaskWorkState({ taskId: task.id, workState: "planned" });
    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "planned" });
    app.reportSubtaskStatus({
      reason: "The implementation is still underway.",
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "planned" });
  });

  test("keeps a manual task state when every subtask is accepted", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Reopen the completed work",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Finish the work",
      taskId: task.id,
    });

    const report = app.reportSubtaskStatus({
      reason: "The implementation is ready for verification.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: report.id,
      verifier: "kevin",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      taskState: "completed",
    });

    app.setTaskWorkState({ taskId: task.id, workState: "planned" });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      taskState: "planned",
    });
    app.setTaskWorkState({ taskId: task.id, workState: "active" });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      taskState: "active",
    });
  });

  test("recomputes a rollup parent downward when a child reopens", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Roll up work",
      projectId: project.id,
    });
    const subtask = app.createSubtask({ name: "Child work", taskId: task.id });

    const completeReport = app.reportSubtaskStatus({
      reason: "The child is ready for verification.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskState: "awaiting_verification",
      stateReason: "The child is ready for verification.",
    });

    app.reportSubtaskStatus({
      reason: "The child needs another implementation pass.",
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskState: "active",
    });
    expect(app.getTaskStatus(task.id)).not.toHaveProperty("stateReason");

    app.reportSubtaskStatus({
      reason: "The child is ready for verification again.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: completeReport.id,
      verifier: "kevin",
    });
  });

  test("reopens an auto-completed parent when a newer child report is active", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Auto complete work",
      projectId: project.id,
    });
    const subtask = app.createSubtask({ name: "Child work", taskId: task.id });

    const report = app.reportSubtaskStatus({
      reason: "The child is complete.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: report.id,
      verifier: "kevin",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      taskState: "completed",
    });

    app.reportSubtaskStatus({
      reason: "The child has a follow-up fix.",
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "active",
    });
  });

  test("does not demote a manual blocked or higher parent state", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Hold the work",
      projectId: project.id,
    });
    const subtask = app.createSubtask({ name: "Child work", taskId: task.id });

    app.setTaskWorkState({
      reason: "Waiting for a product decision.",
      taskId: task.id,
      workState: "blocked",
    });
    app.reportSubtaskStatus({
      reason: "The child is still planned.",
      reportedState: "not_started",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      stateReason: "Waiting for a product decision.",
      taskState: "blocked",
    });

    app.setTaskWorkState({ taskId: task.id, workState: "active" });
    app.reportSubtaskStatus({
      reason: "The child is back to planning.",
      reportedState: "not_started",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "active" });
  });
});

describe("subtask effective work state", () => {
  test("supports backlog reports and requires actionable reasons for blocked and awaiting verification", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Plan the feature",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Investigate the edge case",
      taskId: task.id,
    });

    app.reportSubtaskStatus({
      reportedState: "backlog",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      subtasks: [{ reportedState: "backlog", effectiveState: "backlog" }],
    });

    expect(() =>
      app.reportSubtaskStatus({
        reportedState: "blocked",
        reporter: "codex",
        subtaskId: subtask.id,
      }),
    ).toThrow("reason");
    app.reportSubtaskStatus({
      reason: "The fixture is missing the production account.",
      reportedState: "blocked",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      subtasks: [
        {
          effectiveState: "blocked",
          reason: "The fixture is missing the production account.",
        },
      ],
      taskState: "blocked",
    });

    expect(() =>
      app.reportSubtaskStatus({
        reportedState: "complete",
        reporter: "codex",
        subtaskId: subtask.id,
      }),
    ).toThrow("reason");
    const completeReport = app.reportSubtaskStatus({
      reason: "Check the result against the acceptance criteria.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      subtasks: [
        {
          effectiveState: "awaiting_verification",
          reason: "Check the result against the acceptance criteria.",
        },
      ],
      taskState: "awaiting_verification",
    });

    expect(() =>
      app.verifyStatusReport({
        decision: "deferred",
        reportId: completeReport.id,
        verifier: "kevin",
      }),
    ).toThrow("reason");
    app.verifyStatusReport({
      decision: "deferred",
      reason: "The acceptance evidence needs one more browser check.",
      reportId: completeReport.id,
      verifier: "kevin",
    });
    expect(app.getTaskStatus(task.id)).toMatchObject({
      subtasks: [
        {
          effectiveState: "blocked",
          reason: "The acceptance evidence needs one more browser check.",
          verificationState: "deferred",
        },
      ],
      taskState: "blocked",
    });
  });
});

describe("state-scoped ordering", () => {
  test("reorders tasks and subtasks within their effective state and moves transitions to the destination tail", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });
    const first = app.createTask({ name: "First", projectId: project.id });
    const second = app.createTask({ name: "Second", projectId: project.id });
    const third = app.createTask({ name: "Third", projectId: project.id });

    app.reorderTasks({
      orderedTaskIds: [third.id, first.id, second.id],
      projectId: project.id,
      workState: "planned",
    });
    expect(
      app.getProjectHierarchy(project.id).tasks.map(({ id }) => id),
    ).toEqual([third.id, first.id, second.id]);

    app.setTaskWorkState({ taskId: first.id, workState: "active" });
    expect(
      app.getProjectHierarchy(project.id).tasks.map(({ id }) => id),
    ).toEqual([first.id, third.id, second.id]);

    const subtaskA = app.createSubtask({ name: "A", taskId: second.id });
    const subtaskB = app.createSubtask({ name: "B", taskId: second.id });
    app.reorderSubtasks({
      orderedSubtaskIds: [subtaskB.id, subtaskA.id],
      taskId: second.id,
      workState: "planned",
    });
    expect(
      app.getTaskStatus(second.id).subtasks.map(({ subtaskId }) => subtaskId),
    ).toEqual([subtaskB.id, subtaskA.id]);

    app.reportSubtaskStatus({
      reason: "Start the investigation.",
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: subtaskB.id,
    });
    expect(
      app.getTaskStatus(second.id).subtasks.map(({ subtaskId }) => subtaskId),
    ).toEqual([subtaskB.id, subtaskA.id]);
  });

  test("rejects reorder requests that mix parents or effective states", () => {
    const app = createApplication();
    const firstProject = app.createProject({ name: "First" });
    const secondProject = app.createProject({ name: "Second" });
    const firstTask = app.createTask({
      name: "First task",
      projectId: firstProject.id,
    });
    const secondTask = app.createTask({
      name: "Second task",
      projectId: secondProject.id,
    });

    expect(() =>
      app.reorderTasks({
        orderedTaskIds: [firstTask.id, secondTask.id],
        projectId: firstProject.id,
        workState: "planned",
      }),
    ).toThrow("same project");
    app.setTaskWorkState({ taskId: firstTask.id, workState: "active" });
    expect(() =>
      app.reorderTasks({
        orderedTaskIds: [firstTask.id],
        projectId: firstProject.id,
        workState: "planned",
      }),
    ).toThrow("state");
  });
});
