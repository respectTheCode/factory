import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("project planning", () => {
  test("retrieves a project with its task and subtask hierarchy", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-22T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1", "subtask-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Website refresh" });
    const task = app.createTask({
      name: "Publish the refreshed site",
      projectId: project.id,
    });
    app.createSubtask({
      name: "Verify the production build",
      taskId: task.id,
    });

    const hierarchy = app.getProjectHierarchy(project.id);

    expect(hierarchy).toEqual({
      name: "Website refresh",
      tasks: [
        {
          name: "Publish the refreshed site",
          subtasks: [{ name: "Verify the production build" }],
        },
      ],
    });
  });
});
