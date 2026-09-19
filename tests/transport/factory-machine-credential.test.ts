import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createFactoryApplication,
  type CodeSessionObservationInput,
} from "../../src/application";
import {
  createMachineCredentialStore,
  resolveMachineToken,
} from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";
import type { T3ActivityReader } from "../../src/t3";
import { createWebSocket } from "./helpers";

type TRPCResponse = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

const operator = { name: "Kevin", secret: "operator-secret" };

async function apiRequest(
  server: { url: URL },
  path: string,
  options: {
    cookie?: string;
    token?: string;
    input?: unknown;
    origin?: string;
  } = {},
): Promise<{ response: Response; body: TRPCResponse }> {
  const response = await fetch(new URL(`/api/${path}`, server.url), {
    ...(options.input === undefined
      ? {}
      : { body: JSON.stringify(options.input), method: "POST" }),
    headers: {
      ...(options.input === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.origin === undefined ? {} : { Origin: options.origin }),
      ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
      ...(options.token === undefined
        ? {}
        : { Authorization: `Bearer ${options.token}` }),
    },
  });
  const body = response.headers.get("content-type")?.includes("json")
    ? ((await response.json()) as TRPCResponse)
    : {};
  return { body, response };
}

async function queryRequest(
  server: { url: URL },
  path: string,
  input: unknown,
  token: string,
): Promise<{ response: Response; body: TRPCResponse }> {
  const query = encodeURIComponent(JSON.stringify(input));
  const response = await fetch(
    new URL(`/api/${path}?input=${query}`, server.url),
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const body = (await response.json()) as TRPCResponse;
  return { body, response };
}

function unavailableReader(error = "fixture unavailable"): T3ActivityReader {
  return {
    readShell: async () => ({
      error,
      fetchedAt: new Date().toISOString(),
      ok: false,
      status: "unavailable" as const,
    }),
    readThread: async () => ({
      error,
      fetchedAt: new Date().toISOString(),
      ok: false,
      status: "unavailable" as const,
    }),
  };
}

function openSocket(
  server: { url: URL },
  headers: Record<string, string> = {},
): Promise<WebSocket> {
  const socket = createWebSocket(new URL("/trpc", server.url), headers);
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("WebSocket connection failed")),
      { once: true },
    );
  });
}

function socketRequest(
  socket: WebSocket,
  request: Record<string, unknown> & { id: number },
): Promise<TRPCResponse & { id: number }> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const response = JSON.parse(String(event.data)) as TRPCResponse & {
        id: number;
      };
      if (response.id !== request.id) return;
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
    socket.send(JSON.stringify(request));
  });
}

