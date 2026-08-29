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

describe("task editing CLI", () => {
  test("updates Task and Subtask titles and descriptions with stable JSON", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-task-editing-"),
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
        "Original task title",
        "--objective",
        "Original task description",
        "--branch-name",
        "feature/task-editing",
        "--project-id",
        project.project.id,
        "--database",
        databasePath,
      ]);
      const task = JSON.parse(taskResult.stdout) as {
        task: { id: string };
      };

      const subtaskResult = await runCli([
        "subtask",
        "create",
        "--name",
        "Original subtask title",
        "--description",
        "Original subtask description",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      const subtask = JSON.parse(subtaskResult.stdout) as {
        subtask: { id: string };
      };

      const taskUpdateResult = await runCli([
        "task",
        "update",
        "--task-id",
        task.task.id,
        "--title",
        "Updated task title",
        "--description",
        "Updated task description",
        "--acceptance-criteria",
        "Updated criterion|Second updated criterion",
        "--database",
        databasePath,
      ]);
      expect(taskUpdateResult.exitCode).toBe(0);
      expect(JSON.parse(taskUpdateResult.stdout)).toMatchObject({
        schemaVersion: 1,
        task: {
          acceptanceCriteria: ["Updated criterion", "Second updated criterion"],
          branchName: "feature/task-editing",
          name: "Updated task title",
          objective: "Updated task description",
        },
      });

      const subtaskUpdateResult = await runCli([
        "subtask",
        "update",
        "--subtask-id",
        subtask.subtask.id,
        "--title",
        "Updated subtask title",
        "--description",
        "Updated subtask description",
        "--database",
        databasePath,
      ]);
      expect(subtaskUpdateResult.exitCode).toBe(0);
      expect(JSON.parse(subtaskUpdateResult.stdout)).toMatchObject({
        schemaVersion: 1,
        subtask: {
          description: "Updated subtask description",
          name: "Updated subtask title",
          taskId: task.task.id,
        },
      });

      const reportResult = await runCli([
        "subtask",
        "report",
        "--subtask-id",
        subtask.subtask.id,
        "--state",
        "in_progress",
        "--reporter",
        "codex",
        "--database",
        databasePath,
      ]);
      expect(reportResult.exitCode).toBe(0);

      const lateCriteriaUpdateResult = await runCli([
        "task",
        "update",
        "--task-id",
        task.task.id,
        "--acceptance-criteria",
        "Late criterion",
        "--database",
        databasePath,
      ]);
      expect(lateCriteriaUpdateResult.exitCode).toBe(1);
      expect(lateCriteriaUpdateResult.stderr).toContain("planning phase");

      const clearDescriptionResult = await runCli([
        "task",
        "update",
        "--task-id",
        task.task.id,
        "--description",
        "",
        "--database",
        databasePath,
      ]);
      expect(clearDescriptionResult.exitCode).toBe(0);
      expect(
        (JSON.parse(clearDescriptionResult.stdout) as { task: object }).task,
      ).not.toHaveProperty("objective");

      const clearSubtaskDescriptionResult = await runCli([
        "subtask",
        "update",
        "--subtask-id",
        subtask.subtask.id,
        "--description",
        "",
        "--database",
        databasePath,
      ]);
      expect(clearSubtaskDescriptionResult.exitCode).toBe(0);
      expect(
        (
          JSON.parse(clearSubtaskDescriptionResult.stdout) as {
            subtask: object;
          }
        ).subtask,
      ).not.toHaveProperty("description");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
