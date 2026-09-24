import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { chdir, cwd } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createFactoryServer, getFactoryServerOptions } from "../../src/server";
import { createTestServer, loginTestOperator } from "./helpers";

function temporaryDirectory(prefix = "factory-server-runtime-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("Factory server runtime", () => {
  test("loads pilot identity, revision files, and GitHub mounted secrets", () => {
    const directory = temporaryDirectory();
    const githubTokenFile = join(directory, "github-token");
    const revisionFile = join(directory, "REVISION");
    writeFileSync(githubTokenFile, "github-secret-token\n", { mode: 0o600 });
    writeFileSync(revisionFile, "0123456789abcdef0123456789abcdef01234567\n", {
      mode: 0o600,
    });

    try {
      expect(
        getFactoryServerOptions({
          FACTORY_ENVIRONMENT: "pilot",
          FACTORY_REQUIRE_EXISTING_DB: "true",
          FACTORY_REVISION_FILE: revisionFile,
          GITHUB_TOKEN_FILE: githubTokenFile,
        }),
      ).toMatchObject({
        environment: "pilot",
        githubToken: "github-secret-token",
        requireExistingDatabase: true,
        revision: "0123456789abcdef0123456789abcdef01234567",
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("keeps explicit revision ahead of a mounted revision file", () => {
    const directory = temporaryDirectory();
    const revisionFile = join(directory, "REVISION");
    writeFileSync(revisionFile, "0123456789abcdef0123456789abcdef01234567\n");

    try {
      expect(
        getFactoryServerOptions({
          FACTORY_REVISION: "pilot-build-7",
          FACTORY_REVISION_FILE: revisionFile,
        }).revision,
      ).toBe("pilot-build-7");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects a missing database when production requires an existing snapshot", () => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "missing.sqlite");

    try {
      expect(() =>
        createFactoryServer({
          databasePath,
          environment: "pilot",
          port: 0,
          requireExistingDatabase: true,
        }),
      ).toThrow("FACTORY_REQUIRE_EXISTING_DB=true");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test.each([
    ["corrupt", "not-json"],
    [
      "incompatible",
      JSON.stringify({
        projects: [],
        schemaVersion: 2,
        statusReports: [],
        subtasks: [],
        tasks: [],
        verifications: [],
      }),
    ],
  ])("rejects an existing %s factory snapshot in pilot", (_kind, state) => {
    const directory = temporaryDirectory();
    const databasePath = join(directory, "factory.sqlite");
    const database = new Database(databasePath);
    database.exec(
      "CREATE TABLE factory_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)",
    );
    database
      .query("INSERT INTO factory_state (id, state) VALUES (1, $state)")
      .run({ $state: state });
    database.close();

    try {
      expect(() =>
        createFactoryServer({
          databasePath,
          environment: "pilot",
          port: 0,
          requireExistingDatabase: true,
        }),
      ).toThrow("compatible existing Factory database");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects a production database that cannot accept a persistence write", () => {
    const directory = temporaryDirectory("factory-server-readonly-");
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    application.createProject({ name: "Read-only proof" });
    application.close();

    try {
      chmodSync(databasePath, 0o444);
      expect(() =>
        createFactoryServer({
          databasePath,
          environment: "production",
          port: 0,
        }),
      ).toThrow("compatible existing Factory database");
    } finally {
      chmodSync(databasePath, 0o644);
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("reports optional integrations and updates readiness after a T3 source is added", async () => {
    const directory = temporaryDirectory("factory-server-readiness-");
    const server = createTestServer({
      databasePath: ":memory:",
      environment: "pilot",
      port: 0,
      t3ConnectionsDirectory: join(directory, "t3-connections"),
    });

    try {
      const health = await fetch(new URL("/healthz", server.url));
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok" });

      const readiness = await fetch(new URL("/readyz", server.url));
      expect(readiness.status).toBe(200);
      expect(await readiness.json()).toMatchObject({
        checks: { database: "ok", staticAssets: "ok" },
        integrations: { github: "unavailable", t3: "unavailable" },
        ready: true,
        status: "ready",
      });

      const cookie = await loginTestOperator(server);
      const saved = await fetch(
        new URL("/api/t3.connections.save", server.url),
        {
          body: JSON.stringify({
            accessToken: "t3-readiness-test-token",
            baseUrl: "http://127.0.0.1:3774",
            label: "Readiness source",
            machineId: "readiness-machine",
          }),
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie,
          },
          method: "POST",
        },
      );
      expect(saved.status).toBe(200);

      const readinessWithT3 = await fetch(new URL("/readyz", server.url));
      expect(readinessWithT3.status).toBe(200);
      expect(await readinessWithT3.json()).toMatchObject({
        integrations: { github: "unavailable", t3: "configured" },
        ready: true,
        status: "ready",
      });

      for (const pathname of ["/version", "/deployment.json"]) {
        const response = await fetch(new URL(pathname, server.url));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          environment: "pilot",
          revision: "dev",
          schemaVersion: 1,
        });
      }
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("serves static assets independently of the process CWD", async () => {
    const server = createFactoryServer({
      databasePath: ":memory:",
      port: 0,
    });
    const originalDirectory = cwd();
    const directory = temporaryDirectory("factory-server-cwd-");

    try {
      chdir(directory);
      const response = await fetch(new URL("/", server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Software Factory");
    } finally {
      chdir(originalDirectory);
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("closes application persistence across a restart", () => {
    const directory = temporaryDirectory("factory-server-restart-");
    const databasePath = join(directory, "factory.sqlite");

    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({ name: "Restart proof" });
      first.close();

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.listProjects()).toContainEqual({
        id: project.id,
        name: project.name,
      });
      reopened.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("makes readiness unavailable as shutdown begins and keeps stop idempotent", async () => {
    const server = createFactoryServer({
      databasePath: ":memory:",
      port: 0,
      shutdownTimeoutMs: 250,
    });

    const stopping = server.stop();
    const readiness = await fetch(new URL("/readyz", server.url)).catch(
      () => undefined,
    );
    expect(readiness === undefined || readiness.status === 503).toBe(true);
    await stopping;
    await server.stop();
  });
});
