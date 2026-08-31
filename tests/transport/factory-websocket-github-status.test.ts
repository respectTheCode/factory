import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { GitHubStatusReader } from "../../src/github";
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
      try {
        const response = JSON.parse(String(event.data)) as RawResponse;
        if (response.id !== body.id) return;
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
    socket.send(JSON.stringify(body));
  });
}

function data(response: RawResponse): Record<string, unknown> {
  expect(response.result?.type).toBe("data");
  return response.result?.data as Record<string, unknown>;
}

describe("Factory GitHub status WebSocket transport", () => {
  test("reads live status for Task and Subtask PR references", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-github-status-"),
    );
    const reader: GitHubStatusReader = {
      read: async (reference) => ({
        fetchedAt: "2026-08-31T15:00:00.000Z",
        pullRequest: {
          baseBranch: "main",
          draft: false,
          headBranch: "feature/status",
          headSha: "abc123",
          mergeable: true,
          number: reference.number,
          state: "open",
          title: "Status",
          updatedAt: "2026-08-31T14:00:00.000Z",
          url: reference.url,
        },
        status: "ok",
        checkRuns: [],
        checkRunsStatus: "ok",
        workflowRuns: [],
        workflowRunsStatus: "ok",
      }),
    };
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      githubStatusReader: reader,
      port: 0,
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
          params: { input: { name: "Private repo" }, path: "projects.create" },
        }),
      );
      const task = data(
        await request(socket, {
          id: 2,
          method: "mutation",
          params: {
            input: {
              name: "Ship status",
              projectId: project.id,
              pullRequestUrl: "https://github.com/acme/repo/pull/42",
            },
            path: "tasks.create",
          },
        }),
      );
      const subtask = data(
        await request(socket, {
          id: 3,
          method: "mutation",
          params: {
            input: {
              name: "Verify status",
              pullRequestUrl: "https://github.com/acme/repo/pull/43",
              taskId: task.id,
            },
            path: "subtasks.create",
          },
        }),
      );

      const taskStatus = data(
        await request(socket, {
          id: 4,
          method: "query",
          params: { input: { taskId: task.id }, path: "tasks.githubStatus" },
        }),
      );
      const subtaskStatus = data(
        await request(socket, {
          id: 5,
          method: "query",
          params: {
            input: { subtaskId: subtask.id },
            path: "subtasks.githubStatus",
          },
        }),
      );

      expect(taskStatus).toMatchObject({
        status: "ok",
        pullRequest: { number: 42 },
      });
      expect(subtaskStatus).toMatchObject({
        status: "ok",
        pullRequest: { number: 43 },
      });
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("returns not linked without invoking GitHub", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-github-unlinked-"),
    );
    let calls = 0;
    const server = createFactoryServer({
      databasePath: join(temporaryDirectory, "factory.sqlite"),
      githubStatusReader: {
        read: async () => {
          calls += 1;
          throw new Error("should not be called");
        },
      },
      port: 0,
    });
    const socket = new WebSocket(new URL("/trpc", server.url));

    try {
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("WebSocket connection failed")),
          {
            once: true,
          },
        );
      });
      const project = data(
        await request(socket, {
          id: 11,
          method: "mutation",
          params: { input: { name: "Private repo" }, path: "projects.create" },
        }),
      );
      const task = data(
        await request(socket, {
          id: 12,
          method: "mutation",
          params: {
            input: { name: "No PR", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );
      const result = data(
        await request(socket, {
          id: 13,
          method: "query",
          params: { input: { taskId: task.id }, path: "tasks.githubStatus" },
        }),
      );
      expect(result.status).toBe("not_linked");
      expect(calls).toBe(0);
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
