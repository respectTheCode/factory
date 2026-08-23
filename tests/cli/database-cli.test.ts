import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

type BackupOutput = {
  schemaVersion: 1;
  backup: {
    sourcePath: string;
    destinationPath: string;
    sizeBytes: number;
  };
};

async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, "../.."),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  return { exitCode, stderr, stdout };
}

describe("database CLI", () => {
  test("creates a stable JSON backup from the configured database", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-database-cli-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const backupPath = join(temporaryDirectory, "backups", "factory.sqlite");

    try {
      const createResult = await runCli([
        "project",
        "create",
        "--name",
        "Backup me",
        "--database",
        databasePath,
      ]);
      expect(createResult.exitCode).toBe(0);

      const backupResult = await runCli([
        "database",
        "backup",
        "--database",
        databasePath,
        "--output",
        backupPath,
        "--json",
      ]);

      expect(backupResult.exitCode).toBe(0);
      expect(backupResult.stderr).toBe("");
      const output = JSON.parse(backupResult.stdout) as BackupOutput;
      expect(output).toMatchObject({
        schemaVersion: 1,
        backup: {
          destinationPath: backupPath,
          sourcePath: databasePath,
        },
      });
      expect(output.backup.sizeBytes).toBeGreaterThan(0);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
