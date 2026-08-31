import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  FactoryApplication,
  createFactoryApplication,
} from "../../src/application";

describe("pull request references", () => {
  test("stores canonical PR URLs on Tasks and Subtasks", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-31T15:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1", "subtask-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });
    const project = app.createProject({ name: "Private repository" });
    const task = app.createTask({
      name: "Task",
      projectId: project.id,
      pullRequestUrl:
        "https://www.github.com/acme/private-repo/pull/42?view=checks",
    });
    const subtask = app.createSubtask({
      name: "Subtask",
      pullRequestUrl: "https://github.com/acme/private-repo/pull/43",
      taskId: task.id,
    });

    expect(app.getTaskDetail(task.id).pullRequestUrl).toBe(
      "https://github.com/acme/private-repo/pull/42",
    );
    expect(app.getSubtaskDetail(subtask.id).pullRequestUrl).toBe(
      "https://github.com/acme/private-repo/pull/43",
    );
    expect(app.getProjectHierarchy(project.id)).toMatchObject({
      tasks: [
        {
          pullRequestUrl: "https://github.com/acme/private-repo/pull/42",
          subtasks: [
            {
              pullRequestUrl: "https://github.com/acme/private-repo/pull/43",
            },
          ],
        },
      ],
    });
  });

  test("clears a PR reference and rejects malformed URLs", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-31T15:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });
    const project = app.createProject({ name: "Private repository" });
    const task = app.createTask({
      name: "Task",
      projectId: project.id,
    });

    expect(() =>
      app.updateTask({
        pullRequestUrl: "https://github.com/acme/private-repo/issues/42",
        taskId: task.id,
      }),
    ).toThrow("GitHub pull request URL");

    app.updateTask({
      pullRequestUrl: "",
      taskId: task.id,
    });
    expect(app.getTaskDetail(task.id)).not.toHaveProperty("pullRequestUrl");
  });

  test("persists references across application instances", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-pull-request-persistence-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({ name: "Private repository" });
      const task = first.createTask({
        name: "Task",
        projectId: project.id,
        pullRequestUrl: "https://github.com/acme/repo/pull/42",
      });
      const subtask = first.createSubtask({
        name: "Subtask",
        pullRequestUrl: "https://github.com/acme/repo/pull/43",
        taskId: task.id,
      });

      const second = createFactoryApplication({ databasePath });
      expect(second.getTaskDetail(task.id).pullRequestUrl).toBe(
        "https://github.com/acme/repo/pull/42",
      );
      expect(second.getSubtaskDetail(subtask.id).pullRequestUrl).toBe(
        "https://github.com/acme/repo/pull/43",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
