import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createBackupService } from "../../src/backup-service";

describe("Factory backup worker startup failures", () => {
  test("releases busy state when spawn fails and allows a repaired operation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-spawn-"));
    const databaseParent = join(directory, "missing-parent");
    const databasePath = join(databaseParent, "factory.sqlite");
    const backupDirectory = join(directory, "backups");
    mkdirSync(backupDirectory);

    try {
      const service = createBackupService({
        databasePath,
        directory: backupDirectory,
      });

      await expect(service.list()).rejects.toThrow();
      expect(service.status().busy).toBe(false);

      mkdirSync(databaseParent);
      await expect(service.list()).resolves.toEqual([]);
      expect(service.status().busy).toBe(false);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
