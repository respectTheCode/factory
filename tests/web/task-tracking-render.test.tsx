import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  ObservedActivityViewModel,
  ObservedThread,
} from "../../src/web/observed-activity";
import { TaskTracking } from "../../src/web/task-tracking-panel";
import type { TrackingStatus, TrackingTask } from "../../src/web/task-tracking";

const now = new Date();
const task: TrackingTask = {
  id: "task-render",
  simpleId: "T-22",
  name: "Session attribution",
  acceptanceCriteria: ["A report is checked against the current revision."],
  subtasks: [
    {
      id: "sub-render",
      simpleId: "ST-22",
      name: "Run the focused test",
      evidence: "Editable work note.",
    },
  ],
};

function thread(overrides: Partial<ObservedThread> = {}): ObservedThread {
  return {
    association: {
      state: "linked",
      links: [
        {
          linkId: "link",
          target: {
            id: "sub-render",
            kind: "subtask",
            label: "Run the focused test",
          },
        },
      ],
    },
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "running",
    latestTurnState: "running",
    observedAt: now.toISOString(),
    sourceUpdatedAt: now.toISOString(),
    provider: "t3",
    sourceId: "mac-render",
    machineId: "machine-render",
    threadId: "thread-render",
    title: "T3 session",
    agent: "Codex",
    codeSessionId: "session-full-12345678",
    runId: "run-full-98765432",
    ...overrides,
  };
}

function activity(
  threadRows: ObservedThread[],
  observedAt = now.toISOString(),
): ObservedActivityViewModel {
  return {
    connection: { state: "connected", observedAt },
    counts: {
      ambiguous: 0,
      linked: threadRows.length,
      needsAttention: 0,
      running: threadRows.length,
      suggested: 0,
      unmatched: 0,
    },
    findings: [],
    targets: [],
    threads: threadRows,
    sources: [
      {
        connection: { state: "connected", observedAt },
        counts: {
          ambiguous: 0,
          linked: threadRows.length,
          needsAttention: 0,
          running: threadRows.length,
          suggested: 0,
          unmatched: 0,
        },
        machineId: "machine-render",
        sourceId: "mac-render",
        status: "ok",
      },
    ],
  };
}

function render(
  props: Partial<React.ComponentProps<typeof TaskTracking>> = {},
) {
  return renderToStaticMarkup(
    createElement(TaskTracking, {
      activity: null,
      busy: false,
      canMutate: false,
      connected: false,
      githubStatuses: {},
      operatorName: "Casey Operator",
      status: undefined,
      task,
      ...props,
    }),
  );
}

describe("task tracking detail rendering", () => {
  test("renders tabs and disabled report controls without inventing sessions", () => {
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("No explicitly linked T3 sessions");
    expect(html).toContain("Append a structured report");
    expect(html).toContain("Reporter · Casey Operator");
    expect(html).toContain('class="task-tracking-submit" disabled=""');
    expect(html).toContain('hidden=""');
  });

  test("shows stale sessions neutrally and separates source freshness from activity age", () => {
    const old = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const staleThread = thread({
      hasPendingApprovals: true,
      sourceUpdatedAt: old,
      observedAt: old,
    });
    const html = render({ activity: activity([staleThread], old) });
    expect(html).toContain("Stale source");
    expect(html).toContain("Source mac-render · machine machine-render");
    expect(html).toContain("Thread · thread-render");
    expect(html).toContain("Code session · session-full-12345678");
    expect(html).toContain("Run · run-full-98765432");
    expect(html).not.toContain("Waiting for approval</span>");
  });

  test("keeps a complete report claim separate from pending Factory acceptance", () => {
    const status: TrackingStatus = {
      taskState: "awaiting_verification",
      subtasks: [
        {
          subtaskId: "sub-render",
          reportId: "report-render",
          reportCreatedAt: now.toISOString(),
          reporter: "Casey Operator",
          machineId: "machine-render",
          reportedState: "complete",
          reason: "Focused tests pass.",
          reportEvidence: "Test output attached.",
          testedRevision: "abc123",
          verificationState: "awaiting_verification",
        },
      ],
    };
    const html = render({ status });
    expect(html).toContain("Claim · complete");
    expect(html).toContain("Acceptance · awaiting verification");
    expect(html).toContain("complete · report claim");
    expect(html).toContain("Factory acceptance");
    expect(html).toContain("Current report reason:");
    expect(html).toContain("Report report-render");
    expect(html).toContain("Test output attached.");
    expect(html).toContain("Check evidence unavailable");
    expect(html).toContain("No review snapshot supplied.");
    expect(html).not.toContain("Current notes:");
  });

  test("labels legacy editable evidence as current notes", () => {
    const status: TrackingStatus = {
      subtasks: [
        {
          subtaskId: "sub-render",
          reportId: "report-legacy",
          reportedState: "in_progress",
          verificationState: "unreported",
        },
      ],
    };
    const html = render({ status });
    expect(html).toContain("Current notes:");
    expect(html).toContain("Editable work note.");
    expect(html).not.toContain("Report evidence:");
  });
});
