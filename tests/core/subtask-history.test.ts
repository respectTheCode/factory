import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

describe("subtask history", () => {
  test("preserves every status report and its human verification", () => {
    const app = new FactoryApplication({
      clock: () => new Date("2026-08-23T12:00:00.000Z"),
      idGenerator: (() => {
        const ids = [
          "project-1",
          "task-1",
          "subtask-1",
          "report-1",
          "report-2",
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
      name: "Verify the production build",
      taskId: task.id,
    });

    const firstReport = app.reportSubtaskStatus({
      evidence: "The production build is ready for verification.",
      reporter: "codex",
      reportedState: "in_progress",
      subtaskId: subtask.id,
    });
    const secondReport = app.reportSubtaskStatus({
      evidence: "Build 2026-08-23 passed in CI.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: subtask.id,
    });

    app.verifyStatusReport({
      decision: "accepted",
      reportId: secondReport.id,
      verifier: "kevin",
    });

    expect(app.getSubtaskReportHistory(subtask.id)).toMatchObject([
      {
        id: firstReport.id,
        reportedState: "in_progress",
        reporter: "codex",
      },
      {
        id: secondReport.id,
        reportedState: "complete",
        reporter: "codex",
      },
    ]);
    expect(app.getSubtaskVerificationHistory(subtask.id)).toMatchObject([
      {
        decision: "accepted",
        reportId: secondReport.id,
        verifier: "kevin",
      },
    ]);
  });
});
