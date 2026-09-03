import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type {
  T3ActivityReader,
  T3ShellObservation,
  T3ThreadObservation,
} from "../../src/t3";
import { createFactoryServer } from "../../src/server";

type RawResponse = {
  id: number;
  result?: { data?: unknown; type?: string };
};

function request(
  socket: WebSocket,
  body: Record<string, unknown> & { id: number },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const response = JSON.parse(String(event.data)) as RawResponse;
      if (response.id !== body.id) return;
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
    socket.send(JSON.stringify(body));
  });
}

function data(response: RawResponse): Record<string, unknown> {
  expect(response.result?.type).toBe("data");
  return response.result?.data as Record<string, unknown>;
}

function shell(): Extract<T3ShellObservation, { ok: true }> {
  const project = {
    createdAt: "2026-09-02T12:00:00.000Z",
    id: "t3-project-factory",
    repositoryIdentity: {
      canonicalKey: "github.com/app-press/factory",
      locator: {
        remoteName: "origin",
        remoteUrl: "git@github.com:app-press/factory.git",
        source: "git-remote" as const,
      },
    },
    title: "Factory",
    updatedAt: "2026-09-02T12:01:00.000Z",
    workspaceRoot: "/work/factory",
  };
  const thread = {
    branch: "feature/t3-integration",
    createdAt: "2026-09-02T12:00:00.000Z",
    hasActionableProposedPlan: true,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    id: "t3-thread-1",
    latestTurn: {
      requestedAt: "2026-09-02T12:00:00.000Z",
      startedAt: "2026-09-02T12:00:01.000Z",
      state: "running" as const,
      turnId: "turn-1",
    },
    latestUserMessageAt: "2026-09-02T12:00:00.000Z",
    linkedPullRequest: null,
    planProgress: { completedSteps: 1, step: "Wire", totalSteps: 2 },
    projectId: "t3-project-factory",
    session: {
      activeTurnId: "turn-1",
      providerName: "codex",
      status: "running" as const,
      updatedAt: "2026-09-02T12:00:01.000Z",
    },
    title: "Wire T3 integration",
    updatedAt: "2026-09-02T12:00:01.000Z",
    worktreePath: "/work/factory",
  };
  return {
    fetchedAt: "2026-09-02T12:01:00.000Z",
    ok: true,
    projects: [project],
    sourceDigest: "shell-digest",
    sourceSequence: 7,
    sourceStream: "shell",
    sourceUpdatedAt: "2026-09-02T12:01:00.000Z",
    status: "ok",
    threads: [thread],
  } as unknown as Extract<T3ShellObservation, { ok: true }>;
}

function detail(): Extract<T3ThreadObservation, { ok: true }> {
  return {
    fetchedAt: "2026-09-02T12:02:00.000Z",
    ok: true,
    sourceDigest: "detail-digest",
    sourceSequence: 8,
    sourceStream: "thread",
    sourceUpdatedAt: "2026-09-02T12:02:00.000Z",
    status: "ok",
    thread: {
      ...shell().threads[0]!,
      hasActionableProposedPlan: false,
      activities: [
        {
          createdAt: "2026-09-02T12:02:00.000Z",
          id: "activity-1",
          kind: "tool-started",
          sequence: 8,
          tone: "tool",
          turnId: "turn-1",
        },
      ],
      checkpoints: [
        {
          completedAt: "2026-09-02T12:02:01.000Z",
          files: [
            { additions: 4, deletions: 1, kind: "modified", path: "src/t3.ts" },
          ],
          status: "ready",
          turnId: "turn-1",
        },
      ],
      messages: [
        {
          createdAt: "2026-09-02T12:02:00.000Z",
          id: "message-1",
          role: "user",
          streaming: false,
          text: "private transcript text",
          turnId: "turn-1",
          updatedAt: "2026-09-02T12:02:00.000Z",
        },
      ],
    },
  } as unknown as Extract<T3ThreadObservation, { ok: true }>;
}

function reader(): T3ActivityReader & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async readShell() {
      calls.push("shell");
      return shell();
    },
    async readThread() {
      calls.push("thread");
      return detail();
    },
  };
}

