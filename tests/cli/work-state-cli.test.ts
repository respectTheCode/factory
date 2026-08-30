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

function parseOutput(stdout: string): Record<string, any> {
  const parsed = JSON.parse(stdout) as Record<string, any>;
  expect(parsed.schemaVersion).toBe(1);
  return parsed;
}

describe("agent CLI work-state contract", () => {
  test("changes task state, reorders work, and reports a backlog reason", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-work-state-cli-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const gitOriginUrl = "git@github.com:app-press/factory.git";

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Work state CLI",
        "--git-origin-url",
        gitOriginUrl,
        "--database",
        databasePath,
      ]);
      const project = parseOutput(projectResult.stdout).project as {
        id: string;
      };

      const taskIds: string[] = [];
      for (const name of ["First", "Second", "Third"]) {
        const result = await runCli([
          "task",
          "create",
          "--name",
          name,
          "--project-id",
          project.id,
          "--database",
          databasePath,
        ]);
        taskIds.push((parseOutput(result.stdout).task as { id: string }).id);
      }

      const activeResult = await runCli([
        "task",
        "state",
        "--task-id",
        taskIds[0] as string,
        "--state",
        "active",
        "--reason",
        "The implementation is now underway",
        "--database",
        databasePath,
      ]);
      expect(activeResult.exitCode).toBe(0);
      const activeStatus = await runCli([
        "task",
        "status",
        "--task-id",
        taskIds[0] as string,
        "--database",
        databasePath,
      ]);
      expect(parseOutput(activeStatus.stdout).status).toMatchObject({
        taskState: "active",
      });

      const blockedResult = await runCli([
        "task",
        "state",
        "--task-id",
        taskIds[0] as string,
        "--state",
        "blocked",
        "--reason",
        "Waiting on the external dependency",
        "--database",
        databasePath,
      ]);
      expect(blockedResult.exitCode).toBe(0);
      expect(parseOutput(blockedResult.stdout).status).toMatchObject({
        stateReason: "Waiting on the external dependency",
        taskState: "blocked",
      });

      const plannedResult = await runCli([
        "task",
        "state",
        "--task-id",
        taskIds[0] as string,
        "--state",
        "planned",
        "--database",
        databasePath,
      ]);
      expect(plannedResult.exitCode).toBe(0);

      const completedResult = await runCli([
        "task",
        "state",
        "--task-id",
        taskIds[0] as string,
        "--state",
        "completed",
        "--database",
        databasePath,
      ]);
      expect(completedResult.exitCode).toBe(1);
      expect(completedResult.stderr).toContain("completed");

      const reorderResult = await runCli([
        "task",
        "reorder",
        "--project-id",
        project.id,
        "--state",
        "planned",
        "--task-ids",
        `${taskIds[2]}|${taskIds[0]}|${taskIds[1]}`,
        "--database",
        databasePath,
      ]);
      expect(reorderResult.exitCode).toBe(0);
      parseOutput(reorderResult.stdout);

      const subtaskIds: string[] = [];
      for (const name of ["One", "Two", "Three"]) {
        const result = await runCli([
          "subtask",
          "create",
          "--name",
          name,
          "--task-id",
          taskIds[2] as string,
          "--database",
          databasePath,
        ]);
        subtaskIds.push(
          (parseOutput(result.stdout).subtask as { id: string }).id,
        );
      }

      const subtaskReorderResult = await runCli([
        "subtask",
        "reorder",
        "--task-id",
        taskIds[2] as string,
        "--state",
        "planned",
        "--subtask-ids",
        `${subtaskIds[2]}|${subtaskIds[0]}|${subtaskIds[1]}`,
        "--database",
        databasePath,
      ]);
      expect(subtaskReorderResult.exitCode).toBe(0);
      parseOutput(subtaskReorderResult.stdout);

      const reportResult = await runCli([
        "subtask",
        "report",
        "--subtask-id",
        subtaskIds[0] as string,
        "--state",
        "backlog",
        "--reason",
        "Waiting for product input",
        "--reporter",
        "codex",
        "--database",
        databasePath,
      ]);
      expect(reportResult.exitCode).toBe(0);
      expect(parseOutput(reportResult.stdout).report).toMatchObject({
        reportedState: "backlog",
        reason: "Waiting for product input",
      });

      const contextResult = await runCli([
        "project",
        "context",
        "--git-origin-url",
        gitOriginUrl,
        "--database",
        databasePath,
      ]);
      expect(contextResult.exitCode).toBe(0);
      const context = parseOutput(contextResult.stdout).context as {
        tasks: Array<{
          id: string;
          subtasks: Array<{ id: string }>;
        }>;
      };
      expect(context.tasks.map((task) => task.id)).toEqual([
        taskIds[2] as string,
        taskIds[0] as string,
        taskIds[1] as string,
      ]);
      expect(context.tasks[0]?.subtasks.map((subtask) => subtask.id)).toEqual([
        subtaskIds[2] as string,
        subtaskIds[1] as string,
        subtaskIds[0] as string,
      ]);

      const verifyResult = await runCli([
        "subtask",
        "verify",
        "--subtask-id",
        subtaskIds[0] as string,
        "--decision",
        "rejected",
        "--reason",
        "The evidence is incomplete",
        "--database",
        databasePath,
      ]);
      expect(verifyResult.exitCode).toBe(1);
      expect(verifyResult.stderr).toContain("Human verification");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
