import { describe, expect, test } from "bun:test";

import {
  createT3ActivityReader,
  DEFAULT_T3_SERVER_VERSION,
  MAX_T3_THREAD_TURN_LIMIT,
  normalizeT3BaseUrl,
} from "../src/t3";

const BASE_URL = "http://127.0.0.1:3773";
const FIXTURE_TOKEN = "fixture-t3-access-token";
const NOW = () => new Date("2026-09-02T18:00:00.000Z");

function descriptorResponse(version = DEFAULT_T3_SERVER_VERSION): Response {
  return Response.json({
    capabilities: {},
    environmentId: "environment-1",
    label: "T3 fixture",
    platform: { arch: "arm64", os: "darwin" },
    serverVersion: version,
  });
}

function threadShell(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-09-02T17:00:00.000Z",
    hasActionableProposedPlan: true,
    hasPendingApprovals: false,
    hasPendingUserInput: true,
    id: "thread-1",
    interactionMode: "default",
    latestTurn: {
      completedAt: null,
      requestedAt: "2026-09-02T17:30:00.000Z",
      startedAt: "2026-09-02T17:30:01.000Z",
      state: "running",
      turnId: "turn-1",
    },
    latestUserMessageAt: "2026-09-02T17:30:00.000Z",
    linkedPullRequest: {
      number: 2,
      projectId: "project-1",
      repository: "app-press/factory",
      url: "https://github.com/app-press/factory/pull/2",
    },
    modelSelection: { instanceId: "codex", model: "fixture" },
    planProgress: { completedSteps: 1, step: "Implement", totalSteps: 3 },
    projectId: "project-1",
    runtimeMode: "full-access",
    session: {
      activeTurnId: "turn-1",
      lastError: null,
      providerName: "codex",
      runtimeMode: "full-access",
      status: "running",
      threadId: "thread-1",
      updatedAt: "2026-09-02T17:30:01.000Z",
    },
    title: "Implement T3 reader",
    updatedAt: "2026-09-02T17:30:01.000Z",
    worktreePath: "/Users/agent/Projects/factory",
    branch: "feature/t3-reader",
    ...overrides,
  };
}

function project() {
  return {
    createdAt: "2026-09-01T17:00:00.000Z",
    id: "project-1",
    repositoryIdentity: {
      canonicalKey: "github.com/app-press/factory",
      locator: {
        remoteName: "origin",
        remoteUrl: "git@github.com:app-press/factory.git",
        source: "git-remote",
      },
      name: "factory",
      owner: "app-press",
      provider: "github",
    },
    scripts: [],
    title: "Factory",
    updatedAt: "2026-09-02T17:30:01.000Z",
    workspaceRoot: "/Users/agent/Projects/factory",
  };
}

function detailResponse(): Response {
  const detailThread = Object.fromEntries(
    Object.entries(threadShell()).filter(
      ([key]) =>
        key !== "hasActionableProposedPlan" &&
        key !== "hasPendingApprovals" &&
        key !== "hasPendingUserInput" &&
        key !== "latestUserMessageAt" &&
        key !== "planProgress",
    ),
  );
  return Response.json({
    snapshotSequence: 42,
    thread: {
      ...detailThread,
      activities: [
        {
          createdAt: "2026-09-02T17:30:02.000Z",
          id: "event-1",
          kind: "tool-started",
          payload: { shouldNotBeReturned: "secret-like content" },
          sequence: 41,
          summary: "Reading source",
          tone: "tool",
          turnId: "turn-1",
        },
      ],
      checkpoints: [
        {
          assistantMessageId: "message-2",
          checkpointRef: "refs/t3/checkpoint/secret-like-ref",
          checkpointTurnCount: 1,
          completedAt: "2026-09-02T17:30:03.000Z",
          files: [
            {
              additions: 12,
              deletions: 3,
              kind: "modified",
              path: "src/t3.ts",
            },
          ],
          status: "ready",
          turnId: "turn-1",
        },
      ],
      messages: [
        {
          attachments: [],
          createdAt: "2026-09-02T17:30:00.000Z",
          id: "message-1",
          role: "user",
          streaming: false,
          text: "Do not persist this transcript",
          turnId: "turn-1",
          updatedAt: "2026-09-02T17:30:00.000Z",
        },
      ],
      proposedPlans: [
        {
          createdAt: "2026-09-02T17:30:00.000Z",
          id: "plan-1",
          planMarkdown: "Potentially sensitive plan text",
          turnId: "turn-1",
          updatedAt: "2026-09-02T17:30:00.000Z",
        },
      ],
    },
    page: {
      beforeCursor: null,
      hasMore: false,
      snapshotSequence: 42,
      threadSequence: 41,
    },
  });
}

