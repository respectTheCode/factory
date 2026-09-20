import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  backupFactoryDatabase,
  createFactoryApplication,
} from "../../src/application";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAABAAAAAQBPJcTWAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC";
const JPEG =
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAxAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAHAQEBAAAAAAAAAAAAAAAAAAAFBxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAEAAQMBIgACEQADEQD/2gAMAwEAAhEDEQA/AI4Av4p//9k=";
const PROGRESSIVE_JPEG =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wgARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAVAQEBAAAAAAAAAAAAAAAAAAAFBv/aAAwDAQACEAMQAAABigy4/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAH/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";
const WEBP = "UklGRhwAAABXRUJQVlA4TA8AAAAvAAAAAAcQ9Y/+ByKi/wEA";

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
      ).toThrow("container integrity checks");
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
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Truncated JPEG",
          contentType: "image/jpeg",
          dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64"),
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("container integrity checks");
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Truncated WebP",
          contentType: "image/webp",
          dataBase64: Buffer.from("524946460400000057454250", "hex").toString(
            "base64",
          ),
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("container integrity checks");
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Truncated PNG",
          contentType: "image/png",
          dataBase64: Buffer.from(PNG, "base64")
            .subarray(0, 24)
            .toString("base64"),
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("container integrity checks");
      const corruptPng = Buffer.from(PNG, "base64");
      corruptPng[29] = (corruptPng[29] ?? 0) ^ 0xff;
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Corrupt PNG CRC",
          contentType: "image/png",
          dataBase64: corruptPng.toString("base64"),
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("container integrity checks");
      expect(
        application.addScreenshotEvidence({
          caption: "JPEG fixture",
          contentType: "image/jpeg",
          dataBase64: JPEG,
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toMatchObject({ contentType: "image/jpeg" });
      expect(
        application.addScreenshotEvidence({
          caption: "Progressive JPEG fixture",
          contentType: "image/jpeg",
          dataBase64: PROGRESSIVE_JPEG,
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toMatchObject({ contentType: "image/jpeg" });
      const jpeg = Buffer.from(JPEG, "base64");
      const scanMarker = jpeg.indexOf(Buffer.from([0xff, 0xda]));
      const scanHeaderLength =
        scanMarker + 2 + ((jpeg[scanMarker + 2]! << 8) | jpeg[scanMarker + 3]!);
      const emptyScan = Buffer.concat([
        jpeg.subarray(0, scanHeaderLength),
        Buffer.from([0xff, 0xd9]),
      ]);
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Empty JPEG scan",
          contentType: "image/jpeg",
          dataBase64: emptyScan.toString("base64"),
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("container integrity checks");
      expect(
        application.addScreenshotEvidence({
          caption: "WebP fixture",
          contentType: "image/webp",
          dataBase64: WEBP,
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toMatchObject({ contentType: "image/webp" });
      expect(() =>
        application.addScreenshotEvidence({
          caption: "x".repeat(2_001),
          contentType: "image/png",
          dataBase64: PNG,
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("caption must be no longer than");
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Invalid uploader kind",
          contentType: "image/png",
          dataBase64: PNG,
          label: "middle" as "before",
          taskId: task.id,
          uploader: "human",
          uploaderKind: "operator" as "human",
        }),
      ).toThrow("uploader kind is invalid");
      expect(() =>
        application.addScreenshotEvidence({
          caption: "Invalid label",
          contentType: "image/png",
          dataBase64: PNG,
          label: "middle" as "before",
          taskId: task.id,
          uploader: "human",
          uploaderKind: "human",
        }),
      ).toThrow("label is invalid");
    } finally {
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("cascades evidence bytes when its Project, Task, or Subtask is deleted", () => {
    const { application, directory, project, subtask, task } = fixture();
    try {
      const taskEvidence = application.addScreenshotEvidence({
        caption: "Task deletion proof",
        contentType: "image/png",
        dataBase64: PNG,
        taskId: task.id,
        uploader: "human",
        uploaderKind: "human",
      });
      const subtaskEvidence = application.addScreenshotEvidence({
        caption: "Subtask deletion proof",
        contentType: "image/png",
        dataBase64: PNG,
        subtaskId: subtask.id,
        uploader: "human",
        uploaderKind: "human",
      });

      application.removeSubtask(subtask.id);
      expect(() =>
        application.getScreenshotEvidence(subtaskEvidence.id),
      ).toThrow("does not exist");
      expect(
        application.getScreenshotEvidence(taskEvidence.id).dataBase64,
      ).toBe(PNG);

      application.removeTask(task.id);
      expect(() => application.getScreenshotEvidence(taskEvidence.id)).toThrow(
        "does not exist",
      );

      const projectTask = application.createTask({
        name: "Project deletion task",
        projectId: project.id,
      });
      const projectEvidence = application.addScreenshotEvidence({
        caption: "Project deletion proof",
        contentType: "image/png",
        dataBase64: PNG,
        taskId: projectTask.id,
        uploader: "human",
        uploaderKind: "human",
      });
      application.removeProject(project.id);
      expect(() =>
        application.getScreenshotEvidence(projectEvidence.id),
      ).toThrow("does not exist");
    } finally {
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
