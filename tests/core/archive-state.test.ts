import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createFactoryApplication,
  FactoryApplication,
} from "../../src/application";

function createInMemoryApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => new Date("2026-08-24T12:00:00.000Z"),
    idGenerator: () => `id-${++nextId}`,
  });
}

describe("archived task and subtask states", () => {
  test("archives tasks as released or wont_do and removes both from attention", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory V1" });
    const releasedTask = app.createTask({
      name: "Ship the released slice",
      projectId: project.id,
    });
    const wontDoTask = app.createTask({
      name: "Drop the obsolete slice",
      projectId: project.id,
    });
    const activeTask = app.createTask({
      name: "Keep the current slice",
      projectId: project.id,
    });

    app.archiveTask(releasedTask.id, "released");
    app.archiveTask(wontDoTask.id, "wont_do");

    expect(app.getTaskStatus(releasedTask.id)).toMatchObject({
      archiveState: "released",
    });
    expect(app.getTaskStatus(wontDoTask.id)).toMatchObject({
      archiveState: "wont_do",
    });
    expect(app.getProjectStatus(project.id).counts).toMatchObject({
      released: 1,
      wont_do: 1,
    });
    expect(app.getAttentionProjection()).toEqual([
      expect.objectContaining({
        taskId: activeTask.id,
        taskName: activeTask.name,
      }),
    ]);
  });

  test("shows a subtask archive state in task status without changing report history", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Triage the release",
      projectId: project.id,
    });
    const releasedSubtask = app.createSubtask({
      name: "Release the verified build",
      taskId: task.id,
    });
    const wontDoSubtask = app.createSubtask({
      name: "Remove the abandoned experiment",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      evidence: "The build is already available to users.",
      reason: "Check the released build against the acceptance criteria.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: releasedSubtask.id,
    });

    app.archiveSubtask(releasedSubtask.id, "released");
    app.archiveSubtask(wontDoSubtask.id, "wont_do");

    const status = app.getTaskStatus(task.id);
    expect(status.subtasks).toEqual([
      expect.objectContaining({
        reportId: report.id,
        reportedState: "complete",
        archiveState: "released",
        verificationState: "awaiting_verification",
      }),
      expect.objectContaining({
        archiveState: "wont_do",
        verificationState: "unreported",
      }),
    ]);
    expect(app.getSubtaskReportHistory(releasedSubtask.id)).toEqual([report]);
  });

  test("persists archived task and subtask states across application instances", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-archive-state-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory V1" });
      const task = app.createTask({
        name: "Close the launch plan",
        projectId: project.id,
      });
      const subtask = app.createSubtask({
        name: "Skip the unused step",
        taskId: task.id,
      });

      app.archiveTask(task.id, "released");
      app.archiveSubtask(subtask.id, "wont_do");

      const reopened = createFactoryApplication({ databasePath });

      expect(reopened.getTaskStatus(task.id)).toMatchObject({
        archiveState: "released",
        subtasks: [
          expect.objectContaining({
            archiveState: "wont_do",
          }),
        ],
      });
      expect(reopened.getAttentionProjection()).toEqual([]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
