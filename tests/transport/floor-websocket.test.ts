import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { T3ActivityReader, T3ShellObservation } from "../../src/t3";
import { createFactoryServer, type FactoryServer } from "../../src/server";
import { createWebSocket, loginTestOperator } from "./helpers";

type RawMessage = {
  id: number;
  result?: { data?: unknown; type?: string };
  error?: unknown;
};

type MessageWaiter = {
  id: number;
  predicate: (message: RawMessage) => boolean;
  reject: (error: Error) => void;
  resolve: (message: RawMessage) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type MessageInbox = {
  onError: () => void;
  onMessage: (event: MessageEvent) => void;
  waiters: Set<MessageWaiter>;
};

const messageInboxes = new WeakMap<WebSocket, MessageInbox>();

function messageInbox(socket: WebSocket): MessageInbox {
  const existing = messageInboxes.get(socket);
  if (existing) return existing;
  const inbox: MessageInbox = {
    onError: () => {
      for (const waiter of [...inbox.waiters]) {
        waiter.reject(new Error("Floor WebSocket request failed."));
        clearTimeout(waiter.timeout);
      }
      inbox.waiters.clear();
    },
    onMessage: (event) => {
      let message: RawMessage;
      try {
        message = JSON.parse(String(event.data)) as RawMessage;
      } catch {
        return;
      }
      for (const waiter of [...inbox.waiters]) {
        if (waiter.id !== message.id || !waiter.predicate(message)) continue;
        inbox.waiters.delete(waiter);
        clearTimeout(waiter.timeout);
        waiter.resolve(message);
      }
    },
    waiters: new Set(),
  };
  messageInboxes.set(socket, inbox);
  socket.addEventListener("message", inbox.onMessage);
  socket.addEventListener("error", inbox.onError);
  return inbox;
}

function waitForMessage(
  socket: WebSocket,
  id: number,
  predicate: (message: RawMessage) => boolean = () => true,
): Promise<RawMessage> {
  const inbox = messageInbox(socket);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      inbox.waiters.delete(waiter);
      reject(new Error(`Timed out waiting for Floor WebSocket message ${id}.`));
    }, 1_500);
    const waiter: MessageWaiter = {
      id,
      predicate,
      reject,
      resolve,
      timeout,
    };
    inbox.waiters.add(waiter);
  });
}

async function openSocket(server: Pick<FactoryServer, "url">) {
  const socket = createWebSocket(new URL("/trpc", server.url), {
    Cookie: await loginTestOperator(server),
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Floor WebSocket connection failed.")),
      { once: true },
    );
  });
  return socket;
}

function send(
  socket: WebSocket,
  id: number,
  method: "mutation" | "subscription" | "subscription.stop",
  path: string,
  input: Record<string, unknown> = {},
): Promise<RawMessage> {
  const response = waitForMessage(socket, id);
  socket.send(
    JSON.stringify({
      id,
      method,
      params: method === "subscription.stop" ? {} : { input, path },
    }),
  );
  return response;
}

async function subscribeFloor(socket: WebSocket, id: number) {
  const started = waitForMessage(
    socket,
    id,
    (message) => message.result?.type === "started",
  );
  const initial = waitForMessage(
    socket,
    id,
    (message) => message.result?.type === "data",
  );
  socket.send(
    JSON.stringify({
      id,
      method: "subscription",
      params: { input: {}, path: "projects.floorUpdates" },
    }),
  );
  await started;
  return (await initial).result?.data as FloorSnapshotData;
}

type FloorSnapshotData = {
  projects: Array<{
    name: string;
    bench: Array<{ taskName: string }>;
  }>;
  queue: Array<{ action: string }>;
};

function offlineReader(): T3ActivityReader {
  const failure = () => ({
    error: "offline",
    fetchedAt: new Date().toISOString(),
    ok: false as const,
    status: "unreachable" as const,
  });
  return {
    readShell: async () => failure(),
    readThread: async () => failure(),
  };
}

