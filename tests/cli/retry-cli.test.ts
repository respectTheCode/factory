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

function retryServer({
  responseStatus = 200,
}: {
  responseStatus?: number;
} = {}): {
  attempts: () => number;
  requestKeys: () => string[];
  reports: () => unknown[];
  server: { stop: (closeActiveConnections?: boolean) => void; url: URL };
} {
  let reportAttempts = 0;
  const requestKeys: string[] = [];
  const reports: unknown[] = [];
  const server = Bun.serve({
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/version") {
        return Response.json({
          apiVersion: 1,
          revision: "test",
          schemaVersion: 1,
        });
      }
      if (path === "/api/subtasks.report") {
        reportAttempts += 1;
        const input = (await request.json()) as { requestKey?: string };
        if (input.requestKey !== undefined) requestKeys.push(input.requestKey);
        if (reportAttempts === 1 && responseStatus === 200) {
          return new Response("temporary failure", { status: 503 });
        }
        if (responseStatus !== 200) {
          return Response.json(
            {
              error: {
                data: { code: "BAD_REQUEST" },
                message: "invalid report",
              },
            },
            { status: responseStatus },
          );
        }
        const report = {
          createdAt: "2026-09-13T12:00:00.000Z",
          evidence: "retry evidence",
          id: "report-once",
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: "subtask-1",
        };
        reports.push(report);
        return Response.json({
          result: {
            data: report,
          },
        });
      }
      return new Response("not found", { status: 404 });
    },
    port: 40_000 + (process.pid % 1_000) + Math.floor(Math.random() * 10_000),
  });
  return {
    attempts: () => reportAttempts,
    reports: () => reports,
    requestKeys: () => requestKeys,
    server,
  };
}

describe("remote CLI mutation retries", () => {
  test("retries a temporary report failure with the same request key", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-cli-retry-"));
    const tokenPath = join(directory, "access-token");
    writeFileSync(tokenPath, "fmc_test-token\n", { mode: 0o600 });
    const { attempts, reports, requestKeys, server } = retryServer();

    try {
      const result = await runCli(
        [
          "subtask",
          "report",
          "--subtask-id",
          "subtask-1",
          "--state",
          "in_progress",
          "--reporter",
          "codex",
          "--evidence",
          "retry evidence",
          "--request-key",
          "retry-key-1",
          "--json",
        ],
        {
          FACTORY_ACCESS_TOKEN_FILE: tokenPath,
          FACTORY_URL: server.url.toString().replace(/\/$/, ""),
        },
      );

      expect(result.exitCode).toBe(0);
      expect(attempts()).toBe(2);
      expect(requestKeys()).toEqual(["retry-key-1", "retry-key-1"]);
      expect(reports()).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        report: { id: "report-once", requestKey: "retry-key-1" },
      });
    } finally {
      server.stop(true);
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("does not retry a 4xx application error", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-cli-no-retry-"));
    const tokenPath = join(directory, "access-token");
    writeFileSync(tokenPath, "fmc_test-token\n", { mode: 0o600 });
    const { attempts, server } = retryServer({ responseStatus: 400 });

    try {
      const result = await runCli(
        [
          "subtask",
          "report",
          "--subtask-id",
          "subtask-1",
          "--state",
          "in_progress",
          "--reporter",
          "codex",
          "--request-key",
          "no-retry-key",
        ],
        {
          FACTORY_ACCESS_TOKEN_FILE: tokenPath,
          FACTORY_URL: server.url.toString().replace(/\/$/, ""),
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(attempts()).toBe(1);
    } finally {
      server.stop(true);
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
