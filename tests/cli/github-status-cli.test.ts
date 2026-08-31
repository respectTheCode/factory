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

describe("GitHub PR CLI integration", () => {
  test("lets agents attach PRs and inspect an unlinked status safely", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-github-cli-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Private repo",
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
        "Ship status",
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
        "Verify status",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      const subtask = JSON.parse(subtaskResult.stdout) as {
        subtask: { id: string };
      };

      const attachTaskResult = await runCli([
        "task",
        "update",
        "--task-id",
        task.task.id,
        "--pull-request-url",
        "https://www.github.com/acme/repo/pull/42?checks=1",
        "--database",
        databasePath,
      ]);
      const attachSubtaskResult = await runCli([
        "subtask",
        "update",
        "--subtask-id",
        subtask.subtask.id,
        "--pr",
        "https://github.com/acme/repo/pull/43",
        "--database",
        databasePath,
      ]);
      expect(attachTaskResult.exitCode).toBe(0);
      expect(attachSubtaskResult.exitCode).toBe(0);
      expect(JSON.parse(attachTaskResult.stdout)).toMatchObject({
        task: { pullRequestUrl: "https://github.com/acme/repo/pull/42" },
      });
      expect(JSON.parse(attachSubtaskResult.stdout)).toMatchObject({
        subtask: { pullRequestUrl: "https://github.com/acme/repo/pull/43" },
      });

      const statusResult = await runCli([
        "task",
        "github-status",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      expect(statusResult.exitCode).toBe(0);
      expect(JSON.parse(statusResult.stdout)).toMatchObject({
        status: {
          status: "not_configured",
          checkRunsStatus: "not_requested",
          workflowRunsStatus: "not_requested",
        },
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
