import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createHumanSessionStore } from "../../src/human-session";
import { createIdempotencyStore } from "../../src/idempotency";
import { createMachineCredentialStore } from "../../src/machine-credential";
import {
  backupFactorySnapshot,
  inspectFactoryDatabase,
  verifyFactorySnapshot,
} from "../../src/backup-snapshot";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAABAAAAAQBPJcTWAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC";

describe("Factory online backup snapshots", () => {
  test("preserves durable IDs and full report/verification history without manifest secrets", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-snapshot-"));
    const databasePath = join(directory, "factory.sqlite");
    const snapshotPath = join(directory, "backups", "factory.sqlite");
    const manifestPath = `${snapshotPath}.manifest.json`;
    const application = createFactoryApplication({ databasePath });
    const machineCredentials = createMachineCredentialStore({ databasePath });
    const sessions = createHumanSessionStore({ databasePath });
    const idempotency = createIdempotencyStore({ databasePath });

    try {
      const project = application.createProject({ name: "Snapshot project" });
      const task = application.createTask({
        name: "Snapshot task",
        projectId: project.id,
      });
      const subtask = application.createSubtask({
        name: "Snapshot subtask",
        taskId: task.id,
      });
      const screenshot = application.addScreenshotEvidence({
        caption: "Snapshot proof",
        contentType: "image/png",
        dataBase64: PNG,
        subtaskId: subtask.id,
        uploader: "snapshot-host",
        uploaderKind: "machine",
      });
      const report = application.reportSubtaskStatus({
        evidence: "The snapshot contains the complete report history.",
        reason: "The snapshot test records a complete report.",
        reporter: "codex",
        reportedState: "complete",
        subtaskId: subtask.id,
      });
      application.verifyStatusReport({
        decision: "accepted",
        reportId: report.id,
        verifier: "kevin",
      });
      const verification = application.getSubtaskVerificationHistory(
        subtask.id,
      )[0];
      if (!verification)
        throw new Error("Verification fixture was not stored.");
      const machine = machineCredentials.create({
        machineId: "snapshot-host",
        projectIds: [project.id],
      });
      const sessionToken = sessions.create("Kevin");
      idempotency.put({
        createdAt: new Date().toISOString(),
        payloadDigest: "payload-digest",
        requestKey: "snapshot-request-1",
        response: JSON.stringify({ reportId: report.id }),
        scope: "snapshot-host",
      });

      // Close writers before inspecting the online copy, as the production
      // sidecar uses a read-only data mount while the service is live.
      idempotency.close();
      sessions.close();
      machineCredentials.close();
      application.close();
      chmodSync(databasePath, 0o444);

      const backup = backupFactorySnapshot({
        databasePath,
        outputPath: snapshotPath,
      });
      const manifestText = readFileSync(manifestPath, "utf8");
      const mode = statSync(snapshotPath).mode & 0o777;
      const manifestMode = statSync(manifestPath).mode & 0o777;

      expect(mode).toBe(0o600);
      expect(manifestMode).toBe(0o600);
      expect(backup.manifest.snapshot.integrity).toBe("ok");
      expect(backup.manifest.state.collections.projects.ids).toContain(
        project.id,
      );
      expect(backup.manifest.state.collections.tasks.ids).toContain(task.id);
      expect(backup.manifest.state.collections.subtasks.ids).toContain(
        subtask.id,
      );
      expect(backup.manifest.state.history.statusReports).toMatchObject({
        count: 1,
        ids: [report.id],
      });
      expect(backup.manifest.state.history.verifications).toMatchObject({
        count: 1,
        ids: [verification.id],
      });
      expect(
        backup.manifest.state.collections.screenshotEvidence,
      ).toMatchObject({
        count: 1,
        ids: [screenshot.id],
      });
      expect(
        backup.manifest.protectedTables.factory_machine_credentials,
      ).toMatchObject({ count: 1, present: true });
      expect(backup.manifest.protectedTables.factory_sessions).toMatchObject({
        count: 1,
        present: true,
      });
      expect(
        backup.manifest.protectedTables.factory_idempotency_receipts,
      ).toMatchObject({ count: 1, present: true });
      expect(manifestText).not.toContain(machine.token);
      expect(manifestText).not.toContain(sessionToken);

      expect(
        verifyFactorySnapshot({ databasePath: snapshotPath, manifestPath }),
      ).toMatchObject({ verified: true });

      // The serialized copy reopens through the regular application path, not
      // merely through the backup reader.
      const restored = createFactoryApplication({ databasePath: snapshotPath });
      try {
        expect(restored.getSubtaskReportHistory(subtask.id)).toMatchObject([
          { id: report.id },
        ]);
        expect(
          restored.getSubtaskVerificationHistory(subtask.id),
        ).toMatchObject([{ id: verification.id, decision: "accepted" }]);
        expect(restored.getScreenshotEvidence(screenshot.id).dataBase64).toBe(
          PNG,
        );
      } finally {
        restored.close();
      }
    } finally {
      // The stores are closed above on the successful path; close is idempotent
      // for the application and the directory cleanup is exact and bounded.
      try {
        idempotency.close();
      } catch {
        // already closed
      }
      try {
        sessions.close();
      } catch {
        // already closed
      }
      try {
        machineCredentials.close();
      } catch {
        // already closed
      }
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("refuses existing output and does not initialize a missing database", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-refusal-"));
    const missingPath = join(directory, "missing.sqlite");
    const sourcePath = join(directory, "source.sqlite");
    const outputPath = join(directory, "existing.sqlite");

    try {
      expect(() =>
        backupFactorySnapshot({
          databasePath: missingPath,
          outputPath,
        }),
      ).toThrow("Database does not exist");
      expect(existsSync(missingPath)).toBe(false);

      const application = createFactoryApplication({
        databasePath: sourcePath,
      });
      application.createProject({ name: "Source" });
      application.close();
      writeFileSync(outputPath, "keep this file", { mode: 0o600 });
      expect(() =>
        backupFactorySnapshot({
          databasePath: sourcePath,
          outputPath,
        }),
      ).toThrow("Snapshot destination already exists");
      expect(readFileSync(outputPath, "utf8")).toBe("keep this file");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("detects byte corruption and rejects a missing required collection", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-integrity-"));
    const databasePath = join(directory, "factory.sqlite");
    const snapshotPath = join(directory, "snapshot.sqlite");
    const manifestPath = `${snapshotPath}.manifest.json`;

    try {
      const application = createFactoryApplication({ databasePath });
      application.createProject({ name: "Integrity" });
      application.close();
      backupFactorySnapshot({ databasePath, outputPath: snapshotPath });

      const bytes = readFileSync(snapshotPath);
      const lastByteIndex = bytes.length - 1;
      const lastByte = bytes[lastByteIndex];
      if (lastByte === undefined)
        throw new Error("Snapshot is unexpectedly empty.");
      bytes[lastByteIndex] = lastByte ^ 0xff;
      writeFileSync(snapshotPath, bytes, { mode: 0o600 });
      chmodSync(snapshotPath, 0o600);
      expect(() =>
        verifyFactorySnapshot({
          databasePath: snapshotPath,
          manifestPath,
        }),
      ).toThrow("Snapshot checksum does not match");

      const missingCollectionPath = join(
        directory,
        "missing-collection.sqlite",
      );
      const database = new Database(missingCollectionPath);
      database.exec(
        "CREATE TABLE factory_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)",
      );
      database
        .query("INSERT INTO factory_state (id, state) VALUES (1, $state)")
        .run({
          $state: JSON.stringify({
            tasks: [],
            subtasks: [],
            statusReports: [],
            verifications: [],
          }),
        });
      database.close();
      expect(() =>
        inspectFactoryDatabase({ databasePath: missingCollectionPath }),
      ).toThrow("Persisted collection is missing: projects");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("captures a consistent snapshot while a WAL writer remains open", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-online-"));
    const databasePath = join(directory, "factory.sqlite");
    const snapshotPath = join(directory, "snapshot.sqlite");
    const writer = new Database(databasePath);
    let application: ReturnType<typeof createFactoryApplication> | undefined;

    try {
      expect(writer.query("PRAGMA journal_mode = WAL").get()).toMatchObject({
        journal_mode: "wal",
      });
      application = createFactoryApplication({ databasePath });
      const project = application.createProject({ name: "Online writer" });
      // Keep an active writer transaction open. WAL permits the read-only
      // snapshot connection to obtain a stable committed view while this
      // writer is still connected and holding its write reservation.
      writer.exec("BEGIN IMMEDIATE");

      const result = backupFactorySnapshot({
        databasePath,
        outputPath: snapshotPath,
      });
      expect(result.manifest.state.collections.projects.ids).toContain(
        project.id,
      );
      expect(
        verifyFactorySnapshot({
          databasePath: snapshotPath,
          manifestPath: `${snapshotPath}.manifest.json`,
        }),
      ).toMatchObject({ verified: true });
      writer.exec("ROLLBACK");
    } finally {
      try {
        if (writer.inTransaction) writer.exec("ROLLBACK");
      } catch {
        // Best-effort rollback before closing the fixture connection.
      }
      writer.close();
      application?.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects missing history after the tampered snapshot checksum is refreshed", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-history-"));
    const databasePath = join(directory, "factory.sqlite");
    const snapshotPath = join(directory, "snapshot.sqlite");
    const manifestPath = `${snapshotPath}.manifest.json`;
    const application = createFactoryApplication({ databasePath });

    try {
      const project = application.createProject({ name: "History" });
      const task = application.createTask({
        name: "Task",
        projectId: project.id,
      });
      const subtask = application.createSubtask({
        name: "Report history",
        taskId: task.id,
      });
      const report = application.reportSubtaskStatus({
        reason: "History integrity fixture.",
        reporter: "codex",
        reportedState: "in_progress",
        subtaskId: subtask.id,
      });
      application.close();
      backupFactorySnapshot({ databasePath, outputPath: snapshotPath });

      const snapshotDatabase = new Database(snapshotPath);
      const row = snapshotDatabase
        .query("SELECT state FROM factory_state WHERE id = 1")
        .get() as { state: string };
      const state = JSON.parse(row.state) as {
        statusReports: Array<{ id: string }>;
      };
      state.statusReports = state.statusReports.filter(
        (candidate) => candidate.id !== report.id,
      );
      snapshotDatabase
        .query("UPDATE factory_state SET state = $state WHERE id = 1")
        .run({ $state: JSON.stringify(state) });
      snapshotDatabase.close();

      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        snapshot: { sha256: string; sizeBytes: number };
      };
      const changedBytes = readFileSync(snapshotPath);
      manifest.snapshot.sha256 = createHash("sha256")
        .update(changedBytes)
        .digest("hex");
      manifest.snapshot.sizeBytes = changedBytes.byteLength;
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`, {
        mode: 0o600,
      });
      chmodSync(manifestPath, 0o600);

      expect(() =>
        verifyFactorySnapshot({
          databasePath: snapshotPath,
          manifestPath,
        }),
      ).toThrow("Snapshot content does not match the manifest: state");
    } finally {
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("CLI backup and verify emit only bounded metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-cli-"));
    const databasePath = join(directory, "factory.sqlite");
    const snapshotPath = join(directory, "snapshot.sqlite");
    const manifestPath = `${snapshotPath}.manifest.json`;
    const application = createFactoryApplication({ databasePath });
    application.createProject({ name: "CLI" });
    application.close();

    try {
      const backup = Bun.spawnSync([
        "bun",
        "scripts/backup-snapshot.ts",
        "backup",
        "--database",
        databasePath,
        "--output",
        snapshotPath,
      ]);
      expect(backup.exitCode).toBe(0);
      const backupOutput = backup.stdout.toString();
      expect(JSON.parse(backupOutput)).toMatchObject({
        command: "backup",
        manifestPath,
        snapshotPath,
        verified: true,
      });

      const verify = Bun.spawnSync([
        "bun",
        "scripts/backup-snapshot.ts",
        "verify",
        "--database",
        snapshotPath,
        "--manifest",
        manifestPath,
      ]);
      expect(verify.exitCode).toBe(0);
      expect(JSON.parse(verify.stdout.toString())).toMatchObject({
        command: "verify",
        verified: true,
      });
      expect(backupOutput).not.toContain("pilot-agent-token");
      expect(verify.stdout.toString()).not.toContain("pilot-agent-token");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
