import { rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { backupFactorySnapshot } from "../../src/backup-snapshot";

describe("report tracking persistence", () => {
  test("retains new claims and legacy schema-v1 reports through reopen and snapshot backup", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-report-tracking-"));
    const databasePath = join(directory, "factory.sqlite");
    const snapshotPath = join(directory, "backups", "factory.sqlite");
    const createdAt = "2026-10-06T12:00:00.000Z";
    const legacyState = {
      projects: [{ createdAt, id: "project-1", name: "Legacy project" }],
      tasks: [
        {
          createdAt,
          id: "task-1",
          name: "Legacy task",
          projectId: "project-1",
        },
      ],
      subtasks: [
        {
          createdAt,
          id: "subtask-1",
          name: "Legacy report",
          taskId: "task-1",
        },
        {
          createdAt,
          id: "subtask-2",
          name: "Waiting report",
          taskId: "task-1",
        },
      ],
      statusReports: [
        {
          createdAt,
          evidence: "Legacy report evidence.",
          id: "report-legacy",
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: "subtask-1",
        },
      ],
      verifications: [],
    };

    try {
      const database = new Database(databasePath);
      database.exec(
        "CREATE TABLE factory_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)",
      );
      database
        .query("INSERT INTO factory_state (id, state) VALUES (1, $state)")
        .run({ $state: JSON.stringify(legacyState) });
      database.close();

      const legacy = createFactoryApplication({ databasePath });
      expect(legacy.getSubtaskReportHistory("subtask-1")).toMatchObject([
        {
          evidence: "Legacy report evidence.",
          id: "report-legacy",
        },
      ]);
      expect(legacy.getSubtaskReportHistory("subtask-1")[0]).not.toHaveProperty(
        "handoff",
      );

      const newReport = legacy.reportSubtaskStatus({
        artifacts: [
          {
            kind: "preview",
            label: "Review build",
            testedRevision: "abcdef1234567",
            url: "https://preview.example.test/build/42",
          },
        ],
        evidence: "The preview is ready for review.",
        handoff: {
          dependency: "Human review of the preview.",
          nextAction:
            "Open the preview and compare it with the approved design.",
          nextOwner: "Kevin",
          nextOwnerKind: "human",
          waitingOnSubtaskIds: ["ST-2"],
        },
        machineId: "agent-mac-mini",
        reason: "The preview is ready for a human check.",
        reportedState: "complete",
        reporter: "codex",
        sessionRef: {
          externalThreadId: "thread-report-tracking",
          provider: "t3",
          sourceId: "legacy",
        },
        subtaskId: "ST-1",
        testedRevision: "ABCDEF1234567",
      });
      expect(newReport).toMatchObject({
        artifacts: [
          {
            testedRevision: "abcdef1234567",
            url: "https://preview.example.test/build/42",
          },
        ],
        handoff: {
          nextOwner: "Kevin",
          waitingOnSubtaskIds: ["subtask-2"],
        },
        testedRevision: "abcdef1234567",
      });
      legacy.close();

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getSubtaskReportHistory("ST-1")).toEqual([
        {
          createdAt: new Date(createdAt),
          evidence: "Legacy report evidence.",
          id: "report-legacy",
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: "subtask-1",
        },
        newReport,
      ]);
      expect(reopened.getTaskStatus("task-1").subtasks[0]).toMatchObject({
        artifacts: newReport.artifacts,
        handoff: newReport.handoff,
        machineId: "agent-mac-mini",
        reportCreatedAt: newReport.createdAt,
        reportEvidence: "The preview is ready for review.",
        sessionRef: newReport.sessionRef,
        testedRevision: "abcdef1234567",
      });
      reopened.close();

      backupFactorySnapshot({ databasePath, outputPath: snapshotPath });
      const restored = createFactoryApplication({ databasePath: snapshotPath });
      try {
        expect(restored.getSubtaskReportHistory("ST-1")).toEqual([
          {
            createdAt: new Date(createdAt),
            evidence: "Legacy report evidence.",
            id: "report-legacy",
            reportedState: "in_progress",
            reporter: "codex",
            subtaskId: "subtask-1",
          },
          newReport,
        ]);
        expect(
          restored.getDashboardSnapshot("project-1").taskStatuses[0]
            ?.subtasks[0],
        ).toMatchObject({
          handoff: newReport.handoff,
          testedRevision: "abcdef1234567",
        });
      } finally {
        restored.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
