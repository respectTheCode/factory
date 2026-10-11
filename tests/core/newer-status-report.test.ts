import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("current subtask status", () => {
  test("a newer Step report supersedes verification without finishing the Task", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-22T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = [
          "project-1",
          "task-1",
          "subtask-1",
          "report-1",
          "verification-1",
          "report-2",
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
      name: "Verify the production build",
      taskId: task.id,
    });

    const acceptedReport = app.reportSubtaskStatus({
      evidence: "bun test tests/core/project-task-hierarchy.test.ts",
      reason: "Check the result against the acceptance criteria.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: subtask.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: acceptedReport.id,
      verifier: "kevin",
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      subtasks: [{ reportedState: "complete", verificationState: "accepted" }],
      taskCompleted: false,
      taskState: "planned",
    });

    app.reportSubtaskStatus({
      evidence: "The production build now needs another check.",
      reporter: "codex",
      reportedState: "in_progress",
      subtaskId: subtask.id,
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      subtasks: [
        {
          reportedState: "in_progress",
          verificationState: "unreported",
        },
      ],
      taskCompleted: false,
      taskState: "active",
    });

    expect(app.getSubtaskReportHistory(subtask.id)).toMatchObject([
      { reportedState: "complete", reporter: "codex" },
      { reportedState: "in_progress", reporter: "codex" },
    ]);
  });
});
