import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("subtask status reporting", () => {
  test("keeps an agent-complete subtask awaiting human verification", () => {
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
    const subtask = app.createSubtask({
      name: "Verify the production build",
      taskId: task.id,
    });

    app.reportSubtaskStatus({
      evidence: "bun test tests/core/project-task-hierarchy.test.ts",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: subtask.id,
    });

    const status = app.getTaskStatus(task.id);

    expect(status).toMatchObject({
      subtasks: [
        {
          reportedState: "complete",
          verificationState: "awaiting_verification",
        },
      ],
      taskCompleted: false,
    });
  });
});
