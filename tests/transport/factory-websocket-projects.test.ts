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

describe("Factory project WebSocket transport", () => {
  test("creates a project and observes it through projects.list", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-transport-"),
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

      const createResponse = await sendRawTRPCRequest(socket, {
        id: 1,
        method: "mutation",
        params: {
          input: { name: "Website refresh" },
          path: "projects.create",
        },
      });

      expect(createResponse.result?.type).toBe("data");

      const listResponse = await sendRawTRPCRequest(socket, {
        id: 2,
        method: "query",
        params: { input: null, path: "projects.list" },
      });

      expect(listResponse).toMatchObject({
        id: 2,
        result: {
          type: "data",
          data: [{ name: "Website refresh" }],
        },
      });
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
