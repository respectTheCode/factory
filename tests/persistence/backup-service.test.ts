import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createBackupService } from "../../src/backup-service";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-backup-service-"));
  const databasePath = join(directory, "factory.sqlite");
  const backupDirectory = join(directory, "nfs-backups");
  const application = createFactoryApplication({ databasePath });
  application.createProject({ name: "Backup fixture" });
  application.close();
  mkdirSync(backupDirectory);
  return { backupDirectory, databasePath, directory };
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
    const { backupDirectory, databasePath, directory } = fixture();
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
        integrity: "verified",
      });
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

  test("prepares a verified local restore copy and creates a mandatory pre-restore backup", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
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
