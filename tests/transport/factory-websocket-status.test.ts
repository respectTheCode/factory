import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";
import { createWebSocket, loginTestOperator } from "./helpers";

type RawResponse = {
  id: number;
  result?: { data?: unknown; type?: string };
};

function request(
  socket: WebSocket,
  body: Record<string, unknown> & { id: number },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const response = JSON.parse(String(event.data)) as RawResponse;
      if (response.id !== body.id) return;
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      resolve(response);
    };
    const onError = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      reject(new Error("WebSocket request failed"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.send(JSON.stringify(body));
  });
}

function data(response: RawResponse): Record<string, unknown> {
  expect(response.result?.type).toBe("data");
  return response.result?.data as Record<string, unknown>;
}

describe("Factory status WebSocket transport", () => {
  test("exposes project and portfolio status projections", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-status-transport-"),
    );
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      operator: { name: "test-operator", secret: "test-operator-secret" },
      port: 0,
    });
    const socket = createWebSocket(new URL("/trpc", server.url), {
      Cookie: await loginTestOperator(server),
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket connection failed")),
          { once: true },
        );
      });

      const project = data(
        await request(socket, {
          id: 1,
          method: "mutation",
          params: {
            input: { name: "Factory V1" },
            path: "projects.create",
          },
        }),
      );
      const task = data(
        await request(socket, {
          id: 2,
          method: "mutation",
          params: {
            input: { name: "Ship the loop", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );
      const subtask = data(
        await request(socket, {
          id: 3,
          method: "mutation",
          params: {
            input: { name: "Verify the loop", taskId: task.id },
            path: "subtasks.create",
          },
        }),
      );
      await request(socket, {
        id: 4,
        method: "mutation",
        params: {
          input: {
            reportedState: "in_progress",
            reporter: "codex",
            subtaskId: subtask.id,
          },
          path: "subtasks.report",
        },
      });

      const projectStatus = await request(socket, {
        id: 5,
        method: "query",
        params: { input: { projectId: project.id }, path: "projects.status" },
      });
      expect(projectStatus).toMatchObject({
        id: 5,
        result: {
          type: "data",
          data: {
            totalTasks: 1,
            counts: {
              planned: 0,
              active: 1,
              awaiting_verification: 0,
              completed: 0,
              blocked: 0,
            },
          },
        },
      });

      const portfolioStatus = await request(socket, {
        id: 6,
        method: "query",
        params: { input: null, path: "projects.portfolio" },
      });
      expect(data(portfolioStatus)).toMatchObject({
        totalTasks: 1,
        counts: {
          planned: 0,
          active: 1,
          awaiting_verification: 0,
          completed: 0,
          blocked: 0,
        },
        projects: [{ projectId: project.id }],
      });
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("exposes non-completed work through the attention projection", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-attention-transport-"),
    );
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      operator: { name: "test-operator", secret: "test-operator-secret" },
      port: 0,
    });
    const socket = createWebSocket(new URL("/trpc", server.url), {
      Cookie: await loginTestOperator(server),
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket connection failed")),
          { once: true },
        );
      });

      const alpha = data(
        await request(socket, {
          id: 11,
          method: "mutation",
          params: { input: { name: "Alpha roadmap" }, path: "projects.create" },
        }),
      );
      const plannedTask = data(
        await request(socket, {
          id: 12,
          method: "mutation",
          params: {
            input: { name: "Draft release", projectId: alpha.id },
            path: "tasks.create",
          },
        }),
      );
      const zeta = data(
        await request(socket, {
          id: 13,
          method: "mutation",
          params: { input: { name: "Zeta launch" }, path: "projects.create" },
        }),
      );
      const activeTask = data(
        await request(socket, {
          id: 14,
          method: "mutation",
          params: {
            input: {
              name: "Build deployment",
              owner: "sam",
              priority: "high",
              projectId: zeta.id,
            },
            path: "tasks.create",
          },
        }),
      );
      const subtask = data(
        await request(socket, {
          id: 15,
          method: "mutation",
          params: {
            input: { name: "Build subtask", taskId: activeTask.id },
            path: "subtasks.create",
          },
        }),
      );
      await request(socket, {
        id: 16,
        method: "mutation",
        params: {
          input: {
            reportedState: "in_progress",
            reporter: "codex",
            subtaskId: subtask.id,
          },
          path: "subtasks.report",
        },
      });

      const attention = await request(socket, {
        id: 17,
        method: "query",
        params: { input: null, path: "projects.attention" },
      });

      expect(attention).toMatchObject({
        id: 17,
        result: {
          type: "data",
          data: [
            {
              owner: "sam",
              priority: "high",
              projectId: zeta.id,
              projectName: "Zeta launch",
              state: "active",
              taskId: activeTask.id,
              taskName: "Build deployment",
            },
            {
              projectId: alpha.id,
              projectName: "Alpha roadmap",
              state: "planned",
              taskId: plannedTask.id,
              taskName: "Draft release",
            },
          ],
        },
      });
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
