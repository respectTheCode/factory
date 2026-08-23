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

type DatabaseCheckOutput = {
  schemaVersion: 1;
  check: {
    databasePath: string;
    integrity: "ok";
    counts: {
      projects: number;
      tasks: number;
      subtasks: number;
      statusReports: number;
      verifications: number;
      trackerLinks: number;
    };
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
  test("checks database integrity and reports persisted entity counts", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-database-check-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Integrity check project",
        "--database",
        databasePath,
      ]);
      expect(projectResult.exitCode).toBe(0);
      const project = JSON.parse(projectResult.stdout) as {
        project: { id: string };
      };

      const taskResult = await runCli([
        "task",
        "create",
        "--name",
        "Integrity check task",
        "--project-id",
        project.project.id,
        "--database",
        databasePath,
      ]);
      expect(taskResult.exitCode).toBe(0);
      const task = JSON.parse(taskResult.stdout) as {
        task: { id: string };
      };

      const subtaskResult = await runCli([
        "subtask",
        "create",
        "--name",
        "Integrity check subtask",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      expect(subtaskResult.exitCode).toBe(0);

      const checkResult = await runCli([
        "database",
        "check",
        "--database",
        databasePath,
        "--json",
      ]);

      expect(checkResult.exitCode).toBe(0);
      expect(checkResult.stderr).toBe("");
      expect(JSON.parse(checkResult.stdout) as DatabaseCheckOutput).toEqual({
        schemaVersion: 1,
        check: {
          databasePath,
          integrity: "ok",
          counts: {
            projects: 1,
            tasks: 1,
            subtasks: 1,
            statusReports: 0,
            verifications: 0,
            trackerLinks: 0,
          },
        },
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

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
