import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";

const repositoryRoot = join(import.meta.dir, "../..");

async function waitForServer(
  url: URL,
  process: Bun.Subprocess,
): Promise<Response> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(250) });
      if (response.status > 0) return response;
    } catch {
      // The packaged server may still be starting.
    }
    if (process.exitCode !== null) {
      throw new Error(`Packaged server exited with code ${process.exitCode}.`);
    }
    await Bun.sleep(50);
  }
  throw new Error(`Packaged server did not start at ${url}.`);
}

async function freePort(): Promise<number> {
  const probe = Bun.serve({
    fetch: () => new Response("ok"),
    port: 0,
  });
  const port = probe.port;
  if (port === undefined) throw new Error("Failed to allocate a test port.");
  probe.stop(true);
  return port;
}

describe("Mac release packaging", () => {
  test("serves static assets and runs the packaged backup worker outside the checkout", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-release-package-"));
    const stageDirectory = join(directory, "release");
    const cwd = join(directory, "unrelated-cwd");
    const databasePath = join(directory, "factory.sqlite");
    const backupDirectory = join(directory, "backups");
    const operatorSecretPath = join(directory, "operator-secret");
    mkdirSync(stageDirectory);
    mkdirSync(cwd);
    mkdirSync(backupDirectory);
    writeFileSync(operatorSecretPath, "release-test-secret\n", { mode: 0o600 });

    const application = createFactoryApplication({ databasePath });
    application.createProject({ name: "Packaged release" });
    application.close();
    writeFileSync(
      `${databasePath}.backup-settings.json`,
      JSON.stringify({
        enabled: false,
        intervalMinutes: 30,
        keepDaily: 30,
        keepRecent: 336,
      }),
    );

    const build = Bun.spawn([process.execPath, "run", "build:web"], {
      cwd: repositoryRoot,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [buildExitCode, , buildStderr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    expect(buildExitCode, buildStderr).toBe(0);

    const packageProcess = Bun.spawn(
      [
        "bash",
        join(repositoryRoot, "scripts/package-user-service.sh"),
        stageDirectory,
      ],
      { cwd: repositoryRoot, stderr: "pipe", stdout: "pipe" },
    );
    const [packageExitCode, , packageStderr] = await Promise.all([
      packageProcess.exited,
      new Response(packageProcess.stdout).text(),
      new Response(packageProcess.stderr).text(),
    ]);
    expect(packageExitCode, packageStderr).toBe(0);

    const port = await freePort();
    const serverProcess = Bun.spawn(
      [process.execPath, "run", join(stageDirectory, "src/server.js")],
      {
        cwd,
        env: {
          ...Bun.env,
          FACTORY_BACKUP_DIR: backupDirectory,
          FACTORY_BACKUP_REQUIRE_NFS: "false",
          FACTORY_DB: databasePath,
          FACTORY_ENVIRONMENT: "development",
          FACTORY_GITHUB_TOKEN_FILE: "",
          FACTORY_HOST: "127.0.0.1",
          FACTORY_OPERATOR_NAME: "release-test",
          FACTORY_OPERATOR_SECRET_FILE: operatorSecretPath,
          FACTORY_PORT: String(port),
          FACTORY_REQUIRE_EXISTING_DB: "true",
          FACTORY_REVISION: "release-test",
          GITHUB_TOKEN: "",
          GH_TOKEN: "",
          T3_ACCESS_TOKEN: "",
          T3_ACCESS_TOKEN_FILE: "",
          T3_BASE_URL: "",
        },
        stderr: "pipe",
        stdout: "pipe",
      },
    );
    const serverUrl = new URL(`http://127.0.0.1:${port}`);

    try {
      const readiness = await waitForServer(
        new URL("/readyz", serverUrl),
        serverProcess,
      );
      expect(readiness.status).toBe(200);
      expect(await readiness.json()).toMatchObject({
        checks: { database: "ok", staticAssets: "ok" },
        ready: true,
        status: "ready",
      });

      for (const pathname of [
        "/",
        "/main.css",
        "/main.js",
        "/service-worker.js",
      ]) {
        const response = await fetch(new URL(pathname, serverUrl));
        expect(response.status).toBe(200);
        expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
      }

      const login = await fetch(new URL("/session/login", serverUrl), {
        body: JSON.stringify({ secret: "release-test-secret" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toBeDefined();

      const backup = await fetch(new URL("/api/backups.create", serverUrl), {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie!,
          Origin: serverUrl.origin,
        },
        method: "POST",
      });
      const backupBody = await backup.text();
      expect(backup.status, backupBody).toBe(200);
      expect(JSON.parse(backupBody) as unknown).toMatchObject({
        result: {
          data: { integrity: "verified", trigger: "manual" },
        },
      });
      expect(
        readdirSync(backupDirectory).some((entry) => entry.startsWith("b-")),
      ).toBe(true);
    } finally {
      serverProcess.kill();
      await serverProcess.exited;
      await Promise.all([
        new Response(serverProcess.stdout).text(),
        new Response(serverProcess.stderr).text(),
      ]);
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