describe("Factory T3 tRPC integration", () => {
  test("keeps project detail local, refreshes observations, and links only Factory state", async () => {
    const directory = mkdtempSync(join(tmpdir(), "software-factory-t3-rpc-"));
    const t3 = reader();
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      port: 0,
      t3ActivityReader: t3,
    });
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

      const project = data(
        await request(socket, {
          id: 1,
          method: "mutation",
          params: {
            input: {
              name: "Factory",
              t3ProjectId: "t3-project-factory",
              workspaceRoot: "/work/factory",
            },
            path: "projects.create",
          },
        }),
      );
      const task = data(
        await request(socket, {
          id: 2,
          method: "mutation",
          params: {
            input: { name: "T3 integration", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );

      await request(socket, {
        id: 3,
        method: "query",
        params: { input: { projectId: project.id }, path: "projects.detail" },
      });
      expect(t3.calls).toEqual([]);

      const activity = data(
        await request(socket, {
          id: 4,
          method: "query",
          params: {
            input: { projectId: project.id },
            path: "t3.projectActivity",
          },
        }),
      );
      expect(activity).toMatchObject({
        connection: { state: "connected" },
        counts: { running: 1, unmatched: 1 },
        status: "ok",
        threads: [{ threadId: "t3-thread-1", title: "Wire T3 integration" }],
      });

      const status = data(
        await request(socket, {
          id: 5,
          method: "query",
          params: { input: { projectId: project.id }, path: "t3.status" },
        }),
      );
      expect(status).toMatchObject({
        counts: { linked: 0, running: 1 },
        status: "ok",
      });

      const detailResult = data(
        await request(socket, {
          id: 6,
          method: "query",
          params: {
            input: { threadId: "t3-thread-1", turnLimit: 1 },
            path: "t3.threadDetail",
          },
        }),
      );
      expect(detailResult).toMatchObject({
        evidence: {
          changedFileCount: 1,
          checkpointFiles: ["src/t3.ts"],
          sourceStream: "thread",
        },
        observation: { sourceStream: "thread" },
        status: "ok",
        thread: {
          hasActionableProposedPlan: true,
          id: "t3-thread-1",
        },
      });
      expect(JSON.stringify(detailResult)).not.toContain(
        "private transcript text",
      );

      const linked = data(
        await request(socket, {
          id: 7,
          method: "mutation",
          params: {
            input: {
              projectId: project.id,
              taskId: task.id,
              threadId: "t3-thread-1",
            },
            path: "t3.linkThread",
          },
        }),
      );
      expect(linked).toMatchObject({ run: { taskId: task.id } });

      const afterLink = data(
        await request(socket, {
          id: 8,
          method: "query",
          params: {
            input: { projectId: project.id },
            path: "t3.projectActivity",
          },
        }),
      );
      expect(afterLink).toMatchObject({ counts: { linked: 1 } });
      expect(
        (afterLink.findings as Array<{ kind: string; status: string }>).every(
          (finding) => finding.status === "open",
        ),
      ).toBe(true);
      expect(
        (afterLink.findings as Array<{ kind: string }>).some(
          (finding) => finding.kind === "unlinked_activity",
        ),
      ).toBe(false);

      const unlinked = data(
        await request(socket, {
          id: 9,
          method: "mutation",
          params: {
            input: { threadId: "t3-thread-1" },
            path: "t3.unlinkThread",
          },
        }),
      );
      expect(unlinked).toMatchObject({ run: { state: "observed" } });
      expect(t3.calls).toEqual(["shell", "shell", "shell", "thread", "shell"]);
    } finally {
      socket.close();
      server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("preserves last-successful freshness and records unavailable findings after a failed refresh", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "software-factory-t3-failed-refresh-"),
    );
    let shellReads = 0;
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      port: 0,
      t3ActivityReader: {
        async readShell() {
          shellReads += 1;
          return shellReads === 1
            ? shell()
            : {
                error: "T3 Code could not be reached.",
                fetchedAt: "2026-09-02T12:03:00.000Z",
                ok: false as const,
                status: "unreachable" as const,
              };
        },
        async readThread() {
          return detail();
        },
      },
    });
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
      const project = data(
        await request(socket, {
          id: 20,
          method: "mutation",
          params: {
            input: {
              name: "Factory",
              t3ProjectId: "t3-project-factory",
              workspaceRoot: "/work/factory",
            },
            path: "projects.create",
          },
        }),
      );
      await request(socket, {
        id: 21,
        method: "query",
        params: {
          input: { projectId: project.id },
          path: "t3.projectActivity",
        },
      });
      const failed = data(
        await request(socket, {
          id: 22,
          method: "query",
          params: {
            input: { projectId: project.id },
            path: "t3.projectActivity",
          },
        }),
      );

      expect(failed).toMatchObject({
        connection: {
          lastSuccessfulFetchAt: "2026-09-02T12:01:00.000Z",
          observedAt: "2026-09-02T12:03:00.000Z",
          state: "unreachable",
        },
        status: "unreachable",
        threads: [{ threadId: "t3-thread-1" }],
      });
      expect(failed.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "source_unavailable",
            status: "open",
          }),
        ]),
      );
    } finally {
      socket.close();
      server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("fails closed when a T3 Project is not explicitly matched", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "software-factory-t3-unmatched-"),
    );
    const t3 = reader();
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      port: 0,
      t3ActivityReader: {
        readShell: async () => ({
          ...shell(),
          projects: [{ ...shell().projects[0]!, id: "unknown-project" }],
        }),
        readThread: t3.readThread,
      },
    });
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
      const project = data(
        await request(socket, {
          id: 11,
          method: "mutation",
          params: {
            input: { name: "Factory", t3ProjectId: "t3-project-factory" },
            path: "projects.create",
          },
        }),
      );
      const result = data(
        await request(socket, {
          id: 12,
          method: "query",
          params: {
            input: { projectId: project.id },
            path: "t3.projectActivity",
          },
        }),
      );
      expect(result).toMatchObject({ status: "unmatched" });
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "source_unavailable",
            status: "open",
          }),
        ]),
      );
      expect(result.threads).toEqual([]);
    } finally {
      socket.close();
      server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
