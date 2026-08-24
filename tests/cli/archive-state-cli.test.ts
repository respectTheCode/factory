import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

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

describe("archive state CLI", () => {
  test("archives and restores tasks and subtasks with stable JSON", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-archive-cli-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Factory V1",
        "--database",
        databasePath,
      ]);
      const project = JSON.parse(projectResult.stdout) as {
        project: { id: string };
      };
      const taskResult = await runCli([
        "task",
        "create",
        "--name",
        "Release the slice",
        "--project-id",
        project.project.id,
        "--database",
        databasePath,
      ]);
      const task = JSON.parse(taskResult.stdout) as { task: { id: string } };
      const subtaskResult = await runCli([
        "subtask",
        "create",
        "--name",
        "Check the release",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      const subtask = JSON.parse(subtaskResult.stdout) as {
        subtask: { id: string };
      };

      const taskArchive = await runCli([
        "task",
        "archive",
        "--task-id",
        task.task.id,
        "--state",
        "released",
        "--database",
        databasePath,
      ]);
      expect(taskArchive.exitCode).toBe(0);
      expect(JSON.parse(taskArchive.stdout)).toMatchObject({
        schemaVersion: 1,
        task: { archiveState: "released", taskId: task.task.id },
      });

      const taskStatus = await runCli([
        "task",
        "status",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(taskStatus.stdout)).toMatchObject({
        schemaVersion: 1,
        status: { archiveState: "released", taskState: "released" },
      });

      const taskRestore = await runCli([
        "task",
        "restore",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      expect(taskRestore.exitCode).toBe(0);
      expect(JSON.parse(taskRestore.stdout)).toMatchObject({
        schemaVersion: 1,
        task: { archiveState: null, taskId: task.task.id },
      });

      const subtaskArchive = await runCli([
        "subtask",
        "archive",
        "--subtask-id",
        subtask.subtask.id,
        "--state",
        "wont_do",
        "--database",
        databasePath,
      ]);
      expect(subtaskArchive.exitCode).toBe(0);
      expect(JSON.parse(subtaskArchive.stdout)).toMatchObject({
        schemaVersion: 1,
        subtask: { archiveState: "wont_do", subtaskId: subtask.subtask.id },
      });

      const subtaskStatus = await runCli([
        "subtask",
        "status",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(subtaskStatus.stdout)).toMatchObject({
        schemaVersion: 1,
        status: {
          subtasks: [{ archiveState: "wont_do" }],
        },
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
