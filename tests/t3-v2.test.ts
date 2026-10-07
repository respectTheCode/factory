import { describe, expect, test } from "bun:test";

import { createT3ActivityReader } from "../src/t3";
import { parseT3V2ShellPayload, parseT3V2ThreadPayload } from "../src/t3-v2";

const BASE_URL = "https://t3.example.test";
const TOKEN = "fixture-t3-token";
const TIME = "2026-10-04T12:00:00.000Z";

function descriptor(): Response {
  return Response.json({
    capabilities: {},
    environmentId: "environment-1",
    label: "nightly fixture",
    orchestrationProtocolVersion: 2,
    platform: { arch: "arm64", os: "darwin" },
    serverVersion: "0.0.46-nightly.20261004.2652",
  });
}

function project(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-10-01T12:00:00.000Z",
    id: "project-1",
    repositoryIdentity: {
      canonicalKey: "github.com/example/app",
      locator: {
        remoteName: "origin",
        remoteUrl: "git@github.com:example/app.git",
        source: "git-remote",
      },
      name: "app",
      owner: "example",
      provider: "github",
    },
    scripts: [],
    title: "App",
    updatedAt: "2026-10-03T12:00:00.000Z",
    workspaceRoot: "/work/app",
    ...overrides,
  };
}

function shellThread(overrides: Record<string, unknown> = {}) {
  return {
    archivedAt: null,
    createdAt: "2026-10-01T12:00:00.000Z",
    hasActionableProposedPlan: false,
    id: "thread-1",
    latestRunCompletedAt: null,
    latestRunId: "run-2",
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestUserMessageAt: null,
    pendingBackgroundTasks: [],
    pendingRuntimeRequest: null,
    projectId: "project-1",
    providerInstanceId: "codex",
    status: "running",
    title: "Implement feature",
    updatedAt: "2026-10-04T11:59:00.000Z",
    ...overrides,
  };
}

function shellPayload(overrides: Record<string, unknown> = {}) {
  return {
    archivedThreads: [
      shellThread({
        archivedAt: "2026-09-30T12:00:00.000Z",
        id: "archived-thread",
        status: "completed",
        updatedAt: "2026-10-03T12:00:00.000Z",
      }),
    ],
    projects: [project()],
    schemaVersion: 1,
    snapshotSequence: 42,
    threads: [shellThread()],
    ...overrides,
  };
}

function run(
  id: string,
  ordinal: number,
  status: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    completedAt: null,
    id,
    ordinal,
    requestedAt: `2026-10-04T11:${String(ordinal).padStart(2, "0")}:00.000Z`,
    startedAt: `2026-10-04T11:${String(ordinal).padStart(2, "0")}:01.000Z`,
    status,
    threadId: "thread-1",
    ...overrides,
  };
}

