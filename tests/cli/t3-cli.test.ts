import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

async function runCli(
  args: string[],
  environment: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, "../.."),
    env: { ...Bun.env, ...environment },
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

function shellPayload() {
  return {
    projects: [
      {
        createdAt: "2026-09-02T12:00:00.000Z",
        id: "t3-project-factory",
        repositoryIdentity: {
          canonicalKey: "github.com/app-press/factory",
          locator: {
            remoteName: "origin",
            remoteUrl: "git@github.com:app-press/factory.git",
            source: "git-remote",
          },
        },
        title: "Factory",
        updatedAt: "2026-09-02T12:01:00.000Z",
        workspaceRoot: "/work/factory",
      },
    ],
    snapshotSequence: 7,
    threads: [
      {
        branch: "feature/t3-cli",
        createdAt: "2026-09-02T12:00:00.000Z",
        hasActionableProposedPlan: false,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        id: "t3-thread-cli",
        latestTurn: {
          completedAt: null,
          requestedAt: "2026-09-02T12:00:00.000Z",
          startedAt: "2026-09-02T12:00:01.000Z",
          state: "running",
          turnId: "turn-cli",
        },
        latestUserMessageAt: "2026-09-02T12:00:00.000Z",
        linkedPullRequest: null,
        projectId: "t3-project-factory",
        session: {
          activeTurnId: "turn-cli",
          providerName: "codex",
          status: "running",
          updatedAt: "2026-09-02T12:00:01.000Z",
        },
        title: "CLI T3 thread",
        updatedAt: "2026-09-02T12:00:01.000Z",
        worktreePath: "/work/factory",
      },
    ],
    updatedAt: "2026-09-02T12:01:00.000Z",
  };
}

function detailPayload() {
  const shell = shellPayload();
  return {
    snapshotSequence: 8,
    thread: {
      ...shell.threads[0],
      activities: [],
      checkpoints: [],
      messages: [
        {
          createdAt: "2026-09-02T12:02:00.000Z",
          id: "message-cli",
          role: "user",
          streaming: false,
          text: "must not be returned",
          turnId: "turn-cli",
          updatedAt: "2026-09-02T12:02:00.000Z",
        },
      ],
    },
  };
}

