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

describe("Task workflow CLI", () => {
  test("passes structured tracking and session fields through Task reports", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-task-report-cli-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Task report fields" });
    const task = app.createTask({
      name: "Report every field",
      projectId: project.id,
    });
    const step = app.createSubtask({ name: "Review output", taskId: task.id });
    const workflowEpoch = app.getTaskStatus(task.id).workflowEpoch;
    app.close();

    try {
      const result = await runCli([
        "task",
        "report",
        "--task-id",
        task.id,
        "--state",
        "in_progress",
        "--workflow-epoch",
        String(workflowEpoch),
        "--reporter",
        "codex",
        "--summary",
        "The implementation is ready for review.",
        "--session-thread-id",
        "thread-42",
        "--session-source-id",
        "t3-source",
        "--next-owner",
        "Kevin",
        "--next-owner-kind",
        "human",
        "--next-action",
        "Review the implementation.",
        "--dependency",
        "the required review",
        "--waiting-on-subtask-ids",
        step.id,
        "--tested-revision",
        "abcdef0",
        "--artifacts-json",
        JSON.stringify([
          {
            kind: "preview",
            label: "Preview build",
            testedRevision: "abcdef0",
            url: "https://example.com/preview",
          },
        ]),
        "--database",
        databasePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        report: {
          workflowEpoch,
          reportedState: "in_progress",
          summary: "The implementation is ready for review.",
          sessionRef: {
            provider: "t3",
            sourceId: "t3-source",
            externalThreadId: "thread-42",
          },
          handoff: {
            nextOwner: "Kevin",
            nextOwnerKind: "human",
            nextAction: "Review the implementation.",
            dependency: "the required review",
            waitingOnSubtaskIds: [step.id],
          },
          testedRevision: "abcdef0",
          artifacts: [
            {
              kind: "preview",
              label: "Preview build",
              testedRevision: "abcdef0",
              url: "https://example.com/preview",
            },
          ],
        },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("accepts epoch zero, records Task activity, and requires a revision for human checks", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-task-workflow-cli-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Task workflow CLI" });
    const task = app.createTask({
      name: "Zero Step task",
      projectId: project.id,
    });
    const checkedTask = app.createTask({
      finishRule: { kind: "agent_report", requireHumanCheck: true },
      humanCheckText: "Compare the result with the release checklist.",
      name: "Explicit check task",
      projectId: project.id,
    });
    app.close();

    try {
      const report = await runCli([
        "task",
        "report",
        "--task-id",
        task.id,
        "--state",
        "finished",
        "--workflow-epoch",
        "0",
        "--reporter",
        "codex",
        "--summary",
        "The Task is finished.",
        "--database",
        databasePath,
      ]);
      expect(report.exitCode).toBe(0);
      expect(JSON.parse(report.stdout)).toMatchObject({
        report: {
          taskId: task.id,
          workflowEpoch: 0,
          reportedState: "finished",
        },
      });

      const missingEpoch = await runCli([
        "task",
        "report",
        "--task-id",
        task.id,
        "--state",
        "in_progress",
        "--reporter",
        "codex",
        "--database",
        databasePath,
      ]);
      expect(missingEpoch.exitCode).toBe(1);
      expect(missingEpoch.stderr).toContain(
        "Missing required --workflow-epoch",
      );

      const history = await runCli([
        "task",
        "history",
        "--task-id",
        task.id,
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(history.stdout)).toMatchObject({
        history: {
          events: [expect.objectContaining({ kind: "task_report" })],
        },
      });

      const finishRule = await runCli([
        "task",
        "finish-rule",
        "--task-id",
        checkedTask.id,
        "--kind",
        "agent_report",
        "--require-human-check",
        "true",
        "--human-check-text",
        "Run the release checklist before closing.",
        "--actor",
        "Kevin",
        "--database",
        databasePath,
      ]);
      expect(finishRule.exitCode).toBe(0);
      expect(JSON.parse(finishRule.stdout)).toMatchObject({
        task: { finishRule: { kind: "agent_report", requireHumanCheck: true } },
      });

      const checkReport = await runCli([
        "task",
        "report",
        "--task-id",
        checkedTask.id,
        "--state",
        "finished",
        "--workflow-epoch",
        "0",
        "--reporter",
        "codex",
        "--summary",
        "The result is ready for the human check.",
        "--database",
        databasePath,
      ]);
      expect(checkReport.exitCode).toBe(0);

      const status = await runCli([
        "task",
        "status",
        "--task-id",
        checkedTask.id,
        "--database",
        databasePath,
      ]);
      const taskRevision = (
        JSON.parse(status.stdout) as { status: { taskRevision: number } }
      ).status.taskRevision;

      const missingRevision = await runCli([
        "task",
        "check",
        "--task-id",
        checkedTask.id,
        "--actor",
        "Kevin",
        "--database",
        databasePath,
      ]);
      expect(missingRevision.exitCode).toBe(1);
      expect(missingRevision.stderr).toContain(
        "Missing required --expected-revision",
      );

      const check = await runCli([
        "task",
        "check",
        "--task-id",
        checkedTask.id,
        "--actor",
        "Kevin",
        "--expected-revision",
        String(taskRevision),
        "--database",
        databasePath,
      ]);
      expect(check.exitCode).toBe(0);
      expect(JSON.parse(check.stdout)).toMatchObject({
        task: { finishMetadata: { kind: "human_check", actor: "Kevin" } },
      });
      const checkedTaskHistory = await runCli([
        "task",
        "history",
        "--task-id",
        checkedTask.id,
        "--database",
        databasePath,
      ]);
      expect(JSON.parse(checkedTaskHistory.stdout)).toMatchObject({
        history: {
          events: expect.arrayContaining([
            expect.objectContaining({
              kind: "finish_rule_changed",
              actor: "Kevin",
            }),
          ]),
        },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("saves a complete PR requirement edit in one finish-rule command", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-task-finish-cli-"));
    const databasePath = join(directory, "factory.sqlite");
    const firstUrl = "https://github.com/example/repo/pull/21";
    const secondUrl = "https://github.com/example/repo/pull/22";
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Atomic finish rule" });
    const task = app.createTask({
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
      name: "Wait for selected merges",
      projectId: project.id,
      pullRequestUrl: firstUrl,
      pullRequestRequired: true,
      workState: "active",
    });
    app.createSubtask({
      name: "Second pull request",
      pullRequestRequired: true,
      pullRequestUrl: secondUrl,
      taskId: task.id,
    });
    const directTask = app.createTask({
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
      name: "Direct task requirement",
      projectId: project.id,
      pullRequestRequired: true,
      pullRequestUrl: "https://github.com/example/repo/pull/23",
      workState: "active",
    });
    const directStep = app.createSubtask({
      name: "Direct step requirement",
      pullRequestRequired: true,
      pullRequestUrl: "https://github.com/example/repo/pull/24",
      taskId: directTask.id,
    });
    const before = app.getTaskStatus(task.id);
    const mergedAt = new Date(Date.now() + 1_000);
    app.recordTaskPullRequestMerge({
      defaultBranch: "main",
      mergeSha: "a".repeat(40),
      mergedAt,
      observedAt: new Date(mergedAt.getTime() + 1_000),
      pullRequestUrl: firstUrl,
      reachedDefaultBranch: true,
      taskId: task.id,
      workflowEpoch: before.workflowEpoch,
    });
    app.close();

    try {
      const result = await runCli([
        "task",
        "finish-rule",
        "--task-id",
        task.id,
        "--kind",
        "pr_merge",
        "--pull-request-requirements-json",
        JSON.stringify([
          { pullRequestUrl: firstUrl, required: true },
          { pullRequestUrl: secondUrl, required: false },
        ]),
        "--actor",
        "Kevin",
        "--database",
        databasePath,
      ]);

      expect(result.exitCode).toBe(0);
      const taskUpdate = await runCli([
        "task",
        "update",
        "--task-id",
        directTask.id,
        "--pull-request-required",
        "false",
        "--actor",
        "Local agent",
        "--database",
        databasePath,
      ]);
      const stepUpdate = await runCli([
        "subtask",
        "update",
        "--subtask-id",
        directStep.id,
        "--pull-request-required",
        "false",
        "--actor",
        "Local agent",
        "--database",
        databasePath,
      ]);
      expect(taskUpdate.exitCode).toBe(0);
      expect(stepUpdate.exitCode).toBe(0);
      const persisted = createFactoryApplication({ databasePath });
      try {
        expect(persisted.getTaskStatus(task.id)).toMatchObject({
          taskCompleted: true,
          finishMetadata: { kind: "pr_merge", actor: "Kevin" },
          requiredPullRequests: [
            { pullRequestUrl: firstUrl, required: true },
            { pullRequestUrl: secondUrl, required: false },
          ],
        });
        expect(persisted.getTaskWorkflowHistory(task.id)).toContainEqual(
          expect.objectContaining({
            actor: "Kevin",
            kind: "finish_rule_changed",
            pullRequestRequirementChanges: [
              expect.objectContaining({
                pullRequestUrl: secondUrl,
                previousRequired: true,
                required: false,
                sourceKind: "step",
              }),
            ],
          }),
        );
        expect(
          persisted
            .getTaskWorkflowHistory(directTask.id)
            .filter((event) => event.kind === "finish_rule_changed"),
        ).toHaveLength(2);
        expect(
          persisted
            .getTaskWorkflowHistory(directTask.id)
            .filter((event) => event.kind === "finish_rule_changed")
            .every((event) => event.actor === "Local agent"),
        ).toBe(true);
      } finally {
        persisted.close();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
