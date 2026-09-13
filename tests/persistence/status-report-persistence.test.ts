import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";

test("loads older status report snapshots without machine attribution fields", () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-report-legacy-"));
  const databasePath = join(directory, "factory.sqlite");
  const application = createFactoryApplication({ databasePath });
  const project = application.createProject({ name: "Legacy reports" });
  const task = application.createTask({
    name: "Load report",
    projectId: project.id,
  });
  const subtask = application.createSubtask({
    name: "Load legacy report",
    taskId: task.id,
  });
  const report = application.reportSubtaskStatus({
    reportedState: "in_progress",
    reporter: "codex",
    subtaskId: subtask.id,
  });
  const database = new Database(databasePath);

  try {
    const row = database
      .query("SELECT state FROM factory_state WHERE id = 1")
      .get() as { state: string };
    const state = JSON.parse(row.state) as {
      statusReports: Array<Record<string, unknown>>;
    };
    for (const storedReport of state.statusReports) {
      delete storedReport.machineId;
      delete storedReport.sessionRef;
    }
    database
      .query("UPDATE factory_state SET state = $state WHERE id = 1")
      .run({ $state: JSON.stringify(state) });

    expect(application.getSubtaskReportHistory(subtask.id)).toEqual([
      expect.objectContaining({ id: report.id, reporter: "codex" }),
    ]);
    expect(
      application.getSubtaskReportHistory(subtask.id)[0],
    ).not.toHaveProperty("machineId");
    expect(
      application.getSubtaskReportHistory(subtask.id)[0],
    ).not.toHaveProperty("sessionRef");
  } finally {
    database.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
