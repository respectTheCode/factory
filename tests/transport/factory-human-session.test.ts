import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createFactoryServer } from "../../src/server";

const operator = { name: "Kevin", secret: "operator-secret" };

type RawTRPCResponse = {
  error?: {
    data?: { code?: string };
    message?: string;
  };
  id: number;
  result?: { data?: unknown; type?: string };
};

function createWebSocket(
  url: string | URL,
  headers: Record<string, string> = {},
): WebSocket {
  const BunWebSocket = WebSocket as unknown as new (
    url: string | URL,
    options?: { headers: Record<string, string> },
  ) => WebSocket;
  return new BunWebSocket(url, { headers });
}

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

async function openSocket(
  server: { url: URL },
  headers: Record<string, string> = {},
): Promise<WebSocket> {
  const socket = createWebSocket(new URL("/trpc", server.url), headers);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket connection failed")),
      { once: true },
    );
  });
  return socket;
}

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Login did not set a session cookie.");
  return setCookie.split(";", 1)[0] ?? "";
}

function seedVerification(databasePath: string) {
  const application = createFactoryApplication({ databasePath });
  const project = application.createProject({ name: "Session test" });
  const task = application.createTask({
    name: "Verify session",
    projectId: project.id,
  });
  const subtask = application.createSubtask({
    name: "Verify report",
    taskId: task.id,
  });
  const report = application.reportSubtaskStatus({
    reason: "The session test needs verification.",
    reportedState: "complete",
    reporter: "codex",
    subtaskId: subtask.id,
  });
  return { application, reportId: report.id, subtaskId: subtask.id };
}

