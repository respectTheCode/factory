import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";

type RawTRPCResponse = {
  id: number;
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
        if (response.id !== request.id) {
          return;
        }

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

describe("Factory planning WebSocket transport", () => {
  test("creates a task plan and observes it through project detail", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-planning-transport-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const server = createFactoryServer({ port: 0, databasePath });
    const socket = new WebSocket(new URL("/trpc", server.url));

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket connection failed")),
          { once: true },
        );
      });

      const projectResponse = await sendRawTRPCRequest(socket, {
        id: 1,
        method: "mutation",
        params: {
          input: { name: "Website refresh" },
          path: "projects.create",
        },
      });
      const project = responseData(projectResponse);

      const taskResponse = await sendRawTRPCRequest(socket, {
        id: 2,
        method: "mutation",
        params: {
          input: {
            name: "Publish the refreshed site",
            projectId: project.id,
          },
          path: "tasks.create",
        },
      });
      const task = responseData(taskResponse);

      await sendRawTRPCRequest(socket, {
        id: 3,
        method: "mutation",
        params: {
          input: {
            name: "Verify the production build",
            taskId: task.id,
          },
          path: "subtasks.create",
        },
      });

      const detailResponse = await sendRawTRPCRequest(socket, {
        id: 4,
        method: "query",
        params: {
          input: { projectId: project.id },
          path: "projects.detail",
        },
      });

      expect(detailResponse).toMatchObject({
        id: 4,
        result: {
          type: "data",
          data: {
            name: "Website refresh",
            tasks: [
              {
                name: "Publish the refreshed site",
                subtasks: [{ name: "Verify the production build" }],
              },
            ],
          },
        },
      });
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
