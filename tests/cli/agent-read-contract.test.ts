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

describe("agent CLI read contract", () => {
  test("reads attention, task detail, and subtask history as stable JSON", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-agent-cli-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Grail roadmap",
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
        "Release the next build",
        "--project-id",
        project.project.id,
        "--priority",
        "high",
        "--owner",
        "kevin",
        "--database",
        databasePath,
      ]);
      const task = JSON.parse(taskResult.stdout) as {
        task: { id: string; simpleId: string };
      };
      const projectLinkResult = await runCli([
        "project",
        "link",
        "--project-id",
        project.project.id,
        "--system",
        "notion",
        "--stable-id",
        "PRO-1412",
        "--title",
        "Preview environments",
        "--url",
        "https://www.notion.so/playlister/preview-environments",
        "--database",
        databasePath,
      ]);
      expect(projectLinkResult.exitCode).toBe(0);
      expect(JSON.parse(projectLinkResult.stdout)).toMatchObject({
        schemaVersion: 1,
        link: {
          projectId: project.project.id,
          stableId: "PRO-1412",
          system: "notion",
        },
      });
      const taskLinkResult = await runCli([
        "task",
        "link",
        "--task-id",
        task.task.simpleId,
        "--system",
        "linear",
        "--stable-id",
        "GRA-143",
        "--url",
        "https://linear.app/playlister/issue/GRA-143",
        "--database",
        databasePath,
      ]);
      expect(taskLinkResult.exitCode).toBe(0);
      expect(JSON.parse(taskLinkResult.stdout)).toMatchObject({
        schemaVersion: 1,
        link: {
          stableId: "GRA-143",
          system: "linear",
          taskId: task.task.id,
        },
      });
      const subtaskResult = await runCli([
        "subtask",
        "create",
        "--name",
        "Run the release checks",
        "--task-id",
        task.task.id,
        "--database",
        databasePath,
      ]);
      const subtask = JSON.parse(subtaskResult.stdout) as {
        subtask: { id: string; simpleId: string };
      };
      const reportResult = await runCli([
        "subtask",
        "report",
        "--subtask-id",
        subtask.subtask.simpleId,
        "--state",
        "in_progress",
        "--reporter",
        "codex",
        "--evidence",
        "Release checks are running",
        "--database",
        databasePath,
      ]);
      expect(reportResult.exitCode).toBe(0);

      const attentionResult = await runCli([
        "project",
        "attention",
        "--json",
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(attentionResult.stdout)).toEqual({
        schemaVersion: 1,
        attention: [
          {
            owner: "kevin",
            priority: "high",
            projectId: project.project.id,
            projectName: "Grail roadmap",
            state: "active",
            taskId: task.task.id,
            taskSimpleId: task.task.simpleId,
            taskName: "Release the next build",
          },
        ],
      });

      const detailResult = await runCli([
        "task",
        "detail",
        "--task-id",
        task.task.simpleId,
        "--json",
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(detailResult.stdout)).toMatchObject({
        schemaVersion: 1,
        task: {
          id: task.task.id,
          simpleId: task.task.simpleId,
          name: "Release the next build",
          owner: "kevin",
          priority: "high",
          projectId: project.project.id,
        },
      });

      const historyResult = await runCli([
        "subtask",
        "history",
        "--subtask-id",
        subtask.subtask.simpleId,
        "--json",
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(historyResult.stdout)).toMatchObject({
        schemaVersion: 1,
        history: {
          reports: [
            {
              reportedState: "in_progress",
              reporter: "codex",
              evidence: "Release checks are running",
            },
          ],
          verifications: [],
        },
      });

      const verifyResult = await runCli([
        "subtask",
        "verify",
        "--subtask-id",
        subtask.subtask.simpleId,
        "--decision",
        "accepted",
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
