import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createBackupService } from "../../src/backup-service";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAABAAAAAQBPJcTWAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-backup-service-"));
  const databasePath = join(directory, "factory.sqlite");
  const backupDirectory = join(directory, "nfs-backups");
  const application = createFactoryApplication({ databasePath });
  const project = application.createProject({ name: "Backup fixture" });
  const task = application.createTask({
    name: "Backup screenshot task",
    projectId: project.id,
  });
  const screenshot = application.addScreenshotEvidence({
    caption: "Backup screenshot proof",
    contentType: "image/png",
    dataBase64: PNG,
    taskId: task.id,
    uploader: "backup-fixture",
    uploaderKind: "machine",
  });
  application.close();
  mkdirSync(backupDirectory);
  return {
    backupDirectory,
    databasePath,
    directory,
    screenshotId: screenshot.id,
  };
}

describe("Factory app-owned backup service", () => {
  test("reports clear unconfigured defaults and persists local settings", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-settings-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    application.createProject({ name: "Settings fixture" });
    application.close();
    try {
      const unconfigured = createBackupService({ databasePath });
      expect(unconfigured.status()).toMatchObject({
        configured: false,
        directory: null,
        settings: {
          enabled: false,
          intervalMinutes: 30,
          keepDaily: 30,
          keepRecent: 336,
        },
        stale: false,
      });

      const backupDirectory = join(directory, "backups");
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      expect(service.status().settings.enabled).toBe(true);
      await service.updateSettings({ intervalMinutes: 1, keepRecent: 2 });
      const reloaded = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      expect(reloaded.status().settings).toMatchObject({
        enabled: true,
        intervalMinutes: 1,
        keepDaily: 30,
        keepRecent: 2,
      });
      expect(
        readFileSync(`${databasePath}.backup-settings.json`, "utf8"),
      ).not.toContain("factory_state");
      writeFileSync(
        `${databasePath}.restore-result.json`,
        JSON.stringify({
          at: new Date().toISOString(),
          backupId: "b-20260101T000000.000Z-deadbeef",
          preRestoreId: "b-20260101T000001.000Z-deadbeef",
          state: "restored",
        }),
      );
      expect(reloaded.status().lastRestore).toMatchObject({
        state: "restored",
      });
      writeFileSync(`${databasePath}.restore-result.json`, "not json");
      expect(reloaded.status().lastRestore).toBeNull();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("creates verified backups, rejects unsafe IDs, preserves unrelated entries, and rejects corruption on restore", async () => {
    const { backupDirectory, databasePath, directory, screenshotId } =
      fixture();
    const unrelatedDirectory = join(backupDirectory, "keep-me");
    mkdirSync(unrelatedDirectory);
    writeFileSync(join(unrelatedDirectory, "note.txt"), "unrelated");
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      const backup = await service.create("manual");
      expect(backup.integrity).toBe("verified");
      expect(backup.id).toMatch(/^b-[0-9]{8}T[0-9]{6}\.[0-9]{3}Z-[a-f0-9]{8}$/);
      expect(await service.list()).toMatchObject([
        { id: backup.id, integrity: "verified", trigger: "manual" },
      ]);
      const restored = createFactoryApplication({
        databasePath: join(backupDirectory, backup.id, "snapshot.sqlite"),
      });
      try {
        expect(restored.getScreenshotEvidence(screenshotId).dataBase64).toBe(
          PNG,
        );
      } finally {
        restored.close();
      }
      await expect(service.delete("../keep-me")).rejects.toThrow(
        "Backup ID is invalid",
      );
      await expect(
        service.delete(backup.id.replace(/^b-/, "x-")),
      ).rejects.toThrow("Backup ID is invalid");

      const snapshotPath = join(backupDirectory, backup.id, "snapshot.sqlite");
      const bytes = readFileSync(snapshotPath);
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      writeFileSync(snapshotPath, bytes);
      expect((await service.list())[0]).toMatchObject({
        id: backup.id,
        integrity: "corrupt",
      });
      expect(service.status().stale).toBe(true);
      await expect(service.prepareRestore(backup.id)).rejects.toThrow(
        "Snapshot checksum does not match",
      );
      expect(existsSync(join(unrelatedDirectory, "note.txt"))).toBe(true);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("retains manual and pre-restore backups while pruning scheduled backups by union policy", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      await service.updateSettings({ keepRecent: 1, keepDaily: 1 });
      service.stop();
      const manual = await service.create("manual");
      const scheduledOne = await service.create("scheduled");
      const scheduledTwo = await service.create("scheduled");
      const scheduledThree = await service.create("scheduled");
      const preRestore = await service.create("pre-restore");
      const listed = await service.list();
      expect(listed.map((backup) => backup.id)).toEqual(
        expect.arrayContaining([manual.id, preRestore.id, scheduledThree.id]),
      );
      expect(listed.map((backup) => backup.id)).not.toContain(scheduledOne.id);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("does not prune a good older copy when a same-size scheduled copy is corrupt", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    const metadataPath = (id: string) =>
      join(backupDirectory, id, "metadata.json");
    const setCreatedAt = (id: string, createdAt: string) => {
      const path = metadataPath(id);
      const metadata = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        unknown
      >;
      metadata.createdAt = createdAt;
      writeFileSync(path, `${JSON.stringify(metadata)}\n`);
    };
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      await service.updateSettings({ keepRecent: 1, keepDaily: 2 });
      service.stop();
      const goodOlder = await service.create("scheduled");
      setCreatedAt(goodOlder.id, "2026-09-15T00:00:00.000Z");
      const corrupt = await service.create("scheduled");
      setCreatedAt(corrupt.id, "2026-09-17T00:00:00.000Z");

      const snapshotPath = join(backupDirectory, corrupt.id, "snapshot.sqlite");
      const bytes = readFileSync(snapshotPath);
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
      writeFileSync(snapshotPath, bytes);

      const latest = await service.create("scheduled");
      const listed = await service.list();
      expect(listed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: goodOlder.id, integrity: "verified" }),
          expect.objectContaining({ id: corrupt.id, integrity: "corrupt" }),
          expect.objectContaining({ id: latest.id, integrity: "verified" }),
        ]),
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("prepares a verified local restore copy and creates a mandatory pre-restore backup", async () => {
    const { backupDirectory, databasePath, directory, screenshotId } =
      fixture();
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      const source = await service.create("manual");
      const result = await service.prepareRestore(source.id);
      expect(result.backupId).toBe(source.id);
      expect(result.preRestoreId).not.toBe(source.id);
      expect(lstatSync(result.stagedDatabasePath).isFile()).toBe(true);
      expect(lstatSync(result.stagedManifestPath).isFile()).toBe(true);
      const staged = createFactoryApplication({
        databasePath: result.stagedDatabasePath,
      });
      try {
        expect(staged.getScreenshotEvidence(screenshotId).dataBase64).toBe(PNG);
      } finally {
        staged.close();
      }
      await service.list();
      expect(existsSync(result.stagedDatabasePath)).toBe(true);
      expect(existsSync(result.stagedManifestPath)).toBe(true);
      expect(existsSync(databasePath)).toBe(true);
      expect(
        (await service.list()).filter(
          (backup) => backup.trigger === "pre-restore",
        ),
      ).toHaveLength(1);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("allows manual safety work while scheduling is disabled and preserves prior backups after failure", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      await service.updateSettings({ enabled: false });
      const manual = await service.create("manual");
      expect(manual.integrity).toBe("verified");
      await expect(service.create("scheduled")).rejects.toThrow(
        "Scheduled backups are disabled",
      );
      await service.updateSettings({ enabled: true });
      service.stop();
      expect(
        (await service.list()).some((backup) => backup.trigger === "scheduled"),
      ).toBe(true);

      rmSync(databasePath, { force: true });
      await expect(service.create("manual")).rejects.toThrow(
        "Database does not exist",
      );
      expect((await service.list()).map((backup) => backup.id)).toContain(
        manual.id,
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("keeps a failed create visible after successful metadata polling and marks recovery stale after deletion", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      const backup = await service.create("manual");
      rmSync(databasePath, { force: true });
      await expect(service.create("manual")).rejects.toThrow(
        "Database does not exist",
      );
      await service.list();
      expect(service.status().lastError).toContain("Database does not exist");

      const serviceWithDatabase = createBackupService({
        databasePath: join(directory, "second.sqlite"),
        directory: join(directory, "second-backups"),
      });
      const secondApplication = createFactoryApplication({
        databasePath: join(directory, "second.sqlite"),
      });
      secondApplication.createProject({ name: "Second fixture" });
      secondApplication.close();
      const second = await serviceWithDatabase.create("manual");
      expect(serviceWithDatabase.status().stale).toBe(false);
      await serviceWithDatabase.delete(second.id);
      expect(serviceWithDatabase.status()).toMatchObject({
        lastSuccessAt: null,
        stale: true,
      });
      expect(backup.id).not.toBe(second.id);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("retains the newest scheduled backup and one backup per recent UTC day", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    const metadataPath = (id: string) =>
      join(backupDirectory, id, "metadata.json");
    const setCreatedAt = (id: string, createdAt: string) => {
      const path = metadataPath(id);
      const metadata = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        unknown
      >;
      metadata.createdAt = createdAt;
      writeFileSync(path, `${JSON.stringify(metadata)}\n`);
    };
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      const first = await service.create("scheduled");
      service.stop();
      await service.updateSettings({ keepRecent: 1, keepDaily: 2 });
      service.stop();
      setCreatedAt(first.id, "2026-09-15T00:00:00.000Z");
      const second = await service.create("scheduled");
      setCreatedAt(second.id, "2026-09-16T00:00:00.000Z");
      const third = await service.create("scheduled");
      setCreatedAt(third.id, "2026-09-18T00:00:00.000Z");
      const ids = (await service.list()).map((backup) => backup.id);
      expect(ids).toEqual(expect.arrayContaining([second.id, third.id]));
      expect(ids).not.toContain(first.id);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("deduplicates startup scheduling and uses the scheduled recovery point after restart", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      await service.start();
      await service.start();
      service.stop();
      expect(
        (await service.list()).filter(
          (backup) => backup.trigger === "scheduled",
        ),
      ).toHaveLength(1);

      const restarted = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      await restarted.start();
      restarted.stop();
      expect(
        (await restarted.list()).filter(
          (backup) => backup.trigger === "scheduled",
        ),
      ).toHaveLength(1);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("records timeout immediately while holding busy until the worker exits", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    const previousDelay = process.env.FACTORY_BACKUP_TEST_DELAY_MS;
    process.env.FACTORY_BACKUP_TEST_DELAY_MS = "250";
    Bun.env.FACTORY_BACKUP_TEST_DELAY_MS = "250";
    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
        operationTimeoutMs: 100,
      });
      const pending = service.list();
      await Bun.sleep(20);
      expect(service.status().busy).toBe(true);
      await expect(pending).rejects.toThrow("Backup operation timed out");
      expect(service.status()).toMatchObject({
        busy: false,
        lastError: "Backup operation timed out.",
      });
    } finally {
      if (previousDelay === undefined) {
        delete process.env.FACTORY_BACKUP_TEST_DELAY_MS;
        delete Bun.env.FACTORY_BACKUP_TEST_DELAY_MS;
      } else {
        process.env.FACTORY_BACKUP_TEST_DELAY_MS = previousDelay;
        Bun.env.FACTORY_BACKUP_TEST_DELAY_MS = previousDelay;
      }
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("reclaims only marked dead worker artifacts after a killed staged operation", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let liveStaging: string | undefined;
    let liveLocal: string | undefined;
    let killedLocal: string | undefined;
    try {
      const unrelated = join(
        backupDirectory,
        ".factory-backup-staging-unrelated",
      );
      mkdirSync(unrelated);
      writeFileSync(join(unrelated, "keep.txt"), "unrelated");
      const outside = join(directory, "outside-staging");
      mkdirSync(outside);
      const linked = join(backupDirectory, ".factory-backup-staging-linked");
      symlinkSync(outside, linked);

      const marker = (artifactPath: string, kind: "staging" | "local") => ({
        artifactPath: resolve(artifactPath),
        backupRoot: resolve(backupDirectory),
        createdAt: new Date().toISOString(),
        databasePath: resolve(databasePath),
        format: "factory-backup-artifact",
        kind,
        pid: process.pid,
        token: "0".repeat(32),
        version: 1,
      });
      liveStaging = join(backupDirectory, ".factory-backup-staging-live");
      mkdirSync(liveStaging);
      writeFileSync(
        join(liveStaging, ".factory-backup-owner.json"),
        `${JSON.stringify(marker(liveStaging, "staging"))}\n`,
      );
      liveLocal = mkdtempSync(join(tmpdir(), "factory-backup-local-live-"));
      writeFileSync(
        join(liveLocal, ".factory-backup-owner.json"),
        `${JSON.stringify(marker(liveLocal, "local"))}\n`,
      );
      const foreignStaging = join(
        backupDirectory,
        ".factory-backup-staging-foreign",
      );
      mkdirSync(foreignStaging);
      writeFileSync(
        join(foreignStaging, ".factory-backup-owner.json"),
        `${JSON.stringify({
          ...marker(foreignStaging, "staging"),
          backupRoot: resolve(directory, "other-backups"),
          databasePath: resolve(directory, "other.sqlite"),
          pid: 99_999_999,
        })}\n`,
      );

      child = Bun.spawn(
        [
          process.execPath,
          "run",
          fileURLToPath(new URL("../../src/backup-worker.ts", import.meta.url)),
        ],
        {
          env: {
            ...Bun.env,
            FACTORY_BACKUP_TEST_DELAY_AFTER_STAGING_MS: "5000",
          },
          stderr: "pipe",
          stdin: "pipe",
          stdout: "pipe",
        },
      );
      const childInput = child.stdin;
      if (typeof childInput === "number" || !childInput)
        throw new Error("Backup worker stdin is unavailable.");
      childInput.write(
        JSON.stringify({
          databasePath,
          directory: backupDirectory,
          kind: "create",
          requireNfs: false,
          settings: {
            enabled: true,
            intervalMinutes: 30,
            keepDaily: 30,
            keepRecent: 336,
          },
          trigger: "manual",
        }),
      );
      childInput.end();

      let killedAfterStaging = false;
      for (let attempt = 0; attempt < 300; attempt += 1) {
        const staging = readdirSync(backupDirectory).find((name) =>
          name.startsWith(".factory-backup-staging-b-"),
        );
        const local = readdirSync(tmpdir())
          .filter((name) => name.startsWith("factory-backup-local-"))
          .map((name) => join(tmpdir(), name))
          .find((candidate) => {
            try {
              const value = JSON.parse(
                readFileSync(
                  join(candidate, ".factory-backup-owner.json"),
                  "utf8",
                ),
              ) as Record<string, unknown>;
              return (
                value.backupRoot === resolve(backupDirectory) &&
                value.databasePath === resolve(databasePath) &&
                value.pid !== process.pid
              );
            } catch {
              return false;
            }
          });
        if (
          staging &&
          local &&
          existsSync(join(backupDirectory, staging, "snapshot.sqlite")) &&
          existsSync(join(local, "snapshot.sqlite"))
        ) {
          child.kill("SIGKILL");
          killedLocal = local;
          killedAfterStaging = true;
          break;
        }
        await Bun.sleep(10);
      }
      expect(killedAfterStaging).toBe(true);
      await child.exited;

      const cleanupService = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      await cleanupService.list();
      cleanupService.stop();

      expect(
        readdirSync(backupDirectory).some((name) =>
          name.startsWith(".factory-backup-staging-b-"),
        ),
      ).toBe(false);
      expect(killedLocal).toBeDefined();
      expect(existsSync(killedLocal as string)).toBe(false);
      expect(existsSync(unrelated)).toBe(true);
      expect(existsSync(join(unrelated, "keep.txt"))).toBe(true);
      expect(existsSync(linked)).toBe(true);
      expect(existsSync(liveStaging)).toBe(true);
      expect(existsSync(liveLocal)).toBe(true);
      expect(existsSync(foreignStaging)).toBe(true);
    } finally {
      if (child && child.exitCode === null) child.kill("SIGKILL");
      if (child) await child.exited.catch(() => undefined);
      if (killedLocal) rmSync(killedLocal, { force: true, recursive: true });
      if (liveLocal) rmSync(liveLocal, { force: true, recursive: true });
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects symlinked backup roots and does not follow symlinked entries", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    const outside = join(directory, "outside");
    const linkedRoot = join(directory, "linked-backups");
    mkdirSync(outside);
    symlinkSync(outside, linkedRoot);
    try {
      const service = createBackupService({
        databasePath,
        directory: linkedRoot,
      });
      await expect(service.create()).rejects.toThrow("real directory");
      await expect(service.list()).rejects.toThrow("real directory");

      const normal = createBackupService({
        databasePath,
        directory: backupDirectory,
      });
      const backup = await normal.create();
      const target = join(directory, "target");
      mkdirSync(target);
      symlinkSync(
        join(backupDirectory, backup.id),
        join(backupDirectory, "b-20260101T000000.000Z-deadbeef"),
      );
      expect((await normal.list()).map((entry) => entry.id)).toEqual([
        backup.id,
      ]);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
