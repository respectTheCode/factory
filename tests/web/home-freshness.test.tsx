import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  FloorConnection,
  FloorProject,
  FloorQueueItem,
  FloorSnapshot as ServerFloorSnapshot,
  FloorTaskCard,
} from "../../src/floor";
import { Floor, normalizeFloorSnapshot } from "../../src/web/floor";

const finish = {
  kind: "agent_report",
  requireHumanCheck: false,
  humanCheckReady: false,
  requiredPrCount: 0,
  mergedPrCount: 0,
  agentReportedFinished: false,
} as const;

function task(overrides: Partial<FloorTaskCard> = {}): FloorTaskCard {
  return {
    projectId: "project-a",
    taskId: "task-a",
    taskSimpleId: "T-100",
    taskName: "Refresh the task overview",
    finish,
    manualHold: false,
    needsYou: { count: 0, verbs: [] },
    sessions: [],
    sessionsAvailable: true,
    state: "active",
    ...overrides,
  };
}

function project(overrides: Partial<FloorProject> = {}): FloorProject {
  return {
    id: "project-a",
    name: "Factory",
    bench: [],
    counter: [],
    counts: { blocked: 0, waiting: 0, working: 0 },
    reviewNeeded: [],
    stations: [],
    tasks: [],
    ...overrides,
  };
}

function connection(
  sourceId: string,
  fresh: boolean,
  fetchedAt: string,
): FloorConnection {
  return {
    sourceId,
    machineId: `machine-${sourceId}`,
    state: fresh ? "connected" : "unavailable",
    fresh,
    lastSuccessfulFetchAt: fetchedAt,
  };
}

function serverSnapshot(
  projects: FloorProject[],
  overrides: Partial<ServerFloorSnapshot> = {},
): ServerFloorSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    timezone: "America/Indiana/Indianapolis",
    projects,
    queue: [],
    events: [],
    scoreboard: { reportsToday: 0, stampedToday: 0, workingNow: 0 },
    connections: [],
    ...overrides,
  };
}

function render(snapshot: ServerFloorSnapshot): string {
  return renderToStaticMarkup(
    createElement(Floor, {
      connected: true,
      loading: false,
      onOpenTarget: () => {},
      snapshot: normalizeFloorSnapshot(snapshot),
    }),
  );
}

describe("Home source freshness and request copy", () => {
  test("keeps a healthy task session current when a different source is unavailable", () => {
    const now = Date.now();
    const html = render(
      serverSnapshot(
        [
          project({
            tasks: [
              task({
                sessions: [
                  {
                    id: "session-healthy",
                    state: "working",
                    association: "linked",
                    sourceId: "healthy-source",
                    threadId: "thread-healthy",
                    threadTitle: "Release checks",
                    observedAt: new Date(now - 5_000).toISOString(),
                    worker: { identity: "codex", initials: "CX" },
                  },
                ],
              }),
            ],
          }),
        ],
        {
          generatedAt: new Date(now - 5_000).toISOString(),
          connections: [
            connection(
              "healthy-source",
              true,
              new Date(now - 5_000).toISOString(),
            ),
            connection(
              "unavailable-source",
              false,
              new Date(now - 5 * 60_000).toISOString(),
            ),
          ],
        },
      ),
    );

    expect(html).toContain("Codex is working in “Release checks”.");
    expect(html).toContain('class="home-freshness stale" role="status"');
    expect(html).toContain("T3 not reporting");
    expect(html.indexOf('class="home-freshness')).toBeLessThan(
      html.indexOf('id="home-summary"'),
    );
    expect(html).not.toContain("Codex was working in “Release checks”.");
  });

  test("labels work in an aged snapshot as last observed instead of currently working", () => {
    const now = Date.now();
    const html = render(
      serverSnapshot(
        [
          project({
            tasks: [
              task({
                sessions: [
                  {
                    id: "session-recent-source",
                    state: "working",
                    association: "linked",
                    sourceId: "source-a",
                    threadId: "thread-a",
                    threadTitle: "Task implementation",
                    observedAt: new Date(now - 2 * 60_000).toISOString(),
                    worker: { identity: "claude", initials: "CL" },
                  },
                ],
              }),
            ],
          }),
        ],
        {
          generatedAt: new Date(now - 2 * 60_000).toISOString(),
          connections: [
            connection("source-a", true, new Date(now - 5_000).toISOString()),
          ],
        },
      ),
    );

    expect(html).toContain("Last observed by Factory");
    expect(html).toContain('class="home-freshness stale" role="status"');
    expect(html).toContain("Snapshot ");
    expect(html).toContain("may be old");
    expect(html.indexOf('class="home-freshness')).toBeLessThan(
      html.indexOf('id="home-summary"'),
    );
    expect(html).toContain("Claude was working in “Task implementation”.");
    expect(html).not.toContain("Claude is working in “Task implementation”.");
  });

  test("a work-target decide request does not imply a T3 wait or expose Thread details", () => {
    const taskCard = task();
    const queueItem: FloorQueueItem = {
      id: "task-decision",
      action: "decide",
      target: { kind: "work", target: taskCard },
      timestamp: new Date().toISOString(),
      projectId: "project-a",
      projectName: "Factory",
      summary: "Choose the release window",
      reason: "The status report needs an owner.",
    };
    const html = render(
      serverSnapshot([project({ tasks: [taskCard] })], {
        queue: [queueItem],
      }),
    );

    expect(html).toContain("Task details");
    expect(html).toContain(
      "Factory needs you to resolve a task tracking issue",
    );
    expect(html).not.toContain("An agent is waiting for you in T3.");
    expect(html).not.toContain(">Thread details</button>");
  });

  test("an unblock row uses the actionable queue summary, not contextual reason text", () => {
    const taskCard = task({
      taskName: "Rotate the staging certificate",
    });
    const queueItem: FloorQueueItem = {
      id: "unblock-certificate",
      action: "unblock",
      target: { kind: "work", target: taskCard },
      timestamp: new Date().toISOString(),
      projectId: "project-a",
      projectName: "Factory",
      summary: "Upload the renewed certificate to Dokploy",
      reason: "The prior deployment failed validation.",
    };
    const html = render(
      serverSnapshot([project({ tasks: [taskCard] })], {
        queue: [queueItem],
      }),
    );

    expect(html).toContain(
      "Blocked on you: Upload the renewed certificate to Dokploy",
    );
    expect(html).not.toContain("The prior deployment failed validation.");
  });
});
