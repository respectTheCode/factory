import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import type {
  GitHubPullRequestReference,
  GitHubStatusReader,
} from "../../src/github";
import { createFactoryServer } from "../../src/server";

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function status(databasePath: string, taskId: string) {
  const app = createFactoryApplication({ databasePath });
  try {
    return app.getTaskStatus(taskId);
  } finally {
    app.close();
  }
}

describe("automatic PR merge reconciliation", () => {
  test("waits for confirmed merge evidence, accepts eligible work once, and stops its timer", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-pr-reconciler-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/reconciler.git",
      name: "Merge scanner",
    });
    const task = app.createTask({
      name: "Reconcile the merged pull request",
      projectId: project.id,
      pullRequestUrl: "https://github.com/example/reconciler/pull/10",
    });
    const subtask = app.createSubtask({
      name: "Review report",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the merged implementation.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: subtask.id,
    });
    app.close();

    let calls = 0;
    let mergeEvidence: { mergeSha?: string; mergedAt?: string } | undefined;
    let lastReference: GitHubPullRequestReference | undefined;
    const githubStatusReader: GitHubStatusReader = {
      read: async () => ({
        checkRuns: [],
        checkRunsStatus: "ok",
        fetchedAt: new Date().toISOString(),
        status: "ok",
        workflowRuns: [],
        workflowRunsStatus: "ok",
      }),
      readMergeEvidence: async (reference) => {
        calls += 1;
        lastReference = reference;
        return mergeEvidence;
      },
    };
    const server = createFactoryServer({
      databasePath,
      githubStatusReader,
      hostname: "127.0.0.1",
      operator: { name: "Kevin", secret: "scheduler-test" },
      port: 0,
      pullRequestReconciliationIntervalMs: 20,
    });

    try {
      await waitFor(() => calls > 0, "the first GitHub merge scan");
      expect(lastReference).toMatchObject({
        owner: "example",
        repo: "reconciler",
        number: 10,
      });
      expect(status(databasePath, task.id).taskCompleted).toBe(false);
      const beforeMerge = createFactoryApplication({ databasePath });
      expect(beforeMerge.getSubtaskVerificationHistory(subtask.id)).toEqual([]);
      beforeMerge.close();

      mergeEvidence = {
        mergeSha: "0123456789abcdef0123456789abcdef01234567",
        mergedAt: new Date(Date.now() + 10_000).toISOString(),
      };
      await waitFor(
        () => status(databasePath, task.id).taskCompleted,
        "the confirmed merge reconciliation",
      );
      const reconciled = createFactoryApplication({ databasePath });
      try {
        expect(
          reconciled.getSubtaskVerificationHistory(subtask.id),
        ).toMatchObject([
          {
            decision: "accepted",
            source: "pr_merge",
            mergeSha: mergeEvidence!.mergeSha,
          },
        ]);
      } finally {
        reconciled.close();
      }

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(calls).toBeGreaterThan(1);
      await server.stop();
      const callsAtStop = calls;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(calls).toBe(callsAtStop);
      const afterStop = createFactoryApplication({ databasePath });
      try {
        expect(
          afterStop.getSubtaskVerificationHistory(subtask.id),
        ).toHaveLength(1);
      } finally {
        afterStop.close();
      }
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
