import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";
import { createProjectAndRefresh } from "../../src/web/project-actions";

type RawTRPCResponse = {
  id: number;
  error?: { message?: string };
  result?: { data?: unknown; type?: string };
};

function request(
  socket: WebSocket,
  requestBody: Record<string, unknown> & { id: number },
): Promise<RawTRPCResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const response = JSON.parse(String(event.data)) as RawTRPCResponse;
      if (response.id !== requestBody.id) {
        return;
      }

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
    socket.send(JSON.stringify(requestBody));
  });
}

describe("dashboard project creation", () => {
  test("shows the newly created project after a successful tRPC mutation", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-dashboard-"),
    );
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      port: 0,
    });
    const socket = new WebSocket(new URL("/trpc", server.url));
    let nextRequestId = 1;

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket connection failed")),
          { once: true },
        );
      });

      const dashboardActions = {
        createProject: async (input: { name: string }) => {
          const response = await request(socket, {
            id: nextRequestId++,
            method: "mutation",
            params: { input, path: "projects.create" },
          });
          if (response.result?.type !== "data") {
            throw new Error(
              response.error?.message ?? "Project creation failed",
            );
          }
        },
        listProjects: async () => {
          const response = await request(socket, {
            id: nextRequestId++,
            method: "query",
            params: { input: null, path: "projects.list" },
          });
          if (response.result?.type !== "data") {
            throw new Error(
              response.error?.message ?? "Project listing failed",
            );
          }
          return response.result.data as Array<{ id: string; name: string }>;
        },
      };

      expect(await dashboardActions.listProjects()).toEqual([]);

      const observedProjects = await createProjectAndRefresh({
        actions: dashboardActions,
        name: "Website refresh",
      });

      expect(observedProjects).toHaveLength(1);
      expect(observedProjects[0]?.name).toBe("Website refresh");
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
