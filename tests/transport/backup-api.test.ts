import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import {
  type BackupService,
  type BackupSummary,
  createBackupService,
} from "../../src/backup-service";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer, type FactoryServer } from "../../src/server";

const OPERATOR = { name: "backup-test", secret: "backup-test-secret" };

type TRPCResponse = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

function fixture() {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), "factory-backup-api-")),
  );
  const databasePath = join(directory, "factory.sqlite");
  const backupDirectory = join(directory, "backups");
  mkdirSync(backupDirectory);
  const application = createFactoryApplication({ databasePath });
  application.createProject({ name: "Factory" });
  application.close();
  return { backupDirectory, databasePath, directory };
}

async function login(server: Pick<FactoryServer, "url">): Promise<string> {
  const response = await fetch(new URL("/session/login", server.url), {
    body: JSON.stringify({ secret: OPERATOR.secret }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function api(
  server: Pick<FactoryServer, "url">,
  path: string,
  input: unknown,
  cookie?: string,
  method: "GET" | "POST" = "POST",
  token?: string,
): Promise<{ response: Response; body: TRPCResponse }> {
  const url = new URL(`/api/${path}`, server.url);
  if (method === "GET") url.searchParams.set("input", JSON.stringify(input));
  const response = await fetch(url, {
    ...(method === "POST" ? { body: JSON.stringify(input) } : {}),
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method,
  });
  return { body: (await response.json()) as TRPCResponse, response };
}

function fakeService(overrides: Partial<BackupService> = {}): BackupService {
  const summary: BackupSummary = {
    createdAt: new Date().toISOString(),
    id: "b-20260918T000000.000Z-deadbeef",
    integrity: "verified",
    manifestSizeBytes: 1,
    sizeBytes: 2,
    snapshotSizeBytes: 1,
    trigger: "manual",
  };
  return {
    status: () => ({
      busy: false,
      configured: true,
      directory: "/backups",
      lastError: null,
      lastSuccessAt: null,
      settings: {
        enabled: true,
        intervalMinutes: 30,
        keepDaily: 30,
        keepRecent: 336,
      },
      stale: false,
    }),
    list: async () => [summary],
    create: async () => summary,
    updateSettings: async (settings) => ({
      enabled: settings.enabled ?? true,
      intervalMinutes: settings.intervalMinutes ?? 30,
      keepDaily: settings.keepDaily ?? 30,
      keepRecent: settings.keepRecent ?? 336,
    }),
    delete: async () => {},
    prepareRestore: async () => {
      throw new Error("restore not configured in this transport fixture");
    },
    start: async () => {},
    stop: () => {},
    ...overrides,
  };
}

describe("Factory backup transport", () => {
  test("requires a human session on every backup route", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    const machineStore = createMachineCredentialStore({ databasePath });
    const machineCredential = machineStore.create({
      machineId: "backup-machine",
      projectIds: ["project"],
    });
    const server = createFactoryServer({
      backupDirectory,
      databasePath,
      operator: OPERATOR,
      port: 0,
    });
    const routes: Array<[string, unknown, "GET" | "POST"]> = [
      ["backups.status", null, "GET"],
      ["backups.list", null, "GET"],
      ["backups.create", {}, "POST"],
      [
        "backups.updateSettings",
        { enabled: true, intervalMinutes: 30, keepDaily: 30, keepRecent: 336 },
        "POST",
      ],
      [
        "backups.delete",
        { backupId: "b-20260918T000000.000Z-deadbeef" },
        "POST",
      ],
      [
        "backups.restore",
        { backupId: "b-20260918T000000.000Z-deadbeef", confirm: true },
        "POST",
      ],
    ];
    try {
      for (const [route, input, method = "POST"] of routes) {
        const result = await api(
          server,
          route,
          input,
          undefined,
          method as "GET" | "POST",
        );
        expect(result.response.status).toBe(401);
        expect(result.body.error?.data?.code).toBe("UNAUTHORIZED");
      }
      for (const [route, input, method = "POST"] of routes) {
        const result = await api(
          server,
          route,
          input,
          undefined,
          method as "GET" | "POST",
          machineCredential.token,
        );
        expect(result.response.status).toBe(401);
        expect(result.body.error?.data?.code).toBe("UNAUTHORIZED");
      }
      const cookie = await login(server);
      const status = await api(server, "backups.status", null, cookie, "GET");
      expect(status.response.status).toBe(200);
      expect(status.body.result?.data).toMatchObject({ configured: true });
    } finally {
      await server.stop();
      machineStore.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("status and a slow list do not hold the application write mutex", async () => {
    const { databasePath, directory } = fixture();
    let releaseList!: () => void;
    const listPending = new Promise<BackupSummary[]>((resolve) => {
      releaseList = () => resolve([]);
    });
    const server = createFactoryServer({
      backupService: fakeService({ list: async () => listPending }),
      databasePath,
      operator: OPERATOR,
      port: 0,
    });
    try {
      const cookie = await login(server);
      const listPromise = api(server, "backups.list", null, cookie, "GET");
      const status = await api(server, "backups.status", null, cookie, "GET");
      expect(status.response.status).toBe(200);

      const write = await api(
        server,
        "projects.create",
        { name: "Concurrent write" },
        cookie,
      );
      expect(write.response.status).toBe(200);
      releaseList();
      expect((await listPromise).response.status).toBe(200);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("restore acknowledges before restart, gates later writes, and reapplies on startup", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    const engineService = createBackupService({
      databasePath,
      directory: backupDirectory,
    });
    const source = await engineService.create("manual");
    let markPrepared!: () => void;
    const preparationStaged = new Promise<void>((resolve) => {
      markPrepared = resolve;
    });
    let releasePreparation!: () => void;
    const preparationReleased = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const service: BackupService = {
      status: engineService.status.bind(engineService),
      list: engineService.list.bind(engineService),
      create: engineService.create.bind(engineService),
      updateSettings: engineService.updateSettings.bind(engineService),
      delete: engineService.delete.bind(engineService),
      prepareRestore: async (id) => {
        const result = await engineService.prepareRestore(id);
        markPrepared();
        await preparationReleased;
        return result;
      },
      start: async () => {},
      stop: () => engineService.stop(),
    };
    const application = createFactoryApplication({ databasePath });
    application.createProject({ name: "Newer state" });
    application.close();
    let prepared = false;
    const server = createFactoryServer({
      backupService: service,
      databasePath,
      onRestorePrepared: () => {
        prepared = true;
      },
      operator: OPERATOR,
      port: 0,
    });
    let cookie = "";
    try {
      cookie = await login(server);
      const restorePromise = api(
        server,
        "backups.restore",
        { backupId: source.id, confirm: true },
        cookie,
      );
      await preparationStaged;
      const duringRestoreWrite = await api(
        server,
        "projects.create",
        { name: "Must be rejected during restore" },
        cookie,
      );
      expect(duringRestoreWrite.response.status).toBe(409);
      releasePreparation();
      const restore = await restorePromise;
      expect(restore.response.status).toBe(200);
      expect(restore.body.result?.data).toMatchObject({
        backupId: source.id,
        status: "restarting",
      });
      expect(prepared).toBe(true);

      const laterWrite = await api(
        server,
        "projects.create",
        { name: "Must be rejected" },
        cookie,
      );
      expect(laterWrite.response.status).toBe(409);
      const secondRestore = await api(
        server,
        "backups.restore",
        { backupId: source.id, confirm: true },
        cookie,
      );
      expect(secondRestore.response.status).toBe(409);
    } finally {
      releasePreparation();
      await server.stop();
    }

    const restarted = createFactoryServer({
      backupDirectory,
      databasePath,
      operator: OPERATOR,
      port: 0,
    });
    try {
      const staleSession = await api(
        restarted,
        "backups.status",
        null,
        cookie,
        "GET",
      );
      expect(staleSession.response.status).toBe(401);
      const restored = createFactoryApplication({ databasePath });
      expect(restored.listProjects().map((project) => project.name)).toEqual([
        "Factory",
      ]);
      restored.close();
    } finally {
      await restarted.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("the default restore handoff acknowledges before beginning restart", async () => {
    const { backupDirectory, databasePath, directory } = fixture();
    const engineService = createBackupService({
      databasePath,
      directory: backupDirectory,
    });
    const source = await engineService.create("manual");
    const service: BackupService = {
      status: engineService.status.bind(engineService),
      list: engineService.list.bind(engineService),
      create: engineService.create.bind(engineService),
      updateSettings: engineService.updateSettings.bind(engineService),
      delete: engineService.delete.bind(engineService),
      prepareRestore: engineService.prepareRestore.bind(engineService),
      // Keep this test focused on the server's default restart handoff. The
      // scheduler is deliberately disabled so it cannot overlap preparation.
      start: async () => {},
      stop: () => engineService.stop(),
    };
    const server = createFactoryServer({
      backupService: service,
      databasePath,
      operator: OPERATOR,
      port: 0,
    });
    try {
      const cookie = await login(server);
      const restore = await api(
        server,
        "backups.restore",
        { backupId: source.id, confirm: true },
        cookie,
      );
      expect(restore.response.status).toBe(200);
      expect(restore.body.result?.data).toMatchObject({
        backupId: source.id,
        status: "restarting",
      });

      let becameNotReady = false;
      const deadline = Date.now() + 500;
      while (Date.now() < deadline) {
        try {
          const readiness = await fetch(new URL("/readyz", server.url));
          if (readiness.status === 503) {
            await readiness.arrayBuffer();
            becameNotReady = true;
            break;
          } else {
            await readiness.arrayBuffer();
          }
        } catch {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(becameNotReady).toBe(true);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
