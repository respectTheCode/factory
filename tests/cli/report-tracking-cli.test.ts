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
      FACTORY_ACCESS_TOKEN_FILE: "",
      FACTORY_URL: "",
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

function unavailableReader(): T3ActivityReader {
  return {
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
}

describe("report tracking CLI", () => {
  test("records validated handoff and artifact flags in the local database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-report-cli-local-"));
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Local report tracking" });
    const task = app.createTask({ name: "Local task", projectId: project.id });
    const first = app.createSubtask({ name: "First", taskId: task.id });
    const second = app.createSubtask({ name: "Second", taskId: task.id });

    try {
      const artifact = {
        kind: "test",
        label: "Focused test run",
        testedRevision: "abcdef1234567",
        url: "https://ci.example.test/runs/42",
      };
      const report = await runCli([
        "subtask",
        "report",
        "--database",
        databasePath,
        "--subtask-id",
        first.simpleId!,
        "--state",
        "in_progress",
        "--reporter",
        "codex",
        "--evidence",
        "Current proof",
        "--next-owner",
        "Release engineer",
        "--next-owner-kind",
        "human",
        "--next-action",
        "Review the CI run.",
        "--dependency",
        "Check the current preview.",
        "--waiting-on-subtask-ids",
        `${second.simpleId}|${second.id}|${second.simpleId}`,
        "--tested-revision",
        "ABCDEF1234567",
        "--artifacts-json",
        JSON.stringify([artifact]),
        "--json",
      ]);
      expect(report.exitCode).toBe(0);
      expect(JSON.parse(report.stdout).report).toMatchObject({
        artifacts: [artifact],
        handoff: {
          dependency: "Check the current preview.",
          nextAction: "Review the CI run.",
          nextOwner: "Release engineer",
          nextOwnerKind: "human",
          waitingOnSubtaskIds: [second.id],
        },
        testedRevision: "abcdef1234567",
      });
      expect(app.getTaskStatus(task.id).subtasks[0]).toMatchObject({
        handoff: { waitingOnSubtaskIds: [second.id] },
        reportEvidence: "Current proof",
        testedRevision: "abcdef1234567",
      });

      const incompleteHandoff = await runCli([
        "subtask",
        "report",
        "--database",
        databasePath,
        "--subtask-id",
        second.simpleId!,
        "--state",
        "in_progress",
        "--reporter",
        "codex",
        "--next-owner",
        "Human",
      ]);
      expect(incompleteHandoff.exitCode).not.toBe(0);
      expect(incompleteHandoff.stderr).toContain("require --next-owner");

      const malformedArtifacts = await runCli([
        "subtask",
        "report",
        "--database",
        databasePath,
        "--subtask-id",
        second.simpleId!,
        "--state",
        "in_progress",
        "--reporter",
        "codex",
        "--artifacts-json",
        "{malformed",
      ]);
      expect(malformedArtifacts.exitCode).not.toBe(0);
      expect(malformedArtifacts.stderr).toContain(
        "--artifacts-json must contain a JSON array",
      );
      expect(app.getSubtaskReportHistory(second.id)).toEqual([]);
      expect(app.getSubtaskDetail(second.id)).not.toHaveProperty("evidence");
    } finally {
      app.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("serializes report tracking fields through the remote Factory client", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-report-cli-remote-"));
    const databasePath = join(directory, "factory.sqlite");
    const tokenPath = join(directory, "access-token");
    const app = createFactoryApplication({ databasePath });
    const project = app.createProject({ name: "Remote report tracking" });
    const task = app.createTask({ name: "Remote task", projectId: project.id });
    const subtask = app.createSubtask({
      name: "Remote report",
      taskId: task.id,
    });
    const server = createFactoryServer({
      databasePath,
      hostname: "127.0.0.1",
      operator: { name: "operator", secret: "operator-secret" },
      port: 0,
      t3Sources: [
        {
          accessTokenFile: "/tmp/report-tracking-token",
          baseUrl: "http://127.0.0.1:3773",
          machineId: "report-tracking-agent",
          reader: unavailableReader(),
          sourceId: "legacy",
        },
      ],
    });
    const store = createMachineCredentialStore({ databasePath });
    const credential = store.create({
      machineId: "report-tracking-agent",
      projectIds: [project.id],
    });
    writeFileSync(tokenPath, `${credential.token}\n`, { mode: 0o600 });

    try {
      const result = await runCli(
        [
          "subtask",
          "report",
          "--subtask-id",
          subtask.simpleId!,
          "--state",
          "in_progress",
          "--reporter",
          "codex",
          "--next-owner",
          "Codex",
          "--next-owner-kind",
          "agent",
          "--next-action",
          "Finish the remote implementation.",
          "--tested-revision",
          "abcdef1234567",
          "--artifacts-json",
          JSON.stringify([
            {
              kind: "review",
              label: "Remote review",
              url: "https://review.example.test/42",
            },
          ]),
          "--json",
        ],
        {
          FACTORY_ACCESS_TOKEN_FILE: tokenPath,
          FACTORY_URL: server.url.toString().replace(/\/$/, ""),
        },
      );
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).report).toMatchObject({
        artifacts: [
          {
            kind: "review",
            label: "Remote review",
            url: "https://review.example.test/42",
          },
        ],
        handoff: {
          nextAction: "Finish the remote implementation.",
          nextOwner: "Codex",
          nextOwnerKind: "agent",
        },
        machineId: "report-tracking-agent",
        testedRevision: "abcdef1234567",
      });
      expect(app.getSubtaskReportHistory(subtask.id)[0]).toMatchObject({
        handoff: { nextOwner: "Codex" },
        testedRevision: "abcdef1234567",
      });
    } finally {
      store.close();
      app.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