describe("T3 CLI integration", () => {
  test("reads, links, and unlinks through the bounded server adapter", async () => {
    const requests: Array<{
      authorization: string | null;
      method: string;
      path: string;
    }> = [];
    let duplicateRunningThread = false;
    const t3Server = Bun.serve({
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          method: request.method,
          path: url.pathname,
        });
        if (url.pathname === "/.well-known/t3/environment") {
          return Response.json({ serverVersion: "0.0.38" });
        }
        if (url.pathname === "/api/orchestration/shell") {
          const payload = shellPayload();
          if (duplicateRunningThread) {
            payload.threads.push({
              ...payload.threads[0]!,
              id: "t3-thread-cli-duplicate",
              title: "Duplicate running CLI thread",
            });
          }
          return Response.json(payload);
        }
        if (url.pathname === "/api/orchestration/threads/t3-thread-cli") {
          return Response.json(detailPayload());
        }
        return new Response("not found", { status: 404 });
      },
      port: 0,
    });
    const directory = mkdtempSync(join(tmpdir(), "software-factory-t3-cli-"));
    const database = join(directory, "factory.sqlite");
    const tokenFile = join(directory, "t3-read-token");
    writeFileSync(tokenFile, "fixture-cli-token\n", { mode: 0o600 });
    const environment = {
      T3_ACCESS_TOKEN_FILE: tokenFile,
      T3_BASE_URL: t3Server.url.toString(),
    };

    try {
      const created = await runCli(
        [
          "project",
          "create",
          "--name",
          "Factory",
          "--t3-project-id",
          "t3-project-factory",
          "--workspace-root",
          "/work/factory",
          "--database",
          database,
        ],
        environment,
      );
      expect(created.exitCode).toBe(0);
      const project = JSON.parse(created.stdout) as { project: { id: string } };

      const status = await runCli(
        [
          "project",
          "t3-status",
          "--project-id",
          project.project.id,
          "--json",
          "--database",
          database,
        ],
        environment,
      );
      expect(status.exitCode).toBe(0);
      expect(status.stdout).not.toContain("fixture-cli-token");
      expect(JSON.parse(status.stdout)).toMatchObject({
        schemaVersion: 1,
        status: { status: "ok", counts: { running: 1 } },
      });

      const detail = await runCli(
        [
          "session",
          "detail",
          "--thread-id",
          "t3-thread-cli",
          "--json",
          "--database",
          database,
        ],
        environment,
      );
      expect(detail.exitCode).toBe(0);
      expect(detail.stdout).not.toContain("must not be returned");
      expect(JSON.parse(detail.stdout)).toMatchObject({
        schemaVersion: 1,
        session: { status: "ok", threadId: "t3-thread-cli" },
      });

      const task = await runCli(
        [
          "task",
          "create",
          "--name",
          "CLI integration",
          "--project-id",
          project.project.id,
          "--branch-name",
          "feature/t3-cli",
          "--database",
          database,
        ],
        environment,
      );
      const taskId = (JSON.parse(task.stdout) as { task: { id: string } }).task
        .id;
      const autoLinked = await runCli(
        [
          "session",
          "auto-link",
          "--project-id",
          project.project.id,
          "--task-id",
          taskId,
          "--branch-name",
          "feature/t3-cli",
          "--json",
          "--database",
          database,
        ],
        environment,
      );
      expect(autoLinked.exitCode).toBe(0);
      const autoLinkResult = JSON.parse(autoLinked.stdout) as {
        link: { associationId: string };
      };
      expect(autoLinkResult).toMatchObject({
        link: {
          candidateThreadIds: ["t3-thread-cli"],
          status: "linked",
          threadId: "t3-thread-cli",
        },
      });

      const secondTask = await runCli(
        [
          "task",
          "create",
          "--name",
          "Second CLI task",
          "--project-id",
          project.project.id,
          "--database",
          database,
        ],
        environment,
      );
      const secondTaskId = (
        JSON.parse(secondTask.stdout) as { task: { id: string } }
      ).task.id;
      const linked = await runCli(
        [
          "session",
          "link",
          "--thread-id",
          "t3-thread-cli",
          "--project-id",
          project.project.id,
          "--task-id",
          secondTaskId,
          "--json",
          "--database",
          database,
        ],
        environment,
      );
      expect(linked.exitCode).toBe(0);
      expect(JSON.parse(linked.stdout)).toMatchObject({
        link: { association: { taskId: secondTaskId } },
      });

      const unlinked = await runCli(
        [
          "session",
          "unlink",
          "--thread-id",
          "t3-thread-cli",
          "--association-id",
          autoLinkResult.link.associationId,
          "--json",
          "--database",
          database,
        ],
        environment,
      );
      expect(unlinked.exitCode).toBe(0);
      expect(JSON.parse(unlinked.stdout)).toMatchObject({
        link: {
          association: { taskId },
          run: { state: "observed" },
        },
      });

      duplicateRunningThread = true;
      const ambiguous = await runCli(
        [
          "session",
          "auto-link",
          "--project-id",
          project.project.id,
          "--task-id",
          taskId,
          "--branch-name",
          "feature/t3-cli",
          "--json",
          "--database",
          database,
        ],
        environment,
      );
      expect(ambiguous.exitCode).toBe(0);
      expect(JSON.parse(ambiguous.stdout)).toMatchObject({
        link: {
          candidateThreadIds: ["t3-thread-cli", "t3-thread-cli-duplicate"],
          status: "ambiguous",
        },
      });
      expect(requests.every((request) => request.method === "GET")).toBe(true);
      expect(
        requests.every(
          (request) =>
            !request.path.startsWith("/api/orchestration/") ||
            request.authorization === "Bearer fixture-cli-token",
        ),
      ).toBe(true);
    } finally {
      t3Server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
