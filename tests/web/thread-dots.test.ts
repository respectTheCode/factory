import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  getThreadDots,
  threadDotElementId,
  threadDotState,
  type ThreadDotsActivity,
} from "../../src/web/thread-dots";

const source = readFileSync(
  join(import.meta.dir, "../../src/web/thread-dots.tsx"),
  "utf8",
);
const stylesheet = readFileSync(
  join(import.meta.dir, "../../src/web/styles.css"),
  "utf8",
);
const mainSource = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);

const target = { id: "task-1", kind: "task" as const, label: "Task one" };

function activity(
  overrides: Partial<ThreadDotsActivity> = {},
): ThreadDotsActivity {
  return {
    connection: {
      lastSuccessfulFetchAt: "2026-09-20T12:00:00.000Z",
      state: "connected",
    },
    sources: [],
    threads: [],
    ...overrides,
  };
}

function thread(
  threadId: string,
  sourceId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    association: {
      links: [
        {
          linkId: `${sourceId}-link`,
          target,
        },
      ],
      state: "linked" as const,
    },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    sourceId,
    threadId,
    title: `${sourceId} thread`,
    ...overrides,
  };
}

function sourceConnection(
  overrides: Record<string, unknown> = {},
): NonNullable<ThreadDotsActivity["sources"]>[number] {
  return {
    connection: {
      lastSuccessfulFetchAt: "2026-09-20T12:00:00.000Z",
      state: "connected",
    },
    counts: {
      ambiguous: 0,
      linked: 1,
      needsAttention: 0,
      running: 1,
      suggested: 0,
      unmatched: 0,
    },
    machineId: "mac-mini",
    sourceId: "mac",
    status: "ok",
    ...overrides,
  };
}

describe("thread dot presentation", () => {
  test("returns one source-aware dot per linked thread and excludes other targets", () => {
    const dots = getThreadDots(
      activity({
        threads: [
          thread("same-id", "mac"),
          thread("same-id", "ubuntu"),
          thread("other", "mac", {
            association: {
              links: [],
              state: "unmatched" as const,
            },
          }),
        ],
      }),
      target,
      new Date("2026-09-20T12:00:00.000Z"),
    );

    expect(dots.map((dot) => dot.key)).toEqual([
      "mac:same-id",
      "ubuntu:same-id",
    ]);
  });

  test("maps observed states without turning T3 activity into Factory status", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(
      threadDotState(
        activity(),
        thread("running", "mac", { latestSessionState: "running" }),
        now,
      ),
    ).toMatchObject({ tone: "active", label: "running" });
    expect(
      threadDotState(
        activity(),
        thread("waiting", "mac", { hasPendingUserInput: true }),
        now,
      ),
    ).toMatchObject({ tone: "attention", label: "waiting for user input" });
    expect(
      threadDotState(
        activity(),
        thread("failed", "mac", { latestTurnState: "error" }),
        now,
      ),
    ).toMatchObject({ tone: "error", label: "error" });
    expect(
      threadDotState(activity(), thread("unknown", "mac"), now),
    ).toMatchObject({ tone: "neutral", label: "state not reported" });
    expect(
      threadDotState(
        activity({ connection: { state: "connected" } }),
        thread("unknown-age", "mac", { latestSessionState: "running" }),
        now,
      ),
    ).toMatchObject({
      tone: "neutral",
      label: "observation age unknown",
      unknown: true,
    });
  });

  test("makes stale and failed-refresh observations neutral", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const stale = thread("stale", "mac", { latestSessionState: "running" });
    expect(
      threadDotState(
        activity({
          connection: {
            lastSuccessfulFetchAt: "2026-09-18T11:59:59.000Z",
            state: "connected",
          },
        }),
        stale,
        now,
      ),
    ).toMatchObject({
      tone: "neutral",
      label: "stale observation",
      stale: true,
    });
    expect(
      threadDotState(
        activity({
          connection: { state: "unavailable" },
        }),
        thread("cached", "mac", { latestSessionState: "running" }),
        now,
      ),
    ).toMatchObject({ tone: "neutral", label: "observation unavailable" });
  });

  test("keeps cached colored states neutral while project or source matching needs review", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    const running = thread("running", "mac", {
      latestSessionState: "running",
    });
    expect(
      threadDotState(
        activity({
          connection: {
            lastSuccessfulFetchAt: "2026-09-20T12:00:00.000Z",
            state: "connected",
            warning: "Project matching is ambiguous.",
          },
        }),
        running,
        now,
      ),
    ).toMatchObject({
      label: "project matching needs review",
      tone: "neutral",
    });
    expect(
      threadDotState(
        activity({
          sources: [sourceConnection({ status: "unmatched" })],
        }),
        running,
        now,
      ),
    ).toMatchObject({
      label: "source matching needs review",
      tone: "neutral",
    });
    expect(
      threadDotState(
        activity({
          sources: [sourceConnection({ error: "source refresh failed" })],
        }),
        running,
        now,
      ),
    ).toMatchObject({
      label: "source matching needs review",
      tone: "neutral",
    });
  });

  test("uses injective IDs for punctuation in target, source, and thread values", () => {
    const first = threadDotElementId(target, {
      sourceId: "mac.agent",
      threadId: "thread-1",
    });
    const second = threadDotElementId(target, {
      sourceId: "mac-agent",
      threadId: "thread-1",
    });
    expect(first).not.toBe(second);
    expect(
      threadDotElementId(
        { ...target, id: "task.agent" },
        { sourceId: "mac", threadId: "thread-1" },
      ),
    ).not.toBe(
      threadDotElementId(
        { ...target, id: "task-agent" },
        { sourceId: "mac", threadId: "thread-1" },
      ),
    );
  });

  test("keeps disclosure and detail action accessible on touch and keyboard", () => {
    expect(source).toContain('className="thread-dot-disclosure"');
    expect(source).toContain("thread-dot-trigger thread-dot-");
    expect(source).toContain("Open thread details");
    expect(source).toContain("onOpenThread");
    expect(source).toContain("aria-label={`T3 thread");
    expect(mainSource).toContain('className="status-with-thread-dots"');
    expect(stylesheet).toContain(
      ".subtask-title-row > .status-with-thread-dots",
    );
    expect(stylesheet).toContain(
      ".subtask.row-collapsed .subtask-title-row > .status-with-thread-dots",
    );
    expect(stylesheet).toContain(".thread-dot-disclosure:hover");
    expect(stylesheet).toContain(".thread-dot-disclosure:focus-within");
    expect(stylesheet).toContain("@media (max-width: 540px)");
    expect(stylesheet).toContain(".thread-dot-popover");
  });
});