function detailPayload(overrides: Record<string, unknown> = {}) {
  const run1 = run("run-1", 1, "completed", {
    completedAt: "2026-10-04T11:01:30.000Z",
  });
  const run2 = run("run-2", 2, "cancelled", {
    completedAt: "2026-10-04T11:02:30.000Z",
  });
  return {
    hasMoreHistory: true,
    latestLocalTurnOrdinal: 2,
    payloadBudgetExceeded: false,
    projection: {
      attempts: [],
      checkpoints: [
        {
          appRunOrdinal: 1,
          capturedAt: "2026-10-04T11:01:30.000Z",
          files: [
            {
              additions: 3,
              deletions: 1,
              kind: "modified",
              path: "src/old.ts",
            },
          ],
          id: "checkpoint-old",
          nodeId: "node-1",
          ordinalWithinScope: 1,
          ref: "refs/t3/checkpoint/old",
          runId: "run-1",
          scopeId: "scope-1",
          status: "ready",
          threadId: "thread-1",
        },
        {
          appRunOrdinal: 2,
          capturedAt: "2026-10-04T11:02:30.000Z",
          files: [
            {
              additions: 4,
              deletions: 0,
              kind: "modified",
              path: "src/current.ts",
            },
          ],
          id: "checkpoint-current",
          nodeId: "node-2",
          ordinalWithinScope: 1,
          ref: "refs/t3/checkpoint/current",
          runId: "run-2",
          scopeId: "scope-2",
          status: "stale",
          threadId: "thread-1",
        },
        {
          capturedAt: "2026-10-04T11:02:31.000Z",
          files: [],
          id: "checkpoint-manual",
          nodeId: "node-2",
          ordinalWithinScope: 2,
          ref: "refs/t3/checkpoint/manual",
          runId: null,
          scopeId: "scope-2",
          status: "ready",
          threadId: "thread-1",
        },
      ],
      contextHandoffs: [],
      contextTransfers: [],
      messages: [
        {
          attachments: [],
          createdAt: "2026-10-04T11:01:00.000Z",
          id: "message-old",
          role: "user",
          runId: "run-1",
          streaming: false,
          text: "old secret transcript",
          threadId: "thread-1",
          updatedAt: "2026-10-04T11:01:00.000Z",
        },
        {
          attachments: [],
          createdAt: "2026-10-04T11:02:00.000Z",
          id: "message-current",
          role: "assistant",
          runId: "run-2",
          streaming: false,
          text: "current secret transcript",
          threadId: "thread-1",
          updatedAt: "2026-10-04T11:02:00.000Z",
        },
      ],
      nodes: [],
      plans: [
        {
          detailInTurnItem: true,
          id: "plan-1",
          kind: "proposed_plan",
          markdown: "private plan content",
          runId: "run-2",
          status: "active",
          threadId: "thread-1",
        },
      ],
      providerSessions: [
        {
          capabilities: {},
          createdAt: "2026-10-04T11:00:00.000Z",
          cwd: "/work/app",
          id: "session-1",
          model: "fixture",
          providerInstanceId: "codex",
          status: "running",
          updatedAt: "2026-10-04T11:02:30.000Z",
        },
      ],
      providerThreads: [],
      providerTurns: [],
      runtimeRequests: [
        {
          createdAt: "2026-10-04T11:02:00.000Z",
          id: "request-permission",
          kind: "permission",
          nodeId: "node-2",
          responseCapability: { type: "message" },
          status: "pending",
          threadId: "thread-1",
        },
        {
          createdAt: "2026-10-04T11:02:10.000Z",
          id: "request-input",
          kind: "mcp-elicitation",
          nodeId: "node-2",
          responseCapability: { type: "message" },
          status: "pending",
          threadId: "thread-1",
        },
        {
          createdAt: "2026-10-04T11:02:20.000Z",
          id: "request-resolved",
          kind: "auth_refresh",
          nodeId: "node-2",
          responseCapability: { type: "not_resumable", reason: "done" },
          status: "resolved",
          threadId: "thread-1",
        },
      ],
      runs: [run1, run2],
      subagents: [],
      thread: {
        archivedAt: null,
        createdAt: "2026-10-01T12:00:00.000Z",
        id: "thread-1",
        projectId: "project-1",
        providerInstanceId: "codex",
        title: "Implement feature",
        updatedAt: "2026-10-04T11:02:30.000Z",
      },
      turnItems: [],
      updatedAt: TIME,
      visibleTurnItems: [
        {
          item: {
            id: "item-current",
            ordinal: 4,
            runId: "run-2",
            status: "failed",
            threadId: "thread-1",
            type: "error",
            updatedAt: "2026-10-04T11:02:25.000Z",
          },
          position: 0,
          sourceItemId: "item-current",
          sourceThreadId: "thread-1",
          visibility: "local",
        },
      ],
    },
    snapshotSequence: 43,
    ...overrides,
  };
}

