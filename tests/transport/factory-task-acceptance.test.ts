import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import type { FactoryServer } from "../../src/server";
import { createTestServer, loginTestOperator } from "./helpers";

type TRPCBody = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

async function request(
  server: Pick<FactoryServer, "url">,
  path: string,
  input: unknown,
  options: { cookie?: string; method?: "GET" | "POST"; token?: string } = {},
): Promise<{ body: TRPCBody; response: Response }> {
  const method = options.method ?? "POST";
  const url = new URL(`/api/${path}`, server.url);
  if (method === "GET") url.searchParams.set("input", JSON.stringify(input));
  const response = await fetch(url, {
    ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    method,
  });
  return {
    body: (await response.json()) as TRPCBody,
    response,
  };
}

describe("Factory task acceptance transport", () => {
  test("requires a human session and accepts the reviewed snapshot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-task-acceptance-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Acceptance authorization" });
    const task = app.createTask({
      name: "Ship the release",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Verify the build",
      taskId: task.id,
    });
    app.reportSubtaskStatus({
      reason: "Check the published build.",
      reporter: "codex",
      reportedState: "complete",
      subtaskId: subtask.id,
    });
    const status = app.getTaskStatus(task.id);
    app.close();

    const credentials = createMachineCredentialStore({ databasePath });
    const machine = credentials.create({
      machineId: "acceptance-machine",
      projectIds: [project.id],
    });
    credentials.close();
    const server = createTestServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
    });
    const input = {
      expectedTaskRevision: status.taskRevision,
      reviewedSubtasks: status.subtasks.map((child) => ({
        currentReportId: child.reportId ?? null,
        currentVerificationId: child.verificationId ?? null,
        revision: child.revision,
        subtaskId: child.subtaskId,
      })),
      taskId: task.id,
    };

    try {
      const denied = await request(server, "tasks.accept", input, {
        token: machine.token,
      });
      expect(denied.body.error?.data?.code).toBe("UNAUTHORIZED");

      const accepted = await request(server, "tasks.accept", input, {
        cookie: await loginTestOperator(server),
      });
      expect(accepted.response.status).toBe(200);
      expect(accepted.body.result?.data).toMatchObject({
        accepted: true,
        taskId: task.id,
      });
      const current = await request(
        server,
        "tasks.status",
        { taskId: task.id },
        {
          cookie: await loginTestOperator(server),
          method: "GET",
        },
      );
      expect(current.body.result?.data).toMatchObject({
        taskCompleted: true,
        taskState: "completed",
        subtasks: [expect.objectContaining({ verificationState: "accepted" })],
      });
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
