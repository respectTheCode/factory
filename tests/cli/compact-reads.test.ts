import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { createFactoryApplication } from "../../src/application";
import { paginateHistory } from "../../src/cli-reads";

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
  const secondTask = setupApp.createTask({
    name: "Second task",
    projectId: project.id,
  });
  const otherProject = setupApp.createProject({ name: "Other project" });
  setupApp.close();
  const app = createFactoryApplication({ databasePath });
  const reports: Array<{ createdAt: string; id: string }> = [];
  for (const reportedState of [
    "in_progress",
    "blocked",
    "in_progress",
    "complete",
  ] as const) {
    const report = app.reportSubtaskStatus({
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
    reports.push({
      createdAt: report.createdAt.toISOString(),
      id: report.id,
    });
  }
  app.verifyStatusReport({
    decision: "accepted",
    reportId: reports[0]!.id,
    verifier: "kevin",
  });
  app.close();
  return {
    databasePath,
    directory,
    otherSubtask,
    otherProject,
    project,
    reports,
    secondTask,
    subtask,
    task,
  };
}

describe("compact bounded CLI reads", () => {
  test("uses report ID as the stable tie breaker for equal timestamps", () => {
    const items = [
      { createdAt: "2026-09-20T22:00:01.000Z", id: "report-b" },
      { createdAt: "2026-09-20T22:00:01.000Z", id: "report-a" },
      { createdAt: "2026-09-20T22:00:01.000Z", id: "report-c" },
    ];
    const first = paginateHistory(items, {
      direction: "forward",
      limit: 2,
      scope: "subtask-history:ST-1",
    });
    const second = paginateHistory(items, {
      cursor: first.nextCursor ?? undefined,
      direction: "forward",
      limit: 2,
      scope: "subtask-history:ST-1",
    });
    expect(first.items.map((item) => item.id)).toEqual([
      "report-a",
      "report-b",
    ]);
    expect(second.items.map((item) => item.id)).toEqual(["report-c"]);
    expect(second.truncated).toBe(false);
  });

  test("pages history with stable timestamp ties and tail cursors", async () => {
    const fixture = await createHistoryFixture();
    try {
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
          verifications: Array<{ reportId: string }>;
        };
      };
      expect(first.exitCode).toBe(0);
      expect(firstPayload.history.reports).toHaveLength(2);
      expect(firstPayload.history.truncated).toBe(true);
      expect(firstPayload.history.nextCursor).toEqual(expect.any(String));
      expect(first.stderr).toContain("output truncated");
      expect(
        firstPayload.history.verifications.every((verification) =>
          firstPayload.history.reports.some(
            (report) => report.id === verification.reportId,
          ),
        ),
      ).toBe(true);

      const allHistory = await runCli([...base.slice(0, 4), ...base.slice(4)]);
      const allHistoryPayload = JSON.parse(allHistory.stdout) as {
        history: {
          reports: Array<{ id: string }>;
          verifications: Array<{ reportId: string }>;
        };
      };
      expect(allHistoryPayload.history.verifications).toEqual([
        expect.objectContaining({ reportId: fixture.reports[0]!.id }),
      ]);

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

      const since = await runCli([
        ...base.slice(0, 4),
        "--since",
        new Date(Date.now() - 60_000).toISOString(),
        "--limit",
        "2",
        ...base.slice(4),
      ]);
      const sincePayload = JSON.parse(since.stdout) as {
        history: { reports: Array<{ id: string }>; truncated: boolean };
      };
      expect(since.exitCode).toBe(0);
      expect(sincePayload.history.reports).toHaveLength(2);
      expect(sincePayload.history.truncated).toBe(true);

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

      const tailContinuation = await runCli([
        ...base.slice(0, 4),
        "--tail",
        "2",
        "--cursor",
        tailPayload.history.nextCursor,
        ...base.slice(4),
      ]);
      const tailContinuationPayload = JSON.parse(tailContinuation.stdout) as {
        history: { reports: Array<{ id: string }> };
      };
      expect(tailContinuation.exitCode).toBe(0);
      expect(tailContinuationPayload.history.reports).toHaveLength(2);
      expect(
        tailContinuationPayload.history.reports.map((report) => report.id),
      ).not.toEqual(
        expect.arrayContaining(
          tailPayload.history.reports.map((report) => report.id),
        ),
      );

      const empty = await runCli([
        ...base.slice(0, 2),
        "--subtask-id",
        fixture.otherSubtask.simpleId!,
        "--limit",
        "2",
        ...base.slice(4),
      ]);
      expect(JSON.parse(empty.stdout).history).toMatchObject({
        nextCursor: null,
        reportCount: 0,
        reports: [],
        truncated: false,
      });

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
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });

  test("announces truncation on each primary bounded list route", async () => {
    const fixture = await createHistoryFixture();
    try {
      const checks: Array<{
        args: string[];
        get: (payload: Record<string, any>) => Record<string, unknown>;
      }> = [
        {
          args: ["project", "list"],
          get: (payload) => payload,
        },
        {
          args: ["project", "context", "--workspace-root", fixture.directory],
          get: (payload) => payload.context,
        },
        {
          args: ["project", "portfolio"],
          get: (payload) => payload.portfolio,
        },
        {
          args: ["project", "attention"],
          get: (payload) => payload,
        },
        {
          args: ["task", "status", "--task-id", fixture.task.simpleId!],
          get: (payload) => payload.status,
        },
        {
          args: ["subtask", "status", "--task-id", fixture.task.simpleId!],
          get: (payload) => payload.status,
        },
      ];
      for (const check of checks) {
        const result = await runCli([
          ...check.args,
          "--limit",
          "1",
          "--json",
          "--database",
          fixture.databasePath,
        ]);
        const payload = JSON.parse(result.stdout) as Record<string, any>;
        const read = check.get(payload);
        expect(result.exitCode).toBe(0);
        expect(read.truncated).toBe(true);
        expect(read.nextCursor).toEqual(expect.any(String));
        expect(result.stderr).toContain("output truncated");
      }

      const firstCredential = await runCli([
        "credential",
        "create",
        "--machine-id",
        "compact-machine-1",
        "--project-ids",
        fixture.project.id,
        "--database",
        fixture.databasePath,
      ]);
      const secondCredential = await runCli([
        "credential",
        "create",
        "--machine-id",
        "compact-machine-2",
        "--project-ids",
        fixture.otherProject.id,
        "--database",
        fixture.databasePath,
      ]);
      expect(firstCredential.exitCode).toBe(0);
      expect(secondCredential.exitCode).toBe(0);
      const credentialList = await runCli([
        "credential",
        "list",
        "--limit",
        "1",
        "--json",
        "--database",
        fixture.databasePath,
      ]);
      const credentialPayload = JSON.parse(credentialList.stdout) as {
        nextCursor: string;
        truncated: boolean;
      };
      expect(credentialList.exitCode).toBe(0);
      expect(credentialPayload.truncated).toBe(true);
      expect(credentialPayload.nextCursor).toEqual(expect.any(String));
      expect(credentialList.stderr).toContain("output truncated");
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });

  test("keeps compact identity, state, reasons, and counts", async () => {
    const fixture = await createHistoryFixture();
    try {
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
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });
});
