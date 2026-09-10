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

function makeTemporaryPaths(prefix: string) {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), prefix));
  return {
    databasePath: join(temporaryDirectory, "factory.sqlite"),
    temporaryDirectory,
  };
}

describe("project brief CLI", () => {
  test("fails closed when the selected Project does not exist", async () => {
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-missing-",
    );

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
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-ambiguous-",
    );

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

  test("renders the matched Task and only the first open Subtask commands", async () => {
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-branch-",
    );
    const branchName = "factory-project-brief";

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
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
      const accepted = app.createSubtask({
        description: "This description is hidden after acceptance.",
        name: "Accepted check",
        taskId: task.id,
      });
      const acceptedReport = app.reportSubtaskStatus({
        reason: "The human acceptance check is complete.",
        reportedState: "complete",
        reporter: "codex",
        subtaskId: accepted.id,
      });
      app.verifyStatusReport({
        decision: "accepted",
        reportId: acceptedReport.id,
        verifier: "kevin",
      });
      const awaiting = app.createSubtask({
        description: "This description is hidden while awaiting verification.",
        name: "Awaiting check",
        taskId: task.id,
      });
      app.reportSubtaskStatus({
        reason: "Kevin checks the rendered output.",
        reportedState: "complete",
        reporter: "claude",
        subtaskId: awaiting.id,
      });
      const open = app.createSubtask({
        description: "Render the current work evidence.",
        name: "Open check",
        taskId: task.id,
      });
      app.reportSubtaskStatus({
        evidence: "The report evidence is not part of the brief.",
        reportedState: "in_progress",
        reporter: "codex",
        subtaskId: open.id,
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
          task: { id: string; name: string; simpleId: string } | null;
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
        simpleId: task.simpleId!,
      });
      expect(payload.brief.candidateTaskIds).toEqual([]);
      expect(payload.brief.markdown).toContain(
        `# Factory brief: Factory (${project.id})`,
      );
      expect(payload.brief.markdown).toContain(
        `## Task ${task.simpleId}: Add project brief`,
      );
      expect(payload.brief.markdown).toContain(
        `- ${accepted.simpleId} — Accepted check: accepted`,
      );
      expect(payload.brief.markdown).not.toContain(
        "This description is hidden after acceptance.",
      );
      expect(payload.brief.markdown).toContain(
        `- ${awaiting.simpleId} — Awaiting check: awaiting verification`,
      );
      expect(payload.brief.markdown).not.toContain(
        "This description is hidden while awaiting verification.",
      );
      expect(payload.brief.markdown).not.toContain(
        `subtask report --json --subtask-id ${awaiting.simpleId}`,
      );
      expect(payload.brief.markdown).toContain(
        `- ${open.simpleId} — Open check: Render the current work evidence.`,
      );
      expect(payload.brief.markdown).toContain(
        `subtask report --json --subtask-id ${open.simpleId} --state in_progress --reporter "$FACTORY_REPORTER"`,
      );
      expect(payload.brief.markdown).toContain(
        `session auto-link --project-id ${project.id} --task-id ${task.simpleId} --branch-name '${branchName}'`,
      );
      expect(payload.brief.markdown).toContain(
        `subtask history --subtask-id ${open.simpleId} --json`,
      );
      expect(payload.brief.markdown).toContain(
        `task detail --task-id ${task.simpleId} --json`,
      );
      expect(payload.brief.markdown).not.toContain(
        `subtask history --subtask-id ${accepted.simpleId}`,
      );
      expect(payload.brief.markdown).toContain(
        "- linear FACT-1: https://linear.app/app-press/issue/FACT-1",
      );
      expect(payload.brief.markdown).toContain(
        "- linear FACT-2: https://linear.app/app-press/issue/FACT-2",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("keeps Commands before Current status and omits volatile evidence", async () => {
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-order-",
    );
    const longEvidence =
      "This is a known long sentence that must never appear in the session brief evidence output.";

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
        name: "Ordering project",
        workspaceRoot: temporaryDirectory,
      });
      const task = app.createTask({
        acceptanceCriteria: ["Acceptance is visible before status."],
        name: "Ordering task",
        objective: "Objective is visible before any report line.",
        projectId: project.id,
      });
      const subtask = app.createSubtask({ name: "Child", taskId: task.id });
      app.reportSubtaskStatus({
        evidence: longEvidence,
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
      expect(markdown.indexOf(task.objective as string)).toBeLessThan(
        markdown.indexOf("last report"),
      );
      expect(markdown).not.toContain("Tracker links: none");
      expect(markdown).not.toContain("Generated ");
      expect(markdown).not.toContain("Open attention items");
      expect(markdown).not.toContain("project attention");
      expect(markdown).not.toContain(longEvidence);
      expect(markdown).not.toContain("Status Report");
      expect(markdown.split("\n").at(-1)).toContain("2026-");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("puts project-only Open Tasks last and includes each Task state", async () => {
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-open-",
    );

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({
        name: "Open task project",
        workspaceRoot: temporaryDirectory,
      });
      const planned = app.createTask({
        name: "Planned task",
        projectId: project.id,
      });
      const active = app.createTask({
        name: "Active task",
        priority: "high",
        projectId: project.id,
      });
      app.setTaskWorkState({ taskId: active.id, workState: "active" });

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
        brief: { markdown: string; task: null };
      };
      const markdown = payload.brief.markdown;
      const openTasksIndex = markdown.lastIndexOf("## Open Tasks");

      expect(result.exitCode).toBe(0);
      expect(payload.brief.task).toBeNull();
      expect(openTasksIndex).toBe(markdown.indexOf("## Open Tasks"));
      expect(markdown).toContain("Branch missing-branch matches no Task.");
      expect(markdown).toContain(
        `- ${planned.simpleId} — Planned task [planned]`,
      );
      expect(markdown).toContain(
        `- ${active.simpleId} — Active task [active, high]`,
      );
      expect(markdown.indexOf("## Commands")).toBeLessThan(openTasksIndex);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("reports ambiguous branch candidates in a project-only brief", async () => {
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-branch-ambiguous-",
    );
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
          candidateTaskSimpleIds: string[];
          markdown: string;
          task: null;
        };
      };

      expect(result.exitCode).toBe(0);
      expect(payload.brief.task).toBeNull();
      expect(payload.brief.candidateTaskIds).toEqual([first.id, second.id]);
      expect(payload.brief.candidateTaskSimpleIds).toEqual([
        first.simpleId!,
        second.simpleId!,
      ]);
      expect(payload.brief.markdown).toContain(
        `Branch ${branchName} matches several Tasks: ${first.simpleId!}, ${second.simpleId!}.`,
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("includes the three How to work lines", async () => {
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-how-to-work-",
    );

    try {
      const app = createFactoryApplication({ databasePath });
      app.createProject({
        name: "How to work project",
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

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "- Before starting a Subtask, report in_progress with --evidence. At handoff, report complete with --reason naming the human check, or blocked with the blocker.",
      );
      expect(result.stdout).toContain(
        "- Never verify or complete; a human does that in the dashboard. Reports are append-only claims.",
      );
      expect(result.stdout).toContain(
        "- Set FACTORY_REPORTER=claude or codex. Full rules: skills/software-factory/SKILL.md",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("caps output with a final notice and reports the default cap in JSON", async () => {
    const { databasePath, temporaryDirectory } = makeTemporaryPaths(
      "software-factory-project-brief-cap-",
    );

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
        brief: {
          markdown: string;
          maxCharacters: number;
          truncated: boolean;
        };
      };

      expect(cappedResult.exitCode).toBe(0);
      expect(cappedPayload.brief.characterCount).toBeLessThanOrEqual(1000);
      expect(cappedPayload.brief.markdown.length).toBeLessThanOrEqual(1000);
      expect(cappedPayload.brief.truncated).toBe(true);
      expect(cappedPayload.brief.markdown.split("\n").at(-1)).toMatch(
        /^\[Factory brief truncated to 1000 of \d+ characters\. Run:/,
      );
      expect(defaultResult.exitCode).toBe(0);
      expect(defaultPayload.brief.maxCharacters).toBe(6000);
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
