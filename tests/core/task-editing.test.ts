import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("task editing", () => {
  test("updates a task title and description without changing its planning metadata", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-29T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      acceptanceCriteria: ["The edit is persisted"],
      branchName: "feature/task-editing",
      dependencies: ["Existing task"],
      name: "Original task title",
      objective: "Original task description",
      owner: "kevin",
      priority: "high",
      projectId: project.id,
      repositoryLinks: ["https://github.com/app-press/factory"],
    });

    const updatedTask = app.updateTask({
      acceptanceCriteria: [
        "The updated acceptance criterion",
        "The second acceptance criterion",
      ],
      name: "Updated task title",
      objective: "Updated task description",
      taskId: task.id,
    });

    expect(updatedTask).toMatchObject({
      acceptanceCriteria: [
        "The updated acceptance criterion",
        "The second acceptance criterion",
      ],
      branchName: "feature/task-editing",
      dependencies: ["Existing task"],
      name: "Updated task title",
      objective: "Updated task description",
      owner: "kevin",
      priority: "high",
      projectId: project.id,
      repositoryLinks: ["https://github.com/app-press/factory"],
    });
    expect(app.getTaskDetail(task.id)).toMatchObject({
      name: "Updated task title",
      objective: "Updated task description",
    });
  });

  test("updates a subtask title and description without changing its report history", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-29T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1", "subtask-1", "report-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Task title",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      description: "Original subtask description",
      name: "Original subtask title",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      evidence: "The original description was checked.",
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: subtask.id,
    });

    const updatedSubtask = app.updateSubtask({
      description: "Updated subtask description",
      name: "Updated subtask title",
      subtaskId: subtask.id,
    });

    expect(updatedSubtask).toMatchObject({
      description: "Updated subtask description",
      id: subtask.id,
      name: "Updated subtask title",
      taskId: task.id,
    });
    expect(app.getSubtaskReportHistory(subtask.id)).toEqual([report]);
  });
});
