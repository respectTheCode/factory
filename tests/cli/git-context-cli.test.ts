import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

type ProjectCreateOutput = {
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
    gitOriginUrl: string;
  };
};

type TaskCreateOutput = {
  schemaVersion: 1;
  task: {
    id: string;
    name: string;
    projectId: string;
    branchName: string;
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

describe("git context CLI metadata", () => {
  test("accepts and returns git origin and branch metadata", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-git-context-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Grail",
        "--git-origin-url",
        "git@github.com:app-press/grail.git",
        "--database",
        databasePath,
      ]);

      expect(projectResult.exitCode).toBe(0);
      const project = (JSON.parse(projectResult.stdout) as ProjectCreateOutput)
        .project;
      expect(project).toMatchObject({
        name: "Grail",
        gitOriginUrl: "git@github.com:app-press/grail.git",
      });

      const updateResult = await runCli([
        "project",
        "update",
        "--project-id",
        project.id,
        "--git-origin-url",
        "https://github.com/app-press/grail.git",
        "--database",
        databasePath,
      ]);
      expect(updateResult.exitCode).toBe(0);
      expect(JSON.parse(updateResult.stdout)).toMatchObject({
        project: {
          id: project.id,
          gitOriginUrl: "https://github.com/app-press/grail.git",
        },
      });

      const taskResult = await runCli([
        "task",
        "create",
        "--name",
        "Build preview environments",
        "--project-id",
        project.id,
        "--branch-name",
        "GRA-143-preview-environments",
        "--database",
        databasePath,
      ]);

      expect(taskResult.exitCode).toBe(0);
      expect(JSON.parse(taskResult.stdout) as TaskCreateOutput).toMatchObject({
        schemaVersion: 1,
        task: {
          name: "Build preview environments",
          projectId: project.id,
          branchName: "GRA-143-preview-environments",
        },
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