describe("Factory human sessions", () => {
  test("logs in, exposes the human session, and rejects wrong or missing secrets", async () => {
    const server = createFactoryServer({
      databasePath: ":memory:",
      operator,
      port: 0,
    });

    try {
      const loginResponse = await fetch(new URL("/session/login", server.url), {
        body: JSON.stringify({ secret: operator.secret }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const cookie = cookieFrom(loginResponse);
      expect(loginResponse.status).toBe(200);
      expect(loginResponse.headers.get("set-cookie")).toContain(
        "HttpOnly; SameSite=Strict; Path=/;",
      );
      expect(await loginResponse.json()).toEqual({
        human: { name: operator.name },
      });

      const sessionResponse = await fetch(new URL("/session", server.url), {
        headers: { Cookie: cookie },
      });
      expect(await sessionResponse.json()).toEqual({
        human: { name: operator.name },
      });

      const logoutResponse = await fetch(
        new URL("/session/logout", server.url),
        { headers: { Cookie: cookie }, method: "POST" },
      );
      expect(logoutResponse.status).toBe(200);
      expect(logoutResponse.headers.get("set-cookie")).toContain("Max-Age=0");
      const loggedOutSession = await fetch(new URL("/session", server.url), {
        headers: { Cookie: cookie },
      });
      expect(await loggedOutSession.json()).toEqual({ human: null });

      const wrongResponse = await fetch(new URL("/session/login", server.url), {
        body: JSON.stringify({ secret: "wrong-secret" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const missingResponse = await fetch(
        new URL("/session/login", server.url),
        {
          body: JSON.stringify({}),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      expect(wrongResponse.status).toBe(401);
      expect(missingResponse.status).toBe(401);
      expect(await wrongResponse.json()).toEqual(await missingResponse.json());
    } finally {
      server.stop();
    }
  });

  test("rate limits the sixth failed login from one client", async () => {
    const server = createFactoryServer({
      databasePath: ":memory:",
      operator,
      port: 0,
    });

    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const response = await fetch(new URL("/session/login", server.url), {
          body: JSON.stringify({ secret: "wrong-secret" }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        statuses.push(response.status);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    } finally {
      server.stop();
    }
  });

  test("enforces matching origins on login and WebSocket upgrades while allowing absent origins", async () => {
    const server = createFactoryServer({
      allowedOrigins: ["https://factory.example"],
      databasePath: ":memory:",
      operator,
      port: 0,
    });
    const ownOrigin = server.url.origin;

    try {
      const mismatchedLogin = await fetch(
        new URL("/session/login", server.url),
        {
          body: JSON.stringify({ secret: operator.secret }),
          headers: {
            "Content-Type": "application/json",
            Origin: "https://evil.example",
          },
          method: "POST",
        },
      );
      expect(mismatchedLogin.status).toBe(403);

      const allowedOriginLogin = await fetch(
        new URL("/session/login", server.url),
        {
          body: JSON.stringify({ secret: operator.secret }),
          headers: {
            "Content-Type": "application/json",
            Origin: "https://factory.example",
            "X-Forwarded-Host": "factory.example",
            "X-Forwarded-Proto": "https",
          },
          method: "POST",
        },
      );
      expect(allowedOriginLogin.status).toBe(200);
      expect(allowedOriginLogin.headers.get("set-cookie")).toContain(
        " Secure;",
      );

      const matchingLogin = await fetch(new URL("/session/login", server.url), {
        body: JSON.stringify({ secret: operator.secret }),
        headers: {
          "Content-Type": "application/json",
          Origin: ownOrigin,
        },
        method: "POST",
      });
      const cookie = cookieFrom(matchingLogin);
      expect(matchingLogin.status).toBe(200);

      const mismatchedLogout = await fetch(
        new URL("/session/logout", server.url),
        {
          headers: { Cookie: cookie, Origin: "https://evil.example" },
          method: "POST",
        },
      );
      expect(mismatchedLogout.status).toBe(403);

      const absentOriginLogin = await fetch(
        new URL("/session/login", server.url),
        {
          body: JSON.stringify({ secret: operator.secret }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      expect(absentOriginLogin.status).toBe(200);

      await expect(
        openSocket(server, {
          Cookie: cookie,
          Origin: "https://evil.example",
        }),
      ).rejects.toThrow("WebSocket connection failed");

      const matchingSocket = await openSocket(server, {
        Cookie: cookie,
        Origin: ownOrigin,
      });
      const absentOriginSocket = await openSocket(server, { Cookie: cookie });
      matchingSocket.close();
      absentOriginSocket.close();
    } finally {
      server.stop();
    }
  });

  test("requires a human WebSocket session and records the configured operator", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-human-session-"));
    const databasePath = join(directory, "factory.sqlite");
    const { application, reportId, subtaskId } = seedVerification(databasePath);
    const server = createFactoryServer({ databasePath, operator, port: 0 });

    try {
      const unauthenticatedSocket = await openSocket(server);
      const unauthorized = await sendRawTRPCRequest(unauthenticatedSocket, {
        id: 1,
        method: "mutation",
        params: {
          input: { decision: "accepted", reportId },
          path: "subtasks.verify",
        },
      });
      expect(unauthorized.error?.data?.code).toBe("UNAUTHORIZED");
      unauthenticatedSocket.close();

      const loginResponse = await fetch(new URL("/session/login", server.url), {
        body: JSON.stringify({ secret: operator.secret }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const cookie = cookieFrom(loginResponse);
      const authenticatedSocket = await openSocket(server, { Cookie: cookie });
      const verified = await sendRawTRPCRequest(authenticatedSocket, {
        id: 2,
        method: "mutation",
        params: {
          input: { decision: "accepted", reportId },
          path: "subtasks.verify",
        },
      });
      expect(verified.result?.type).toBe("data");
      expect(application.getSubtaskVerificationHistory(subtaskId)).toEqual([
        expect.objectContaining({ verifier: operator.name }),
      ]);
      authenticatedSocket.close();
    } finally {
      server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("keeps a session valid when a new server opens the same database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-human-restart-"));
    const databasePath = join(directory, "factory.sqlite");
    const firstServer = createFactoryServer({
      databasePath,
      operator,
      port: 0,
    });
    let cookie: string;

    try {
      const loginResponse = await fetch(
        new URL("/session/login", firstServer.url),
        {
          body: JSON.stringify({ secret: operator.secret }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      cookie = cookieFrom(loginResponse);
    } finally {
      await firstServer.stop();
    }

    const secondServer = createFactoryServer({
      databasePath,
      operator,
      port: 0,
    });
    try {
      const response = await fetch(new URL("/session", secondServer.url), {
        headers: { Cookie: cookie! },
      });
      expect(await response.json()).toEqual({
        human: { name: operator.name },
      });
    } finally {
      secondServer.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects verification with a clear error when no operator is configured", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-no-operator-"));
    const databasePath = join(directory, "factory.sqlite");
    const { reportId } = seedVerification(databasePath);
    const server = createFactoryServer({ databasePath, port: 0 });

    try {
      const socket = await openSocket(server);
      const response = await sendRawTRPCRequest(socket, {
        id: 1,
        method: "mutation",
        params: {
          input: { decision: "accepted", reportId },
          path: "subtasks.verify",
        },
      });
      expect(response.error?.data?.code).toBe("UNAUTHORIZED");
      expect(response.error?.message).toContain("Human session not configured");
      socket.close();
    } finally {
      server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
