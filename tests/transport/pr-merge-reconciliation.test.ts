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
import { createTestServer, loginTestOperator } from "./helpers";

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

function currentStatus(databasePath: string, taskId: string) {
  const app = createFactoryApplication({ databasePath });
  try {
    return app.getTaskStatus(taskId);
  } finally {
    app.close();
  }
}

describe("automatic Task PR merge reconciliation", () => {
  test("waits for fresh default-branch reachability and records no Step approval", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-pr-reconciler-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/reconciler.git",
      name: "Merge scanner",
    });
    const task = app.createTask({
      name: "Reconcile the required Step pull request",
      projectId: project.id,
    });
    const step = app.createSubtask({
      name: "Ship the linked code",
      pullRequestUrl: "https://github.com/example/reconciler/pull/10",
      taskId: task.id,
    });
    const beforeReport = app.getTaskStatus(task.id);
    const workflowStartedAt = app.getTaskDetail(task.id).workflowStartedAt;
    app.reportTaskStatus({
      reporter: "codex",
      reportedState: "finished",
      summary: "The required PR is ready.",
      taskId: task.id,
      workflowEpoch: beforeReport.workflowEpoch,
    });
    app.close();

    let calls = 0;
    let evidence = {
      defaultBranch: "main",
      mergeSha: "0123456789abcdef0123456789abcdef01234567",
      mergedAt: new Date(
        (workflowStartedAt?.getTime() ?? Date.now()) + 1,
      ).toISOString(),
      observedAt: new Date(Date.now() - 16 * 60_000).toISOString(),
      reachedDefaultBranch: true as const,
    };
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
        return evidence;
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
      expect(currentStatus(databasePath, task.id).taskCompleted).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(currentStatus(databasePath, task.id).taskCompleted).toBe(false);

      evidence = {
        ...evidence,
        observedAt: new Date().toISOString(),
      };
      await waitFor(
        () => currentStatus(databasePath, task.id).taskCompleted,
        "fresh merge evidence proving the commit reached main",
      );
      const reconciled = createFactoryApplication({ databasePath });
      try {
        const status = reconciled.getTaskStatus(task.id);
        expect(status.requiredPullRequests).toMatchObject([
          {
            pullRequestUrl: step.pullRequestUrl,
            required: true,
            merge: {
              defaultBranch: "main",
              mergeSha: evidence.mergeSha,
              reachedDefaultBranch: true,
              workflowEpoch: status.workflowEpoch,
            },
          },
        ]);
        expect(reconciled.getSubtaskVerificationHistory(step.id)).toEqual([]);
      } finally {
        reconciled.close();
      }

      await server.stop();
      const callsAtStop = calls;
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(calls).toBe(callsAtStop);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("supports human-triggered reconciliation and keeps the route human-only", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-pr-manual-reconcile-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({
      gitOriginUrl: "https://github.com/example/manual-reconcile.git",
      name: "Manual reconciliation",
    });
    const task = app.createTask({
      name: "Wait for default branch",
      projectId: project.id,
      pullRequestUrl: "https://github.com/example/manual-reconcile/pull/11",
    });
    const workflowStartedAt = app.getTaskDetail(task.id).workflowStartedAt;
    app.reportTaskStatus({
      reporter: "codex",
      reportedState: "finished",
      summary: "The code change is ready.",
      taskId: task.id,
      workflowEpoch: app.getTaskStatus(task.id).workflowEpoch,
    });
    app.close();

    const githubStatusReader: GitHubStatusReader = {
      read: async () => ({
        checkRuns: [],
        checkRunsStatus: "ok",
        fetchedAt: new Date().toISOString(),
        status: "ok",
        workflowRuns: [],
        workflowRunsStatus: "ok",
      }),
      readMergeEvidence: async () => ({
        defaultBranch: "main",
        mergeSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
        mergedAt: new Date(
          (workflowStartedAt?.getTime() ?? Date.now()) + 1,
        ).toISOString(),
        observedAt: new Date().toISOString(),
        reachedDefaultBranch: true,
      }),
    };
    const server = createTestServer({
      databasePath,
      githubStatusReader,
      hostname: "127.0.0.1",
      port: 0,
      pullRequestReconciliationIntervalMs: 0,
    });

    try {
      const denied = await fetch(
        new URL("/api/tasks.reconcileMergedPullRequest", server.url),
        {
          body: JSON.stringify({ taskId: task.id }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      expect(denied.status).toBe(401);

      const humanCookie = await loginTestOperator(server);
      const response = await fetch(
        new URL("/api/tasks.reconcileMergedPullRequest", server.url),
        {
          body: JSON.stringify({ taskId: task.id }),
          headers: {
            Cookie: humanCookie,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        result: {
          data: {
            reconciled: true,
            updates: [
              {
                defaultBranch: "main",
                mergeSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
                reachedDefaultBranch: true,
              },
            ],
          },
        },
      });
      expect(currentStatus(databasePath, task.id).taskCompleted).toBe(true);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
