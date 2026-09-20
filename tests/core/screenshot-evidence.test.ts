import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  backupFactoryDatabase,
  createFactoryApplication,
} from "../../src/application";

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
  "hex",
).toString("base64");

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-screenshot-proof-"));
  const databasePath = join(directory, "factory.sqlite");
  const application = createFactoryApplication({ databasePath });
  const project = application.createProject({ name: "Screenshot project" });
  const task = application.createTask({
    name: "Capture task",
    projectId: project.id,
  });
  const subtask = application.createSubtask({
    name: "Capture subtask",
    taskId: task.id,
  });
  return { application, databasePath, directory, project, subtask, task };
}

describe("screenshot evidence", () => {
  test("stores metadata-only projections and preserves evidence across reopen and backup", () => {
    const { application, databasePath, directory, subtask, task } = fixture();
    const backupPath = join(directory, "backup.sqlite");
    try {
      const beforeStatus = application.getTaskStatus(task.id);
      const summary = application.addScreenshotEvidence({
        caption: "Task proof",
        contentType: "image/png",
        dataBase64: PNG,
        label: "before",
        pairId: "comparison-1",
        subtaskId: subtask.id,
        testedRevision: "6158623",
        uploader: "mac-mini",
        uploaderKind: "machine",
      });

      expect(summary).not.toHaveProperty("dataBase64");
      expect(summary).toMatchObject({
        caption: "Task proof",
        label: "before",
        pairId: "comparison-1",
        subtaskId: subtask.id,
        testedRevision: "6158623",
        uploader: "mac-mini",
      });
      expect(summary.capturedAt).toBeUndefined();
      expect(application.getTaskStatus(task.id)).toEqual(beforeStatus);
      expect(application.getSubtaskDetail(subtask.id).screenshots).toHaveLength(
        1,
      );
      expect(application.getScreenshotEvidence(summary.id).dataBase64).toBe(
        PNG,
      );

      const reopened = createFactoryApplication({ databasePath });
      try {
        expect(
          reopened.listScreenshotEvidence({ subtaskId: subtask.id }),
        ).toEqual([summary]);
        expect(reopened.getScreenshotEvidence(summary.id).dataBase64).toBe(PNG);
        backupFactoryDatabase({ databasePath, destinationPath: backupPath });
      } finally {
        reopened.close();
      }

      const restored = createFactoryApplication({ databasePath: backupPath });
      try {
        expect(restored.getScreenshotEvidence(summary.id).dataBase64).toBe(PNG);
      } finally {
        restored.close();
      }
    } finally {
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects unsupported content, malformed bytes, and ambiguous ownership", () => {
    const { application, directory, task } = fixture();
    try {
      expect(() =>
        application.addScreenshotEvidence({
          caption: "SVG should be rejected",
          contentType: "image/png",
          dataBase64: Buffer.from("<svg />").toString("base64"),
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("do not match");
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Ambiguous target",
          contentType: "image/png",
          dataBase64: PNG,
          subtaskId: task.id,
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("exactly one");
    } finally {
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
