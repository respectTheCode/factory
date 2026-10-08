import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";
import { createWebSocket, loginTestOperator } from "./helpers";

type RawTRPCMessage = {
  id: number;
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown; type?: string };
};

type TRPCResponse = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

const operator = { name: "test-operator", secret: "test-operator-secret" };

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
    }, 1_500);

    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as RawTRPCMessage;
      if (message.id !== id || !predicate(message)) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      resolve(message);
    };
    const onError = () => {
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      reject(new Error("Factory WebSocket request failed."));
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
  });
}

async function openSocket(
  server: { url: URL },
  token: string,
): Promise<WebSocket> {
  const socket = createWebSocket(new URL("/trpc", server.url), {
    Authorization: `Bearer ${token}`,
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Factory WebSocket connection failed.")),
      { once: true },
    );
  });
  return socket;
}

async function apiRequest(
  server: { url: URL },
  path: string,
  options: { cookie?: string; input?: unknown } = {},
): Promise<{ body: TRPCResponse; response: Response }> {
  const response = await fetch(new URL(`/api/${path}`, server.url), {
    ...(options.input === undefined
      ? {}
      : { body: JSON.stringify(options.input), method: "POST" }),
    headers: {
      ...(options.input === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
  });
  const body = response.headers.get("content-type")?.includes("json")
    ? ((await response.json()) as TRPCResponse)
    : {};
  return { body, response };
}

async function startSubscription(
  socket: WebSocket,
  id: number,
  projectId: string,
): Promise<RawTRPCMessage> {
  const started = waitForMessage(
    socket,
    id,
    (message) => message.result?.type === "started" || Boolean(message.error),
  );
  socket.send(
    JSON.stringify({
      id,
      method: "subscription",
      params: { input: { projectId }, path: "projects.updates" },
    }),
  );
  return started;
}

async function publishTask(
  server: { url: URL },
  cookie: string,
  projectId: string,
  name: string,
): Promise<void> {
  const result = await apiRequest(server, "tasks.create", {
    cookie,
    input: { name, projectId },
  });
  expect(result.response.status).toBe(200);
}

function snapshotProjectIds(message: RawTRPCMessage): string[] {
  const snapshot = message.result?.data as {
    projects?: Array<{ id: string }>;
  };
  return snapshot.projects?.map(({ id }) => id) ?? [];
}

describe("Factory machine credential subscriptions", () => {
  test("reauthenticates each update, applies changed scopes, and errors after revoke", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-agent-subscriptions-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const allowedProject = application.createProject({
      name: "Allowed project",
    });
    const hiddenProject = application.createProject({ name: "Hidden project" });
    application.close();

    const server = createFactoryServer({ databasePath, operator, port: 0 });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "agent-subscription-revoke",
      projectIds: [allowedProject.id],
    });
    const socket = await openSocket(server, credential.token);

    try {
      const cookie = await loginTestOperator(server);
      await expect(
        startSubscription(socket, 1, allowedProject.id),
      ).resolves.toMatchObject({ id: 1, result: { type: "started" } });

      const initialUpdate = waitForMessage(
        socket,
        1,
        (message) => message.result?.type === "data",
      );
      await publishTask(server, cookie, allowedProject.id, "Initial update");
      const initialMessage = await initialUpdate;
      expect(initialMessage).toMatchObject({
        id: 1,
        result: { type: "data" },
      });
      expect(snapshotProjectIds(initialMessage)).toEqual([allowedProject.id]);

      const changedScope = await apiRequest(
        server,
        "agentCredentials.updateProjectAccess",
        {
          cookie,
          input: {
            credentialId: credential.id,
            projectIds: [hiddenProject.id],
          },
        },
      );
      expect(changedScope.response.status).toBe(200);

      const scopedUpdate = waitForMessage(
        socket,
        1,
        (message) => message.result?.type === "data",
      );
      await publishTask(server, cookie, allowedProject.id, "Changed scope");
      const scopedMessage = await scopedUpdate;
      expect(snapshotProjectIds(scopedMessage)).toEqual([hiddenProject.id]);
      expect(
        (scopedMessage.result?.data as { projectDetail?: unknown })
          .projectDetail,
      ).toBeUndefined();

      const revokeEvent = waitForMessage(
        socket,
        1,
        (message) => message.result?.type === "data" || Boolean(message.error),
      );
      const revoked = await apiRequest(server, "agentCredentials.revoke", {
        cookie,
        input: { credentialId: credential.id },
      });
      expect(revoked.response.status).toBe(200);
      await publishTask(server, cookie, allowedProject.id, "After revoke");
      const revokedMessage = await revokeEvent;
      expect(revokedMessage.error?.data?.code).toBe("UNAUTHORIZED");
      expect(revokedMessage.result?.type).not.toBe("data");
    } finally {
      socket.close();
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("errors after rotation and lets the replacement token subscribe", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-agent-subscriptions-rotate-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const allowedProject = application.createProject({
      name: "Allowed project",
    });
    const hiddenProject = application.createProject({ name: "Hidden project" });
    application.close();

    const server = createFactoryServer({ databasePath, operator, port: 0 });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "agent-subscription-rotate",
      projectIds: [allowedProject.id],
    });
    const oldSocket = await openSocket(server, credential.token);

    try {
      const cookie = await loginTestOperator(server);
      await expect(
        startSubscription(oldSocket, 1, allowedProject.id),
      ).resolves.toMatchObject({ id: 1, result: { type: "started" } });

      const rotated = await apiRequest(server, "agentCredentials.rotate", {
        cookie,
        input: { credentialId: credential.id },
      });
      expect(rotated.response.status).toBe(200);
      const newToken = (rotated.body.result?.data as { token: string }).token;
      expect(newToken).toMatch(/^fmc_/);

      const rotationEvent = waitForMessage(
        oldSocket,
        1,
        (message) => message.result?.type === "data" || Boolean(message.error),
      );
      await publishTask(server, cookie, allowedProject.id, "After rotation");
      const rotatedMessage = await rotationEvent;
      expect(rotatedMessage.error?.data?.code).toBe("UNAUTHORIZED");
      expect(rotatedMessage.result?.type).not.toBe("data");

      const newSocket = await openSocket(server, newToken);
      try {
        await expect(
          startSubscription(newSocket, 2, allowedProject.id),
        ).resolves.toMatchObject({ id: 2, result: { type: "started" } });

        const replacementUpdate = waitForMessage(
          newSocket,
          2,
          (message) => message.result?.type === "data",
        );
        await publishTask(
          server,
          cookie,
          allowedProject.id,
          "Replacement token update",
        );
        const replacementMessage = await replacementUpdate;
        expect(snapshotProjectIds(replacementMessage)).toEqual([
          allowedProject.id,
        ]);
        expect(snapshotProjectIds(replacementMessage)).not.toContain(
          hiddenProject.id,
        );
      } finally {
        newSocket.send(
          JSON.stringify({ id: 2, method: "subscription.stop", params: {} }),
        );
        newSocket.close();
      }
    } finally {
      oldSocket.send(
        JSON.stringify({ id: 1, method: "subscription.stop", params: {} }),
      );
      oldSocket.close();
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
