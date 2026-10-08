import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";
import { createWebSocket } from "./helpers";

type TRPCResponse = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

const operator = { name: "Kevin", secret: "operator-secret" };

async function login(server: { url: URL }): Promise<string> {
  const response = await fetch(new URL("/session/login", server.url), {
    body: JSON.stringify({ secret: operator.secret }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function apiRequest(
  server: { url: URL },
  path: string,
  options: { cookie?: string; input?: unknown; token?: string } = {},
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
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
  });
  const body = response.headers.get("content-type")?.includes("json")
    ? ((await response.json()) as TRPCResponse)
    : {};
  return { body, response };
}

function openSocket(server: { url: URL }, token: string): Promise<WebSocket> {
  const socket = createWebSocket(new URL("/trpc", server.url), {
    Authorization: `Bearer ${token}`,
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Factory WebSocket connection failed")),
      { once: true },
    );
  });
}

function socketRequest(
  socket: WebSocket,
  id: number,
  path: string,
  input: unknown = null,
): Promise<TRPCResponse & { id: number }> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const response = JSON.parse(String(event.data)) as TRPCResponse & {
        id: number;
      };
      if (response.id !== id) return;
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      resolve(response);
    };
    const onError = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      reject(new Error("Factory WebSocket request failed"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.send(
      JSON.stringify({
        id,
        method: "query",
        params: { input, path },
      }),
    );
  });
}