function floorShell(
  pending: boolean,
): Extract<T3ShellObservation, { ok: true }> {
  const now = new Date().toISOString();
  return {
    fetchedAt: now,
    ok: true,
    projects: [
      {
        createdAt: now,
        id: "t3-floor-project",
        title: "Floor T3",
        updatedAt: now,
        workspaceRoot: "/work/floor",
      },
    ],
    sourceDigest: `floor-${pending ? "pending" : "idle"}`,
    sourceSequence: pending ? 2 : 1,
    sourceStream: "shell",
    sourceUpdatedAt: now,
    status: "ok",
    threads: pending
      ? [
          {
            createdAt: now,
            hasActionableProposedPlan: false,
            hasPendingApprovals: false,
            hasPendingUserInput: true,
            id: "t3-floor-thread",
            latestTurn: {
              requestedAt: now,
              state: "running" as const,
              turnId: "floor-turn",
            },
            projectId: "t3-floor-project",
            session: {
              providerName: "codex",
              status: "running" as const,
              updatedAt: now,
            },
            title: "Floor external input",
            updatedAt: now,
          },
        ]
      : [],
  };
}

describe("Floor updates WebSocket subscription", () => {
  test("sends initial state and broadcasts a mutation to two human clients, including reconnect", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-floor-ws-"));
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      floorUpdatesIntervalMs: 60_000,
      operator: { name: "test-operator", secret: "test-operator-secret" },
      port: 0,
      t3ActivityReader: offlineReader(),
    });
    const first = await openSocket(server);
    const second = await openSocket(server);
    const writer = await openSocket(server);
    let third: WebSocket | undefined;
    try {
      const projectResponse = await send(
        writer,
        1,
        "mutation",
        "projects.create",
        {
          name: "Floor project",
        },
      );
      const project = projectResponse.result?.data as { id: string };
      const initialFirst = await subscribeFloor(first, 2);
      const initialSecond = await subscribeFloor(second, 3);
      expect(initialFirst.projects).toEqual([
        expect.objectContaining({ name: "Floor project" }),
      ]);
      expect(initialSecond.projects).toEqual(initialFirst.projects);

      const updateFirst = waitForMessage(
        first,
        2,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).projects.some((item) =>
            item.bench.some((task) => task.taskName === "Floor task"),
          ),
      );
      const updateSecond = waitForMessage(
        second,
        3,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).projects.some((item) =>
            item.bench.some((task) => task.taskName === "Floor task"),
          ),
      );
      const taskResponse = await send(writer, 4, "mutation", "tasks.create", {
        name: "Floor task",
        projectId: project.id,
      });
      const task = taskResponse.result?.data as { id: string };
      await expect(updateFirst).resolves.toBeTruthy();
      await expect(updateSecond).resolves.toBeTruthy();

      const subtaskResponse = await send(
        writer,
        5,
        "mutation",
        "subtasks.create",
        {
          name: "Floor subtask",
          taskId: task.id,
        },
      );
      const subtask = subtaskResponse.result?.data as { id: string };

      let verifyPhase = false;
      const verifyFirst = waitForMessage(
        first,
        2,
        (message) =>
          verifyPhase &&
          message.result?.type === "data" &&
          !(message.result.data as FloorSnapshotData).queue.some(
            (item) => item.action === "stamp",
          ),
      );
      const verifySecond = waitForMessage(
        second,
        3,
        (message) =>
          verifyPhase &&
          message.result?.type === "data" &&
          !(message.result.data as FloorSnapshotData).queue.some(
            (item) => item.action === "stamp",
          ),
      );

      const reportFirst = waitForMessage(
        first,
        2,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).queue.some(
            (item) => item.action === "stamp",
          ),
      );
      const reportSecond = waitForMessage(
        second,
        3,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).queue.some(
            (item) => item.action === "stamp",
          ),
      );
      const reportResponse = await send(
        writer,
        6,
        "mutation",
        "subtasks.report",
        {
          evidence: "Floor websocket report evidence",
          reason: "Floor websocket report reason",
          reportedState: "complete",
          reporter: "codex",
          subtaskId: subtask.id,
        },
      );
      const report = reportResponse.result?.data as { id: string };
      expect(reportResponse.error).toBeUndefined();
      await expect(reportFirst).resolves.toBeTruthy();
      await expect(reportSecond).resolves.toBeTruthy();
      verifyPhase = true;
      const verifyResponse = await send(
        writer,
        7,
        "mutation",
        "subtasks.verify",
        {
          decision: "accepted",
          reportId: report.id,
        },
      );
      expect(verifyResponse.error).toBeUndefined();
      await expect(verifyFirst).resolves.toBeTruthy();
      await expect(verifySecond).resolves.toBeTruthy();

      const projectUpdateFirst = waitForMessage(
        first,
        2,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).projects.some(
            (item) => item.name === "Floor project",
          ),
      );
      const projectUpdateSecond = waitForMessage(
        second,
        3,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).projects.some(
            (item) => item.name === "Floor project",
          ),
      );
      await send(writer, 8, "mutation", "projects.update", {
        gitOriginUrl: null,
        projectId: project.id,
        t3ProjectId: null,
        workspaceRoot: "/work/floor-renamed",
      });
      await expect(projectUpdateFirst).resolves.toBeTruthy();
      await expect(projectUpdateSecond).resolves.toBeTruthy();

      await send(second, 3, "subscription.stop", "projects.floorUpdates");
      second.close();
      third = await openSocket(server);
      const reconnect = await subscribeFloor(third, 9);
      expect(reconnect.projects[0]).toEqual(
        expect.objectContaining({ name: "Floor project", bench: [] }),
      );

      const deleteFirst = waitForMessage(
        first,
        2,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).projects.length === 0,
      );
      const deleteThird = waitForMessage(
        third,
        9,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).projects.length === 0,
      );
      await send(writer, 10, "mutation", "projects.remove", {
        confirm: true,
        projectId: project.id,
      });
      await expect(deleteFirst).resolves.toBeTruthy();
      await expect(deleteThird).resolves.toBeTruthy();
    } finally {
      first.close();
      second.close();
      writer.close();
      third?.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("polls external T3 changes once for subscribers and stops after cleanup", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-floor-t3-ws-"));
    let reads = 0;
    const reader: T3ActivityReader = {
      readShell: async () => {
        reads += 1;
        return floorShell(reads >= 2);
      },
      readThread: async () => ({
        error: "unused",
        fetchedAt: new Date().toISOString(),
        ok: false as const,
        status: "unavailable" as const,
      }),
    };
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      floorUpdatesIntervalMs: 20,
      operator: { name: "test-operator", secret: "test-operator-secret" },
      port: 0,
      t3ActivityReader: reader,
    });
    const socket = await openSocket(server);
    try {
      await send(socket, 1, "mutation", "projects.create", {
        name: "Floor T3",
        t3ProjectId: "t3-floor-project",
      });
      const initial = await subscribeFloor(socket, 2);
      expect(initial.queue).toEqual([]);
      const external = waitForMessage(
        socket,
        2,
        (message) =>
          message.result?.type === "data" &&
          (message.result.data as FloorSnapshotData).queue.some(
            (item) => item.action === "input",
          ),
      );
      await expect(external).resolves.toBeTruthy();
      const readsBeforeStop = reads;
      await send(socket, 2, "subscription.stop", "projects.floorUpdates");
      socket.close();
      await server.stop();
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(reads).toBe(readsBeforeStop);
    } finally {
      socket.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects an unauthenticated Floor update subscription", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-floor-auth-ws-"));
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      operator: { name: "test-operator", secret: "test-operator-secret" },
      port: 0,
      t3ActivityReader: offlineReader(),
    });
    const socket = createWebSocket(new URL("/trpc", server.url));
    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("Floor WebSocket connection failed.")),
          { once: true },
        );
      });
      const response = waitForMessage(socket, 1, (message) =>
        Boolean(message.error),
      );
      socket.send(
        JSON.stringify({
          id: 1,
          method: "subscription",
          params: { input: {}, path: "projects.floorUpdates" },
        }),
      );
      await expect(response).resolves.toMatchObject({
        id: 1,
        error: expect.anything(),
      });
    } finally {
      socket.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
