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

describe("Factory Task check transport", () => {
  test("requires a human session for an explicit check after the finish rule is ready", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-task-acceptance-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Acceptance authorization" });
    const task = app.createTask({
      finishRule: { kind: "agent_report", requireHumanCheck: true },
      humanCheckText: "Compare the release with the approved checklist.",
      name: "Ship the release",
      projectId: project.id,
    });
    app.reportTaskStatus({
      reporter: "codex",
      reportedState: "finished",
      summary: "The release is ready for its explicit human check.",
      taskId: task.id,
      workflowEpoch: app.getTaskStatus(task.id).workflowEpoch,
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
      expectedRevision: status.taskRevision,
      taskId: task.id,
    };

    try {
      const denied = await request(server, "tasks.check", input, {
        token: machine.token,
      });
      expect(denied.body.error?.data?.code).toBe("UNAUTHORIZED");

      const checked = await request(server, "tasks.check", input, {
        cookie: await loginTestOperator(server),
      });
      expect(checked.response.status).toBe(200);
      expect(checked.body.result?.data).toMatchObject({
        id: task.id,
        finishMetadata: { kind: "human_check", epoch: status.workflowEpoch },
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
        subtasks: [],
      });
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
