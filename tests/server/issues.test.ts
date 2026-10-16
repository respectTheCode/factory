import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { FactoryApplication } from "../../src/application";
import type {
  GitHubPullRequestStatus,
  GitHubStatusReader,
} from "../../src/github";
import { createFactoryServer } from "../../src/server";
import type { T3ActivityReader } from "../../src/t3";
import { LEGACY_T3_SOURCE_ID } from "../../src/t3-source-identity";
import type { T3Source } from "../../src/t3-sources";
import { createWebSocket, openAuthenticatedSocket } from "../transport/helpers";

const directories: string[] = [];
const projectIdFromT3 = "t3-project-issues";
const branch = "feature/issue-backend";
const pullRequestUrl = "https://github.com/acme/app/pull/31";
const fixedNow = "2026-10-16T12:00:00.000Z";

type RawResponse = {
  id: number;
  result?: { data?: unknown; type?: string };
  error?: { data?: { code?: string }; message?: string };
};

function request(
  socket: WebSocket,
  body: Record<string, unknown> & { id: number },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const response = JSON.parse(String(event.data)) as RawResponse;
      if (response.id !== body.id) return;
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      resolve(response);
    };
    const onError = () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("error", onError);
      reject(new Error("WebSocket request failed"));
    };
    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", onError);
    socket.send(JSON.stringify(body));
  });
}

function data<T>(response: RawResponse): T {
  expect(response.result?.type).toBe("data");
  return response.result?.data as T;
}

async function pollUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    value = await read();
  }
  return value;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function persistedFactoryState(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    const row = database
      .query("SELECT state FROM factory_state WHERE id = 1")
      .get() as { state: string } | null;
    if (!row) throw new Error("Factory state snapshot was not persisted.");
    return row.state;
  } finally {
    database.close();
  }
}

function issueReader() {
  const thread = {
    branch,
    createdAt: "2026-10-16T11:00:00.000Z",
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    id: "thread-issue-1",
    latestTurn: {
      requestedAt: "2026-10-16T11:00:00.000Z",
      startedAt: "2026-10-16T11:01:00.000Z",
      state: "running" as const,
      turnId: "turn-issue-1",
    },
    latestUserMessageAt: "2026-10-16T11:00:00.000Z",
    linkedPullRequestUrl: pullRequestUrl,
    projectId: projectIdFromT3,
    session: {
      activeTurnId: "turn-issue-1",
      providerName: "codex",
      status: "running" as const,
      updatedAt: "2026-10-16T11:01:00.000Z",
    },
    title: "Implement issue tracking",
    updatedAt: "2026-10-16T11:01:00.000Z",
    worktreePath: "/work/app",
  };
  const sent: Array<{ threadId: string; text: string; requestId: string }> = [];
  const reader: T3ActivityReader & {
    sent: typeof sent;
  } = {
    sent,
    async readShell() {
      return {
        fetchedAt: fixedNow,
        ok: true,
        projects: [
          {
            createdAt: "2026-10-16T10:00:00.000Z",
            id: projectIdFromT3,
            title: "App",
            updatedAt: fixedNow,
            workspaceRoot: "/work/app",
          },
        ],
        sourceDigest: "shell-issues",
        sourceSequence: 3,
        sourceStream: "shell",
        sourceUpdatedAt: fixedNow,
        status: "ok",
        threads: [thread],
      } as never;
    },
    async readThread() {
      throw new Error(
        "The issue activity route should not fetch a full thread.",
      );
    },
    async readMessages({ threadId }) {
      expect(threadId).toBe("thread-issue-1");
      return {
        canSend: true,
        messages: [
          {
            createdAt: fixedNow,
            id: "message-1",
            role: "assistant",
            text: "The issue backend is ready.",
          },
        ],
      };
    },
    async sendMessage(input) {
      sent.push(input);
      return {
        delivery: "queued",
        messageId: "message-2",
        threadId: input.threadId,
      };
    },
  };
  return reader;
}

