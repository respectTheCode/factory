import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";

function runPilotCheck(args: string[]) {
  return Bun.spawn(
    [process.execPath, "run", "scripts/check-multi-machine-pilot.ts", ...args],
    {
      cwd: join(import.meta.dir, "../.."),
      env: Bun.env,
      stderr: "pipe",
      stdout: "pipe",
    },
  );
}

async function collect(child: ReturnType<typeof runPilotCheck>) {
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

describe("ST-164 multi-machine pilot harness", () => {
  test("reports from two scoped machines, proves denial and reuses durable markers", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-st164-check-"));
    const databasePath = join(directory, "factory.sqlite");
    const tokenAPath = join(directory, "machine-a.token");
    const tokenBPath = join(directory, "machine-b.token");
    const revokedTokenPath = join(directory, "disposable-revoked.token");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "ST-164 pilot" });
    const task = app.createTask({ name: "Pilot task", projectId: project.id });
    const subtask = app.createSubtask({
      name: "Pilot subtask",
      taskId: task.id,
    });
    app.close();

    const credentials = createMachineCredentialStore({ databasePath });
    const machineA = credentials.create({
      machineId: "pilot-machine-a",
      projectIds: [project.id],
    });
    const machineB = credentials.create({
      machineId: "pilot-machine-b",
      projectIds: [project.id],
    });
    const disposable = credentials.create({
      machineId: "pilot-disposable",
      projectIds: [project.id],
    });
    writeFileSync(tokenAPath, `${machineA.token}\n`, { mode: 0o600 });
    writeFileSync(tokenBPath, `${machineB.token}\n`, { mode: 0o600 });
    writeFileSync(revokedTokenPath, `${disposable.token}\n`, { mode: 0o600 });
    credentials.revoke("pilot-disposable");
    credentials.close();

    const server = createFactoryServer({
      databasePath,
      environment: "pilot",
      hostname: "127.0.0.1",
      port: 0,
      revision: "st164-test",
    });
    const baseArgs = [
      "--factory-url",
      server.url.toString().replace(/\/$/, ""),
      "--project-id",
      project.id,
      "--task-id",
      task.id,
      "--subtask-id",
      subtask.id,
      "--machine-a-token-file",
      tokenAPath,
      "--machine-b-token-file",
      tokenBPath,
      "--machine-a-id",
      "pilot-machine-a",
      "--machine-b-id",
      "pilot-machine-b",
      "--request-key-prefix",
      "st164-test-marker",
      "--revoked-token-file",
      revokedTokenPath,
      "--revoked-machine-id",
      "pilot-disposable",
    ];
    try {
      const first = await collect(runPilotCheck(baseArgs));
      expect(first.exitCode).toBe(0);
      const firstSummary = JSON.parse(first.stdout) as {
        checks: Record<string, string>;
        idempotency: Record<string, string>;
        reportIds: string[];
      };
      expect(firstSummary.checks).toMatchObject({
        machineBackup: "denied",
        machineVerification: "denied",
        reports: "durable",
        revokedCredential: "denied",
        websocketReconnect: "ok",
      });
      expect(firstSummary.idempotency).toMatchObject({
        concurrentRetries: "same-id",
        machineA: "created",
        machineB: "created",
      });
      expect(firstSummary.reportIds).toHaveLength(2);
      expect(first.stdout).not.toContain(machineA.token);
      expect(first.stdout).not.toContain(machineB.token);

      const second = await collect(runPilotCheck(baseArgs));
      expect(second.exitCode).toBe(0);
      const secondSummary = JSON.parse(second.stdout) as {
        idempotency: Record<string, string>;
        reportIds: string[];
      };
      expect(secondSummary.idempotency).toMatchObject({
        machineA: "reused",
        machineB: "reused",
      });
      expect(secondSummary.reportIds).toEqual(firstSummary.reportIds);
      const verificationApp = createFactoryApplication({ databasePath });
      try {
        const history = verificationApp.getSubtaskReportHistory(subtask.id);
        expect(
          history.filter((report) =>
            report.evidence?.startsWith("ST-164 pilot synthetic report"),
          ),
        ).toHaveLength(2);
      } finally {
        verificationApp.close();
      }
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("checks the unauthenticated version guard before using machine tokens", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-st164-guard-"));
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "machine.token");
    const unusedTokenPath = join(directory, "unused-machine.token");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "ST-164 guard" });
    const task = app.createTask({ name: "Guard task", projectId: project.id });
    const subtask = app.createSubtask({
      name: "Guard subtask",
      taskId: task.id,
    });
    app.close();
    const credentials = createMachineCredentialStore({ databasePath });
    const credential = credentials.create({
      machineId: "pilot-guard",
      projectIds: [project.id],
    });
    writeFileSync(tokenPath, credential.token, { mode: 0o600 });
    credentials.close();
    const server = createFactoryServer({
      databasePath,
      environment: "development",
      hostname: "127.0.0.1",
      port: 0,
    });
    try {
      const result = await collect(
        runPilotCheck([
          "--factory-url",
          server.url.toString().replace(/\/$/, ""),
          "--project-id",
          project.id,
          "--task-id",
          task.id,
          "--subtask-id",
          subtask.id,
          "--machine-a-token-file",
          tokenPath,
          "--machine-b-token-file",
          unusedTokenPath,
        ]),
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Refusing to run");
      expect(result.stderr).toContain("not pilot");
      expect(result.stderr).not.toContain(credential.token);
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
