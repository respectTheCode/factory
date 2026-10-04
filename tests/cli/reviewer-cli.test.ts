import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";

async function runCli(
  args: string[],
  environment: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      FACTORY_ACCESS_TOKEN_FILE: "",
      FACTORY_URL: "",
      ...environment,
    },
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

describe("reviewer CLI", () => {
  test("submits explicit Subtask review inputs and a pinned Task snapshot remotely", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-reviewer-cli-"));
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "reviewer-token");
    const snapshotPath = join(directory, "reviewed-task.json");
    const truncatedSnapshotPath = join(directory, "truncated-task.json");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Reviewer CLI" });
    const task = app.createTask({
      name: "Review delivery",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Verify delivery",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      reason: "Check the delivered behavior.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: subtask.id,
    });
    const store = createMachineCredentialStore({ databasePath });
    const reviewer = store.create({
      allProjects: true,
      machineId: "bitsy-reviewer",
      projectIds: [],
      reviewerName: "Bitsy",
      role: "reviewer",
    });
    app.assignReviewer({
      assignedBy: "Kevin",
      reviewer: {
        id: reviewer.id,
        machineId: reviewer.machineId,
        reviewerName: reviewer.reviewerName!,
      },
      targetId: task.id,
      targetType: "task",
    });
    app.close();
    store.close();
    const capturedStatus = await runCli(
      [
        "task",
        "status",
        "--task-id",
        task.id,
        "--database",
        databasePath,
        "--json",
      ],
      {},
    );
    expect(capturedStatus.exitCode).toBe(0);
    writeFileSync(snapshotPath, capturedStatus.stdout);
    const capturedSnapshot = JSON.parse(capturedStatus.stdout) as {
      status: Record<string, unknown>;
    };
    writeFileSync(
      truncatedSnapshotPath,
      JSON.stringify({
        ...capturedSnapshot,
        status: { ...capturedSnapshot.status, truncated: true },
      }),
    );
    writeFileSync(tokenPath, `${reviewer.token}\n`, { mode: 0o600 });
    const server = createFactoryServer({
      databasePath,
      hostname: "127.0.0.1",
      operator: { name: "Kevin", secret: "reviewer-cli-test" },
      port: 0,
    });
    const remoteEnvironment = {
      FACTORY_ACCESS_TOKEN_FILE: tokenPath,
      FACTORY_URL: server.url.toString().replace(/\/$/, ""),
    };

    try {
      const truncatedReview = await runCli(
        [
          "task",
          "review",
          "--task-id",
          task.id,
          "--decision",
          "accepted",
          "--report-text",
          "Checked the delivered behavior.",
          "--reviewed-snapshot",
          truncatedSnapshotPath,
          "--json",
        ],
        remoteEnvironment,
      );
      expect(truncatedReview.exitCode).toBe(1);
      expect(truncatedReview.stderr).toContain("is truncated");

      const taskReview = await runCli(
        [
          "task",
          "review",
          "--task-id",
          task.id,
          "--decision",
          "accepted",
          "--report-text",
          "Checked the delivered behavior and current evidence.",
          "--reviewed-snapshot",
          snapshotPath,
          "--json",
        ],
        remoteEnvironment,
      );
      expect(taskReview.exitCode).toBe(0);
      expect(JSON.parse(taskReview.stdout)).toHaveProperty("review");

      const afterTaskReview = createFactoryApplication({ databasePath });
      const current = afterTaskReview.getTaskStatus(task.id);
      const reviewRevision = current.subtasks[0]?.revision;
      expect(reviewRevision).toBeGreaterThan(0);
      const currentDetail = afterTaskReview.getSubtaskDetail(subtask.id);
      afterTaskReview.close();
      expect(current.subtasks[0]).toHaveProperty("revision");
      expect(current).toMatchObject({
        taskCompleted: true,
        subtasks: [expect.objectContaining({ verificationState: "accepted" })],
      });

      const subtaskReviewArgs = [
        "subtask",
        "review",
        "--report-id",
        report.id,
        "--expected-revision",
        String(reviewRevision),
        "--decision",
        "rejected",
        "--reason",
        "The screenshot does not show the final state.",
        "--report-text",
        "The screenshot does not show the final state.",
        "--json",
      ];
      const subtaskReview = await runCli(subtaskReviewArgs, remoteEnvironment);
      if (subtaskReview.exitCode !== 0) {
        throw new Error(
          `${subtaskReview.stderr}\nargs=${JSON.stringify(subtaskReviewArgs)} status=${JSON.stringify(current)} detail=${JSON.stringify(currentDetail)}`,
        );
      }
      const afterSubtaskReview = createFactoryApplication({ databasePath });
      try {
        expect(afterSubtaskReview.getTaskStatus(task.id)).toMatchObject({
          taskCompleted: false,
          subtasks: [
            expect.objectContaining({ verificationState: "rejected" }),
          ],
        });
        expect(
          afterSubtaskReview.getSubtaskVerificationHistory(subtask.id),
        ).toMatchObject([
          { decision: "accepted", source: "reviewer" },
          {
            decision: "rejected",
            source: "reviewer",
            reportText: "The screenshot does not show the final state.",
          },
        ]);
      } finally {
        afterSubtaskReview.close();
      }

      const staleReview = await runCli(
        [
          "task",
          "review",
          "--task-id",
          task.id,
          "--decision",
          "accepted",
          "--report-text",
          "Rechecking the old snapshot.",
          "--reviewed-snapshot",
          snapshotPath,
          "--json",
        ],
        remoteEnvironment,
      );
      expect(staleReview.exitCode).toBe(1);
      expect(staleReview.stderr).toContain("current revision");
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