function shellResponse(): Response {
  return Response.json({
    projects: [project()],
    snapshotSequence: 41,
    threads: [threadShell()],
    updatedAt: "2026-09-02T17:30:01.000Z",
  });
}

describe("T3 read-only activity transport", () => {
  test("accepts the current supported T3 0.0.42 descriptor", async () => {
    const reader = createT3ActivityReader({
      baseUrl: BASE_URL,
      fetcher: async (input) =>
        String(input).includes("/.well-known")
          ? descriptorResponse("0.0.42")
          : shellResponse(),
      token: FIXTURE_TOKEN,
    });

    await expect(reader.readShell()).resolves.toMatchObject({
      ok: true,
      status: "ok",
    });
  });

  test("reads a shell and a bounded thread using only allowlisted GETs", async () => {
    const requests: Array<{ headers: Headers; method: string; url: string }> =
      [];
    const reader = createT3ActivityReader({
      baseUrl: `${BASE_URL}/`,
      fetcher: async (input, init) => {
        const url = String(input);
        requests.push({
          headers: new Headers(init?.headers),
          method: init?.method ?? "",
          url,
        });
        if (url.endsWith("/.well-known/t3/environment"))
          return descriptorResponse();
        if (url.endsWith("/api/orchestration/shell")) return shellResponse();
        if (url.endsWith("/api/orchestration/threads/thread-1?turnLimit=1")) {
          return detailResponse();
        }
        return new Response("not found", { status: 404 });
      },
      now: NOW,
      token: FIXTURE_TOKEN,
    });

    const shell = await reader.readShell();
    expect(shell).toMatchObject({
      ok: true,
      sourceSequence: 41,
      sourceStream: "shell",
      status: "ok",
      threads: [{ id: "thread-1", session: { status: "running" } }],
    });
    const detail = await reader.readThread({
      threadId: "thread-1",
      turnLimit: 1,
    });
    expect(detail).toMatchObject({
      ok: true,
      sourceSequence: 41,
      sourceStream: "thread:thread-1",
      thread: {
        activities: [{ id: "event-1", kind: "tool-started" }],
        checkpoints: [
          { files: [{ path: "src/t3.ts", additions: 12, deletions: 3 }] },
        ],
        messages: [{ id: "message-1", role: "user" }],
        hasActionableProposedPlan: false,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
      },
    });
    expect(JSON.stringify(detail)).not.toContain("transcript");
    expect(JSON.stringify(detail)).not.toContain("secret-like");
    expect(requests.map((request) => request.url)).toEqual([
      `${BASE_URL}/.well-known/t3/environment`,
      `${BASE_URL}/api/orchestration/shell`,
      `${BASE_URL}/api/orchestration/threads/thread-1?turnLimit=1`,
    ]);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests[0]?.headers.get("authorization")).toBeNull();
    expect(requests[1]?.headers.get("authorization")).toBe(
      `Bearer ${FIXTURE_TOKEN}`,
    );
  });

  test("does not contact T3 without both endpoint and access token", async () => {
    let calls = 0;
    const reader = createT3ActivityReader({
      fetcher: async () => {
        calls += 1;
        return descriptorResponse();
      },
    });

    await expect(reader.readShell()).resolves.toMatchObject({
      ok: false,
      status: "not_configured",
    });
    expect(calls).toBe(0);
  });

  test("maps authentication, permission, network, timeout, and version failures", async () => {
    for (const [response, status] of [
      [new Response(null, { status: 401 }), "authentication_failed"],
      [new Response(null, { status: 403 }), "permission_denied"],
    ] as const) {
      const reader = createT3ActivityReader({
        baseUrl: BASE_URL,
        fetcher: async (input) =>
          String(input).includes("/.well-known")
            ? descriptorResponse()
            : response,
        token: FIXTURE_TOKEN,
      });
      await expect(reader.readShell()).resolves.toMatchObject({
        ok: false,
        status,
      });
    }

    const unreachable = createT3ActivityReader({
      baseUrl: BASE_URL,
      fetcher: async () => {
        throw new TypeError("network down");
      },
      token: FIXTURE_TOKEN,
    });
    await expect(unreachable.readShell()).resolves.toMatchObject({
      ok: false,
      status: "unreachable",
    });

    const timedOut = createT3ActivityReader({
      baseUrl: BASE_URL,
      fetcher: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
      timeoutMs: 1,
      token: FIXTURE_TOKEN,
    });
    await expect(timedOut.readShell()).resolves.toMatchObject({
      ok: false,
      status: "unavailable",
    });

    const bodyTimedOut = createT3ActivityReader({
      baseUrl: BASE_URL,
      fetcher: async (input, init) => {
        if (String(input).includes("/.well-known")) return descriptorResponse();
        return new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener("abort", () => {
                const error = new Error("aborted");
                error.name = "AbortError";
                controller.error(error);
              });
            },
          }),
        );
      },
      timeoutMs: 1,
      token: FIXTURE_TOKEN,
    });
    await expect(bodyTimedOut.readShell()).resolves.toMatchObject({
      ok: false,
      status: "unavailable",
    });

    const incompatible = createT3ActivityReader({
      baseUrl: BASE_URL,
      expectedServerVersion: "0.0.42",
      fetcher: async () => descriptorResponse("0.0.41"),
      token: FIXTURE_TOKEN,
    });
    await expect(incompatible.readShell()).resolves.toMatchObject({
      ok: false,
      status: "incompatible",
    });
  });

  test("rejects malformed and oversized data, and enforces a detail bound", async () => {
    const malformed = createT3ActivityReader({
      baseUrl: BASE_URL,
      fetcher: async (input) =>
        String(input).includes("/.well-known")
          ? descriptorResponse()
          : Response.json({
              projects: [],
              snapshotSequence: "old",
              threads: [],
            }),
      token: FIXTURE_TOKEN,
    });
    await expect(malformed.readShell()).resolves.toMatchObject({
      ok: false,
      status: "invalid_response",
    });

    const oversized = createT3ActivityReader({
      baseUrl: BASE_URL,
      fetcher: async (input) =>
        String(input).includes("/.well-known")
          ? descriptorResponse()
          : new Response("x".repeat(101), {
              headers: { "content-length": "101" },
              status: 200,
            }),
      maxResponseBytes: 100,
      token: FIXTURE_TOKEN,
    });
    await expect(oversized.readShell()).resolves.toMatchObject({
      ok: false,
      status: "invalid_response",
    });

    const reader = createT3ActivityReader({
      baseUrl: BASE_URL,
      token: FIXTURE_TOKEN,
    });
    await expect(
      reader.readThread({ threadId: "thread-1", turnLimit: 0 }),
    ).resolves.toMatchObject({
      ok: false,
      status: "invalid_response",
    });
    await expect(
      reader.readThread({
        threadId: "thread-1",
        turnLimit: MAX_T3_THREAD_TURN_LIMIT + 1,
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "invalid_response",
    });
  });

  test("normalizes safe base URLs and rejects credential-bearing URLs", () => {
    expect(normalizeT3BaseUrl("https://t3.example.test///")).toBe(
      "https://t3.example.test",
    );
    expect(() =>
      normalizeT3BaseUrl("http://user:password@t3.example.test"),
    ).toThrow("without credentials");
    expect(() =>
      normalizeT3BaseUrl("http://t3.example.test?token=fixture"),
    ).toThrow("without credentials");
    expect(normalizeT3BaseUrl("http://192.168.6.100:3773")).toBe(
      "http://192.168.6.100:3773",
    );
    expect(() => normalizeT3BaseUrl("http://8.8.8.8:3773")).toThrow(
      "https:// for non-private hosts",
    );
  });
});
