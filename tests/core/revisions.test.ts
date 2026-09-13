import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  FactoryConflictError,
  createFactoryApplication,
  type FactoryState,
} from "../../src/application";

describe("Task and Subtask revisions", () => {
  test("increments revisions and rejects stale edits", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-revisions-"));
    const databasePath = join(directory, "factory.sqlite");

    try {
      const application = createFactoryApplication({ databasePath });
      const project = application.createProject({ name: "Factory" });
      const task = application.createTask({
        name: "Task",
        projectId: project.id,
      });
      const subtask = application.createSubtask({
        name: "Subtask",
        taskId: task.id,
      });

      expect(application.getTaskDetail(task.id).revision).toBe(1);
      expect(application.getSubtaskDetail(subtask.id).revision).toBe(1);

      const updatedTask = application.updateTask({
        expectedRevision: 1,
        name: "Updated task",
        taskId: task.id,
      });
      expect(updatedTask.revision).toBe(2);
      expect(() =>
        application.updateTask({
          expectedRevision: 1,
          name: "Stale task edit",
          taskId: task.id,
        }),
      ).toThrow(FactoryConflictError);
      expect(() =>
        application.updateSubtask({
          expectedRevision: 1,
          name: "Stale subtask edit",
          subtaskId: subtask.id,
        }),
      ).not.toThrow();
      expect(application.getSubtaskDetail(subtask.id).revision).toBe(2);
      expect(() =>
        application.updateSubtask({
          expectedRevision: 1,
          name: "Another stale subtask edit",
          subtaskId: subtask.id,
        }),
      ).toThrow(FactoryConflictError);

      application.reportSubtaskStatus({
        reportedState: "in_progress",
        reporter: "codex",
        subtaskId: subtask.id,
      });
      expect(application.getSubtaskDetail(subtask.id).revision).toBe(3);
      expect(application.getTaskDetail(task.id).revision).toBe(3);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("hydrates older snapshots with revision one", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-legacy-revision-"));
    const databasePath = join(directory, "factory.sqlite");
    const now = "2026-09-13T12:00:00.000Z";
    const legacyState: FactoryState = {
      projects: [
        { createdAt: new Date(now), id: "project-1", name: "Factory" },
      ],
      statusReports: [],
      subtasks: [
        {
          createdAt: new Date(now),
          id: "subtask-1",
          name: "Legacy subtask",
          taskId: "task-1",
        },
      ],
      tasks: [
        {
          acceptanceCriteria: [],
          createdAt: new Date(now),
          dependencies: [],
          id: "task-1",
          name: "Legacy task",
          projectId: "project-1",
          repositoryLinks: [],
        },
      ],
      verifications: [],
    };

    const database = new Database(databasePath);
    database.exec(
      "CREATE TABLE factory_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)",
    );
    database
      .query("INSERT INTO factory_state (id, state) VALUES (1, $state)")
      .run({
        $state: JSON.stringify({
          ...legacyState,
          projects: legacyState.projects.map((project) => ({
            ...project,
            createdAt: project.createdAt.toISOString(),
          })),
          subtasks: legacyState.subtasks.map((subtask) => ({
            ...subtask,
            createdAt: subtask.createdAt.toISOString(),
          })),
          tasks: legacyState.tasks.map((task) => ({
            ...task,
            createdAt: task.createdAt.toISOString(),
          })),
        }),
      });
    database.close();

    try {
      const application = createFactoryApplication({ databasePath });
      expect(application.getTaskDetail("task-1").revision).toBe(1);
      expect(application.getSubtaskDetail("subtask-1").revision).toBe(1);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
