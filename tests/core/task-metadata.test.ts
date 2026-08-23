import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("task metadata", () => {
  test("returns planning metadata unchanged from task detail", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Factory V1" });
    const task = app.createTask({
      name: "Ship the mobile planning loop",
      projectId: project.id,
      objective: "Make project progress inspectable from a phone",
      acceptanceCriteria: [
        "A user can inspect the task hierarchy",
        "A user can verify a completed subtask",
      ],
      priority: "high",
      owner: "kevin",
      dependencies: ["Tailscale access"],
      repositoryLinks: ["https://github.com/app-press/factory"],
    });

    expect(app.getTaskDetail(task.id)).toMatchObject({
      id: task.id,
      name: "Ship the mobile planning loop",
      projectId: project.id,
      objective: "Make project progress inspectable from a phone",
      acceptanceCriteria: [
        "A user can inspect the task hierarchy",
        "A user can verify a completed subtask",
      ],
      priority: "high",
      owner: "kevin",
      dependencies: ["Tailscale access"],
      repositoryLinks: ["https://github.com/app-press/factory"],
    });
  });
});
