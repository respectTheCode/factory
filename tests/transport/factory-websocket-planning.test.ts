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

function responseData(response: RawTRPCResponse): Record<string, unknown> {
  expect(response.result?.type).toBe("data");
  return response.result?.data as Record<string, unknown>;
}

describe("Factory planning WebSocket transport", () => {
  test("creates a task plan and observes it through project detail", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-planning-transport-"),
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

      const projectResponse = await sendRawTRPCRequest(socket, {
        id: 1,
        method: "mutation",
        params: {
          input: { name: "Website refresh" },
          path: "projects.create",
        },
      });
      const project = responseData(projectResponse);

      const taskResponse = await sendRawTRPCRequest(socket, {
        id: 2,
        method: "mutation",
        params: {
          input: {
            name: "Publish the refreshed site",
            projectId: project.id,
          },
          path: "tasks.create",
        },
      });
      const task = responseData(taskResponse);

      await sendRawTRPCRequest(socket, {
        id: 3,
        method: "mutation",
        params: {
          input: {
            name: "Verify the production build",
            taskId: task.id,
          },
          path: "subtasks.create",
        },
      });

      const detailResponse = await sendRawTRPCRequest(socket, {
        id: 4,
        method: "query",
        params: {
          input: { projectId: project.id },
          path: "projects.detail",
        },
      });

      expect(detailResponse).toMatchObject({
        id: 4,
        result: {
          type: "data",
          data: {
            name: "Website refresh",
            tasks: [
              {
                name: "Publish the refreshed site",
                subtasks: [{ name: "Verify the production build" }],
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

  test("reports a complete subtask and observes task verification status", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-status-transport-"),
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

      const projectResponse = await sendRawTRPCRequest(socket, {
        id: 11,
        method: "mutation",
        params: {
          input: { name: "Website refresh" },
          path: "projects.create",
        },
      });
      const project = responseData(projectResponse);

      const taskResponse = await sendRawTRPCRequest(socket, {
        id: 12,
        method: "mutation",
        params: {
          input: {
            name: "Publish the refreshed site",
            projectId: project.id,
          },
          path: "tasks.create",
        },
      });
      const task = responseData(taskResponse);

      const subtaskResponse = await sendRawTRPCRequest(socket, {
        id: 13,
        method: "mutation",
        params: {
          input: {
            name: "Verify the production build",
            taskId: task.id,
          },
          path: "subtasks.create",
        },
      });
      const subtask = responseData(subtaskResponse);

      const reportResponse = await sendRawTRPCRequest(socket, {
        id: 14,
        method: "mutation",
        params: {
          input: {
            evidence: "Build 2026-08-22 passed in CI.",
            reportedState: "complete",
            reporter: "codex",
            subtaskId: subtask.id,
          },
          path: "subtasks.report",
        },
      });

      expect(reportResponse.result?.type).toBe("data");

      const statusResponse = await sendRawTRPCRequest(socket, {
        id: 15,
        method: "query",
        params: {
          input: { taskId: task.id },
          path: "tasks.status",
        },
      });

      expect(statusResponse).toMatchObject({
        id: 15,
        result: {
          type: "data",
          data: {
            taskCompleted: false,
            subtasks: [
              {
                reportedState: "complete",
                verificationState: "awaiting_verification",
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

  test("accepts a reported subtask and observes completed task status", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-verification-transport-"),
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

      const projectResponse = await sendRawTRPCRequest(socket, {
        id: 21,
        method: "mutation",
        params: {
          input: { name: "Website refresh" },
          path: "projects.create",
        },
      });
      const project = responseData(projectResponse);

      const taskResponse = await sendRawTRPCRequest(socket, {
        id: 22,
        method: "mutation",
        params: {
          input: {
            name: "Publish the refreshed site",
            projectId: project.id,
          },
          path: "tasks.create",
        },
      });
      const task = responseData(taskResponse);

      const subtaskResponse = await sendRawTRPCRequest(socket, {
        id: 23,
        method: "mutation",
        params: {
          input: {
            name: "Verify the production build",
            taskId: task.id,
          },
          path: "subtasks.create",
        },
      });
      const subtask = responseData(subtaskResponse);

      const reportResponse = await sendRawTRPCRequest(socket, {
        id: 24,
        method: "mutation",
        params: {
          input: {
            evidence: "Build 2026-08-22 passed in CI.",
            reportedState: "complete",
            reporter: "codex",
            subtaskId: subtask.id,
          },
          path: "subtasks.report",
        },
      });
      const report = responseData(reportResponse);

      const verifyResponse = await sendRawTRPCRequest(socket, {
        id: 25,
        method: "mutation",
        params: {
          input: {
            decision: "accepted",
            reportId: report.id,
            verifier: "kevin",
          },
          path: "subtasks.verify",
        },
      });

      expect(verifyResponse.result?.type).toBe("data");

      const statusResponse = await sendRawTRPCRequest(socket, {
        id: 26,
        method: "query",
        params: {
          input: { taskId: task.id },
          path: "tasks.status",
        },
      });

      expect(statusResponse).toMatchObject({
        id: 26,
        result: {
          type: "data",
          data: {
            taskCompleted: true,
            subtasks: [
              {
                reportedState: "complete",
                verificationState: "accepted",
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

  test("adds a Linear tracker link and observes it on task detail", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-tracker-transport-"),
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

      const projectResponse = await sendRawTRPCRequest(socket, {
        id: 31,
        method: "mutation",
        params: {
          input: { name: "Grail roadmap" },
          path: "projects.create",
        },
      });
      const project = responseData(projectResponse);

      const taskResponse = await sendRawTRPCRequest(socket, {
        id: 32,
        method: "mutation",
        params: {
          input: {
            name: "Publish the refreshed site",
            projectId: project.id,
          },
          path: "tasks.create",
        },
      });
      const task = responseData(taskResponse);

      const linkResponse = await sendRawTRPCRequest(socket, {
        id: 33,
        method: "mutation",
        params: {
          input: {
            system: "linear",
            stableId: "GRA-123",
            taskId: task.id,
            title: "Publish the refreshed site",
            url: "https://linear.app/grail/issue/GRA-123",
          },
          path: "tasks.link",
        },
      });

      expect(linkResponse.result?.type).toBe("data");

      const detailResponse = await sendRawTRPCRequest(socket, {
        id: 34,
        method: "query",
        params: {
          input: { taskId: task.id },
          path: "tasks.detail",
        },
      });

      expect(detailResponse).toMatchObject({
        id: 34,
        result: {
          type: "data",
          data: {
            name: "Publish the refreshed site",
            trackerLinks: [
              {
                system: "linear",
                stableId: "GRA-123",
                title: "Publish the refreshed site",
                url: "https://linear.app/grail/issue/GRA-123",
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

  test("observes subtask report and verification history", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-history-transport-"),
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

      const projectResponse = await sendRawTRPCRequest(socket, {
        id: 41,
        method: "mutation",
        params: {
          input: { name: "Website refresh" },
          path: "projects.create",
        },
      });
      const project = responseData(projectResponse);

      const taskResponse = await sendRawTRPCRequest(socket, {
        id: 42,
        method: "mutation",
        params: {
          input: {
            name: "Publish the refreshed site",
            projectId: project.id,
          },
          path: "tasks.create",
        },
      });
      const task = responseData(taskResponse);

      const subtaskResponse = await sendRawTRPCRequest(socket, {
        id: 43,
        method: "mutation",
        params: {
          input: {
            name: "Verify the production build",
            taskId: task.id,
          },
          path: "subtasks.create",
        },
      });
      const subtask = responseData(subtaskResponse);

      const firstReportResponse = await sendRawTRPCRequest(socket, {
        id: 44,
        method: "mutation",
        params: {
          input: {
            evidence: "The production build is ready for verification.",
            reportedState: "in_progress",
            reporter: "codex",
            subtaskId: subtask.id,
          },
          path: "subtasks.report",
        },
      });
      const firstReport = responseData(firstReportResponse);

      const secondReportResponse = await sendRawTRPCRequest(socket, {
        id: 45,
        method: "mutation",
        params: {
          input: {
            evidence: "Build 2026-08-23 passed in CI.",
            reportedState: "complete",
            reporter: "codex",
            subtaskId: subtask.id,
          },
          path: "subtasks.report",
        },
      });
      const secondReport = responseData(secondReportResponse);

      const verifyResponse = await sendRawTRPCRequest(socket, {
        id: 46,
        method: "mutation",
        params: {
          input: {
            decision: "accepted",
            reportId: secondReport.id,
            verifier: "kevin",
          },
          path: "subtasks.verify",
        },
      });
      expect(verifyResponse.result?.type).toBe("data");

      const historyResponse = await sendRawTRPCRequest(socket, {
        id: 47,
        method: "query",
        params: {
          input: { subtaskId: subtask.id },
          path: "subtasks.history",
        },
      });
      expect(responseData(historyResponse)).toMatchObject([
        { id: firstReport.id, reportedState: "in_progress" },
        { id: secondReport.id, reportedState: "complete" },
      ]);

      const verificationsResponse = await sendRawTRPCRequest(socket, {
        id: 48,
        method: "query",
        params: {
          input: { subtaskId: subtask.id },
          path: "subtasks.verifications",
        },
      });
      expect(responseData(verificationsResponse)).toMatchObject([
        {
          decision: "accepted",
          reportId: secondReport.id,
          verifier: "kevin",
        },
      ]);
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