describe("Factory agent credential administration", () => {
  test("denies every credential administration route to unauthenticated and machine clients", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-agent-denial-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Denied project" });
    const server = createFactoryServer({ databasePath, operator, port: 0 });
    const store = createMachineCredentialStore({ databasePath });
    const coding = store.create({
      machineId: "agent-coding",
      projectIds: [project.id],
    });
    const reviewer = store.create({
      machineId: "agent-reviewer",
      projectIds: [project.id],
      reviewerName: "Bitsy",
      role: "reviewer",
    });
    const routes = [
      { path: "agentCredentials.list" },
      {
        input: {
          machineId: "admin-denied",
          projectIds: [project.id],
          role: "coding",
        },
        path: "agentCredentials.create",
      },
      {
        input: {
          credentialId: coding.id,
          projectIds: [project.id],
        },
        path: "agentCredentials.updateProjectAccess",
      },
      {
        input: { credentialId: coding.id },
        path: "agentCredentials.rotate",
      },
      {
        input: { credentialId: coding.id },
        path: "agentCredentials.revoke",
      },
    ];

    try {
      for (const token of [undefined, coding.token, reviewer.token]) {
        for (const route of routes) {
          const result = await apiRequest(server, route.path, {
            ...(route.input === undefined ? {} : { input: route.input }),
            ...(token ? { token } : {}),
          });
          expect(result.response.status).toBe(401);
          expect(result.body.error?.data?.code).toBe("UNAUTHORIZED");
        }
      }
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("is human-only and keeps list responses metadata-only", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-agent-credentials-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Agent project" });
    const server = createFactoryServer({ databasePath, operator, port: 0 });
    const store = createMachineCredentialStore({ databasePath });
    const machine = store.create({
      machineId: "agent-admin-test",
      projectIds: [project.id],
    });
    try {
      const cookie = await login(server);
      const list = await apiRequest(server, "agentCredentials.list", {
        cookie,
      });
      expect(list.response.status).toBe(200);
      expect(list.body.result?.data).toMatchObject({
        projects: [{ id: project.id, name: "Agent project" }],
      });
      expect(JSON.stringify(list.body.result?.data)).not.toContain(
        machine.token,
      );
      expect(JSON.stringify(list.body.result?.data)).not.toContain("tokenHash");

      const created = await apiRequest(server, "agentCredentials.create", {
        cookie,
        input: {
          machineId: "agent-created",
          projectIds: [project.id],
          role: "coding",
        },
      });
      expect(created.response.status).toBe(200);
      const createdData = created.body.result?.data as {
        credential: { id: string; projectIds: string[] };
        token: string;
      };
      expect(createdData.token).toMatch(/^fmc_/);
      expect(createdData.credential.projectIds).toEqual([project.id]);
      expect(createdData.credential).not.toHaveProperty("token");

      const duplicate = await apiRequest(server, "agentCredentials.create", {
        cookie,
        input: {
          machineId: "agent-created",
          projectIds: [project.id],
          role: "coding",
        },
      });
      expect(duplicate.response.status).toBe(400);
      expect(duplicate.body.error?.message).toContain("already exists");

      const codingAllProjects = await apiRequest(
        server,
        "agentCredentials.create",
        {
          cookie,
          input: {
            allProjects: true,
            machineId: "agent-invalid-all",
            projectIds: [],
            role: "coding",
          },
        },
      );
      expect(codingAllProjects.response.status).toBe(400);

      const reviewer = await apiRequest(server, "agentCredentials.create", {
        cookie,
        input: {
          allProjects: true,
          machineId: "agent-reviewer",
          projectIds: [],
          reviewerName: "Bitsy",
          role: "reviewer",
        },
      });
      expect(reviewer.response.status).toBe(200);
      expect(reviewer.body.result?.data).toMatchObject({
        credential: {
          allProjects: true,
          role: "reviewer",
          reviewerName: "Bitsy",
        },
      });
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("updates empty and known scopes on an already-open machine WebSocket", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-agent-scope-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Scoped project" });
    const outsideProject = application.createProject({
      name: "Outside project",
    });
    const server = createFactoryServer({ databasePath, operator, port: 0 });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "agent-scope-test",
      projectIds: [project.id],
    });
    const socket = await openSocket(server, credential.token);
    try {
      const before = await socketRequest(socket, 1, "projects.list");
      expect(before.result?.data).toEqual([
        expect.objectContaining({ id: project.id }),
      ]);
      const beforeDetail = await socketRequest(socket, 2, "projects.detail", {
        projectId: project.id,
      });
      expect(beforeDetail.result?.data).toMatchObject({ id: project.id });
      const outsideDetail = await socketRequest(socket, 3, "projects.detail", {
        projectId: outsideProject.id,
      });
      expect(outsideDetail.error?.data?.code).toBe("FORBIDDEN");

      const cookie = await login(server);
      const unknown = await apiRequest(
        server,
        "agentCredentials.updateProjectAccess",
        {
          cookie,
          input: {
            credentialId: credential.id,
            projectIds: ["does-not-exist"],
          },
        },
      );
      expect(unknown.response.status).toBe(400);

      const disabled = await apiRequest(
        server,
        "agentCredentials.updateProjectAccess",
        {
          cookie,
          input: { credentialId: credential.id, projectIds: [] },
        },
      );
      expect(disabled.response.status).toBe(200);
      const afterDisable = await socketRequest(socket, 4, "projects.list");
      expect(afterDisable.result?.data).toEqual([]);
      const detailAfterDisable = await socketRequest(
        socket,
        5,
        "projects.detail",
        { projectId: project.id },
      );
      expect(detailAfterDisable.error?.data?.code).toBe("FORBIDDEN");

      const reenabled = await apiRequest(
        server,
        "agentCredentials.updateProjectAccess",
        {
          cookie,
          input: { credentialId: credential.id, projectIds: [project.id] },
        },
      );
      expect(reenabled.response.status).toBe(200);
      const afterEnable = await socketRequest(socket, 6, "projects.list");
      expect(afterEnable.result?.data).toEqual([
        expect.objectContaining({ id: project.id }),
      ]);
      const detailAfterEnable = await socketRequest(
        socket,
        7,
        "projects.detail",
        { projectId: project.id },
      );
      expect(detailAfterEnable.result?.data).toMatchObject({ id: project.id });
    } finally {
      socket.close();
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rotates atomically and targets revoke by credential ID", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-agent-rotation-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Rotation project" });
    const server = createFactoryServer({ databasePath, operator, port: 0 });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "agent-rotation-test",
      projectIds: [project.id],
    });
    const originalSocket = await openSocket(server, credential.token);
    let rotatedSocket: WebSocket | null = null;
    try {
      const cookie = await login(server);
      const rotated = await apiRequest(server, "agentCredentials.rotate", {
        cookie,
        input: { credentialId: credential.id },
      });
      expect(rotated.response.status).toBe(200);
      const rotatedData = rotated.body.result?.data as { token: string };
      expect(rotatedData.token).not.toBe(credential.token);

      const afterRotationSocket = await socketRequest(
        originalSocket,
        1,
        "projects.list",
      );
      expect(afterRotationSocket.error?.data?.code).toBe("UNAUTHORIZED");

      const oldToken = await apiRequest(server, "projects.list", {
        token: credential.token,
      });
      expect(oldToken.response.status).toBe(401);
      const newToken = await apiRequest(server, "projects.list", {
        token: rotatedData.token,
      });
      expect(newToken.response.status).toBe(200);
      rotatedSocket = await openSocket(server, rotatedData.token);

      const revoked = await apiRequest(server, "agentCredentials.revoke", {
        cookie,
        input: { credentialId: credential.id },
      });
      expect(revoked.response.status).toBe(200);
      const afterRevoke = await apiRequest(server, "projects.list", {
        token: rotatedData.token,
      });
      expect(afterRevoke.response.status).toBe(401);
      const afterRevokeSocket = await socketRequest(
        rotatedSocket,
        1,
        "projects.list",
      );
      expect(afterRevokeSocket.error?.data?.code).toBe("UNAUTHORIZED");

      const staleRevoke = await apiRequest(server, "agentCredentials.revoke", {
        cookie,
        input: { credentialId: credential.id },
      });
      expect(staleRevoke.response.status).toBe(404);
    } finally {
      originalSocket.close();
      rotatedSocket?.close();
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
