import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("project tracker links", () => {
  test("keeps project links separate from task links", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1", "project-link-1", "task-link-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Playlister roadmap" });
    const task = app.createTask({
      name: "Ship the mobile dashboard",
      projectId: project.id,
    });

    const projectLink = app.addProjectTrackerLink({
      system: "notion",
      projectId: project.id,
      stableId: "notion-project-123",
      url: "https://www.notion.so/playlister/Project-123",
      title: "Playlister roadmap",
    });
    const taskLink = app.addTaskTrackerLink({
      system: "linear",
      taskId: task.id,
      stableId: "GRA-123",
      url: "https://linear.app/grail/issue/GRA-123",
      title: "Ship the mobile dashboard",
    });

    expect(projectLink).toMatchObject({
      id: "project-link-1",
      system: "notion",
      projectId: project.id,
      stableId: "notion-project-123",
      url: "https://www.notion.so/playlister/Project-123",
      title: "Playlister roadmap",
    });
    expect(projectLink).not.toHaveProperty("taskId");
    expect(taskLink).toMatchObject({
      id: "task-link-1",
      system: "linear",
      taskId: task.id,
      stableId: "GRA-123",
      url: "https://linear.app/grail/issue/GRA-123",
      title: "Ship the mobile dashboard",
    });
    expect(taskLink).not.toHaveProperty("projectId");

    expect(app.getProjectDetail(project.id)).toMatchObject({
      id: project.id,
      name: "Playlister roadmap",
      trackerLinks: [
        {
          system: "notion",
          projectId: project.id,
          stableId: "notion-project-123",
          url: "https://www.notion.so/playlister/Project-123",
          title: "Playlister roadmap",
        },
      ],
    });
    expect(app.getTaskDetail(task.id).trackerLinks).toEqual([
      {
        id: "task-link-1",
        system: "linear",
        taskId: task.id,
        stableId: "GRA-123",
        url: "https://linear.app/grail/issue/GRA-123",
        title: "Ship the mobile dashboard",
      },
    ]);
  });

  test("allows a tracker link without a display title", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-2", "project-link-2"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Grail roadmap" });
    app.addProjectTrackerLink({
      system: "linear",
      projectId: project.id,
      stableId: "GRA-456",
      url: "https://linear.app/grail/project/GRA-456",
    });

    expect(app.getProjectDetail(project.id).trackerLinks).toEqual([
      {
        id: "project-link-2",
        system: "linear",
        projectId: project.id,
        stableId: "GRA-456",
        url: "https://linear.app/grail/project/GRA-456",
      },
    ]);
  });
});
