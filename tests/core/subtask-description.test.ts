import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("subtask descriptions", () => {
  test("persists a description through hierarchy reads without changing verification", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = [
          "project-1",
          "task-1",
          "subtask-1",
          "report-1",
          "verification-1",
        ];
        return () => ids.shift() ?? "unexpected-id";
      })(),
    });

    const project = app.createProject({ name: "Website refresh" });
    const task = app.createTask({
      name: "Publish the refreshed site",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      description: "Confirm the production build is healthy before release.",
      name: "Verify the production build",
      taskId: task.id,
    });

    expect(subtask).toMatchObject({
      id: "subtask-1",
      name: "Verify the production build",
      taskId: task.id,
      description: "Confirm the production build is healthy before release.",
    });

    expect(app.getProjectHierarchy(project.id)).toMatchObject({
      tasks: [
        {
          subtasks: [
            {
              id: subtask.id,
              name: subtask.name,
              taskId: task.id,
              description:
                "Confirm the production build is healthy before release.",
            },
          ],
        },
      ],
    });

    const report = app.reportSubtaskStatus({
      evidence: "bun test passed",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: report.id,
      verifier: "kevin",
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      subtasks: [
        {
          reportedState: "complete",
          verificationState: "accepted",
        },
      ],
    });
  });
});