function githubReader(): GitHubStatusReader {
  const pullRequest: GitHubPullRequestStatus = {
    baseBranch: "main",
    draft: false,
    headSha: "abcdef0123456789",
    headBranch: branch,
    mergeable: true,
    number: 31,
    state: "closed",
    title: "Implement issue tracking",
    updatedAt: fixedNow,
    url: pullRequestUrl,
    mergedAt: "2026-10-16T11:45:00.000Z",
    mergeSha: "0123456789abcdef",
  };
  return {
    async read() {
      return {
        checkRuns: [],
        checkRunsStatus: "not_requested",
        fetchedAt: fixedNow,
        pullRequest,
        status: "ok",
        workflowRuns: [],
        workflowRunsStatus: "not_requested",
      };
    },
  };
}

function unmergedGitHubReader(): GitHubStatusReader {
  return {
    async read(pullRequest) {
      const status: GitHubPullRequestStatus = {
        baseBranch: "main",
        draft: false,
        headSha: "abcdef0123456789",
        headBranch: "feature/issue-tracker",
        mergeable: true,
        number: pullRequest.number,
        state: pullRequest.number === 31 ? "open" : "closed",
        title: "Unmerged issue work",
        updatedAt: fixedNow,
        url: pullRequest.url,
      };
      return {
        checkRuns: [],
        checkRunsStatus: "not_requested",
        fetchedAt: fixedNow,
        pullRequest: status,
        status: "ok",
        workflowRuns: [],
        workflowRunsStatus: "not_requested",
      };
    },
  };
}

function sourceActivityReader(input: {
  projectId: string;
  threads: Array<{
    id: string;
    branch: string;
    state: "working" | "stopped";
    title: string;
  }>;
}): T3ActivityReader {
  return {
    async readShell() {
      return {
        fetchedAt: fixedNow,
        ok: true,
        projects: [
          {
            createdAt: "2026-10-16T10:00:00.000Z",
            id: input.projectId,
            title: input.projectId,
            updatedAt: fixedNow,
            workspaceRoot: "/work/app",
          },
        ],
        sourceDigest: `shell-${input.projectId}`,
        sourceSequence: 3,
        sourceStream: "shell",
        sourceUpdatedAt: fixedNow,
        status: "ok",
        threads: input.threads.map((thread) => ({
          branch: thread.branch,
          createdAt: "2026-10-16T10:00:00.000Z",
          hasActionableProposedPlan: false,
          hasPendingApprovals: false,
          hasPendingUserInput: false,
          id: thread.id,
          latestTurn: {
            requestedAt: "2026-10-16T11:00:00.000Z",
            startedAt: "2026-10-16T11:01:00.000Z",
            state: thread.state === "working" ? "running" : "completed",
            turnId: `turn-${thread.id}`,
          },
          latestUserMessageAt: "2026-10-16T11:00:00.000Z",
          projectId: input.projectId,
          session: {
            activeTurnId:
              thread.state === "working" ? `turn-${thread.id}` : undefined,
            providerName: "codex",
            status: thread.state === "working" ? "running" : "stopped",
            updatedAt: "2026-10-16T11:01:00.000Z",
          },
          title: thread.title,
          updatedAt: "2026-10-16T11:01:00.000Z",
          worktreePath: "/work/app",
        })),
      } as never;
    },
    async readThread() {
      throw new Error(
        "The issue activity route should not fetch a full thread.",
      );
    },
  };
}

