import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";

type TRPCResponse = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

const operator = { name: "Kevin", secret: "operator-secret" };

async function apiRequest(
  server: { url: URL },
  path: string,
  input: unknown,
  token: string,
): Promise<{ response: Response; body: TRPCResponse }> {
  const response = await fetch(new URL(`/api/${path}`, server.url), {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  return {
    body: (await response.json()) as TRPCResponse,
    response,
  };
}

function resultData<T>(body: TRPCResponse): T {
  if (body.result?.data === undefined) {
    throw new Error(`Expected tRPC result: ${JSON.stringify(body)}`);
  }
  return body.result.data as T;
}

function temporaryDatabase(prefix: string): {
  directory: string;
  databasePath: string;
} {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return { databasePath: join(directory, "factory.sqlite"), directory };
}

function port(): number {
  return 30_000 + (process.pid % 1_000) + Math.floor(Math.random() * 10_000);
}

describe("serialized Factory writes and idempotency", () => {
  test("replays a report across a server restart, scopes keys, and rejects reuse", async () => {
    const { databasePath, directory } = temporaryDatabase(
      "factory-idempotency-",
    );
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Factory" });
    const task = application.createTask({
      name: "Task",
      projectId: project.id,
    });
    const subtask = application.createSubtask({
      name: "Subtask",
      taskId: task.id,
    });
    const store = createMachineCredentialStore({ databasePath });
    const firstCredential = store.create({
      machineId: "machine-one",
      projectIds: [project.id],
    });
    const secondCredential = store.create({
      machineId: "machine-two",
      projectIds: [project.id],
    });
    let server = createFactoryServer({ databasePath, operator, port: port() });

    try {
      const input = {
        createdAt: "2000-01-01T00:00:00.000Z",
        evidence: "server-owned timestamp",
        reportedState: "in_progress",
        reporter: "codex",
        requestKey: "report-replay-1",
        subtaskId: subtask.id,
      };
      const first = await apiRequest(
        server,
        "subtasks.report",
        input,
        firstCredential.token,
      );
      expect(first.response.status).toBe(200);
      const firstReport = resultData<{ id: string; createdAt: string }>(
        first.body,
      );
      expect(firstReport.createdAt).not.toBe(input.createdAt);
      expect(Date.parse(firstReport.createdAt)).toBeGreaterThan(
        Date.parse(input.createdAt),
      );

      const replay = await apiRequest(
        server,
        "subtasks.report",
        input,
        firstCredential.token,
      );
      expect(replay.response.status).toBe(200);
      expect(replay.body).toEqual(first.body);
      expect(resultData<{ id: string }>(replay.body).id).toBe(firstReport.id);
      expect(application.getSubtaskReportHistory(subtask.id)).toHaveLength(1);

      await server.stop();
      server = createFactoryServer({
        databasePath,
        operator,
        port: port(),
      });
      const afterRestart = await apiRequest(
        server,
        "subtasks.report",
        input,
        firstCredential.token,
      );
      expect(afterRestart.response.status).toBe(200);
      expect(afterRestart.body).toEqual(first.body);
      expect(resultData<{ id: string }>(afterRestart.body).id).toBe(
        firstReport.id,
      );

      const secondScope = await apiRequest(
        server,
        "subtasks.report",
        input,
        secondCredential.token,
      );
      expect(secondScope.response.status).toBe(200);
      expect(resultData<{ id: string }>(secondScope.body).id).not.toBe(
        firstReport.id,
      );

      const taskRevision = application.getTaskDetail(task.id).revision;
      const taskUpdate = await apiRequest(
        server,
        "tasks.update",
        {
          expectedRevision: taskRevision,
          name: "Updated task",
          requestKey: "task-update-1",
          taskId: task.id,
        },
        firstCredential.token,
      );
      expect(taskUpdate.response.status).toBe(200);
      expect(resultData<{ revision: number }>(taskUpdate.body).revision).toBe(
        taskRevision + 1,
      );
      const staleTask = await apiRequest(
        server,
        "tasks.update",
        {
          expectedRevision: taskRevision,
          name: "Stale task",
          requestKey: "task-update-2",
          taskId: task.id,
        },
        firstCredential.token,
      );
      expect(staleTask.response.status).toBe(409);
      expect(staleTask.body.error?.data?.code).toBe("CONFLICT");
      expect(staleTask.body.error?.message).toContain(
        `current revision ${taskRevision + 1}`,
      );
      expect(staleTask.body.error?.message).toContain(
        `expected revision ${taskRevision}`,
      );

      const subtaskRevision = application.getSubtaskDetail(subtask.id).revision;
      const subtaskUpdate = await apiRequest(
        server,
        "subtasks.update",
        {
          description: "Updated description",
          expectedRevision: subtaskRevision,
          requestKey: "subtask-update-1",
          subtaskId: subtask.id,
        },
        firstCredential.token,
      );
      expect(subtaskUpdate.response.status).toBe(200);
      expect(
        resultData<{ revision: number }>(subtaskUpdate.body).revision,
      ).toBe(subtaskRevision + 1);
      const staleSubtask = await apiRequest(
        server,
        "subtasks.update",
        {
          description: "Stale description",
          expectedRevision: subtaskRevision,
          requestKey: "subtask-update-2",
          subtaskId: subtask.id,
        },
        firstCredential.token,
      );
      expect(staleSubtask.response.status).toBe(409);
      expect(staleSubtask.body.error?.data?.code).toBe("CONFLICT");

      const reused = await apiRequest(
        server,
        "subtasks.report",
        { ...input, evidence: "different payload" },
        firstCredential.token,
      );
      expect(reused.response.status).toBe(409);
      expect(reused.body.error?.data?.code).toBe("CONFLICT");
      expect(reused.body.error?.message).toBe(
        "request key reused with a different payload",
      );

      const database = new Database(databasePath, { readonly: true });
      try {
        const receiptCount = database
          .query("SELECT COUNT(*) AS count FROM factory_idempotency_receipts")
          .get() as { count: number };
        expect(receiptCount.count).toBe(4);
      } finally {
        database.close();
      }
    } finally {
      await server.stop();
      store.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("serializes 25 distinct and 25 same-subtask reports without loss", async () => {
    const { databasePath, directory } = temporaryDatabase(
      "factory-concurrency-",
    );
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Factory" });
    const task = application.createTask({
      name: "Task",
      projectId: project.id,
    });
    const subtasks = Array.from({ length: 25 }, (_, index) =>
      application.createSubtask({
        name: `Subtask ${index + 1}`,
        taskId: task.id,
      }),
    );
    const sameSubtask = subtasks[0];
    if (!sameSubtask) throw new Error("Expected a fixture subtask.");
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "machine-concurrency",
      projectIds: [project.id],
    });
    const server = createFactoryServer({
      databasePath,
      operator,
      port: port(),
    });

    try {
      const distinctInputs = subtasks.map((subtask, index) => ({
        evidence: `distinct-${index}`,
        reportedState: "in_progress" as const,
        reporter: "codex",
        requestKey: `distinct-${String(index).padStart(2, "0")}`,
        subtaskId: subtask.id,
      }));
      const sameInputs = Array.from({ length: 25 }, (_, index) => ({
        evidence: `same-${index}`,
        reportedState: "in_progress" as const,
        reporter: "codex",
        requestKey: `same-report-${String(index).padStart(2, "0")}`,
        subtaskId: sameSubtask.id,
      }));
      const responses = await Promise.all(
        [...distinctInputs, ...sameInputs].map((input) =>
          apiRequest(server, "subtasks.report", input, credential.token),
        ),
      );

      expect(responses.every(({ response }) => response.status === 200)).toBe(
        true,
      );
      const reportIds = responses.map(
        ({ body }) => resultData<{ id: string }>(body).id,
      );
      expect(new Set(reportIds).size).toBe(50);
      expect(application.getSubtaskReportHistory(sameSubtask.id)).toHaveLength(
        26,
      );
      const totalReports = subtasks.reduce(
        (total, current) =>
          total + application.getSubtaskReportHistory(current.id).length,
        0,
      );
      expect(totalReports).toBe(50);
      expect(application.getTaskStatus(task.id)).toMatchObject({
        taskState: "active",
        subtasks: expect.arrayContaining(
          subtasks.map((subtask) =>
            expect.objectContaining({ subtaskId: subtask.id }),
          ),
        ),
      });
    } finally {
      await server.stop();
      store.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("reports the median and p95 latency for 50 sequential remote reports", async () => {
    const { databasePath, directory } = temporaryDatabase("factory-latency-");
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Factory" });
    const task = application.createTask({
      name: "Task",
      projectId: project.id,
    });
    const subtask = application.createSubtask({
      name: "Subtask",
      taskId: task.id,
    });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "machine-latency",
      projectIds: [project.id],
    });
    const server = createFactoryServer({
      databasePath,
      operator,
      port: port(),
    });
    const timings: number[] = [];

    try {
      const url = new URL(`/api/subtasks.report`, server.url);
      for (let index = 0; index < 50; index += 1) {
        const started = performance.now();
        const response = await fetch(url, {
          body: JSON.stringify({
            evidence: `latency-${index}`,
            reportedState: "in_progress",
            reporter: "codex",
            requestKey: `latency-${String(index).padStart(2, "0")}`,
            subtaskId: subtask.id,
          }),
          headers: {
            Authorization: `Bearer ${credential.token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        expect(response.status).toBe(200);
        await response.json();
        timings.push(performance.now() - started);
      }

      const sorted = [...timings].sort((left, right) => left - right);
      const percentile = (fraction: number) =>
        sorted[
          Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
        ] ?? 0;
      console.log(
        `remote report latency median=${percentile(0.5).toFixed(1)}ms p95=${percentile(0.95).toFixed(1)}ms`,
      );
      expect(timings).toHaveLength(50);
    } finally {
      await server.stop();
      store.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
