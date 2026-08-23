import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

type ProjectCreateOutput = {
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
  };
};

type ProjectListOutput = {
  schemaVersion: 1;
  projects: Array<{
    id: string;
    name: string;
  }>;
};

type TaskCreateOutput = {
  schemaVersion: 1;
  task: {
    id: string;
    name: string;
    projectId: string;
  };
};

type SubtaskCreateOutput = {
  schemaVersion: 1;
  subtask: {
    id: string;
    name: string;
    taskId: string;
  };
};

type SubtaskReportOutput = {
  schemaVersion: 1;
  report: {
    id: string;
    subtaskId: string;
    reportedState: string;
    reporter: string;
    evidence?: string;
  };
};

type SubtaskStatusOutput = {
  schemaVersion: 1;
  status: {
    taskCompleted: boolean;
    subtasks: Array<{
      id: string;
      reportedState: string;
      verificationState: string;
      reporter: string;
      evidence?: string;
    }>;
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

describe("project CLI", () => {
  test("creates and lists a project with stable JSON output", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const createResult = await runCli([
        "project",
        "create",
        "--name",
        "Website refresh",
        "--database",
        databasePath,
      ]);

      expect(createResult.exitCode).toBe(0);
      const created = JSON.parse(createResult.stdout) as ProjectCreateOutput;
      expect(created).toMatchObject({
        schemaVersion: 1,
        project: { name: "Website refresh" },
      });
      expect(created.project.id).toEqual(expect.any(String));

      const listResult = await runCli([
        "project",
        "list",
        "--database",
        databasePath,
      ]);

      expect(listResult.exitCode).toBe(0);
      const listed = JSON.parse(listResult.stdout) as ProjectListOutput;
      expect(listed).toMatchObject({ schemaVersion: 1 });
      expect(listed.projects).toContainEqual(created.project);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("reports subtask progress and reserves verification for a human", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-status-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Website refresh",
        "--database",
        databasePath,
      ]);
      const project = (JSON.parse(projectResult.stdout) as ProjectCreateOutput)
        .project;

      const taskResult = await runCli([
        "task",
        "create",
        "--name",
        "Publish the refreshed site",
        "--project-id",
        project.id,
        "--database",
        databasePath,
      ]);
      const task = (JSON.parse(taskResult.stdout) as TaskCreateOutput).task;

      const subtaskResult = await runCli([
        "subtask",
        "create",
        "--name",
        "Verify the production build",
        "--task-id",
        task.id,
        "--database",
        databasePath,
      ]);
      const subtask = (JSON.parse(subtaskResult.stdout) as SubtaskCreateOutput)
        .subtask;

      const reportResult = await runCli([
        "subtask",
        "report",
        "--subtask-id",
        subtask.id,
        "--state",
        "complete",
        "--reporter",
        "codex",
        "--evidence",
        "Build 2026-08-22 passed in CI.",
        "--database",
        databasePath,
      ]);
      expect(reportResult.exitCode).toBe(0);
      const report = (JSON.parse(reportResult.stdout) as SubtaskReportOutput)
        .report;

      const statusResult = await runCli([
        "subtask",
        "status",
        "--task-id",
        task.id,
        "--database",
        databasePath,
      ]);
      expect(statusResult.exitCode).toBe(0);
      const status = JSON.parse(statusResult.stdout) as SubtaskStatusOutput;
      expect(status).toMatchObject({
        schemaVersion: 1,
        status: {
          taskCompleted: false,
          subtasks: [
            {
              id: report.id,
              reportedState: "complete",
              verificationState: "awaiting_verification",
              reporter: "codex",
              evidence: "Build 2026-08-22 passed in CI.",
            },
          ],
        },
      });

      const verifyResult = await runCli([
        "subtask",
        "verify",
        "--report-id",
        report.id,
        "--decision",
        "accepted",
        "--verifier",
        "kevin",
        "--database",
        databasePath,
      ]);
      expect(verifyResult.exitCode).not.toBe(0);
      expect(verifyResult.stderr).toContain("Human verification");
      expect(verifyResult.stderr).toContain("Factory dashboard");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
