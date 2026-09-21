import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";
import type { T3ActivityReader } from "../../src/t3";

async function runCli(
  args: string[],
  environment: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, "../.."),
    env: {
      ...Bun.env,
      FACTORY_URL: "",
      FACTORY_ACCESS_TOKEN_FILE: "",
      ...environment,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

function port(): number {
  return 20_000 + (process.pid % 1_000) + Math.floor(Math.random() * 500);
}

describe("remote Factory CLI", () => {
  test("matches local reads, attributes reports, and renders a remote brief", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-remote-cli-"));
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "access-token");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({
      name: "Remote Factory",
      t3Mappings: [{ sourceId: "legacy", workspaceRoot: directory }],
      workspaceRoot: directory,
    });
    const task = app.createTask({
      branchName: "remote-cli",
      name: "Remote task",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Remote report",
      taskId: task.id,
    });
    const t3Reader: T3ActivityReader = {
      readShell: async () => ({
        error: "fixture unavailable",
        fetchedAt: new Date().toISOString(),
        ok: false,
        status: "unavailable",
      }),
      readThread: async () => ({
        error: "fixture unavailable",
        fetchedAt: new Date().toISOString(),
        ok: false,
        status: "unavailable",
      }),
    };
    const server = createFactoryServer({
      databasePath,
      hostname: "127.0.0.1",
      operator: { name: "operator", secret: "operator-secret" },
      port: port(),
      t3Sources: [
        {
          accessTokenFile: "/tmp/legacy-token",
          baseUrl: "http://127.0.0.1:3773",
          machineId: "mac-mini-remote",
          reader: t3Reader,
          sourceId: "legacy",
        },
      ],
    });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "mac-mini-remote",
      projectIds: [project.id],
    });
    writeFileSync(tokenPath, `${credential.token}\n`, { mode: 0o600 });
    const remoteEnvironment = {
      FACTORY_ACCESS_TOKEN_FILE: tokenPath,
      FACTORY_URL: server.url.toString().replace(/\/$/, ""),
    };

    try {
      const remoteDetail = await runCli(
        ["task", "detail", "--task-id", task.simpleId!, "--summary", "--json"],
        remoteEnvironment,
      );
      expect(remoteDetail.exitCode).toBe(0);
      expect(JSON.parse(remoteDetail.stdout).task).toMatchObject({
        id: task.id,
        simpleId: task.simpleId,
        acceptanceCriteriaCount: 0,
      });
      expect(JSON.parse(remoteDetail.stdout).task).not.toHaveProperty(
        "objective",
      );

      const remoteContext = await runCli(
        [
          "project",
          "context",
          "--workspace-root",
          directory,
          "--compact",
          "--json",
        ],
        remoteEnvironment,
      );
      expect(remoteContext.exitCode).toBe(0);
      expect(JSON.parse(remoteContext.stdout)).toMatchObject({
        context: {
          t3Mappings: [{ sourceId: "legacy", workspaceRoot: directory }],
          tasks: [
            {
              id: task.id,
              subtaskCount: 1,
            },
          ],
        },
      });

      const report = await runCli(
        [
          "subtask",
          "report",
          "--subtask-id",
          subtask.simpleId!,
          "--state",
          "in_progress",
          "--reporter",
          "codex",
          "--evidence",
          "Remote evidence",
          "--session-thread-id",
          "thread-remote",
          "--json",
        ],
        remoteEnvironment,
      );
      expect(report.exitCode).toBe(0);
      expect(JSON.parse(report.stdout)).toMatchObject({
        schemaVersion: 1,
        report: {
          machineId: "mac-mini-remote",
          sessionRef: { externalThreadId: "thread-remote", provider: "t3" },
        },
      });

      const reportPayload = JSON.parse(report.stdout) as {
        report: { createdAt: string };
      };
      const history = await runCli(
        [
          "subtask",
          "history",
          "--subtask-id",
          subtask.simpleId!,
          "--tail",
          "1",
          "--since",
          new Date(
            new Date(reportPayload.report.createdAt).getTime() - 1,
          ).toISOString(),
          "--json",
        ],
        remoteEnvironment,
      );
      expect(history.exitCode).not.toBe(0);
      expect(history.stderr).toContain("either --tail or --since");
      const remoteHistory = await runCli(
        [
          "subtask",
          "history",
          "--subtask-id",
          subtask.simpleId!,
          "--tail",
          "1",
          "--json",
        ],
        remoteEnvironment,
      );
      expect(JSON.parse(remoteHistory.stdout).history.reports).toHaveLength(1);

      const doctor = await runCli(["doctor", "--json"], remoteEnvironment);
      expect(doctor.exitCode).toBe(0);
      expect(JSON.parse(doctor.stdout)).toMatchObject({
        doctor: {
          apiCompatibility: { compatible: true, expected: 1, actual: 1 },
          identity: {
            machine: { machineId: "mac-mini-remote", projectIds: [project.id] },
          },
          mode: "remote",
          server: { apiVersion: 1 },
          ok: true,
        },
        schemaVersion: 1,
      });

      const brief = await runCli(
        [
          "project",
          "brief",
          "--workspace-root",
          directory,
          "--branch-name",
          "remote-cli",
          "--json",
        ],
        remoteEnvironment,
      );
      expect(brief.exitCode).toBe(0);
      const markdown = JSON.parse(brief.stdout).brief.markdown as string;
      expect(markdown).toContain(
        `export FACTORY_URL='${remoteEnvironment.FACTORY_URL}'`,
      );
      expect(markdown).toContain(
        `export FACTORY_ACCESS_TOKEN_FILE='${tokenPath}'`,
      );
      expect(markdown).not.toContain("--database");
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("fails closed for scope, credentials, ambiguity, and public HTTP", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-remote-cli-failure-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "access-token");
    const app = createFactoryApplication({ databasePath });
    const inside = app.createProject({ name: "Inside" });
    const outside = app.createProject({ name: "Outside" });
    const insideTask = app.createTask({
      name: "Inside task",
      projectId: inside.id,
    });
    const outsideTask = app.createTask({
      name: "Outside task",
      projectId: outside.id,
    });
    const outsideSubtask = app.createSubtask({
      name: "Outside subtask",
      taskId: outsideTask.id,
    });
    const server = createFactoryServer({
      databasePath,
      hostname: "127.0.0.1",
      port: port(),
    });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "mac-mini-failure",
      projectIds: [inside.id],
    });
    writeFileSync(tokenPath, credential.token);
    const remoteEnvironment = {
      FACTORY_ACCESS_TOKEN_FILE: tokenPath,
      FACTORY_URL: server.url.toString().replace(/\/$/, ""),
    };

    try {
      const forbidden = await runCli(
        [
          "subtask",
          "report",
          "--subtask-id",
          outsideSubtask.simpleId!,
          "--state",
          "in_progress",
          "--reporter",
          "codex",
        ],
        remoteEnvironment,
      );
      expect(forbidden.exitCode).not.toBe(0);
      expect(forbidden.stderr).toContain("not scoped to this Project");

      writeFileSync(tokenPath, "fmc_revoked");
      const rejected = await runCli(
        ["project", "list", "--json"],
        remoteEnvironment,
      );
      expect(rejected.exitCode).not.toBe(0);
      expect(rejected.stderr.trim()).toBe(
        "Factory credential rejected (revoked or wrong token).",
      );

      const ambiguous = await runCli(
        [
          "task",
          "detail",
          "--task-id",
          insideTask.id,
          "--database",
          databasePath,
        ],
        remoteEnvironment,
      );
      expect(ambiguous.exitCode).not.toBe(0);
      expect(ambiguous.stderr).toContain("Ambiguous Factory mode");

      writeFileSync(tokenPath, credential.token);
      const publicHttp = await runCli(["project", "list", "--json"], {
        FACTORY_ACCESS_TOKEN_FILE: tokenPath,
        FACTORY_URL: "http://factory.example.com:3000",
      });
      expect(publicHttp.exitCode).not.toBe(0);
      expect(publicHttp.stderr).toContain("machine tokens travel in the clear");

      const missingToken = await runCli(["project", "list", "--json"], {
        FACTORY_URL: remoteEnvironment.FACTORY_URL,
        FACTORY_ACCESS_TOKEN_FILE: join(directory, "missing-token"),
      });
      expect(missingToken.exitCode).not.toBe(0);
      expect(missingToken.stderr).toContain("FACTORY_ACCESS_TOKEN_FILE");
    } finally {
      store.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("credential create, list, and revoke are local-only", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-credential-cli-"));
    const databasePath = join(directory, "factory.sqlite");
    try {
      const created = await runCli([
        "credential",
        "create",
        "--machine-id",
        "mac-mini-admin",
        "--project-ids",
        "project-a|project-b",
        "--database",
        databasePath,
        "--json",
      ]);
      expect(created.exitCode).toBe(0);
      const token = JSON.parse(created.stdout).credential.token as string;
      expect(token).toMatch(/^fmc_/);

      const listed = await runCli([
        "credential",
        "list",
        "--database",
        databasePath,
        "--json",
      ]);
      expect(JSON.parse(listed.stdout)).toMatchObject({
        credentials: [
          {
            machineId: "mac-mini-admin",
            projectIds: ["project-a", "project-b"],
          },
        ],
      });
      expect(listed.stdout).not.toContain(token);
      expect(listed.stdout).not.toContain("tokenHash");

      const revoked = await runCli([
        "credential",
        "revoke",
        "--machine-id",
        "mac-mini-admin",
        "--database",
        databasePath,
        "--json",
      ]);
      expect(JSON.parse(revoked.stdout)).toEqual({
        schemaVersion: 1,
        revoked: { machineId: "mac-mini-admin" },
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
