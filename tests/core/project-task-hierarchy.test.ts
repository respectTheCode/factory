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

    expect(hierarchy).toMatchObject({
      id: project.id,
      name: "Website refresh",
      tasks: [
        {
          id: task.id,
          name: "Publish the refreshed site",
          projectId: project.id,
          subtasks: [{ name: "Verify the production build" }],
        },
      ],
    });
  });

  test("returns stable identifiers and parent references for project details", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-22T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-2", "task-2", "subtask-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Mobile launch" });
    const task = app.createTask({
      name: "Prepare the release",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Check the install flow",
      taskId: task.id,
    });

    const hierarchy = app.getProjectHierarchy(project.id);

    expect(hierarchy).toEqual({
      id: project.id,
      name: "Mobile launch",
      tasks: [
        {
          id: task.id,
          name: "Prepare the release",
          projectId: project.id,
          subtasks: [
            {
              id: subtask.id,
              name: "Check the install flow",
              taskId: task.id,
              sortOrder: 0,
              workState: "planned",
            },
          ],
          sortOrder: 0,
          workState: "planned",
        },
      ],
    });
  });
});
