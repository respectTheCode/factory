import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { createFactoryApplication } from "../../src/application";

type ProjectCreateOutput = {
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
    gitOriginUrl?: string;
    workspaceRoot?: string;
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
  test("does not anchor a persisted relative workspace root to the CLI cwd", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-relative-root-"));
    try {
      const databasePath = join(directory, "factory.sqlite");
      const app = createFactoryApplication({ databasePath });
      app.createProject({ name: "Legacy relative root", workspaceRoot: "." });
      const result = await runCli([
        "project",
        "context",
        "--workspace-root",
        ".",
        "--database",
        databasePath,
        "--json",
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  test("resolves project and task context by workspace root without a Git remote", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-workspace-context-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const workspaceRoot = join(temporaryDirectory, "factory");

    try {
      const projectResult = await runCli([
        "project",
        "create",
        "--name",
        "Factory",
        "--workspace-root",
        workspaceRoot,
        "--database",
        databasePath,
      ]);
      expect(projectResult.exitCode).toBe(0);
      const project = (JSON.parse(projectResult.stdout) as ProjectCreateOutput)
        .project;

      const taskResult = await runCli([
        "task",
        "create",
        "--name",
        "Automatic associations",
        "--project-id",
        project.id,
        "--branch-name",
        "factory-agent-session-auto-linking",
        "--database",
        databasePath,
      ]);
      const task = (JSON.parse(taskResult.stdout) as TaskCreateOutput).task;

      const contextResult = await runCli([
        "project",
        "context",
        "--workspace-root",
        join(workspaceRoot, "."),
        "--branch-name",
        "factory-agent-session-auto-linking",
        "--json",
        "--database",
        databasePath,
      ]);
      expect(contextResult.exitCode).toBe(0);
      expect(JSON.parse(contextResult.stdout)).toMatchObject({
        schemaVersion: 1,
        context: {
          id: project.id,
          workspaceRoot,
          tasks: [{ id: task.id }],
        },
      });

      const attentionResult = await runCli([
        "project",
        "attention",
        "--workspace-root",
        workspaceRoot,
        "--json",
        "--database",
        databasePath,
      ]);
      expect(attentionResult.exitCode).toBe(0);
      expect(JSON.parse(attentionResult.stdout)).toMatchObject({
        attention: [{ projectId: project.id, taskId: task.id }],
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

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

      const taskUpdateResult = await runCli([
        "task",
        "update",
        "--task-id",
        (JSON.parse(taskResult.stdout) as TaskCreateOutput).task.id,
        "--branch-name",
        "GRA-143-preview-environments-v2",
        "--database",
        databasePath,
      ]);
      expect(taskUpdateResult.exitCode).toBe(0);
      expect(JSON.parse(taskUpdateResult.stdout)).toMatchObject({
        task: {
          branchName: "GRA-143-preview-environments-v2",
        },
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("isolates project and task context across equivalent Git origin forms", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-origin-context-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const grailProjectResult = await runCli([
        "project",
        "create",
        "--name",
        "Grail",
        "--git-origin-url",
        "git@github.com:app-press/grail.git",
        "--database",
        databasePath,
      ]);
      const grailProject = (
        JSON.parse(grailProjectResult.stdout) as ProjectCreateOutput
      ).project;
      const playlisterProjectResult = await runCli([
        "project",
        "create",
        "--name",
        "Playlister",
        "--git-origin-url",
        "https://github.com/app-press/playlister.git",
        "--database",
        databasePath,
      ]);
      const playlisterProject = (
        JSON.parse(playlisterProjectResult.stdout) as ProjectCreateOutput
      ).project;
      await runCli([
        "task",
        "create",
        "--name",
        "Unrelated Playlister task",
        "--project-id",
        playlisterProject.id,
        "--database",
        databasePath,
      ]);
      const taskResult = await runCli([
        "task",
        "create",
        "--name",
        "Preview environments",
        "--project-id",
        grailProject.id,
        "--branch-name",
        "GRA-143-preview-environments",
        "--database",
        databasePath,
      ]);
      const task = (JSON.parse(taskResult.stdout) as TaskCreateOutput).task;
      await runCli([
        "subtask",
        "create",
        "--name",
        "Verify the preview",
        "--task-id",
        task.id,
        "--database",
        databasePath,
      ]);
      await runCli([
        "task",
        "link",
        "--task-id",
        task.id,
        "--system",
        "linear",
        "--stable-id",
        "GRA-143",
        "--url",
        "https://linear.app/playlister/issue/GRA-143",
        "--database",
        databasePath,
      ]);

      const listResult = await runCli([
        "project",
        "list",
        "--git-origin-url",
        "https://github.com/app-press/grail/",
        "--json",
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(listResult.stdout)).toEqual({
        schemaVersion: 1,
        projects: [grailProject],
      });

      const contextResult = await runCli([
        "project",
        "context",
        "--git-origin-url",
        "ssh://git@github.com/app-press/grail.git",
        "--branch-name",
        "GRA-143-preview-environments",
        "--json",
        "--database",
        databasePath,
      ]);
      expect(contextResult.exitCode).toBe(0);
      expect(JSON.parse(contextResult.stdout)).toMatchObject({
        schemaVersion: 1,
        context: {
          id: grailProject.id,
          gitOriginUrl: "git@github.com:app-press/grail.git",
          tasks: [
            {
              id: task.id,
              branchName: "GRA-143-preview-environments",
              subtasks: [{ name: "Verify the preview" }],
              trackerLinks: [{ stableId: "GRA-143", system: "linear" }],
            },
          ],
        },
      });

      const attentionResult = await runCli([
        "project",
        "attention",
        "--git-origin-url",
        "git@github.com:app-press/grail.git",
        "--json",
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(attentionResult.stdout)).toEqual({
        schemaVersion: 1,
        attention: [
          {
            projectId: grailProject.id,
            projectName: "Grail",
            state: "planned",
            taskId: task.id,
            taskName: "Preview environments",
          },
        ],
      });

      await runCli([
        "task",
        "create",
        "--name",
        "Duplicate branch context",
        "--project-id",
        grailProject.id,
        "--branch-name",
        "GRA-143-preview-environments",
        "--database",
        databasePath,
      ]);
      const ambiguousBranchResult = await runCli([
        "project",
        "context",
        "--git-origin-url",
        "git@github.com:app-press/grail.git",
        "--branch-name",
        "GRA-143-preview-environments",
        "--database",
        databasePath,
      ]);
      expect(ambiguousBranchResult.exitCode).toBe(1);
      expect(ambiguousBranchResult.stderr).toContain(
        "matches multiple Factory Tasks",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("fails closed when a Git origin does not resolve uniquely", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-origin-ambiguity-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const missingResult = await runCli([
        "project",
        "context",
        "--git-origin-url",
        "https://github.com/app-press/missing.git",
        "--database",
        databasePath,
      ]);
      expect(missingResult.exitCode).toBe(1);
      expect(missingResult.stderr).toContain("No Factory Project matches");

      for (const origin of [
        "git@github.com:app-press/grail.git",
        "https://github.com/app-press/grail",
      ]) {
        await runCli([
          "project",
          "create",
          "--name",
          `Grail ${origin}`,
          "--git-origin-url",
          origin,
          "--database",
          databasePath,
        ]);
      }

      const ambiguousResult = await runCli([
        "project",
        "context",
        "--git-origin-url",
        "ssh://git@github.com/app-press/grail.git",
        "--database",
        databasePath,
      ]);
      expect(ambiguousResult.exitCode).toBe(1);
      expect(ambiguousResult.stderr).toContain(
        "matches multiple Factory Projects",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("fails closed when a workspace root does not resolve uniquely", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-cli-workspace-ambiguity-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const workspaceRoot = join(temporaryDirectory, "factory");

    try {
      const missingResult = await runCli([
        "project",
        "context",
        "--workspace-root",
        join(temporaryDirectory, "missing"),
        "--database",
        databasePath,
      ]);
      expect(missingResult.exitCode).toBe(1);
      expect(missingResult.stderr).toContain("No Factory Project matches");

      for (const name of ["Factory one", "Factory two"]) {
        await runCli([
          "project",
          "create",
          "--name",
          name,
          "--workspace-root",
          workspaceRoot,
          "--database",
          databasePath,
        ]);
      }

      const ambiguousResult = await runCli([
        "project",
        "context",
        "--workspace-root",
        workspaceRoot,
        "--database",
        databasePath,
      ]);
      expect(ambiguousResult.exitCode).toBe(1);
      expect(ambiguousResult.stderr).toContain(
        "matches multiple Factory Projects",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
