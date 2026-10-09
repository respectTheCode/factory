import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";

import { createFactoryApplication } from "../../src/application";
import { createRemoteFactoryClient } from "../../src/remote-client";
import { createMachineCredentialStore } from "../../src/machine-credential";
import type { FactoryRouter } from "../../src/server";
import { createTestServer } from "./helpers";
import { loginTestOperator } from "./helpers";

describe("Task workflow remote API", () => {
  test("reports a zero-Step Task with scoped credentials and durable idempotency", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-task-workflow-api-"));
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "machine-token");
    const outsiderTokenPath = join(directory, "outsider-token");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Task workflow" });
    const task = app.createTask({ name: "Zero Steps", projectId: project.id });
    const outsideProject = app.createProject({ name: "Outside scope" });
    const outsideTask = app.createTask({
      name: "Protected Task",
      projectId: outsideProject.id,
    });
    const historyTask = app.createTask({
      name: "Legacy Step history",
      projectId: project.id,
    });
    const historyStep = app.createSubtask({
      name: "Earlier reviewed Step",
      taskId: historyTask.id,
    });
    const historyReport = app.reportSubtaskStatus({
      evidence: "The delivered Step is recorded.",
      reason: "Retain the historical check.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: historyStep.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: historyReport.id,
      verifier: "Kevin",
    });
    const startingStatus = app.getTaskStatus(task.id);
    app.close();

    const credentials = createMachineCredentialStore({ databasePath });
    const machine = credentials.create({
      machineId: "task-reporting-machine",
      projectIds: [project.id],
    });
    const outsider = credentials.create({
      machineId: "other-machine",
      projectIds: [outsideProject.id],
    });
    credentials.close();
    writeFileSync(tokenPath, machine.token, { mode: 0o600 });
    writeFileSync(outsiderTokenPath, outsider.token, { mode: 0o600 });

    let server = createTestServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
    });
    const remote = () =>
      createRemoteFactoryClient({
        FACTORY_ACCESS_TOKEN_FILE: tokenPath,
        FACTORY_URL: server.url.origin,
      });
    const outsiderRemote = () =>
      createRemoteFactoryClient({
        FACTORY_ACCESS_TOKEN_FILE: outsiderTokenPath,
        FACTORY_URL: server.url.origin,
      });

    try {
      const reportInput = {
        reporter: "codex",
        reportedState: "finished" as const,
        summary: "The Task is complete under its agent-report finish rule.",
        taskId: task.id,
        workflowEpoch: startingStatus.workflowEpoch,
        requestKey: "zero-step-task-report-1",
      };
      const firstReport = await remote().reportTaskStatus(reportInput);
      expect(firstReport.createdAt).toBeInstanceOf(Date);
      expect(firstReport.workflowEpoch).toBe(startingStatus.workflowEpoch);

      const status = await remote().getTaskStatus(task.id);
      expect(status.subtasks).toEqual([]);
      expect(status.taskCompleted).toBe(true);
      expect(status.latestTaskReport?.createdAt).toBeInstanceOf(Date);
      const history = await remote().getTaskActivityHistory({
        taskId: task.id,
      });
      expect(history.events).toContainEqual(
        expect.objectContaining({
          kind: "task_report",
          createdAt: expect.any(Date),
          summary: reportInput.summary,
        }),
      );
      const stepHistory = await remote().getSubtaskReportHistory(
        historyStep.id,
      );
      expect(stepHistory[0]?.createdAt).toBeInstanceOf(Date);
      const verificationHistory = await remote().getSubtaskVerificationHistory(
        historyStep.id,
      );
      expect(verificationHistory[0]?.createdAt).toBeInstanceOf(Date);

      await expect(outsiderRemote().getTaskStatus(task.id)).rejects.toThrow(
        "not scoped to this Project",
      );

      const machineClient = remote();
      await expect(
        machineClient.updateTaskFinishRule({
          expectedRevision: status.taskRevision,
          expectedWorkflowEpoch: status.workflowEpoch,
          finishRule: { kind: "agent_report", requireHumanCheck: false },
          pullRequestRequirements: [],
          taskId: task.id,
        }),
      ).rejects.toThrow();
      await expect(
        machineClient.checkTask({
          checker: "codex",
          expectedRevision: status.taskRevision,
          taskId: task.id,
        }),
      ).rejects.toThrow();
      await expect(
        machineClient.markTaskDone({
          actor: "codex",
          reason: "This must remain human-only.",
          taskId: task.id,
        }),
      ).rejects.toThrow();

      await server.stop();
      server = createTestServer({
        databasePath,
        hostname: "127.0.0.1",
        port: 0,
      });
      const replay = await remote().reportTaskStatus(reportInput);
      expect(replay.id).toBe(firstReport.id);
      expect(replay.createdAt).toEqual(firstReport.createdAt);
      const persistedApp = createFactoryApplication({ databasePath });
      try {
        expect(persistedApp.getTaskReportHistory(task.id)).toHaveLength(1);
        expect(persistedApp.getTaskStatus(task.id).subtasks).toEqual([]);
      } finally {
        persistedApp.close();
      }
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("saves canonical PR requirements with current guards and authenticated audit actors", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-finish-rule-api-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Atomic finish rule API" });
    const firstUrl = "https://github.com/example/repo/pull/31";
    const secondUrl = "https://github.com/example/repo/pull/32";
    const task = app.createTask({
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
      name: "Keep one merge outstanding",
      projectId: project.id,
      pullRequestUrl: firstUrl,
      pullRequestRequired: true,
      workState: "active",
    });
    const step = app.createSubtask({
      name: "Second pull request",
      pullRequestRequired: true,
      pullRequestUrl: secondUrl,
      taskId: task.id,
    });
    let status = app.getTaskStatus(task.id);
    const mergedAt = new Date(Date.now() + 1_000);
    app.recordTaskPullRequestMerge({
      defaultBranch: "main",
      mergeSha: "b".repeat(40),
      mergedAt,
      observedAt: new Date(mergedAt.getTime() + 1_000),
      pullRequestUrl: firstUrl,
      reachedDefaultBranch: true,
      taskId: task.id,
      workflowEpoch: status.workflowEpoch,
    });
    status = app.getTaskStatus(task.id);

    const directEditTask = app.createTask({
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
      name: "Direct PR requirement audit",
      projectId: project.id,
      pullRequestUrl: "https://github.com/example/repo/pull/33",
      pullRequestRequired: true,
      workState: "active",
    });
    const directEditStep = app.createSubtask({
      name: "Direct Step requirement audit",
      pullRequestRequired: true,
      pullRequestUrl: "https://github.com/example/repo/pull/34",
      taskId: directEditTask.id,
    });
    app.close();

    const server = createTestServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      const cookie = await loginTestOperator(server);
      const client = createTRPCProxyClient<FactoryRouter>({
        links: [
          httpBatchLink({
            headers: { cookie },
            url: new URL("/api", server.url).toString(),
          }),
        ],
      });

      await expect(
        client.tasks.updateFinishRule.mutate({
          actor: "caller-supplied actor",
          expectedRevision: status.taskRevision - 1,
          expectedWorkflowEpoch: status.workflowEpoch,
          finishRule: status.finishRule,
          pullRequestRequirements: [
            { pullRequestUrl: firstUrl, required: true },
            { pullRequestUrl: secondUrl, required: false },
          ],
          taskId: task.id,
        }),
      ).rejects.toThrow();
      await expect(
        client.tasks.updateFinishRule.mutate({
          actor: "caller-supplied actor",
          expectedRevision: status.taskRevision,
          expectedWorkflowEpoch: status.workflowEpoch + 1,
          finishRule: status.finishRule,
          pullRequestRequirements: [
            { pullRequestUrl: firstUrl, required: true },
            { pullRequestUrl: secondUrl, required: false },
          ],
          taskId: task.id,
        }),
      ).rejects.toThrow();
      await expect(
        client.tasks.updateFinishRule.mutate({
          actor: "caller-supplied actor",
          expectedRevision: status.taskRevision,
          expectedWorkflowEpoch: status.workflowEpoch,
          finishRule: status.finishRule,
          pullRequestRequirements: [
            { pullRequestUrl: firstUrl, required: true },
          ],
          taskId: task.id,
        }),
      ).rejects.toThrow();

      const unchanged = createFactoryApplication({ databasePath });
      try {
        expect(unchanged.getTaskStatus(task.id)).toMatchObject({
          taskCompleted: false,
          taskRevision: status.taskRevision,
        });
        expect(unchanged.getTaskWorkflowHistory(task.id)).toHaveLength(1);
      } finally {
        unchanged.close();
      }

      await client.tasks.updateFinishRule.mutate({
        actor: "caller-supplied actor",
        expectedRevision: status.taskRevision,
        expectedWorkflowEpoch: status.workflowEpoch,
        finishRule: status.finishRule,
        pullRequestRequirements: [
          { pullRequestUrl: firstUrl, required: true },
          { pullRequestUrl: secondUrl, required: false },
        ],
        taskId: task.id,
      });
      await client.tasks.update.mutate({
        actor: "caller-supplied actor",
        pullRequestRequired: false,
        taskId: directEditTask.id,
      } as never);
      await client.subtasks.update.mutate({
        actor: "caller-supplied actor",
        pullRequestRequired: false,
        subtaskId: directEditStep.id,
      } as never);

      const persisted = createFactoryApplication({ databasePath });
      try {
        expect(persisted.getTaskStatus(task.id)).toMatchObject({
          taskCompleted: true,
          finishMetadata: { kind: "pr_merge", actor: "test-operator" },
          requiredPullRequests: [
            { pullRequestUrl: firstUrl, required: true },
            { pullRequestUrl: secondUrl, required: false },
          ],
        });
        expect(persisted.getTaskWorkflowHistory(task.id)).toContainEqual(
          expect.objectContaining({
            actor: "test-operator",
            kind: "finish_rule_changed",
            pullRequestRequirementChanges: [
              expect.objectContaining({
                pullRequestUrl: secondUrl,
                sourceId: step.id,
                sourceKind: "step",
                previousRequired: true,
                required: false,
              }),
            ],
          }),
        );
        expect(
          persisted
            .getTaskWorkflowHistory(directEditTask.id)
            .filter((event) => event.kind === "finish_rule_changed"),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              actor: "test-operator",
              pullRequestRequirementChanges: [
                expect.objectContaining({
                  pullRequestUrl: "https://github.com/example/repo/pull/33",
                }),
              ],
            }),
            expect.objectContaining({
              actor: "test-operator",
              pullRequestRequirementChanges: [
                expect.objectContaining({
                  pullRequestUrl: "https://github.com/example/repo/pull/34",
                }),
              ],
            }),
          ]),
        );
      } finally {
        persisted.close();
      }
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("paginates bounded Task activity history through the remote API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-task-history-api-"));
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "machine-token");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Task history" });
    const task = app.createTask({
      name: "History pages",
      projectId: project.id,
    });
    const workflowEpoch = app.getTaskStatus(task.id).workflowEpoch;
    for (let index = 0; index < 3; index += 1) {
      app.reportTaskStatus({
        reporter: "codex",
        reportedState: "in_progress",
        summary: `Progress update ${index + 1}`,
        taskId: task.id,
        workflowEpoch,
      });
    }
    app.close();

    const credentials = createMachineCredentialStore({ databasePath });
    const credential = credentials.create({
      machineId: "history-reader",
      projectIds: [project.id],
    });
    credentials.close();
    writeFileSync(tokenPath, credential.token, { mode: 0o600 });
    const server = createTestServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
    });
    const client = createRemoteFactoryClient({
      FACTORY_ACCESS_TOKEN_FILE: tokenPath,
      FACTORY_URL: server.url.origin,
    });

    try {
      const firstPage = await client.getTaskActivityHistory({
        limit: 2,
        taskId: task.id,
      });
      expect(firstPage.events).toHaveLength(2);
      expect(
        firstPage.events.every((event) => event.createdAt instanceof Date),
      ).toBe(true);
      expect(firstPage.totalCount).toBe(3);
      expect(firstPage.truncated).toBe(true);
      expect(firstPage.nextCursor).toBeTruthy();

      const secondPage = await client.getTaskActivityHistory({
        cursor: firstPage.nextCursor!,
        limit: 2,
        taskId: task.id,
      });
      expect(secondPage.events).toHaveLength(1);
      expect(secondPage.truncated).toBe(false);
      expect(secondPage.nextCursor).toBeNull();
      expect(
        new Set([
          ...firstPage.events.map((event) => event.id),
          ...secondPage.events.map((event) => event.id),
        ]).size,
      ).toBe(3);

      await expect(
        client.getTaskActivityHistory({ limit: 101, taskId: task.id }),
      ).rejects.toThrow();
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("hydrates manualHold as an exact boolean for manual and agent blocked Tasks", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-task-manual-hold-api-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "machine-token");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Manual hold transport" });
    const manualTask = app.createTask({
      name: "Deliberately held",
      projectId: project.id,
      workState: "active",
    });
    app.setTaskWorkState({
      taskId: manualTask.id,
      workState: "blocked",
      reason: "Held for human review.",
    });
    const agentTask = app.createTask({
      name: "Blocked by the agent",
      projectId: project.id,
      workState: "active",
    });
    const agentStatus = app.getTaskStatus(agentTask.id);
    app.reportTaskStatus({
      taskId: agentTask.id,
      workflowEpoch: agentStatus.workflowEpoch,
      reportedState: "blocked",
      reporter: "Codex",
      reason: "Waiting on an upstream dependency.",
    });
    app.close();

    const credentialStore = createMachineCredentialStore({ databasePath });
    const machine = credentialStore.create({
      machineId: "manual-hold-status-reader",
      projectIds: [project.id],
    });
    credentialStore.close();
    writeFileSync(tokenPath, machine.token, { mode: 0o600 });

    const server = createTestServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      const remote = createRemoteFactoryClient({
        FACTORY_ACCESS_TOKEN_FILE: tokenPath,
        FACTORY_URL: server.url.origin,
      });
      const manualStatus = await remote.getTaskStatus(manualTask.id);
      const agentBlockedStatus = await remote.getTaskStatus(agentTask.id);
      expect(manualStatus.taskState).toBe("blocked");
      expect(manualStatus.manualHold).toBe(true);
      expect(agentBlockedStatus.taskState).toBe("blocked");
      expect(agentBlockedStatus.manualHold).toBe(false);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
