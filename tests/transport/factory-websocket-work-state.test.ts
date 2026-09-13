import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";
import { createFactoryApplication } from "../../src/application";

type RawTRPCResponse = {
  id: number;
  error?: { message?: string };
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
        if (response.id !== request.id) return;

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
  if (response.result?.type !== "data") {
    throw new Error(`Expected tRPC data response: ${JSON.stringify(response)}`);
  }
  expect(response.result?.type).toBe("data");
  return response.result?.data as Record<string, unknown>;
}

function responseError(response: RawTRPCResponse): string {
  expect(response.error).toBeDefined();
  return response.error?.message ?? "";
}

test("resumes subtask tracking through the PWA transport without accepting reports", async () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-rollup-websocket-"));
  const databasePath = join(directory, "factory.sqlite");
  const app = createFactoryApplication({ databasePath });
  const project = app.createProject({ name: "Resume tracking" });
  const task = app.createTask({ projectId: project.id, name: "Held work" });
  const child = app.createSubtask({ taskId: task.id, name: "Review slice" });
  const report = app.reportSubtaskStatus({
    subtaskId: child.id,
    reportedState: "complete",
    reporter: "codex",
    reason: "Check the slice.",
  });
  app.setTaskWorkState({ taskId: task.id, workState: "active" });
  const { server, socket } = await openServerSocket(databasePath);
  try {
    responseData(
      await sendRawTRPCRequest(socket, {
        id: 1,
        method: "mutation",
        params: { path: "tasks.resumeRollup", input: { taskId: task.id } },
      }),
    );
    const status = responseData(
      await sendRawTRPCRequest(socket, {
        id: 2,
        method: "query",
        params: { path: "tasks.status", input: { taskId: task.id } },
      }),
    );
    expect(status).toMatchObject({
      taskState: "awaiting_verification",
      taskCompleted: false,
    });
    expect(app.getSubtaskReportHistory(child.id)).toEqual([report]);
  } finally {
    socket.close();
    server.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

async function openServerSocket(databasePath: string) {
  const server = createFactoryServer({ port: 0, databasePath });
  const socket = new WebSocket(new URL("/trpc", server.url));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket connection failed")),
      { once: true },
    );
  });
  return { server, socket };
}

