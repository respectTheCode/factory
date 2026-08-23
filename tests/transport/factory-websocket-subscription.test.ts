import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";

type RawTRPCMessage = {
  id: number;
  result?: {
    data?: unknown;
    type?: string;
  };
  error?: unknown;
};

function waitForMessage(
  socket: WebSocket,
  id: number,
  predicate: (message: RawTRPCMessage) => boolean = () => true,
): Promise<RawTRPCMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      reject(new Error(`Timed out waiting for tRPC message ${id}.`));
    }, 1_000);

    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as RawTRPCMessage;
      if (message.id !== id || !predicate(message)) {
        return;
      }

      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      resolve(message);
    };
    const onError = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      reject(new Error("WebSocket subscription failed."));
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}

function sendMutation(
  socket: WebSocket,
  id: number,
  path: string,
  input: Record<string, unknown>,
): Promise<RawTRPCMessage> {
  const response = waitForMessage(socket, id);
  socket.send(
    JSON.stringify({
      id,
      method: "mutation",
      params: { input, path },
    }),
  );
  return response;
}

describe("Factory subscription WebSocket transport", () => {
  test("publishes authoritative project detail after a task mutation", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-subscription-transport-"),
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

      const projectResponse = await sendMutation(socket, 1, "projects.create", {
        name: "Website refresh",
      });
      const project = projectResponse.result?.data as { id: string };

      const subscriptionStarted = waitForMessage(socket, 2);
      socket.send(
        JSON.stringify({
          id: 2,
          method: "subscription",
          params: {
            input: { projectId: project.id },
            path: "projects.updates",
          },
        }),
      );

      await expect(subscriptionStarted).resolves.toMatchObject({
        id: 2,
        result: { type: "started" },
      });

      const update = waitForMessage(
        socket,
        2,
        (message) =>
          message.result?.type === "data" &&
          (
            message.result.data as { tasks?: Array<{ name: string }> }
          )?.tasks?.some(
            (task) => task.name === "Publish the refreshed site",
          ) === true,
      );

      await sendMutation(socket, 3, "tasks.create", {
        name: "Publish the refreshed site",
        projectId: project.id,
      });

      await expect(update).resolves.toMatchObject({
        id: 2,
        result: {
          type: "data",
          data: {
            id: project.id,
            name: "Website refresh",
            tasks: [
              expect.objectContaining({ name: "Publish the refreshed site" }),
            ],
          },
        },
      });
    } finally {
      socket.send(
        JSON.stringify({ id: 2, method: "subscription.stop", params: {} }),
      );
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
