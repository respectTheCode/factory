import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";

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

describe("project brief CLI", () => {
  test("fails closed when the selected Project does not exist", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-brief-missing-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const result = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--database",
        databasePath,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr.trim()).toBe(
        `No Factory Project matches workspace root ${temporaryDirectory}.`,
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("fails closed and names both Projects when the selector is ambiguous", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-brief-ambiguous-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const first = app.createProject({
        name: "First project",
        workspaceRoot: temporaryDirectory,
      });
      const second = app.createProject({
        name: "Second project",
        workspaceRoot: temporaryDirectory,
      });
      const result = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--database",
        databasePath,
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(first.id);
      expect(result.stderr).toContain(second.id);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("renders the uniquely matched branch Task, Subtask, and read commands", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-brief-branch-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const branchName = "factory-project-brief";

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
        gitOriginUrl: "git@github.com:app-press/factory.git",
        name: "Factory",
        workspaceRoot: temporaryDirectory,
      });
      app.addProjectTrackerLink({
        projectId: project.id,
        stableId: "FACT-1",
        system: "linear",
        url: "https://linear.app/app-press/issue/FACT-1",
      });
      const task = app.createTask({
        acceptanceCriteria: ["The brief is stable", "The cap is enforced"],
        branchName,
        dependencies: ["Existing CLI conventions"],
        name: "Add project brief",
        objective: "Give a coding session durable Factory context.",
        projectId: project.id,
      });
      app.addTaskTrackerLink({
        stableId: "FACT-2",
        system: "linear",
        taskId: task.id,
        url: "https://linear.app/app-press/issue/FACT-2",
      });
      const subtask = app.createSubtask({
        description: "Render the current work evidence.",
        name: "Render current status",
        taskId: task.id,
      });
      app.reportSubtaskStatus({
        evidence: "Status report evidence appears in the volatile section.",
        reportedState: "in_progress",
        reporter: "codex",
        subtaskId: subtask.id,
      });

      const result = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--branch-name",
        branchName,
        "--json",
        "--database",
        databasePath,
      ]);
      const payload = JSON.parse(result.stdout) as {
        schemaVersion: number;
        brief: {
          candidateTaskIds: string[];
          markdown: string;
          project: { id: string; name: string };
          task: { id: string; name: string } | null;
        };
      };

      expect(result.exitCode).toBe(0);
      expect(payload.schemaVersion).toBe(1);
      expect(payload.brief.project).toEqual({
        id: project.id,
        name: "Factory",
      });
      expect(payload.brief.task).toEqual({
        id: task.id,
        name: task.name,
      });
      expect(payload.brief.markdown).toContain(`## Task`);
      expect(payload.brief.markdown).toContain(task.id);
      expect(payload.brief.markdown).toContain(subtask.id);
      expect(payload.brief.markdown).toContain(
        `subtask report --json --subtask-id ${subtask.id} --state in_progress --reporter "$FACTORY_REPORTER"`,
      );
      expect(payload.brief.markdown).toContain(
        `session auto-link --project-id ${project.id} --task-id ${task.id} --branch-name '${branchName}'`,
      );
      expect(payload.brief.markdown).toContain(
        `subtask history --subtask-id ${subtask.id} --json`,
      );
      expect(payload.brief.markdown).toContain(
        `task detail --task-id ${task.id} --json`,
      );
      expect(payload.brief.markdown).toContain("FACT-1");
      expect(payload.brief.candidateTaskIds).toEqual([]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("keeps stable content and Commands before the volatile Current status", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-brief-order-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
        name: "Ordering project",
        workspaceRoot: temporaryDirectory,
      });
      const task = app.createTask({
        acceptanceCriteria: ["Acceptance is visible before status."],
        name: "Ordering task",
        objective: "Objective is visible before status.",
        projectId: project.id,
      });
      const subtask = app.createSubtask({ name: "Child", taskId: task.id });
      app.reportSubtaskStatus({
        evidence: "Status Report text should be volatile.",
        reportedState: "in_progress",
        reporter: "codex",
        subtaskId: subtask.id,
      });

      const result = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--task-id",
        task.id,
        "--database",
        databasePath,
      ]);
      const markdown = result.stdout.trimEnd();

      expect(result.exitCode).toBe(0);
      expect(markdown.indexOf("## Commands")).toBeLessThan(
        markdown.indexOf("## Current status"),
      );
      expect(
        markdown.indexOf("Objective is visible before status."),
      ).toBeLessThan(
        markdown.indexOf("Status Report text should be volatile."),
      );
      expect(
        markdown.indexOf("Acceptance is visible before status."),
      ).toBeLessThan(
        markdown.indexOf("Status Report text should be volatile."),
      );
      expect(markdown.split("\n").at(-1)).toMatch(/^Generated /);
      expect(markdown).not.toContain("Factory brief truncated");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("renders a project-only brief when the branch matches no Task", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-brief-open-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
        name: "Open task project",
        workspaceRoot: temporaryDirectory,
      });
      const task = app.createTask({
        branchName: "different-branch",
        name: "Existing open task",
        projectId: project.id,
      });

      const result = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--branch-name",
        "missing-branch",
        "--json",
        "--database",
        databasePath,
      ]);
      const payload = JSON.parse(result.stdout) as {
        brief: {
          candidateTaskIds: string[];
          markdown: string;
          task: null;
        };
      };

      expect(result.exitCode).toBe(0);
      expect(payload.brief.task).toBeNull();
      expect(payload.brief.candidateTaskIds).toEqual([]);
      expect(payload.brief.markdown).toContain("## Open Tasks");
      expect(payload.brief.markdown).toContain(task.id);
      expect(payload.brief.markdown).toContain(
        "Branch missing-branch matched zero non-archived Tasks.",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("renders project-only context and candidate IDs when a branch is ambiguous", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-brief-branch-ambiguous-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const branchName = "duplicate-branch";

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
        name: "Ambiguous branch project",
        workspaceRoot: temporaryDirectory,
      });
      const first = app.createTask({
        branchName,
        name: "First matching task",
        projectId: project.id,
      });
      const second = app.createTask({
        branchName,
        name: "Second matching task",
        projectId: project.id,
      });

      const result = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--branch-name",
        branchName,
        "--json",
        "--database",
        databasePath,
      ]);
      const payload = JSON.parse(result.stdout) as {
        brief: {
          candidateTaskIds: string[];
          markdown: string;
          task: null;
        };
      };

      expect(result.exitCode).toBe(0);
      expect(payload.brief.task).toBeNull();
      expect(payload.brief.candidateTaskIds).toEqual([first.id, second.id]);
      expect(payload.brief.markdown).toContain(
        `Branch ${branchName} matched several non-archived Tasks; candidates: ${first.id}, ${second.id}.`,
      );
      expect(payload.brief.markdown).toContain(first.id);
      expect(payload.brief.markdown).toContain(second.id);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("caps output with a final notice and reports truncation in JSON", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-brief-cap-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
        name: "Large brief project",
        workspaceRoot: temporaryDirectory,
      });
      const task = app.createTask({
        name: "Large brief task",
        objective: "A long objective keeps stable content ahead of status.",
        projectId: project.id,
      });
      for (let index = 0; index < 8; index += 1) {
        const subtask = app.createSubtask({
          description: `Description ${index} with enough content to exercise the brief character cap.`,
          name: `Subtask ${index} with a deliberately long name`,
          taskId: task.id,
        });
        app.reportSubtaskStatus({
          evidence: `Evidence ${index} makes the current status section large enough to truncate.`,
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: subtask.id,
        });
      }

      const cappedResult = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--task-id",
        task.id,
        "--max-chars",
        "1000",
        "--json",
        "--database",
        databasePath,
      ]);
      const cappedPayload = JSON.parse(cappedResult.stdout) as {
        brief: {
          characterCount: number;
          markdown: string;
          truncated: boolean;
        };
      };
      const defaultResult = await runCli([
        "project",
        "brief",
        "--workspace-root",
        temporaryDirectory,
        "--task-id",
        task.id,
        "--json",
        "--database",
        databasePath,
      ]);
      const defaultPayload = JSON.parse(defaultResult.stdout) as {
        brief: { markdown: string; truncated: boolean };
      };

      expect(cappedResult.exitCode).toBe(0);
      expect(cappedPayload.brief.characterCount).toBeLessThanOrEqual(1000);
      expect(cappedPayload.brief.markdown.length).toBeLessThanOrEqual(1000);
      expect(cappedPayload.brief.truncated).toBe(true);
      expect(cappedPayload.brief.markdown.split("\n").at(-1)).toMatch(
        /^\[Factory brief truncated to 1000 of \d+ characters\. Run:/,
      );
      expect(defaultResult.exitCode).toBe(0);
      expect(defaultPayload.brief.truncated).toBe(false);
      expect(defaultPayload.brief.markdown).not.toContain(
        "Factory brief truncated",
      );
      expect(defaultPayload.brief.markdown.length).toBeGreaterThan(1000);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
