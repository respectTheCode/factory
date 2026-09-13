import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";

type RawTRPCResponse = {
  id: number;
  error?: unknown;
  result?: {
    data?: unknown;
    type?: string;
  };
};

function sendRawTRPCRequest(
  socket: WebSocket,
  request: Record<string, unknown> & { id: number },
): Promise<RawTRPCResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      try {
        const response = JSON.parse(String(event.data)) as RawTRPCResponse;
        if (response.id !== request.id) return;

        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        resolve(response);
      } catch (error) {
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("error", onError);
        reject(error);
      }
    };
    const onError = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      reject(new Error("WebSocket request failed"));
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.send(JSON.stringify(request));
  });
}

function responseData(response: RawTRPCResponse): Record<string, unknown> {
  expect(response.result?.type).toBe("data");
  return response.result?.data as Record<string, unknown>;
}

async function openSocket(server: { url: URL }): Promise<WebSocket> {
  const socket = new WebSocket(new URL("/trpc", server.url));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket connection failed")),
      { once: true },
    );
  });
  return socket;
}

describe("Factory archive state WebSocket transport", () => {
  test("archives tasks as released and wont_do, then restores them", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-task-archive-transport-"),
    );
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      port: 0,
    });
    const socket = await openSocket(server);

    try {
      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 1,
          method: "mutation",
          params: { input: { name: "Factory V1" }, path: "projects.create" },
        }),
      );
      const task = responseData(
        await sendRawTRPCRequest(socket, {
          id: 2,
          method: "mutation",
          params: {
            input: { name: "Ship the release", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );

      const released = await sendRawTRPCRequest(socket, {
        id: 3,
        method: "mutation",
        params: {
          input: { archiveState: "released", taskId: task.id },
          path: "tasks.archive",
        },
      });
      expect(released.result?.type).toBe("data");

      const releasedStatus = responseData(
        await sendRawTRPCRequest(socket, {
          id: 4,
          method: "query",
          params: { input: { taskId: task.id }, path: "tasks.status" },
        }),
      );
      expect(releasedStatus).toMatchObject({
        archiveState: "released",
        taskState: "released",
      });

      const restored = await sendRawTRPCRequest(socket, {
        id: 5,
        method: "mutation",
        params: { input: { taskId: task.id }, path: "tasks.restore" },
      });
      expect(restored.result?.type).toBe("data");
      expect(
        responseData(
          await sendRawTRPCRequest(socket, {
            id: 6,
            method: "query",
            params: { input: { taskId: task.id }, path: "tasks.status" },
          }),
        ),
      ).not.toHaveProperty("archiveState");

      const wontDo = await sendRawTRPCRequest(socket, {
        id: 7,
        method: "mutation",
        params: {
          input: { archiveState: "wont_do", taskId: task.id },
          path: "tasks.archive",
        },
      });
      expect(wontDo.result?.type).toBe("data");

      expect(
        responseData(
          await sendRawTRPCRequest(socket, {
            id: 8,
            method: "query",
            params: { input: { taskId: task.id }, path: "tasks.status" },
          }),
        ),
      ).toMatchObject({ archiveState: "wont_do" });

      const restoredAgain = await sendRawTRPCRequest(socket, {
        id: 9,
        method: "mutation",
        params: { input: { taskId: task.id }, path: "tasks.restore" },
      });
      expect(restoredAgain.result?.type).toBe("data");
      expect(
        responseData(
          await sendRawTRPCRequest(socket, {
            id: 10,
            method: "query",
            params: { input: { taskId: task.id }, path: "tasks.status" },
          }),
        ),
      ).not.toHaveProperty("archiveState");
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("shows subtask archive states through tasks.status and restores them", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-subtask-archive-transport-"),
    );
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      port: 0,
    });
    const socket = await openSocket(server);

    try {
      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 21,
          method: "mutation",
          params: { input: { name: "Factory V1" }, path: "projects.create" },
        }),
      );
      const task = responseData(
        await sendRawTRPCRequest(socket, {
          id: 22,
          method: "mutation",
          params: {
            input: { name: "Triage the release", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );
      const subtask = responseData(
        await sendRawTRPCRequest(socket, {
          id: 23,
          method: "mutation",
          params: {
            input: { name: "Skip the obsolete step", taskId: task.id },
            path: "subtasks.create",
          },
        }),
      );

      const archived = await sendRawTRPCRequest(socket, {
        id: 24,
        method: "mutation",
        params: {
          input: { archiveState: "wont_do", subtaskId: subtask.id },
          path: "subtasks.archive",
        },
      });
      expect(archived.result?.type).toBe("data");

      const archivedStatus = responseData(
        await sendRawTRPCRequest(socket, {
          id: 25,
          method: "query",
          params: { input: { taskId: task.id }, path: "tasks.status" },
        }),
      );
      expect(archivedStatus).toMatchObject({
        taskState: "planned",
        subtasks: [
          {
            archiveState: "wont_do",
            verificationState: "unreported",
          },
        ],
      });

      const restored = await sendRawTRPCRequest(socket, {
        id: 26,
        method: "mutation",
        params: {
          input: { subtaskId: subtask.id },
          path: "subtasks.restore",
        },
      });
      expect(restored.result?.type).toBe("data");

      const restoredStatus = responseData(
        await sendRawTRPCRequest(socket, {
          id: 27,
          method: "query",
          params: { input: { taskId: task.id }, path: "tasks.status" },
        }),
      );
      expect(restoredStatus).toMatchObject({
        subtasks: [{ verificationState: "unreported" }],
      });
      expect(
        (restoredStatus.subtasks as Array<Record<string, unknown>>)[0],
      ).not.toHaveProperty("archiveState");
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("requires explicit confirmation before deleting tasks or subtasks", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-removal-transport-"),
    );
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      port: 0,
    });
    const socket = await openSocket(server);

    try {
      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 31,
          method: "mutation",
          params: { input: { name: "Factory V1" }, path: "projects.create" },
        }),
      );
      const task = responseData(
        await sendRawTRPCRequest(socket, {
          id: 32,
          method: "mutation",
          params: {
            input: { name: "Remove this task", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );
      const siblingTask = responseData(
        await sendRawTRPCRequest(socket, {
          id: 33,
          method: "mutation",
          params: {
            input: { name: "Keep this task", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );
      const subtask = responseData(
        await sendRawTRPCRequest(socket, {
          id: 34,
          method: "mutation",
          params: {
            input: { name: "Remove this subtask", taskId: siblingTask.id },
            path: "subtasks.create",
          },
        }),
      );

      const unconfirmedTask = await sendRawTRPCRequest(socket, {
        id: 35,
        method: "mutation",
        params: { input: { taskId: task.id }, path: "tasks.remove" },
      });
      expect(unconfirmedTask.error).toBeDefined();

      const removedTask = await sendRawTRPCRequest(socket, {
        id: 36,
        method: "mutation",
        params: {
          input: { confirm: true, taskId: task.id },
          path: "tasks.remove",
        },
      });
      expect(removedTask.result?.type).toBe("data");
      expect(responseData(removedTask)).toMatchObject({
        taskId: task.id,
        dashboard: {
          projectDetail: {
            tasks: [expect.not.objectContaining({ id: task.id })],
          },
        },
      });

      const removedSubtask = await sendRawTRPCRequest(socket, {
        id: 37,
        method: "mutation",
        params: {
          input: { confirm: true, subtaskId: subtask.id },
          path: "subtasks.remove",
        },
      });
      expect(removedSubtask.result?.type).toBe("data");
      expect(responseData(removedSubtask)).toMatchObject({
        subtaskId: subtask.id,
        dashboard: {
          projectDetail: {
            tasks: [expect.objectContaining({ subtasks: [] })],
          },
        },
      });

      const remainingHierarchy = responseData(
        await sendRawTRPCRequest(socket, {
          id: 38,
          method: "query",
          params: {
            input: { projectId: project.id },
            path: "projects.detail",
          },
        }),
      );
      expect(remainingHierarchy.tasks).toEqual([
        expect.objectContaining({ id: siblingTask.id, subtasks: [] }),
      ]);
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