describe("Factory work-state WebSocket transport", () => {
  test("moves a task between workflow states and carries a state reason", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-work-state-transport-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const { server, socket } = await openServerSocket(databasePath);

    try {
      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 1,
          method: "mutation",
          params: { input: { name: "Work state" }, path: "projects.create" },
        }),
      );
      const task = responseData(
        await sendRawTRPCRequest(socket, {
          id: 2,
          method: "mutation",
          params: {
            input: { name: "Implement state", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );

      const stateResponse = await sendRawTRPCRequest(socket, {
        id: 3,
        method: "mutation",
        params: {
          input: {
            reason: "Ready to implement the accepted plan",
            taskId: task.id,
            workState: "active",
          },
          path: "tasks.setState",
        },
      });
      expect(stateResponse.result?.type).toBe("data");
      expect(responseData(stateResponse)).toMatchObject({
        id: task.id,
        workState: "active",
        dashboard: {
          projectDetail: {
            id: project.id,
            tasks: [
              expect.objectContaining({ id: task.id, workState: "active" }),
            ],
          },
          taskStatuses: [
            expect.objectContaining({ taskId: task.id, taskState: "active" }),
          ],
        },
      });

      const statusResponse = await sendRawTRPCRequest(socket, {
        id: 4,
        method: "query",
        params: { input: { taskId: task.id }, path: "tasks.status" },
      });
      expect(responseData(statusResponse)).toMatchObject({
        taskState: "active",
      });

      expect(
        responseError(
          await sendRawTRPCRequest(socket, {
            id: 5,
            method: "mutation",
            params: {
              input: { taskId: task.id, workState: "blocked" },
              path: "tasks.setState",
            },
          }),
        ),
      ).toContain("reason");
      expect(
        responseError(
          await sendRawTRPCRequest(socket, {
            id: 6,
            method: "mutation",
            params: {
              input: { taskId: task.id, workState: "awaiting_verification" },
              path: "tasks.setState",
            },
          }),
        ),
      ).toContain("reason");

      const blockedResponse = await sendRawTRPCRequest(socket, {
        id: 7,
        method: "mutation",
        params: {
          input: {
            reason: "Check the missing external dependency",
            taskId: task.id,
            workState: "blocked",
          },
          path: "tasks.setState",
        },
      });
      expect(blockedResponse.result?.type).toBe("data");
      const blockedStatusResponse = await sendRawTRPCRequest(socket, {
        id: 8,
        method: "query",
        params: { input: { taskId: task.id }, path: "tasks.status" },
      });
      expect(responseData(blockedStatusResponse)).toMatchObject({
        stateReason: "Check the missing external dependency",
        taskState: "blocked",
      });
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("reorders tasks and subtasks within a workflow state", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-reorder-transport-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const { server, socket } = await openServerSocket(databasePath);

    try {
      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 11,
          method: "mutation",
          params: { input: { name: "Reorder" }, path: "projects.create" },
        }),
      );
      const taskResponses = await Promise.all(
        ["First", "Second", "Third"].map((name, index) =>
          sendRawTRPCRequest(socket, {
            id: 12 + index,
            method: "mutation",
            params: {
              input: { name, projectId: project.id },
              path: "tasks.create",
            },
          }),
        ),
      );
      const tasks = taskResponses.map(responseData);
      const taskIds = tasks.map((task) => task.id as string) as string[];

      const reorderTasksResponse = await sendRawTRPCRequest(socket, {
        id: 20,
        method: "mutation",
        params: {
          input: {
            projectId: project.id,
            orderedTaskIds: [taskIds[2], taskIds[0], taskIds[1]],
            workState: "planned",
          },
          path: "tasks.reorder",
        },
      });
      expect(reorderTasksResponse.result?.type).toBe("data");

      const subtaskResponses = await Promise.all(
        ["One", "Two", "Three"].map((name, index) =>
          sendRawTRPCRequest(socket, {
            id: 21 + index,
            method: "mutation",
            params: {
              input: { name, taskId: taskIds[2] },
              path: "subtasks.create",
            },
          }),
        ),
      );
      const subtasks = subtaskResponses.map(responseData);
      const subtaskIds = subtasks.map(
        (subtask) => subtask.id as string,
      ) as string[];
      const reorderSubtasksResponse = await sendRawTRPCRequest(socket, {
        id: 30,
        method: "mutation",
        params: {
          input: {
            orderedSubtaskIds: [subtaskIds[2], subtaskIds[0], subtaskIds[1]],
            taskId: taskIds[2],
            workState: "planned",
          },
          path: "subtasks.reorder",
        },
      });
      expect(reorderSubtasksResponse.result?.type).toBe("data");

      const detail = responseData(
        await sendRawTRPCRequest(socket, {
          id: 31,
          method: "query",
          params: { input: { projectId: project.id }, path: "projects.detail" },
        }),
      );
      expect(
        (detail.tasks as Array<{ id: string }>).map((task) => task.id),
      ).toEqual([taskIds[2]!, taskIds[0]!, taskIds[1]!]);
      expect(
        (
          (detail.tasks as Array<{ subtasks: Array<{ id: string }> }>)[0]
            ?.subtasks ?? []
        ).map((subtask) => subtask.id),
      ).toEqual([subtaskIds[2]!, subtaskIds[0]!, subtaskIds[1]!]);
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("accepts backlog reports and forwards their reason to core", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-report-transport-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const { server, socket } = await openServerSocket(databasePath);

    try {
      const project = responseData(
        await sendRawTRPCRequest(socket, {
          id: 41,
          method: "mutation",
          params: { input: { name: "Reports" }, path: "projects.create" },
        }),
      );
      const task = responseData(
        await sendRawTRPCRequest(socket, {
          id: 42,
          method: "mutation",
          params: {
            input: { name: "Report task", projectId: project.id },
            path: "tasks.create",
          },
        }),
      );
      const subtask = responseData(
        await sendRawTRPCRequest(socket, {
          id: 43,
          method: "mutation",
          params: {
            input: { name: "Report subtask", taskId: task.id },
            path: "subtasks.create",
          },
        }),
      );

      const reportResponse = await sendRawTRPCRequest(socket, {
        id: 44,
        method: "mutation",
        params: {
          input: {
            reportedState: "backlog",
            reporter: "codex",
            reason: "Waiting for the product decision before starting",
            subtaskId: subtask.id,
          },
          path: "subtasks.report",
        },
      });
      expect(responseData(reportResponse)).toMatchObject({
        reportedState: "backlog",
        reason: "Waiting for the product decision before starting",
      });

      expect(
        responseError(
          await sendRawTRPCRequest(socket, {
            id: 45,
            method: "mutation",
            params: {
              input: {
                reportedState: "blocked",
                reporter: "codex",
                subtaskId: subtask.id,
              },
              path: "subtasks.report",
            },
          }),
        ),
      ).toContain("reason");
      expect(
        responseError(
          await sendRawTRPCRequest(socket, {
            id: 46,
            method: "mutation",
            params: {
              input: {
                reportedState: "complete",
                reporter: "codex",
                subtaskId: subtask.id,
              },
              path: "subtasks.report",
            },
          }),
        ),
      ).toContain("reason");

      const completeReport = responseData(
        await sendRawTRPCRequest(socket, {
          id: 47,
          method: "mutation",
          params: {
            input: {
              reportedState: "complete",
              reporter: "codex",
              reason: "Check the result against the acceptance criteria",
              subtaskId: subtask.id,
            },
            path: "subtasks.report",
          },
        }),
      );
      const verificationResponse = await sendRawTRPCRequest(socket, {
        id: 48,
        method: "mutation",
        params: {
          input: {
            decision: "deferred",
            reason: "The acceptance evidence needs one more browser check",
            reportId: completeReport.id,
            verifier: "kevin",
          },
          path: "subtasks.verify",
        },
      });
      expect(
        responseError(
          await sendRawTRPCRequest(socket, {
            id: 49,
            method: "mutation",
            params: {
              input: {
                decision: "rejected",
                reportId: completeReport.id,
                verifier: "kevin",
              },
              path: "subtasks.verify",
            },
          }),
        ),
      ).toContain("reason");
      expect(
        responseError(
          await sendRawTRPCRequest(socket, {
            id: 50,
            method: "mutation",
            params: {
              input: {
                decision: "deferred",
                reportId: completeReport.id,
                verifier: "kevin",
              },
              path: "subtasks.verify",
            },
          }),
        ),
      ).toContain("reason");
      expect(responseData(verificationResponse)).toMatchObject({
        ok: true,
        dashboard: {
          projectDetail: {
            tasks: [expect.objectContaining({ workState: "blocked" })],
          },
          taskStatuses: [expect.objectContaining({ taskState: "blocked" })],
        },
      });

      const verifications = responseData(
        await sendRawTRPCRequest(socket, {
          id: 51,
          method: "query",
          params: {
            input: { subtaskId: subtask.id },
            path: "subtasks.verifications",
          },
        }),
      );
      expect(verifications).toMatchObject([
        {
          decision: "deferred",
          reason: "The acceptance evidence needs one more browser check",
        },
      ]);
    } finally {
      socket.close();
      server.stop();
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
