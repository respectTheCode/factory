import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("task tracker links", () => {
  test("shows a Linear link on task detail without changing native task status", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-22T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = ["project-1", "task-1", "subtask-1", "report-1"];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Grail roadmap" });
    const task = app.createTask({
      name: "Publish the refreshed site",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Verify the production build",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      evidence: "bun test",
      reporter: "codex",
      reportedState: "in_progress",
      subtaskId: subtask.id,
    });

    const nativeStatusBeforeLink = app.getTaskStatus(task.id);

    app.addTaskTrackerLink({
      system: "linear",
      stableId: "GRA-123",
      taskId: task.id,
      title: "Publish the refreshed site",
      url: "https://linear.app/grail/issue/GRA-123",
    });

    expect(app.getTaskDetail(task.id)).toMatchObject({
      name: "Publish the refreshed site",
      trackerLinks: [
        {
          system: "linear",
          stableId: "GRA-123",
          title: "Publish the refreshed site",
          url: "https://linear.app/grail/issue/GRA-123",
        },
      ],
    });
    expect(app.getTaskStatus(task.id)).toEqual(nativeStatusBeforeLink);
  });
});