describe("T3 orchestration protocol 2 compatibility", () => {
  test("uses the v2 header and bounded route, with one cached descriptor", async () => {
    const requests: Array<{ headers: Headers; method: string; url: string }> =
      [];
    const reader = createT3ActivityReader({
      baseUrl: BASE_URL,
      fetcher: async (input, init) => {
        const url = String(input);
        requests.push({
          headers: new Headers(init?.headers),
          method: init?.method ?? "",
          url,
        });
        if (url.endsWith("/.well-known/t3/environment")) return descriptor();
        if (url.endsWith("/api/orchestration/shell"))
          return Response.json(shellPayload());
        if (url.endsWith("/api/orchestration/threads/thread-1/bounded"))
          return Response.json(detailPayload());
        return new Response("not found", { status: 404 });
      },
      now: () => new Date(TIME),
      token: TOKEN,
    });

    const shell = await reader.readShell();
    expect(shell).toMatchObject({
      ok: true,
      sourceSequence: 42,
      sourceStream: "shell",
      sourceUpdatedAt: "2026-10-04T11:59:00.000Z",
      threads: [
        { id: "thread-1", session: { status: "running" } },
        { id: "archived-thread", archivedAt: "2026-09-30T12:00:00.000Z" },
      ],
    });
    const detail = await reader.readThread({
      threadId: "thread-1",
      turnLimit: 1,
    });
    expect(detail).toMatchObject({
      ok: true,
      sourceSequence: 43,
      sourceStream: "shell",
      sourceUpdatedAt: TIME,
      hasMoreHistory: true,
      thread: {
        activities: [{ id: "thread-1:item-current", tone: "error" }],
        checkpoints: [
          {
            status: "error",
            turnId: "run-2",
            files: [{ path: "src/current.ts", additions: 4, deletions: 0 }],
          },
        ],
        hasActionableProposedPlan: true,
        hasPendingApprovals: true,
        hasPendingUserInput: true,
        latestTurn: { state: "interrupted", turnId: "run-2" },
        messages: [
          { id: "message-current", role: "assistant", turnId: "run-2" },
        ],
        session: { status: "ready" },
      },
    });
    expect(JSON.stringify(detail)).not.toContain("secret transcript");
    expect(JSON.stringify(detail)).not.toContain("private plan content");
    expect(requests.map((request) => request.url)).toEqual([
      `${BASE_URL}/.well-known/t3/environment`,
      `${BASE_URL}/api/orchestration/shell`,
      `${BASE_URL}/api/orchestration/threads/thread-1/bounded`,
    ]);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests[0]?.headers.get("x-t3-orchestration-protocol")).toBeNull();
    expect(requests[1]?.headers.get("x-t3-orchestration-protocol")).toBe("2");
    expect(requests[2]?.headers.get("x-t3-orchestration-protocol")).toBe("2");
    expect(requests[1]?.headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  test("maps durable statuses and pending runtime request kinds conservatively", () => {
    const shellStatuses = [
      ["idle", "completed", "idle"],
      ["preparing", "running", "starting"],
      ["queued", "running", "starting"],
      ["starting", "running", "starting"],
      ["running", "running", "running"],
      ["waiting", "running", "ready"],
      ["completed", "completed", "ready"],
      ["interrupted", "interrupted", "interrupted"],
      ["failed", "error", "error"],
      ["cancelled", "interrupted", "interrupted"],
      ["rolled_back", "interrupted", "interrupted"],
    ] as const;
    for (const [status, latestState, sessionStatus] of shellStatuses) {
      const parsed = parseT3V2ShellPayload(
        shellPayload({
          threads: [
            shellThread({
              latestRunCompletedAt: "2026-10-04T11:59:30.000Z",
              latestRunRequestedAt: "2026-10-04T11:58:00.000Z",
              status,
            }),
          ],
          archivedThreads: [],
        }),
      );
      expect(parsed?.threads[0]).toMatchObject({
        latestTurn: {
          state: latestState,
          completedAt: "2026-10-04T11:59:30.000Z",
        },
        session: { status: sessionStatus },
      });
    }

    const requestKinds = [
      ["permission", true, false],
      ["dynamic_tool_call", true, false],
      ["command", true, false],
      ["file-read", true, false],
      ["file-change", true, false],
      ["mcp-elicitation", false, true],
      ["user_input", false, true],
      ["auth_refresh", false, true],
    ] as const;
    for (const [
      kind,
      hasPendingApprovals,
      hasPendingUserInput,
    ] of requestKinds) {
      const body = detailPayload() as unknown as Record<string, unknown>;
      const projection = body.projection as Record<string, unknown>;
      projection.runtimeRequests = [
        {
          createdAt: TIME,
          id: "request-" + kind,
          kind,
          nodeId: "node-2",
          responseCapability: { type: "message" },
          status: "pending",
        },
      ];
      const parsed = parseT3V2ThreadPayload(body, {
        threadId: "thread-1",
        turnLimit: 1,
      });
      expect(parsed?.thread).toMatchObject({
        hasPendingApprovals,
        hasPendingUserInput,
      });
    }

    const nonPending = detailPayload() as unknown as Record<string, unknown>;
    const nonPendingProjection = nonPending.projection as Record<
      string,
      unknown
    >;
    nonPendingProjection.runtimeRequests = [
      {
        createdAt: TIME,
        id: "request-resolved",
        kind: "permission",
        nodeId: "node-2",
        responseCapability: { type: "message" },
        status: "resolved",
      },
    ];
    expect(
      parseT3V2ThreadPayload(nonPending, {
        threadId: "thread-1",
        turnLimit: 1,
      })?.thread,
    ).toMatchObject({
      hasPendingApprovals: false,
      hasPendingUserInput: false,
    });
  });

  test("rejects budget overflow, a mismatched thread, and duplicate shell rows", async () => {
    for (const [route, body] of [
      [
        "/api/orchestration/threads/thread-1/bounded",
        detailPayload({ payloadBudgetExceeded: true }),
      ],
      [
        "/api/orchestration/threads/thread-1/bounded",
        detailPayload({
          projection: {
            ...(detailPayload().projection as Record<string, unknown>),
            thread: {
              id: "another-thread",
              projectId: "project-1",
              title: "wrong projection",
              createdAt: "2026-10-01T12:00:00.000Z",
              updatedAt: TIME,
            },
          },
        }),
      ],
      [
        "/api/orchestration/shell",
        shellPayload({
          archivedThreads: [
            shellThread({
              archivedAt: "2026-10-03T12:00:00.000Z",
              id: "thread-1",
              status: "completed",
            }),
          ],
        }),
      ],
      [
        "/api/orchestration/shell",
        shellPayload({
          threads: [shellThread({ latestRunId: 17 })],
          archivedThreads: [],
        }),
      ],
    ] as const) {
      const reader = createT3ActivityReader({
        baseUrl: BASE_URL,
        fetcher: async (input) => {
          const url = String(input);
          if (url.endsWith("/.well-known/t3/environment")) return descriptor();
          if (url.endsWith(route)) return Response.json(body);
          return new Response("not found", { status: 404 });
        },
        token: TOKEN,
      });
      const result = route.endsWith("/shell")
        ? await reader.readShell()
        : await reader.readThread({ threadId: "thread-1", turnLimit: 1 });
      expect(result).toMatchObject({ ok: false, status: "invalid_response" });
    }
  });
});
