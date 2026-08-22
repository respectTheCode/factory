import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";

describe("Factory WebSocket transport", () => {
  test("upgrades /trpc and serves a projects.list query", async () => {
    const server = createFactoryServer({ port: 0 });
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

      const responsePromise = new Promise<unknown>((resolve, reject) => {
        socket.addEventListener(
          "message",
          (event) => {
            try {
              resolve(JSON.parse(String(event.data)));
            } catch (error) {
              reject(error);
            }
          },
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket query failed")),
          { once: true },
        );
      });

      socket.send(
        JSON.stringify({
          id: 1,
          method: "query",
          params: { input: null, path: "projects.list" },
        }),
      );

      const response = await responsePromise;

      expect(response).toMatchObject({
        id: 1,
        result: { data: [], type: "data" },
      });
    } finally {
      socket.close();
      server.stop();
    }
  });
});
