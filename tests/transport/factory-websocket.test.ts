import { describe, expect, test } from "bun:test";

import { createTestServer, openAuthenticatedSocket } from "./helpers";

describe("Factory WebSocket transport", () => {
  test("upgrades /trpc and serves a projects.list query", async () => {
    const server = createTestServer({ databasePath: ":memory:", port: 0 });
    const socket = await openAuthenticatedSocket(server);

    try {
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
