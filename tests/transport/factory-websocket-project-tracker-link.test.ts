import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";
import { createWebSocket, loginTestOperator } from "./helpers";

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

describe("Factory project tracker-link WebSocket transport", () => {
  test("links a project and keeps its tracker link distinct from a task link", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-tracker-transport-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const server = createFactoryServer({
      databasePath,
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

      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 1,
          method: "mutation",
          params: {
            input: {
              gitOriginUrl: "git@github.com:app-press/playlister.git",
              name: "Playlister roadmap",
            },
            path: "projects.create",
          },
        }),
      );
      const task = responseData(
        await sendRawTRPCRequest(socket, {
          id: 2,
          method: "mutation",
          params: {
            input: {
              branchName: "PRO-1412-mobile-dashboard",
              name: "Ship the mobile dashboard",
              projectId: project.id,
            },
            path: "tasks.create",
          },
        }),
      );

      const projectLinkResponse = await sendRawTRPCRequest(socket, {
        id: 3,
        method: "mutation",
        params: {
          input: {
            system: "notion",
            projectId: project.id,
            stableId: "notion-project-123",
            url: "https://www.notion.so/playlister/Project-123",
            title: "Playlister roadmap",
          },
          path: "projects.link",
        },
      });
      expect(projectLinkResponse.result?.type).toBe("data");

      const taskLinkResponse = await sendRawTRPCRequest(socket, {
        id: 4,
        method: "mutation",
        params: {
          input: {
            system: "linear",
            taskId: task.id,
            stableId: "GRA-123",
            url: "https://linear.app/grail/issue/GRA-123",
            title: "Ship the mobile dashboard",
          },
          path: "tasks.link",
        },
      });
      expect(taskLinkResponse.result?.type).toBe("data");

      const projectDetailResponse = await sendRawTRPCRequest(socket, {
        id: 5,
        method: "query",
        params: {
          input: { projectId: project.id },
          path: "projects.detail",
        },
      });
      expect(projectDetailResponse).toMatchObject({
        id: 5,
        result: {
          type: "data",
          data: {
            id: project.id,
            gitOriginUrl: "git@github.com:app-press/playlister.git",
            name: "Playlister roadmap",
            trackerLinks: [
              {
                system: "notion",
                projectId: project.id,
                stableId: "notion-project-123",
                url: "https://www.notion.so/playlister/Project-123",
                title: "Playlister roadmap",
              },
            ],
          },
        },
      });

      const taskDetailResponse = await sendRawTRPCRequest(socket, {
        id: 6,
        method: "query",
        params: {
          input: { taskId: task.id },
          path: "tasks.detail",
        },
      });
      expect(taskDetailResponse).toMatchObject({
        id: 6,
        result: {
          type: "data",
          data: {
            branchName: "PRO-1412-mobile-dashboard",
            trackerLinks: [
              {
                system: "linear",
                taskId: task.id,
                stableId: "GRA-123",
                url: "https://linear.app/grail/issue/GRA-123",
                title: "Ship the mobile dashboard",
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

  test("accepts project links without an optional title", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-tracker-optional-title-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const server = createFactoryServer({
      databasePath,
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

      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 11,
          method: "mutation",
          params: {
            input: { name: "Grail roadmap" },
            path: "projects.create",
          },
        }),
      );

      const linkResponse = await sendRawTRPCRequest(socket, {
        id: 12,
        method: "mutation",
        params: {
          input: {
            system: "linear",
            projectId: project.id,
            stableId: "GRA-456",
            url: "https://linear.app/grail/project/GRA-456",
          },
          path: "projects.link",
        },
      });

      expect(linkResponse).toMatchObject({
        id: 12,
        result: {
          type: "data",
          data: {
            system: "linear",
            projectId: project.id,
            stableId: "GRA-456",
            url: "https://linear.app/grail/project/GRA-456",
          },
        },
      });
      expect(
        (linkResponse.result?.data as Record<string, unknown>)?.title,
      ).toBeUndefined();
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
