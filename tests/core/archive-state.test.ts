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
        effectiveState: "completed",
        verificationState: "not_required",
      }),
      expect.objectContaining({
        archiveState: "wont_do",
        verificationState: "unreported",
      }),
    ]);
    expect(app.getSubtaskReportHistory(releasedSubtask.id)).toEqual([report]);
  });

  test("releasing a task releases every child and restore leaves children released", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Release the task",
      projectId: project.id,
    });
    const releasedChild = app.createSubtask({
      name: "Previously released",
      taskId: task.id,
    });
    const wontDoChild = app.createSubtask({
      name: "Previously wont do",
      taskId: task.id,
    });
    const activeChild = app.createSubtask({
      name: "Active child",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      evidence: "Keep this history.",
      reason: "Check the released output.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: activeChild.id,
    });
    app.archiveSubtask(releasedChild.id, "released");
    app.archiveSubtask(wontDoChild.id, "wont_do");

    app.archiveTask(task.id, "released");
    expect(
      app.getTaskStatus(task.id).subtasks.map((child) => child.archiveState),
    ).toEqual(["released", "released", "released"]);
    expect(app.getSubtaskReportHistory(activeChild.id)).toEqual([report]);

    app.restoreTask(task.id);
    expect(app.getTaskStatus(task.id)).not.toHaveProperty("archiveState");
    expect(
      app
        .getTaskStatus(task.id)
        .subtasks.every((child) => child.archiveState === "released"),
    ).toBe(true);
  });

  test("archiving a task as wont_do preserves each child's separate disposition", () => {
    const app = createInMemoryApplication();
    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Drop the task",
      projectId: project.id,
    });
    const releasedChild = app.createSubtask({
      name: "Released child",
      taskId: task.id,
    });
    const activeChild = app.createSubtask({
      name: "Active child",
      taskId: task.id,
    });
    app.archiveSubtask(releasedChild.id, "released");

    app.archiveTask(task.id, "wont_do");

    expect(
      Object.fromEntries(
        app
          .getTaskStatus(task.id)
          .subtasks.map((child) => [child.subtaskId, child.archiveState]),
      ),
    ).toEqual({ [releasedChild.id]: "released", [activeChild.id]: undefined });
    expect(app.getTaskStatus(task.id).archiveState).toBe("wont_do");
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
