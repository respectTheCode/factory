import { describe, expect, test } from "bun:test";

import { FactoryApplication, type FactoryState } from "../../src/application";

describe("dashboard snapshot", () => {
  test("materializes all UI state from one persistence refresh", () => {
    let nextId = 0;
    let refreshCount = 0;
    let persistedState: FactoryState = {
      projects: [],
      statusReports: [],
      subtasks: [],
      tasks: [],
      verifications: [],
    };
    const app = new FactoryApplication({
      clock: () => new Date("2026-09-10T12:00:00.000Z"),
      idGenerator: () => `id-${++nextId}`,
      persist: (state) => {
        persistedState = state;
      },
      refresh: () => {
        refreshCount += 1;
        return persistedState;
      },
      state: persistedState,
    });
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Update the UI",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Apply returned state",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "The returned dashboard state is authoritative.",
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: subtask.id,
    });

    refreshCount = 0;
    const snapshot = app.getDashboardSnapshot(project.id);

    expect(refreshCount).toBe(1);
    expect(snapshot).toMatchObject({
      attention: [expect.objectContaining({ taskId: task.id })],
      portfolioStatus: {
        totalTasks: 1,
      },
      projectDetail: {
        id: project.id,
        tasks: [expect.objectContaining({ id: task.id })],
      },
      projects: [{ id: project.id, name: "Factory" }],
      taskDetails: [expect.objectContaining({ id: task.id })],
      taskStatuses: [
        expect.objectContaining({
          taskId: task.id,
          taskState: "active",
          subtasks: [expect.objectContaining({ effectiveState: "active" })],
        }),
      ],
    });
  });
});