describe("Factory machine credentials", () => {
  test("round-trips source-specific project mappings through the API", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-project-mappings-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const server = createFactoryServer({
      databasePath,
      operator,
      port: 0,
    });
    try {
      const login = await fetch(new URL("/session/login", server.url), {
        body: JSON.stringify({ secret: operator.secret }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toBeTruthy();

      const created = await apiRequest(server, "projects.create", {
        cookie,
        input: {
          name: "Mapped project",
          t3Mappings: [{ sourceId: "ubuntu", t3ProjectId: "ubuntu-project" }],
        },
      });
      expect(created.response.status).toBe(200);
      const project = created.body.result?.data as {
        id: string;
        t3Mappings?: unknown;
      };
      expect(project.t3Mappings).toEqual([
        { sourceId: "ubuntu", t3ProjectId: "ubuntu-project" },
      ]);

      const updated = await apiRequest(server, "projects.update", {
        cookie,
        input: {
          gitOriginUrl: null,
          projectId: project.id,
          t3Mappings: [{ sourceId: "ubuntu", workspaceRoot: "/srv/factory" }],
        },
      });
      expect(updated.response.status).toBe(200);
      expect(
        (updated.body.result?.data as { t3Mappings?: unknown }).t3Mappings,
      ).toEqual([{ sourceId: "ubuntu", workspaceRoot: "/srv/factory" }]);

      expect(application.getProjectDetail(project.id).t3Mappings).toEqual([
        { sourceId: "ubuntu", workspaceRoot: "/srv/factory" },
      ]);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("binds machine T3 reads to the configured source machine identity", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-machine-t3-source-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Source-scoped" });
    const unavailable = unavailableReader();
    const server = createFactoryServer({
      databasePath,
      operator,
      port: 0,
      t3Sources: [
        {
          accessTokenFile: "/tmp/legacy-token",
          baseUrl: "http://127.0.0.1:3773",
          machineId: "mac-mini",
          reader: unavailable,
          sourceId: "legacy",
        },
        {
          accessTokenFile: "/tmp/ubuntu-token",
          baseUrl: "http://192.168.6.51:3773",
          machineId: "agent-ubuntu",
          reader: unavailable,
          sourceId: "ubuntu",
        },
      ],
    });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "mac-mini",
      projectIds: [project.id],
    });
    try {
      const forbidden = await queryRequest(
        server,
        "t3.status",
        { projectId: project.id, sourceId: "ubuntu" },
        credential.token,
      );
      expect(forbidden.response.status).toBe(403);
      expect(forbidden.body.error?.data?.code).toBe("FORBIDDEN");

      const allowed = await queryRequest(
        server,
        "t3.status",
        { projectId: project.id, sourceId: "legacy" },
        credential.token,
      );
      expect(allowed.response.status).toBe(200);
      expect(allowed.body.result?.data).toMatchObject({
        sourceId: "legacy",
        status: "unavailable",
      });
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("authorizes detail and unlink against the selected source project", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-source-project-auth-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const first = application.createProject({
      gitOriginUrl: "git@github.com:app-press/factory.git",
      name: "First source project",
    });
    const second = application.createProject({
      gitOriginUrl: "git@github.com:app-press/factory.git",
      name: "Second source project",
    });
    const observedAt = new Date("2026-09-18T12:00:00.000Z");
    const observation = (
      projectId: string,
      sourceId: string,
    ): CodeSessionObservationInput => ({
      externalProjectId: `${sourceId}-project`,
      externalThreadId: "shared-thread",
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      latestSessionState: "ready",
      latestTurnState: "completed",
      machineId: "mac-mini",
      observedAt,
      projectId,
      provider: "t3",
      repositoryIdentity: "github.com/app-press/factory",
      sourceDigest: `${sourceId}-digest`,
      sourceId,
      sourceSequence: 1,
      sourceStream: "shell",
      sourceUpdatedAt: observedAt,
      title: `${sourceId} thread`,
      workspaceRoot: `/work/${sourceId}`,
    });
    application.refreshT3Observations({
      observations: [
        observation(first.id, "legacy"),
        observation(second.id, "ubuntu"),
      ],
    });
    expect(application.getProjectIdForThread("shared-thread", "legacy")).toBe(
      first.id,
    );
    expect(application.getProjectIdForThread("shared-thread", "ubuntu")).toBe(
      second.id,
    );

    const reader = unavailableReader();
    const server = createFactoryServer({
      databasePath,
      operator,
      port: 0,
      t3Sources: [
        {
          accessTokenFile: "/tmp/legacy-token",
          baseUrl: "http://127.0.0.1:3773",
          machineId: "mac-mini",
          reader,
          sourceId: "legacy",
        },
        {
          accessTokenFile: "/tmp/ubuntu-token",
          baseUrl: "http://192.168.6.51:3773",
          machineId: "agent-ubuntu",
          reader,
          sourceId: "ubuntu",
        },
      ],
    });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "agent-ubuntu",
      projectIds: [first.id],
    });
    try {
      const detail = await queryRequest(
        server,
        "t3.threadDetail",
        { threadId: "shared-thread", turnLimit: 1 },
        credential.token,
      );
      expect(detail.response.status).toBe(403);
      expect(detail.body.error?.data?.code).toBe("FORBIDDEN");

      const unlink = await apiRequest(server, "t3.unlinkThread", {
        input: { threadId: "shared-thread" },
        token: credential.token,
      });
      expect(unlink.response.status).toBe(403);
      expect(unlink.body.error?.data?.code).toBe("FORBIDDEN");
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("stores only token hashes and supports authentication and revocation", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-machine-credential-"),
    );
    const store = createMachineCredentialStore({
      databasePath: join(directory, "factory.sqlite"),
    });

    try {
      const created = store.create({
        machineId: "mac-mini-1",
        projectIds: ["project-a", "project-b"],
      });
      expect(created.token).toMatch(/^fmc_[A-Za-z0-9_-]+$/);
      expect(store.authenticate(created.token)).toEqual({
        id: created.id,
        machineId: "mac-mini-1",
        projectIds: ["project-a", "project-b"],
      });
      expect(store.authenticate("fmc_wrong")).toBeNull();
      expect(store.list()).toEqual([
        expect.objectContaining({
          id: created.id,
          machineId: "mac-mini-1",
          projectIds: ["project-a", "project-b"],
        }),
      ]);
      expect(store.list()[0]).not.toHaveProperty("tokenHash");
      expect(store.list()[0]).not.toHaveProperty("token");

      store.revoke("mac-mini-1");
      expect(store.authenticate(created.token)).toBeNull();
    } finally {
      store.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("authenticates scoped reports through HTTP and rejects role or scope violations", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-machine-api-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const insideProject = application.createProject({ name: "Inside" });
    const outsideProject = application.createProject({ name: "Outside" });
    const insideTask = application.createTask({
      name: "Inside task",
      projectId: insideProject.id,
    });
    const insideSubtask = application.createSubtask({
      name: "Inside subtask",
      taskId: insideTask.id,
    });
    const outsideTask = application.createTask({
      name: "Outside task",
      projectId: outsideProject.id,
    });
    const outsideSubtask = application.createSubtask({
      name: "Outside subtask",
      taskId: outsideTask.id,
    });
    const reportReader = unavailableReader();
    const server = createFactoryServer({
      databasePath,
      operator,
      port: 0,
      t3Sources: [
        {
          accessTokenFile: "/tmp/legacy-token",
          baseUrl: "http://127.0.0.1:3773",
          machineId: "mac-mini-1",
          reader: reportReader,
          sourceId: "legacy",
        },
        {
          accessTokenFile: "/tmp/ubuntu-token",
          baseUrl: "http://192.168.6.51:3773",
          machineId: "agent-ubuntu",
          reader: reportReader,
          sourceId: "ubuntu",
        },
      ],
    });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "mac-mini-1",
      projectIds: [insideProject.id],
    });

    try {
      const reportResult = await apiRequest(server, "subtasks.report", {
        input: {
          evidence: "Remote evidence",
          machineId: "spoofed-client-value",
          reportedState: "in_progress",
          reporter: "codex",
          sessionRef: { externalThreadId: "thread-1", provider: "t3" },
          subtaskId: insideSubtask.id,
        },
        token: credential.token,
      });
      expect(reportResult.response.status).toBe(200);
      expect(reportResult.body.result?.data).toMatchObject({
        machineId: "mac-mini-1",
        reporter: "codex",
        sessionRef: {
          externalThreadId: "thread-1",
          provider: "t3",
          sourceId: "legacy",
        },
      });
      expect(application.getSubtaskReportHistory(insideSubtask.id)).toEqual([
        expect.objectContaining({
          machineId: "mac-mini-1",
          sessionRef: {
            externalThreadId: "thread-1",
            provider: "t3",
            sourceId: "legacy",
          },
        }),
      ]);

      const spoofedSourceReport = await apiRequest(server, "subtasks.report", {
        input: {
          reportedState: "in_progress",
          reporter: "codex",
          sessionRef: {
            externalThreadId: "thread-1",
            provider: "t3",
            sourceId: "ubuntu",
          },
          subtaskId: insideSubtask.id,
        },
        token: credential.token,
      });
      expect(spoofedSourceReport.response.status).toBe(403);
      expect(spoofedSourceReport.body.error?.data?.code).toBe("FORBIDDEN");

      const outsideReport = await apiRequest(server, "subtasks.report", {
        input: {
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: outsideSubtask.id,
        },
        token: credential.token,
      });
      expect(outsideReport.response.status).toBe(403);
      expect(outsideReport.body.error?.data?.code).toBe("FORBIDDEN");
      expect(outsideReport.body.error?.message).toContain("not scoped");

      const verify = await apiRequest(server, "subtasks.verify", {
        input: { decision: "accepted", reportId: "not-a-report" },
        token: credential.token,
      });
      expect(verify.response.status).toBe(401);
      expect(verify.body.error?.data?.code).toBe("UNAUTHORIZED");

      const remove = await apiRequest(server, "projects.remove", {
        input: { confirm: true, projectId: insideProject.id },
        token: credential.token,
      });
      expect(remove.response.status).toBe(401);
      expect(remove.body.error?.data?.code).toBe("UNAUTHORIZED");

      const wrongToken = await apiRequest(server, "projects.list", {
        token: "fmc_invalid",
      });
      expect(wrongToken.body.error?.data?.code).toBe("UNAUTHORIZED");

      store.revoke("mac-mini-1");
      const revokedToken = await apiRequest(server, "projects.list", {
        token: credential.token,
      });
      expect(revokedToken.body.error?.data?.code).toBe("UNAUTHORIZED");
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("filters machine portfolio reads, rejects unauthenticated WebSocket reads, and serves version", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-machine-reads-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const visible = application.createProject({ name: "Visible" });
    application.createProject({ name: "Hidden" });
    const server = createFactoryServer({ databasePath, operator, port: 0 });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "mac-mini-2",
      projectIds: [visible.id],
    });

    try {
      const list = await apiRequest(server, "projects.list", {
        token: credential.token,
      });
      expect(list.body.result?.data).toEqual([
        expect.objectContaining({ id: visible.id, name: "Visible" }),
      ]);

      const portfolio = await apiRequest(server, "projects.portfolio", {
        token: credential.token,
      });
      expect(portfolio.body.result?.data).toMatchObject({
        projects: [expect.objectContaining({ projectId: visible.id })],
      });

      const version = await fetch(new URL("/version", server.url));
      expect(await version.json()).toEqual({
        apiVersion: 1,
        revision: expect.any(String),
        schemaVersion: 1,
      });

      const originRejected = await apiRequest(server, "projects.list", {
        origin: "https://evil.example",
        token: credential.token,
      });
      expect(originRejected.response.status).toBe(403);

      const socket = await openSocket(server);
      try {
        const response = await socketRequest(socket, {
          id: 1,
          method: "query",
          params: { input: null, path: "projects.list" },
        });
        expect(response.error?.data?.code).toBe("UNAUTHORIZED");
      } finally {
        socket.close();
      }
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe("machine credential rotation", () => {
  test("re-issues a revoked machine ID and keeps active IDs unique", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-credential-rotate-"));
    const store = createMachineCredentialStore({
      databasePath: join(directory, "factory.sqlite"),
    });
    try {
      const first = store.create({ machineId: "mac-mini", projectIds: ["p"] });
      expect(() =>
        store.create({ machineId: "mac-mini", projectIds: ["p"] }),
      ).toThrow();
      store.revoke("mac-mini");
      const second = store.create({ machineId: "mac-mini", projectIds: ["p"] });
      expect(store.authenticate(first.token)).toBeNull();
      expect(store.authenticate(second.token)?.machineId).toBe("mac-mini");
      expect(store.list().map((c) => c.id)).toEqual([second.id]);
    } finally {
      store.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});

describe("machine token parsing", () => {
  test("accepts only bearer machine tokens", () => {
    expect(resolveMachineToken("Bearer fmc_abc-123_X")).toBe("fmc_abc-123_X");
    expect(resolveMachineToken("bearer fmc_abc")).toBe("fmc_abc");
    expect(resolveMachineToken("Basic fmc_abc")).toBeUndefined();
    expect(resolveMachineToken("Bearer human-token extra")).toBeUndefined();
  });
});
