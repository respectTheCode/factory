import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  checkFactoryDatabase,
  createFactoryApplication,
} from "../../src/application";

describe("task and subtask removal", () => {
  test("removes a task and all of its child records while preserving siblings", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-task-removal-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory V1" });
      const remainingTask = app.createTask({
        name: "Keep this task",
        projectId: project.id,
      });
      const removedTask = app.createTask({
        name: "Delete this task",
        projectId: project.id,
      });
      const removedSubtask = app.createSubtask({
        name: "Delete this subtask too",
        taskId: removedTask.id,
      });
      const removedReport = app.reportSubtaskStatus({
        evidence: "This record should be deleted with its subtask.",
        reporter: "codex",
        reportedState: "complete",
        subtaskId: removedSubtask.id,
      });
      app.verifyStatusReport({
        decision: "accepted",
        reportId: removedReport.id,
        verifier: "kevin",
      });
      app.addTaskTrackerLink({
        taskId: removedTask.id,
        stableId: "OLD-123",
        system: "linear",
        url: "https://linear.app/example/issue/OLD-123",
      });

      app.removeTask(removedTask.id);

      expect(app.getProjectHierarchy(project.id)).toMatchObject({
        tasks: [{ id: remainingTask.id, name: remainingTask.name }],
      });
      expect(() => app.getTaskStatus(removedTask.id)).toThrow(
        `Task ${removedTask.id} does not exist.`,
      );
      expect(() => app.getTaskDetail(removedTask.id)).toThrow(
        `Task ${removedTask.id} does not exist.`,
      );
      expect(() => app.getSubtaskReportHistory(removedSubtask.id)).toThrow(
        `Subtask ${removedSubtask.id} does not exist.`,
      );
      expect(() =>
        app.verifyStatusReport({
          decision: "accepted",
          reportId: removedReport.id,
          verifier: "kevin",
        }),
      ).toThrow(`Status Report ${removedReport.id} does not exist.`);
      expect(checkFactoryDatabase({ databasePath }).counts).toEqual({
        projects: 1,
        tasks: 1,
        subtasks: 0,
        statusReports: 0,
        verifications: 0,
        trackerLinks: 0,
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("removes one subtask and its history while preserving sibling subtasks", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-subtask-removal-"),
    );
    const app = createFactoryApplication({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
    });
    try {
      const project = app.createProject({ name: "Factory V1" });
      const task = app.createTask({
        name: "Keep the task",
        projectId: project.id,
      });
      const remainingSubtask = app.createSubtask({
        name: "Keep this subtask",
        taskId: task.id,
      });
      const removedSubtask = app.createSubtask({
        name: "Delete this subtask",
        taskId: task.id,
      });
      const removedReport = app.reportSubtaskStatus({
        evidence: "Remove this history.",
        reporter: "codex",
        reportedState: "in_progress",
        subtaskId: removedSubtask.id,
      });
      app.verifyStatusReport({
        decision: "deferred",
        reportId: removedReport.id,
        verifier: "kevin",
      });

      app.removeSubtask(removedSubtask.id);

      expect(app.getProjectHierarchy(project.id)).toMatchObject({
        tasks: [
          {
            subtasks: [
              { id: remainingSubtask.id, name: remainingSubtask.name },
            ],
          },
        ],
      });
      expect(() => app.getSubtaskReportHistory(removedSubtask.id)).toThrow(
        `Subtask ${removedSubtask.id} does not exist.`,
      );
      expect(() =>
        app.verifyStatusReport({
          decision: "accepted",
          reportId: removedReport.id,
          verifier: "kevin",
        }),
      ).toThrow(`Status Report ${removedReport.id} does not exist.`);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
