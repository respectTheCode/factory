import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { DEFAULT_T3_SERVER_VERSION } from "../../src/t3";
import type { FactoryServer } from "../../src/server";
import { createTestServer, loginTestOperator } from "./helpers";

type TRPCBody = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

type RequestMethod = "GET" | "POST";

async function api(
  server: Pick<FactoryServer, "url">,
  path: string,
  input: unknown,
  options: { cookie?: string; method?: RequestMethod; token?: string } = {},
): Promise<{ body: TRPCBody; raw: string; response: Response }> {
  const method = options.method ?? "POST";
  const url = new URL(`/api/${path}`, server.url);
  if (method === "GET") url.searchParams.set("input", JSON.stringify(input));
  const response = await fetch(url, {
    ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
    headers: {
      "Content-Type": "application/json",
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    method,
  });
  const raw = await response.text();
  return { body: JSON.parse(raw) as TRPCBody, raw, response };
}

function startT3Fixture(expectedToken: string) {
  const observedTokens: string[] = [];
  const server = Bun.serve({
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/.well-known/t3/environment") {
        return Response.json({ serverVersion: DEFAULT_T3_SERVER_VERSION });
      }
      if (url.pathname === "/api/orchestration/shell") {
        const authorization = request.headers.get("authorization") ?? "";
        const token = authorization.startsWith("Bearer ")
          ? authorization.slice("Bearer ".length)
          : "";
        observedTokens.push(token);
        if (token !== expectedToken) {
          return Response.json({ message: "Unauthorized" }, { status: 401 });
        }
        const updatedAt = new Date().toISOString();
        return Response.json({
          projects: [],
          snapshotSequence: 1,
          threads: [],
          updatedAt,
        });
      }
      return new Response("Not found", { status: 404 });
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  return {
    observedTokens,
    server,
    url: server.url.toString().replace(/\/$/, ""),
  };
}

describe("Factory T3 connection routes", () => {
  test("requires a human session for list, refresh, save, and test routes", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-t3-connections-auth-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Credential scope" });
    application.close();
    const machine = createMachineCredentialStore({ databasePath }).create({
      machineId: "test-machine",
      projectIds: [project.id],
    });
    const server = createTestServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
      t3ConnectionsDirectory: join(directory, "t3-connections"),
    });
    const draft = {
      accessToken: "secret-never-reflect-this",
      baseUrl: "http://127.0.0.1:3773",
      label: "Auth check",
      machineId: "test-machine",
    };
    const requests: Array<{
      input: unknown;
      method: RequestMethod;
      path: string;
    }> = [
      { input: {}, method: "GET", path: "t3.connections.list" },
      { input: {}, method: "GET", path: "t3.connections.refresh" },
      { input: draft, method: "POST", path: "t3.connections.save" },
      { input: draft, method: "POST", path: "t3.connections.test" },
    ];

    try {
      for (const request of requests) {
        for (const auth of [{}, { token: machine.token }]) {
          const result = await api(server, request.path, request.input, {
            ...auth,
            method: request.method,
          });
          expect(result.response.status).toBe(401);
          expect(result.body.error?.data?.code).toBe("UNAUTHORIZED");
        }
      }

      const humanCookie = await loginTestOperator(server);
      const listed = await api(
        server,
        "t3.connections.list",
        {},
        {
          cookie: humanCookie,
          method: "GET",
        },
      );
      expect(listed.response.status).toBe(200);
      expect(listed.raw).not.toContain(draft.accessToken);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("adds and edits a source at runtime, persists it across restart, and never returns its token", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-t3-connections-persist-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const connectionsDirectory = join(directory, "t3-connections");
    const originalToken = "t3-test-secret-original";
    const replacementToken = "t3-test-secret-replacement";
    const originalT3 = startT3Fixture(originalToken);
    const replacementT3 = startT3Fixture(replacementToken);
    const application = createFactoryApplication({ databasePath });
    const authorizationProject = application.createProject({
      name: "T3 source authorization",
    });
    application.close();
    const machineCredentials = createMachineCredentialStore({ databasePath });
    const serverOptions = {
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
      t3ConnectionsDirectory: connectionsDirectory,
      t3TimeoutMs: 1_000,
    };
    let server = createTestServer(serverOptions);
    let serverStopped = false;

    try {
      const shell = await fetch(new URL("/connections", server.url));
      expect(shell.status).toBe(200);
      expect(shell.headers.get("cache-control")).toBe("no-cache");

      const cookie = await loginTestOperator(server);
      const added = await api(
        server,
        "t3.connections.save",
        {
          accessToken: originalToken,
          baseUrl: originalT3.url,
          label: "Build Mac",
          machineId: "build-mac",
        },
        { cookie },
      );
      expect(added.response.status).toBe(200);
      expect(added.raw).not.toContain(originalToken);
      const addedSource = (
        added.body.result?.data as
          | { source?: { sourceId?: string; tokenConfigured?: boolean } }
          | undefined
      )?.source;
      expect(addedSource).toMatchObject({ tokenConfigured: true });
      const sourceId = addedSource?.sourceId;
      expect(sourceId).toBeString();
      if (!sourceId) throw new Error("Save did not return the new source ID.");

      const firstRefresh = await api(
        server,
        "t3.connections.refresh",
        { sourceId },
        { cookie, method: "GET" },
      );
      expect(firstRefresh.response.status).toBe(200);
      expect(firstRefresh.raw).not.toContain(originalToken);
      expect(firstRefresh.body.result?.data).toEqual([
        expect.objectContaining({ sourceId, state: "connected" }),
      ]);
      expect(originalT3.observedTokens).toContain(originalToken);
      const originalMachineCredential = machineCredentials.create({
        machineId: "build-mac",
        projectIds: [authorizationProject.id],
      });
      const originalMachineStatus = await api(
        server,
        "t3.status",
        { projectId: authorizationProject.id, sourceId },
        { method: "GET", token: originalMachineCredential.token },
      );
      expect(originalMachineStatus.response.status).toBe(200);
      expect(originalMachineStatus.body.result?.data).toMatchObject({
        machineId: "build-mac",
        sourceId,
      });

      const edited = await api(
        server,
        "t3.connections.save",
        {
          accessToken: replacementToken,
          baseUrl: replacementT3.url,
          label: "Build Mac Updated",
          machineId: "build-mac-updated",
          sourceId,
        },
        { cookie },
      );
      expect(edited.response.status).toBe(200);
      expect(edited.raw).not.toContain(originalToken);
      expect(edited.raw).not.toContain(replacementToken);
      expect(edited.body.result?.data).toMatchObject({
        source: {
          baseUrl: replacementT3.url,
          label: "Build Mac Updated",
          machineId: "build-mac-updated",
          sourceId,
          tokenConfigured: true,
        },
      });

      const oldMachineStatus = await api(
        server,
        "t3.status",
        { projectId: authorizationProject.id, sourceId },
        { method: "GET", token: originalMachineCredential.token },
      );
      expect(oldMachineStatus.response.status).toBe(403);
      expect(oldMachineStatus.body.error?.data?.code).toBe("FORBIDDEN");

      const updatedMachineCredential = machineCredentials.create({
        machineId: "build-mac-updated",
        projectIds: [authorizationProject.id],
      });
      const updatedMachineStatus = await api(
        server,
        "t3.status",
        { projectId: authorizationProject.id, sourceId },
        { method: "GET", token: updatedMachineCredential.token },
      );
      expect(updatedMachineStatus.response.status).toBe(200);
      expect(updatedMachineStatus.body.result?.data).toMatchObject({
        machineId: "build-mac-updated",
        sourceId,
      });

      const editedRefresh = await api(
        server,
        "t3.connections.refresh",
        { sourceId },
        { cookie, method: "GET" },
      );
      expect(editedRefresh.response.status).toBe(200);
      expect(editedRefresh.raw).not.toContain(replacementToken);
      expect(editedRefresh.body.result?.data).toEqual([
        expect.objectContaining({ sourceId, state: "connected" }),
      ]);
      expect(replacementT3.observedTokens).toContain(replacementToken);
      expect(originalT3.observedTokens).toHaveLength(2);

      await server.stop();
      serverStopped = true;
      server = createTestServer(serverOptions);
      serverStopped = false;
      const restartedCookie = await loginTestOperator(server);
      const persisted = await api(
        server,
        "t3.connections.list",
        {},
        { cookie: restartedCookie, method: "GET" },
      );
      expect(persisted.response.status).toBe(200);
      expect(persisted.raw).not.toContain(originalToken);
      expect(persisted.raw).not.toContain(replacementToken);
      const persistedSources = (
        persisted.body.result?.data as { sources?: unknown[] } | undefined
      )?.sources;
      expect(persistedSources).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            baseUrl: replacementT3.url,
            label: "Build Mac Updated",
            machineId: "build-mac-updated",
            sourceId,
            tokenConfigured: true,
          }),
        ]),
      );

      const restartedRefresh = await api(
        server,
        "t3.connections.refresh",
        { sourceId },
        { cookie: restartedCookie, method: "GET" },
      );
      expect(restartedRefresh.response.status).toBe(200);
      expect(restartedRefresh.raw).not.toContain(replacementToken);
      expect(restartedRefresh.body.result?.data).toEqual([
        expect.objectContaining({ sourceId, state: "connected" }),
      ]);
      expect(replacementT3.observedTokens).toContain(replacementToken);
    } finally {
      if (!serverStopped) await server.stop();
      machineCredentials.close();
      await originalT3.server.stop(true);
      await replacementT3.server.stop(true);
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