function source(sourceId: string, reader: T3ActivityReader): T3Source {
  return {
    accessTokenFile: "<test-token>",
    baseUrl: `http://${sourceId}.test:3773`,
    machineId: `machine-${sourceId}`,
    reader,
    sourceId,
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Factory issue routes", () => {
  test("returns persisted issues before a deduped remote refresh and exposes refreshed status on later polls", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-refresh-"));
    directories.push(directory);
    let releaseActivity!: () => void;
    let markActivityStarted!: () => void;
    let readShellCalls = 0;
    const activityGate = new Promise<void>((resolve) => {
      releaseActivity = resolve;
    });
    const activityStarted = new Promise<void>((resolve) => {
      markActivityStarted = resolve;
    });
    const baseReader = sourceActivityReader({
      projectId: "t3-project-issues-gated",
      threads: [
        {
          id: "thread-issue-gated",
          branch,
          state: "working",
          title: "Gated issue thread",
        },
      ],
    });
    const gatedReader: T3ActivityReader = {
      ...baseReader,
      async readShell() {
        readShellCalls += 1;
        markActivityStarted();
        await activityGate;
        return baseReader.readShell();
      },
    };
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      port: 0,
      t3ActivityReader: gatedReader,
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const socket = await openAuthenticatedSocket(server);
    let requestId = 1;
    try {
      const project = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              gitOriginUrl: "git@github.com:acme/app.git",
              name: "Gated App",
              t3ProjectId: "t3-project-issues-gated",
              workspaceRoot: "/work/app",
            },
            path: "projects.create",
          },
        }),
      );
      const issue = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              branches: [branch],
              projectId: project.id,
              title: "Gated issue",
            },
            path: "issues.create",
          },
        }),
      );

      const firstListPromise = request(socket, {
        id: requestId++,
        method: "query",
        params: { input: { projectId: project.id }, path: "issues.list" },
      });
      await withTimeout(
        activityStarted,
        1_000,
        "The list request did not start its remote refresh.",
      );
      const firstListResponse = await withTimeout(
        firstListPromise,
        1_000,
        "The issue list waited for the blocked remote refresh.",
      );
      expect(
        data<Array<{ id: string; status: string }>>(firstListResponse),
      ).toContainEqual(
        expect.objectContaining({ id: issue.id, status: "todo" }),
      );

      const secondList = data<Array<{ id: string }>>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { projectId: project.id }, path: "issues.list" },
        }),
      );
      expect(secondList.map(({ id }) => id)).toContain(issue.id);
      expect(readShellCalls).toBe(1);

      releaseActivity();
      const refreshed = await pollUntil(
        async () =>
          data<Array<{ id: string; status: string }>>(
            await request(socket, {
              id: requestId++,
              method: "query",
              params: { input: { projectId: project.id }, path: "issues.list" },
            }),
          ),
        (issues) =>
          issues.some(
            (candidate) =>
              candidate.id === issue.id && candidate.status === "in_progress",
          ),
      );
      expect(
        refreshed.find((candidate) => candidate.id === issue.id)?.status,
      ).toBe("in_progress");
    } finally {
      releaseActivity();
      socket.close();
      await server.stop();
    }
  });

  test("issue refresh and global T3 status leave legacy observation state untouched", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-issues-lightweight-"),
    );
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    const server = createFactoryServer({
      databasePath,
      port: 0,
      t3ActivityReader: issueReader(),
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const socket = await openAuthenticatedSocket(server);
    let requestId = 1;
    const prototype = FactoryApplication.prototype;
    const legacyMethods = [
      "getProjectHierarchy",
      "getT3ThreadDetail",
      "listProjectT3Activity",
      "listReconciliationFindings",
      "listSessionEvidence",
      "matchT3Observation",
      "refreshT3Observations",
    ] as const;
    const descriptors = new Map(
      legacyMethods.map((method) => [
        method,
        Object.getOwnPropertyDescriptor(prototype, method),
      ]),
    );
    try {
      const project = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              gitOriginUrl: "git@github.com:acme/app.git",
              name: "App",
              t3ProjectId: projectIdFromT3,
              workspaceRoot: "/work/app",
            },
            path: "projects.create",
          },
        }),
      );
      await request(socket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: {
            branchName: branch,
            name: "Legacy matching Task",
            projectId: project.id,
          },
          path: "tasks.create",
        },
      });
      const issue = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              branches: [branch],
              projectId: project.id,
              title: "Issue",
            },
            path: "issues.create",
          },
        }),
      );
      const stateBefore = persistedFactoryState(databasePath);

      for (const method of legacyMethods)
        Object.defineProperty(prototype, method, {
          configurable: true,
          value() {
            throw new Error(`Unexpected legacy T3 operation: ${method}`);
          },
        });

      const listed = data<Array<{ id: string }>>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { projectId: project.id }, path: "issues.list" },
        }),
      );
      expect(listed.map(({ id }) => id)).toContain(issue.id);
      const detail = data<{
        threads: Array<{
          branch?: string;
          current: boolean;
          state: string;
          threadId: string;
        }>;
        connections: Array<{ sourceId: string; state: string }>;
      }>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { id: issue.id }, path: "issues.detail" },
        }),
      );
      expect(detail.connections).toContainEqual(
        expect.objectContaining({
          sourceId: LEGACY_T3_SOURCE_ID,
          state: "connected",
        }),
      );
      expect(detail.threads).toContainEqual(
        expect.objectContaining({
          branch,
          current: true,
          state: "working",
          threadId: "thread-issue-1",
        }),
      );
      const headerStatus = data<{
        counts: { linked: number; running: number; suggested: number };
        status: string;
        threadCount: number;
      }>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: {}, path: "t3.status" },
        }),
      );
      expect(headerStatus).toMatchObject({
        counts: { linked: 0, running: 1, suggested: 0 },
        status: "ok",
        threadCount: 1,
      });
      expect(persistedFactoryState(databasePath)).toBe(stateBefore);
    } finally {
      for (const method of legacyMethods) {
        const descriptor = descriptors.get(method);
        if (descriptor) Object.defineProperty(prototype, method, descriptor);
        else Reflect.deleteProperty(prototype, method);
      }
      socket.close();
      await server.stop();
    }
  });

  test("exposes human-only issue CRUD, fresh T3/PR detail, and linked-thread replies", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-rpc-"));
    directories.push(directory);
    const t3 = issueReader();
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      githubStatusReader: githubReader(),
      port: 0,
      t3ActivityReader: t3,
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const socket = await openAuthenticatedSocket(server);
    const unauthenticatedSocket = createWebSocket(new URL("/trpc", server.url));
    let requestId = 1;
    try {
      await new Promise<void>((resolve, reject) => {
        unauthenticatedSocket.addEventListener("open", () => resolve(), {
          once: true,
        });
        unauthenticatedSocket.addEventListener(
          "error",
          () =>
            reject(new Error("Unauthenticated WebSocket connection failed")),
          { once: true },
        );
      });
      const denied = await request(unauthenticatedSocket, {
        id: requestId++,
        method: "query",
        params: { input: {}, path: "issues.list" },
      });
      expect(denied.error?.data?.code).toBe("UNAUTHORIZED");
      const deniedSend = await request(unauthenticatedSocket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: {
            id: "issue-not-authorized",
            requestId: "unauthorized-reply-1",
            sourceId: LEGACY_T3_SOURCE_ID,
            text: "This must not be sent.",
            threadId: "thread-issue-1",
          },
          path: "issues.sendMessage",
        },
      });
      expect(deniedSend.error?.data?.code).toBe("UNAUTHORIZED");

      const project = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              gitOriginUrl: "git@github.com:acme/app.git",
              name: "App",
              t3ProjectId: projectIdFromT3,
              workspaceRoot: "/work/app",
            },
            path: "projects.create",
          },
        }),
      );
      const created = data<{ id: string; simpleId: string; status: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              projectId: project.id,
              title: "Issue backend",
              branches: [branch],
            },
            path: "issues.create",
          },
        }),
      );
      expect(created).toMatchObject({ simpleId: "F-1", status: "todo" });

      const details = data<{
        issue: {
          pullRequestUrls: string[];
          pullRequests: Array<{ state: string; merged: boolean }>;
          status: string;
        };
        connections: Array<{ sourceId: string; state: string }>;
        threads: Array<{
          sourceId: string;
          threadId: string;
          branch?: string;
          repository?: string;
          state: string;
          canSend?: boolean;
          messages?: Array<{ text: string }>;
        }>;
      }>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { id: created.id }, path: "issues.detail" },
        }),
      );
      expect(details.issue).toMatchObject({
        status: "done",
        pullRequestUrls: [pullRequestUrl],
        pullRequests: [{ state: "merged", merged: true }],
      });
      expect(details.connections.length).toBeGreaterThan(0);
      expect(details.threads).toEqual([
        expect.objectContaining({
          sourceId: LEGACY_T3_SOURCE_ID,
          threadId: "thread-issue-1",
          branch,
          repository: "git@github.com:acme/app.git",
          state: "working",
          canSend: true,
          messages: [
            expect.objectContaining({ text: "The issue backend is ready." }),
          ],
        }),
      ]);

      const sent = data<{ delivery: string; messageId: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              id: created.id,
              sourceId: LEGACY_T3_SOURCE_ID,
              threadId: "thread-issue-1",
              requestId: "issue-reply-0001",
              text: "Please continue with the tests.",
            },
            path: "issues.sendMessage",
          },
        }),
      );
      expect(sent).toMatchObject({
        delivery: "queued",
        messageId: "message-2",
      });
      const repeated = await request(socket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: {
            id: created.id,
            sourceId: LEGACY_T3_SOURCE_ID,
            threadId: "thread-issue-1",
            requestId: "issue-reply-0001",
            text: "Please continue with the tests.",
          },
          path: "issues.sendMessage",
        },
      });
      expect(data(repeated)).toMatchObject({
        delivery: "queued",
        messageId: "message-2",
      });
      const changedText = await request(socket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: {
            id: created.id,
            sourceId: LEGACY_T3_SOURCE_ID,
            threadId: "thread-issue-1",
            requestId: "issue-reply-0001",
            text: "A changed payload must conflict.",
          },
          path: "issues.sendMessage",
        },
      });
      expect(changedText.error?.data?.code).toBe("CONFLICT");
      for (const changedPayload of [
        { id: "another-issue" },
        { sourceId: "another-source" },
        { threadId: "another-thread" },
      ]) {
        const mismatch = await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              id: created.id,
              requestId: "issue-reply-0001",
              sourceId: LEGACY_T3_SOURCE_ID,
              text: "Please continue with the tests.",
              threadId: "thread-issue-1",
              ...changedPayload,
            },
            path: "issues.sendMessage",
          },
        });
        expect(mismatch.error?.data?.code).toBe("CONFLICT");
      }
      expect(t3.sent).toEqual([
        {
          threadId: "thread-issue-1",
          requestId: "issue-reply-0001",
          text: "Please continue with the tests.",
        },
      ]);

      const updated = data<{ id: string; title: string; status: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: { id: created.id, title: "Updated issue", status: "todo" },
            path: "issues.update",
          },
        }),
      );
      expect(updated).toMatchObject({
        id: created.id,
        title: "Updated issue",
        status: "todo",
      });
      const listed = data<Array<{ id: string }>>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { projectId: project.id }, path: "issues.list" },
        }),
      );
      expect(listed.map(({ id }) => id)).toContain(created.id);
      expect(
        data<{ id: string }>(
          await request(socket, {
            id: requestId++,
            method: "mutation",
            params: { input: { id: created.id }, path: "issues.remove" },
          }),
        ),
      ).toEqual({ id: created.id });
    } finally {
      unauthenticatedSocket.close();
      socket.close();
      await server.stop();
    }
  });

  test("uses fresh T3 sources only and preserves issue status while a source is unresolved", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-sources-"));
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    const m4ProjectId = "t3-project-m4";
    const m5ProjectId = "t3-project-m5";
    const m4Reader = sourceActivityReader({
      projectId: m4ProjectId,
      threads: [
        {
          id: "thread-m4",
          branch: "feature/m4",
          state: "working",
          title: "M4 active thread",
        },
      ],
    });
    const m5InitialReader = sourceActivityReader({
      projectId: m5ProjectId,
      threads: [
        {
          id: "thread-m5-stopped",
          branch: "feature/m5-stopped",
          state: "stopped",
          title: "M5 stopped thread",
        },
        {
          id: "thread-m5-working",
          branch: "feature/m5-working",
          state: "working",
          title: "M5 working thread",
        },
      ],
    });
    const sources = (m5Reader: T3ActivityReader): T3Source[] => [
      source("m4", m4Reader),
      source("m5", m5Reader),
    ];
    const mappings = [
      { sourceId: "m4", t3ProjectId: m4ProjectId },
      { sourceId: "m5", t3ProjectId: m5ProjectId },
    ];
    const firstServer = createFactoryServer({
      databasePath,
      port: 0,
      t3Sources: sources(m5InitialReader),
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const firstSocket = await openAuthenticatedSocket(firstServer);
    let requestId = 1;
    let projectId = "";
    let stoppedIssueId = "";
    let workingIssueId = "";
    try {
      const project = data<{ id: string }>(
        await request(firstSocket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              gitOriginUrl: "git@github.com:acme/app.git",
              name: "Multi-source App",
              t3Mappings: mappings,
              workspaceRoot: "/work/app",
            },
            path: "projects.create",
          },
        }),
      );
      projectId = project.id;
      const m4Issue = data<{ id: string }>(
        await request(firstSocket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              branches: ["feature/m4"],
              projectId,
              title: "Healthy M4 issue",
            },
            path: "issues.create",
          },
        }),
      );
      const stoppedIssue = data<{ id: string }>(
        await request(firstSocket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              branches: ["feature/m5-stopped"],
              projectId,
              title: "M5 stopped issue",
            },
            path: "issues.create",
          },
        }),
      );
      stoppedIssueId = stoppedIssue.id;
      const workingIssue = data<{ id: string }>(
        await request(firstSocket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              branches: ["feature/m5-working"],
              projectId,
              title: "M5 working issue",
            },
            path: "issues.create",
          },
        }),
      );
      workingIssueId = workingIssue.id;
      await request(firstSocket, {
        id: requestId++,
        method: "query",
        params: { input: { projectId }, path: "issues.list" },
      });
      const refreshedIssues = await pollUntil(
        async () =>
          data<Array<{ id: string; status: string }>>(
            await request(firstSocket, {
              id: requestId++,
              method: "query",
              params: { input: { projectId }, path: "issues.list" },
            }),
          ),
        (issues) =>
          issues.some(
            (issue) =>
              issue.id === m4Issue.id && issue.status === "in_progress",
          ),
      );
      expect(
        refreshedIssues.find((issue) => issue.id === m4Issue.id)?.status,
      ).toBe("in_progress");
      await request(firstSocket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: { id: stoppedIssueId, status: "todo" },
          path: "issues.update",
        },
      });
      await request(firstSocket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: { id: workingIssueId, status: "todo" },
          path: "issues.update",
        },
      });
    } finally {
      firstSocket.close();
      await firstServer.stop();
    }

    const unmatchedM5Reader = sourceActivityReader({
      projectId: "t3-project-m5-unmatched",
      threads: [],
    });
    const secondServer = createFactoryServer({
      databasePath,
      port: 0,
      t3Sources: sources(unmatchedM5Reader),
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const secondSocket = await openAuthenticatedSocket(secondServer);
    requestId = 1;
    try {
      const listed = data<
        Array<{
          id: string;
          status: string;
        }>
      >(
        await request(secondSocket, {
          id: requestId++,
          method: "query",
          params: { input: { projectId }, path: "issues.list" },
        }),
      );
      expect(listed.find((issue) => issue.id === stoppedIssueId)?.status).toBe(
        "todo",
      );
      expect(listed.find((issue) => issue.id === workingIssueId)?.status).toBe(
        "todo",
      );
      const stoppedDetail = data<{
        threads: Array<{
          sourceId: string;
          threadId: string;
          current: boolean;
        }>;
      }>(
        await request(secondSocket, {
          id: requestId++,
          method: "query",
          params: { input: { id: stoppedIssueId }, path: "issues.detail" },
        }),
      );
      expect(stoppedDetail.threads).toContainEqual(
        expect.objectContaining({
          sourceId: "m5",
          threadId: "thread-m5-stopped",
          current: false,
        }),
      );
      const workingDetail = data<{
        threads: Array<{
          sourceId: string;
          threadId: string;
          current: boolean;
        }>;
      }>(
        await request(secondSocket, {
          id: requestId++,
          method: "query",
          params: { input: { id: workingIssueId }, path: "issues.detail" },
        }),
      );
      expect(workingDetail.threads).toContainEqual(
        expect.objectContaining({
          sourceId: "m5",
          threadId: "thread-m5-working",
          current: false,
        }),
      );
    } finally {
      secondSocket.close();
      await secondServer.stop();
    }
  });

  test("rejects manually marking a PR-backed issue done without merged evidence", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-done-rpc-"));
    directories.push(directory);
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      githubStatusReader: unmergedGitHubReader(),
      port: 0,
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const socket = await openAuthenticatedSocket(server);
    let requestId = 1;
    try {
      const project = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: { name: "App" },
            path: "projects.create",
          },
        }),
      );
      const openIssue = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              projectId: project.id,
              pullRequestUrls: [pullRequestUrl],
              title: "Open PR issue",
            },
            path: "issues.create",
          },
        }),
      );
      const closedUnmergedIssue = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              projectId: project.id,
              pullRequestUrls: ["https://github.com/acme/app/pull/32"],
              title: "Closed-unmerged PR issue",
            },
            path: "issues.create",
          },
        }),
      );
      await request(socket, {
        id: requestId++,
        method: "query",
        params: { input: { projectId: project.id }, path: "issues.list" },
      });
      await request(socket, {
        id: requestId++,
        method: "query",
        params: { input: { id: openIssue.id }, path: "issues.detail" },
      });
      for (const id of [openIssue.id, closedUnmergedIssue.id]) {
        const result = await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: { id, status: "done" },
            path: "issues.update",
          },
        });
        expect(result.error?.data?.code).toBe("BAD_REQUEST");
        expect(result.error?.message).toContain(
          "every Pull Request is confirmed merged",
        );
      }
    } finally {
      socket.close();
      await server.stop();
    }
  });

  test("moves issues before an anchor or appends them to the target status", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-move-rpc-"));
    directories.push(directory);
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      port: 0,
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const socket = await openAuthenticatedSocket(server);
    let requestId = 1;
    try {
      const project = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: { input: { name: "Move App" }, path: "projects.create" },
        }),
      );
      const issues: Array<{ id: string; title: string }> = [];
      for (const title of ["First", "Second", "Third"]) {
        issues.push(
          data<{ id: string; title: string }>(
            await request(socket, {
              id: requestId++,
              method: "mutation",
              params: {
                input: { projectId: project.id, title },
                path: "issues.create",
              },
            }),
          ),
        );
      }

      const moved = data<{ id: string; status: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              id: issues[2]!.id,
              status: "todo",
              beforeId: issues[0]!.id,
            },
            path: "issues.move",
          },
        }),
      );
      expect(moved).toMatchObject({ id: issues[2]!.id, status: "todo" });
      await request(socket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: { id: issues[1]!.id, status: "in_progress" },
          path: "issues.move",
        },
      });
      const listed = data<Array<{ id: string; status: string }>>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { projectId: project.id }, path: "issues.list" },
        }),
      );
      expect(listed.map(({ id }) => id)).toEqual([
        issues[2]!.id,
        issues[0]!.id,
        issues[1]!.id,
      ]);
      expect(listed.find(({ id }) => id === issues[1]!.id)?.status).toBe(
        "in_progress",
      );
    } finally {
      socket.close();
      await server.stop();
    }
  });

  test("rejects invalid move anchors and unconfirmed Done moves atomically", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-issues-move-guard-rpc-"),
    );
    directories.push(directory);
    const server = createFactoryServer({
      databasePath: join(directory, "factory.sqlite"),
      githubStatusReader: unmergedGitHubReader(),
      port: 0,
      operator: { name: "test-operator", secret: "test-operator-secret" },
    });
    const socket = await openAuthenticatedSocket(server);
    let requestId = 1;
    try {
      const project = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: { name: "Move Guard App" },
            path: "projects.create",
          },
        }),
      );
      const first = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: { projectId: project.id, title: "First" },
            path: "issues.create",
          },
        }),
      );
      const linked = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: {
              projectId: project.id,
              pullRequestUrls: [pullRequestUrl],
              title: "Unmerged PR issue",
            },
            path: "issues.create",
          },
        }),
      );
      const last = data<{ id: string }>(
        await request(socket, {
          id: requestId++,
          method: "mutation",
          params: {
            input: { projectId: project.id, title: "Last" },
            path: "issues.create",
          },
        }),
      );
      await request(socket, {
        id: requestId++,
        method: "query",
        params: { input: { id: linked.id }, path: "issues.detail" },
      });
      const before = data<Array<{ id: string; status: string }>>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { projectId: project.id }, path: "issues.list" },
        }),
      );

      const invalidAnchor = await request(socket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: { id: first.id, status: "todo", beforeId: linked.id },
          path: "issues.move",
        },
      });
      expect(invalidAnchor.error?.data?.code).toBe("BAD_REQUEST");
      expect(invalidAnchor.error?.message).toContain("destination status");

      const unconfirmedDone = await request(socket, {
        id: requestId++,
        method: "mutation",
        params: {
          input: { id: linked.id, status: "done" },
          path: "issues.move",
        },
      });
      expect(unconfirmedDone.error?.data?.code).toBe("BAD_REQUEST");
      expect(unconfirmedDone.error?.message).toContain(
        "every Pull Request is confirmed merged",
      );

      const after = data<Array<{ id: string; status: string }>>(
        await request(socket, {
          id: requestId++,
          method: "query",
          params: { input: { projectId: project.id }, path: "issues.list" },
        }),
      );
      expect(after).toEqual(before);
      expect(before.map(({ id }) => id)).toContain(first.id);
      expect(before.map(({ id }) => id)).toContain(last.id);
      expect(before.find(({ id }) => id === linked.id)?.status).not.toBe(
        "done",
      );
    } finally {
      socket.close();
      await server.stop();
    }
  });
});
