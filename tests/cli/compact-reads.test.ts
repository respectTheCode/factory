import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createFactoryApplication } from "../../src/application";

async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, "../.."),
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

async function createHistoryFixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-cli-compact-"));
  const databasePath = join(directory, "factory.sqlite");
  const setupApp = createFactoryApplication({ databasePath });
  const project = setupApp.createProject({
    name: "Compact reads",
    workspaceRoot: directory,
  });
  const task = setupApp.createTask({
    name: "Read task",
    objective: "A long objective that summary mode must omit.",
    acceptanceCriteria: ["One", "Two"],
    dependencies: ["Dependency"],
    projectId: project.id,
    repositoryLinks: ["https://example.test/repository"],
  });
  const subtask = setupApp.createSubtask({
    description: "A long subtask description that compact context omits.",
    name: "Read history",
    taskId: task.id,
  });
  const otherSubtask = setupApp.createSubtask({
    name: "Other history",
    taskId: task.id,
  });
  setupApp.close();
  const app = createFactoryApplication({ databasePath });
  for (const reportedState of [
    "in_progress",
    "blocked",
    "in_progress",
    "complete",
  ] as const) {
    app.reportSubtaskStatus({
      evidence: `Evidence ${reportedState}`,
      ...(reportedState === "complete"
        ? { reason: "Review this complete report." }
        : reportedState === "blocked"
          ? { reason: "Review this blocked report." }
          : {}),
      reportedState,
      reporter: "codex",
      subtaskId: subtask.id,
    });
  }
  app.close();
  const database = new Database(databasePath);
  const row = database
    .query("SELECT state FROM factory_state WHERE id = 1")
    .get() as { state: string };
  const state = JSON.parse(row.state) as {
    statusReports: Array<{ createdAt: string }>;
  };
  for (const report of state.statusReports) {
    report.createdAt = "2026-09-20T22:00:01.000Z";
  }
  database
    .query("UPDATE factory_state SET state = $state WHERE id = 1")
    .run({ $state: JSON.stringify(state) });
  database.close();
  return { databasePath, directory, otherSubtask, project, subtask, task };
}

describe("compact bounded CLI reads", () => {
  test("pages history with stable timestamp ties and tail cursors", async () => {
    const fixture = await createHistoryFixture();
    const base = [
      "subtask",
      "history",
      "--subtask-id",
      fixture.subtask.simpleId!,
      "--json",
      "--database",
      fixture.databasePath,
    ];

    const first = await runCli([
      ...base.slice(0, 4),
      "--limit",
      "2",
      ...base.slice(4),
    ]);
    const firstPayload = JSON.parse(first.stdout) as {
      history: {
        nextCursor: string;
        reports: Array<{ id: string }>;
        truncated: boolean;
      };
    };
    expect(first.exitCode).toBe(0);
    expect(firstPayload.history.reports).toHaveLength(2);
    expect(firstPayload.history.truncated).toBe(true);
    expect(firstPayload.history.nextCursor).toEqual(expect.any(String));
    expect(first.stderr).toContain("output truncated");

    const second = await runCli([
      ...base.slice(0, 4),
      "--limit",
      "2",
      "--cursor",
      firstPayload.history.nextCursor,
      ...base.slice(4),
    ]);
    const secondPayload = JSON.parse(second.stdout) as {
      history: {
        nextCursor: null;
        reports: Array<{ id: string }>;
        truncated: boolean;
      };
    };
    expect(second.exitCode).toBe(0);
    expect(secondPayload.history.reports).toHaveLength(2);
    expect(secondPayload.history.truncated).toBe(false);
    expect(secondPayload.history.nextCursor).toBeNull();
    expect(
      secondPayload.history.reports.map((report) => report.id),
    ).not.toEqual(
      expect.arrayContaining(
        firstPayload.history.reports.map((report) => report.id),
      ),
    );

    const tail = await runCli([
      ...base.slice(0, 4),
      "--tail",
      "2",
      ...base.slice(4),
    ]);
    const tailPayload = JSON.parse(tail.stdout) as {
      history: { nextCursor: string; reports: Array<{ id: string }> };
    };
    expect(tail.exitCode).toBe(0);
    expect(tailPayload.history.reports).toHaveLength(2);
    expect(tailPayload.history.nextCursor).toEqual(expect.any(String));

    const wrongTarget = await runCli([
      ...base.slice(0, 2),
      "--subtask-id",
      fixture.otherSubtask.simpleId!,
      ...base.slice(4),
      "--cursor",
      firstPayload.history.nextCursor,
    ]);
    expect(wrongTarget.exitCode).toBe(1);
    expect(wrongTarget.stderr).toContain("not valid for this history read");
  });

  test("keeps compact identity, state, reasons, and counts", async () => {
    const fixture = await createHistoryFixture();
    const summary = await runCli([
      "task",
      "detail",
      "--task-id",
      fixture.task.simpleId!,
      "--summary",
      "--json",
      "--database",
      fixture.databasePath,
    ]);
    const summaryTask = JSON.parse(summary.stdout).task as Record<
      string,
      unknown
    >;
    expect(summary.exitCode).toBe(0);
    expect(summaryTask).toMatchObject({
      acceptanceCriteriaCount: 2,
      dependencyCount: 1,
      id: fixture.task.id,
      name: "Read task",
      projectId: fixture.project.id,
      repositoryLinkCount: 1,
    });
    expect(summaryTask).not.toHaveProperty("objective");
    expect(summaryTask).not.toHaveProperty("acceptanceCriteria");
    expect(summaryTask).not.toHaveProperty("dependencies");

    const compact = await runCli([
      "project",
      "context",
      "--workspace-root",
      fixture.directory,
      "--compact",
      "--json",
      "--database",
      fixture.databasePath,
    ]);
    const compactTask = JSON.parse(compact.stdout).context.tasks[0] as Record<
      string,
      unknown
    >;
    expect(compact.exitCode).toBe(0);
    expect(compactTask).toMatchObject({
      acceptanceCriteriaCount: 2,
      id: fixture.task.id,
      subtaskCount: 2,
    });
    expect(compactTask).not.toHaveProperty("objective");
    expect(compactTask).not.toHaveProperty("acceptanceCriteria");
    expect(
      (compactTask.subtasks as Array<Record<string, unknown>>)[0],
    ).not.toHaveProperty("description");
  });
});
