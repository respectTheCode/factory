import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  FloorProject as ServerFloorProject,
  FloorSnapshot as ServerFloorSnapshot,
  FloorTaskCard as ServerFloorTaskCard,
} from "../../src/floor";
import {
  Floor,
  FLOOR_BAY_STORAGE_KEY,
  floorTaskCardTarget,
  floorTaskCounts,
  needsYouCountForProject,
  normalizeFloorSnapshot,
  type FloorAction,
} from "../../src/web/floor";
import { statusDefinitions } from "../../src/web/status-presentation";

const themeCss = readFileSync(
  new URL("../../src/web/styles.css", import.meta.url),
  "utf8",
);
const floorCss = readFileSync(
  new URL("../../src/web/floor.css", import.meta.url),
  "utf8",
);

type RGB = [number, number, number];

function cssColor(token: string): RGB {
  const match = themeCss.match(
    new RegExp(`${token}:\\s*(#[\\da-f]{6})\\s*;`, "i"),
  );
  if (!match) throw new Error(`Missing CSS color token ${token}`);
  return hexColor(match[1]!);
}

function hexColor(value: string): RGB {
  return [1, 3, 5].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  ) as RGB;
}

function blend(foreground: RGB, background: RGB, alpha: number): RGB {
  return foreground.map(
    (channel, index) => channel * alpha + background[index]! * (1 - alpha),
  ) as RGB;
}

function luminance(color: RGB): number {
  const linear = color.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrastRatio(first: RGB, second: RGB): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (left, right) => right - left,
  );
  return (lighter! + 0.05) / (darker! + 0.05);
}

function cssRule(selector: RegExp): string {
  return floorCss.match(selector)?.[1] ?? "";
}

const finish = {
  kind: "pr_merge",
  requireHumanCheck: false,
  humanCheckReady: false,
  requiredPrCount: 2,
  mergedPrCount: 1,
  agentReportedFinished: false,
} as const;

function task(
  overrides: Partial<ServerFloorTaskCard> = {},
): ServerFloorTaskCard {
  return {
    finish,
    manualHold: false,
    needsYou: { count: 0, verbs: [] },
    projectId: "project-a",
    sessions: [],
    sessionsAvailable: true,
    state: "active",
    taskId: "task-a",
    taskName: "Refresh the task overview",
    taskSimpleId: "T-100",
    ...overrides,
  };
}

function project(
  overrides: Partial<ServerFloorProject> = {},
): ServerFloorProject {
  return {
    bench: [],
    counter: [],
    counts: { blocked: 0, waiting: 0, working: 0 },
    id: "project-a",
    name: "Factory",
    reviewNeeded: [],
    stations: [],
    tasks: [],
    ...overrides,
  };
}

function serverSnapshot(
  projects: ServerFloorProject[],
  overrides: Partial<ServerFloorSnapshot> = {},
): ServerFloorSnapshot {
  return {
    connections: [
      {
        fresh: true,
        machineId: "factory-host",
        sourceId: "t3-one",
        state: "connected",
      },
    ],
    events: [],
    generatedAt: new Date().toISOString(),
    projects,
    queue: [],
    scoreboard: { reportsToday: 0, stampedToday: 0, workingNow: 0 },
    timezone: "America/Indiana/Indianapolis",
    ...overrides,
  };
}

function render(snapshot: ReturnType<typeof normalizeFloorSnapshot>) {
  return renderToStaticMarkup(
    createElement(Floor, {
      connected: true,
      loading: false,
      onCreateProject: async () => {},
      onOpenTarget: () => {},
      snapshot,
    }),
  );
}

describe("task-centric Floor dashboard", () => {
  test("renders one card per projected task, including in-review work without a queue item", () => {
    const active = task();
    const inReview = task({
      state: "awaiting_verification",
      taskId: "task-review",
      taskName: "Review the report",
      taskSimpleId: "T-101",
    });
    const view = normalizeFloorSnapshot(
      serverSnapshot([project({ tasks: [active, inReview] })]),
    );
    const html = render(view);

    expect(html.match(/class="floor-task-card /g)).toHaveLength(2);
    expect(html).toContain("Review the report");
    expect(html).toContain("In review tasks · visible projects");
    expect(html).toContain("status-icon-awaiting_verification");
    expect(html).not.toContain('class="floor-task-facts"');
    expect(html).not.toContain("Project bays");
    expect(floorTaskCounts(view.projects)).toEqual({
      active: 1,
      blocked: 0,
      inReview: 1,
      doneToday: 0,
    });
  });

  test("task card navigation carries only the project and task IDs and has no nested action", () => {
    const taskRow = task({ needsYou: { count: 1, verbs: ["review"] } });
    const html = render(
      normalizeFloorSnapshot(serverSnapshot([project({ tasks: [taskRow] })])),
    );
    const card = html.match(
      /<article class="floor-task-card [\s\S]*?<\/article>/,
    )?.[0];

    expect(floorTaskCardTarget(taskRow)).toEqual({
      projectId: "project-a",
      taskId: "task-a",
    });
    expect(card).toBeDefined();
    expect(card?.match(/<button\b/g)).toHaveLength(1);
    expect(card).toContain('class="floor-task-needs-you"');
    expect(card).toContain("Needs you · 1 · Review");
    expect(card).toContain(
      'aria-label="Open active task T-100: Refresh the task overview"',
    );
    expect(card).toContain("Needs you · 1 · Review");
    expect(card).not.toContain('action="review"');
    expect(floorCss).toMatch(
      /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%,\s*270px\),\s*1fr\)\)/,
    );
    expect(floorCss).toMatch(
      /\.floor-task-title\s*\{\s*border-radius:[\s\S]*?display:\s*block[\s\S]*?padding:\s*13px 0/,
    );
    expect(cssRule(/\.floor-task-title > span\s*\{([^}]*)\}/)).toMatch(
      /-webkit-line-clamp:\s*2/,
    );
    expect(cssRule(/\.floor-task-title::after\s*\{([^}]*)\}/)).toMatch(
      /inset:\s*0/,
    );
    expect(
      cssRule(
        /\.floor-task-card:has\(\.floor-task-title:focus-visible\)\s*\{([^}]*)\}/,
      ),
    ).toMatch(/outline:\s*2px solid var\(--accent\)/);
  });

  test("visible-project counts use recorded task states and recently-done records", () => {
    const visible = project({
      tasks: [
        task(),
        task({ state: "blocked", taskId: "blocked", taskSimpleId: "T-102" }),
        task({
          state: "awaiting_verification",
          taskId: "review",
          taskSimpleId: "T-103",
        }),
        task({ state: "planned", taskId: "planned", taskSimpleId: "T-104" }),
        task({ state: "backlog", taskId: "backlog", taskSimpleId: "T-105" }),
      ],
      recentlyDone: [
        task({ state: "completed", taskId: "done", taskSimpleId: "T-106" }),
      ],
    });
    const hidden = project({
      id: "project-hidden",
      name: "Hidden project",
      tasks: [task({ projectId: "project-hidden", taskId: "hidden-active" })],
      recentlyDone: [
        task({
          projectId: "project-hidden",
          state: "completed",
          taskId: "hidden-done",
        }),
      ],
    });

    const visibleView = normalizeFloorSnapshot(
      serverSnapshot([visible]),
    ).projects;
    const allView = normalizeFloorSnapshot(
      serverSnapshot([visible, hidden]),
    ).projects;
    expect(floorTaskCounts(visibleView)).toEqual({
      active: 1,
      blocked: 1,
      inReview: 1,
      doneToday: 1,
    });
    expect(floorTaskCounts(allView).active).toBe(2);
  });

  test("hidden-project attention counts include related targets and do not double count one queue item", () => {
    const items = [
      {
        id: "review-shared",
        kind: "review",
        label: "Review shared work",
        ageLabel: "5m",
        projectId: "project-a",
        relatedTargets: [
          {
            projectId: "project-b",
            taskId: "task-b",
            taskName: "Related",
            taskSimpleId: "T-200",
          },
        ],
      },
      {
        id: "review-shared",
        kind: "review",
        label: "Review shared work",
        ageLabel: "5m",
        projectId: "project-b",
      },
    ] as FloorAction[];

    expect(needsYouCountForProject("project-a", items)).toBe(1);
    expect(needsYouCountForProject("project-b", items)).toBe(1);
    expect(needsYouCountForProject("project-c", items)).toBe(0);
  });

  test("a hidden project chip keeps its related attention count while Needs you remains global", () => {
    const relatedTask = {
      projectId: "project-b",
      taskId: "task-b",
      taskName: "Related task",
      taskSimpleId: "T-200",
    };
    const view = normalizeFloorSnapshot(
      serverSnapshot(
        [
          project({ tasks: [task()] }),
          project({
            id: "project-b",
            name: "Hidden project",
            tasks: [task({ projectId: "project-b", taskId: "task-b" })],
          }),
        ],
        {
          queue: [
            {
              action: "review",
              id: "review-shared",
              projectId: "project-a",
              projectName: "Factory",
              relatedTargets: [relatedTask],
              summary: "Review shared work",
              target: { kind: "work", target: task() },
              timestamp: new Date().toISOString(),
            },
          ],
        },
      ),
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) =>
            key === FLOOR_BAY_STORAGE_KEY
              ? JSON.stringify({ collapsed: ["project-b"], version: 1 })
              : null,
          setItem: () => {},
        },
      },
    });
    try {
      const html = render(view);
      expect(html).toContain("1 needs you");
      expect(html).toContain('class="floor-project-chip hidden needs-you"');
      expect(html).toContain("Needs you · global queue");
      expect(html).toContain("Review shared work");
    } finally {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  test("keeps fresh project sessions visible when another source is unavailable", () => {
    const linkedSession = {
      association: "linked",
      id: "thread-one",
      state: "working",
      target: {
        projectId: "project-a",
        taskId: "task-a",
        taskName: "Refresh the task overview",
        taskSimpleId: "T-100",
      },
      threadId: "thread-one",
      worker: { identity: "codex", initials: "CX" },
    } as const;
    const view = normalizeFloorSnapshot(
      serverSnapshot(
        [
          project({
            tasks: [task({ sessions: [linkedSession] })],
            sessionsAvailable: true,
          }),
        ],
        {
          connections: [
            {
              fresh: false,
              machineId: "other-host",
              sourceId: "t3-two",
              state: "unavailable",
            },
          ],
          scoreboard: { reportsToday: 0, stampedToday: 0, workingNow: 1 },
        },
      ),
    );

    const html = render(view);
    expect(view.stale).toBe(true);
    expect(html).toContain("one or more sources unavailable");
    expect(html).toContain("working</small>");
    expect(html).not.toContain("last observed; snapshot is stale");
  });

  test("groups linked contributors and shows recorded handoff attribution", () => {
    const handoffAt = new Date(Date.now() - 12 * 60_000).toISOString();
    const sharedTarget = {
      projectId: "project-b",
      taskId: "task-b",
      taskName: "Related task",
      taskSimpleId: "T-200",
    };
    const card = task({
      handoff: {
        additionalCount: 1,
        nextAction: "Inspect the current preview",
        nextOwner: "Casey",
        nextOwnerKind: "human",
        reportedAt: handoffAt,
        reporter: "Codex",
      },
      sessions: [
        {
          association: "linked",
          id: "thread-one",
          relatedTargets: [
            {
              projectId: "project-a",
              taskId: "task-a",
              taskName: "Refresh the task overview",
              taskSimpleId: "T-100",
            },
            sharedTarget,
          ],
          state: "working",
          target: task(),
          threadId: "thread-one",
          threadTitle: "Dashboard implementation",
          worker: { identity: "codex", initials: "CX" },
        },
        {
          association: "linked",
          id: "thread-two",
          state: "waiting_input",
          target: task(),
          threadId: "thread-two",
          threadTitle: "Need a product decision",
          worker: { identity: "claude", initials: "CL" },
        },
      ],
    });
    const html = render(
      normalizeFloorSnapshot(serverSnapshot([project({ tasks: [card] })])),
    );

    expect(html).toContain("Next · Casey");
    expect(html).toContain("Inspect the current preview");
    expect(html).toContain("Reported by Codex · 12m ago");
    expect(html).toContain("+1 more recorded handoffs");
    expect(html).toContain("Dashboard implementation");
    expect(html).toContain("Need a product decision");
    expect(html).toContain("Also linked to T-200");
    expect(html).not.toContain("Refresh the task overview</strong>");
  });

  test("shows blocked reasons and an explicit manual-hold marker", () => {
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([
          project({
            tasks: [
              task({
                manualHold: true,
                state: "blocked",
                stateReason: "Waiting for a fresh preview.",
                taskId: "task-blocked",
                taskSimpleId: "T-120",
              }),
            ],
          }),
        ]),
      ),
    );

    expect(html).toContain("Manual hold");
    expect(html).toContain("Waiting for a fresh preview.");
    expect(html).toContain('class="floor-task-reason blocked"');
  });

  test("keeps unmatched sessions separate and marks unavailable session sources", () => {
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([
          project({
            tasks: [task({ sessionsAvailable: false })],
            unmatchedSessions: [
              {
                association: "ambiguous",
                id: "unlinked-thread",
                state: "idle",
                threadId: "unlinked-thread",
                threadTitle: "Unmatched working thread",
                worker: { identity: "unknown", initials: "??" },
              },
            ],
          }),
        ]),
      ),
    );

    expect(html).toContain("Session status unavailable.");
    expect(html).toContain(
      "Some observed sources may not provide session data for this project.",
    );
    expect(html).toContain("Sessions without a task");
    expect(html).toContain("Not counted as tasks");
    expect(html).toContain("Unmatched working thread");
  });

  test("marks session observations as old when the Floor snapshot itself is stale", () => {
    const oldSnapshot = serverSnapshot(
      [
        project({
          tasks: [
            task({
              sessions: [
                {
                  association: "linked",
                  id: "old-session",
                  state: "working",
                  target: task(),
                  threadId: "old-session",
                  threadTitle: "Previously working thread",
                  worker: { identity: "codex", initials: "CX" },
                },
              ],
            }),
          ],
        }),
      ],
      { generatedAt: new Date(Date.now() - 60_000).toISOString() },
    );
    const html = render(normalizeFloorSnapshot(oldSnapshot));

    expect(html).toContain("snapshot stale");
    expect(html).toContain("last observed; snapshot is stale");
    expect(html).not.toContain("No linked session observed.");
  });

  test("shows finish rules and open Steps without percentages or a fake zero-step count", () => {
    const done = task({
      finishProvenance: "PR #18 merged to main",
      state: "completed",
      steps: { done: 1, total: 3 },
      taskId: "task-done",
      taskName: "Merged work",
      taskSimpleId: "T-110",
    });
    const zeroSteps = task({
      finish: {
        ...finish,
        kind: "agent_report",
        requireHumanCheck: true,
        humanCheckReady: true,
      },
      steps: undefined,
      taskId: "task-zero",
      taskName: "No step list",
      taskSimpleId: "T-111",
    });
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([
          project({
            tasks: [zeroSteps],
            recentlyDone: [done],
          }),
        ]),
      ),
    );

    expect(html).toContain("Done · 2 Steps left open");
    expect(html).toContain("Finish evidence · PR #18 merged to main");
    const doneCard = html.match(
      /<article class="floor-task-card state-completed[\s\S]*?<\/article>/,
    )?.[0];
    expect(doneCard).toBeDefined();
    expect(doneCard).not.toContain("Finish rule");
    expect(html).not.toContain("0/0");
    expect(html).not.toContain("% complete");
    expect(html).not.toContain('class="floor-recently-done" open');
  });

  test("fails closed when an older Floor projection has no task-card field", () => {
    const html = render(
      normalizeFloorSnapshot(serverSnapshot([project({ tasks: undefined })])),
    );
    expect(html).toContain("Task overview unavailable");
    expect(html).not.toContain("Refresh the task overview");
  });

  test("keeps planned cards compact and suppresses only generated merge-wait reasons", () => {
    const planned = task({ state: "planned", taskId: "planned" });
    const repeatedReason = task({
      stateReason: "Waiting for required pull requests to merge (1 of 2).",
    });
    const customReason = task({
      state: "completed",
      stateReason: "Marked done by the project owner.",
      finishProvenance: "Human marked done",
      taskId: "done-with-reason",
    });
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([
          project({
            recentlyDone: [customReason],
            tasks: [planned, repeatedReason],
          }),
        ]),
      ),
    );

    const plannedCard = html.match(
      /<article class="floor-task-card state-planned planned[\s\S]*?<\/article>/,
    )?.[0];
    const progressCard = html.match(
      /<article class="floor-task-card state-active[\s\S]*?<\/article>/,
    )?.[0];
    const doneCard = html.match(
      /<article class="floor-task-card state-completed[\s\S]*?<\/article>/,
    )?.[0];

    expect(plannedCard).toBeDefined();
    expect(plannedCard).not.toContain("Finish rule");
    expect(progressCard).toBeDefined();
    expect(progressCard).not.toContain(
      "Waiting for required pull requests to merge",
    );
    expect(progressCard).toContain("Finish rule");
    expect(doneCard).toBeDefined();
    expect(doneCard).not.toContain("Finish rule");
    expect(doneCard).toContain("Marked done by the project owner.");
    expect(doneCard).toContain("Finish evidence · Human marked done");
  });

  test("explains incomplete queue breakdowns and formats observed log details consistently", () => {
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([project({ tasks: [task()] })], {
          connections: [
            {
              fresh: false,
              machineId: "factory-host",
              sourceId: "t3-one",
              state: "unavailable",
            },
          ],
          events: [
            {
              actor: "Codex",
              id: "codex-event",
              kind: "report",
              projectId: "project-a",
              summary: "Updated task evidence",
              timestamp: "2026-10-11T15:04:05.000Z",
            },
            {
              actor: "Claude",
              id: "claude-event",
              kind: "report",
              projectId: "project-a",
              summary: "Reviewed implementation",
              timestamp: "2026-10-11T15:03:05.000Z",
            },
            {
              actor: "Luna",
              id: "luna-event",
              kind: "report",
              projectId: "project-a",
              summary: "Completed implementation",
              timestamp: "2026-10-11T15:02:05.000Z",
            },
          ],
        }),
      ),
    );

    expect(html).toContain(
      "Some queue sources are unavailable; this breakdown may be incomplete.",
    );
    expect(html).toContain('class="floor-log-who">CX</span>');
    expect(html).toContain('class="floor-log-who">CL</span>');
    expect(html).toContain('class="floor-log-who">LU</span>');
    expect(html).toMatch(/class="floor-log-time">\d{2}:\d{2}<\/span>/);
    expect(html).not.toMatch(/class="floor-log-time">\d{2}:\d{2}:\d{2}/);
    expect(html.match(/class="floor-log-time">[^<]*/g)?.join("")).not.toContain(
      "PM",
    );
  });

  test("shows singular observed session counts and keeps disclosure controls explicit", () => {
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([project({ tasks: [task()] })], {
          scoreboard: { reportsToday: 0, stampedToday: 0, workingNow: 1 },
        }),
      ),
    );

    expect(html).toContain("fresh observed session working");
    expect(html).not.toContain("fresh observed sessions working");
    expect(html).toContain("floor-disclosure-caret");
  });

  test("small task and session labels meet AA contrast on normal and planned cards", () => {
    const ink = cssColor("--ink");
    const dimInk = cssColor("--ink-dim");
    const normalCard = cssColor("--raised");
    const plannedCard = blend(cssColor("--panel"), cssColor("--canvas"), 0.48);
    const provenanceRule = cssRule(/\.floor-task-provenance\s*\{([^}]*)\}/);
    const cardBackgrounds = [normalCard, plannedCard];
    const stateRule = cssRule(/\.floor-task-state\s*\{([^}]*)\}/);
    const priorityRule = cssRule(/\.floor-priority\s*\{([^}]*)\}/);
    const urgentPriorityRule = cssRule(
      /\.priority-urgent,\s*\.priority-high\s*\{([^}]*)\}/,
    );
    const sessionStateRule = cssRule(
      /\.floor-session-copy small\s*\{([^}]*)\}/,
    );
    const plannedCardRule = cssRule(/\.floor-task-card\.planned\s*\{([^}]*)\}/);

    expect(plannedCardRule).toMatch(
      /background:\s*rgba\(27,\s*24,\s*21,\s*0\.48\)/,
    );
    expect(stateRule).toMatch(/background:\s*color-mix\([\s\S]*?18%/);
    expect(stateRule).toMatch(/border:\s*1px solid\s+color-mix\([\s\S]*?55%/);
    expect(stateRule).toMatch(/color:\s*var\(--ink\)/);
    expect(stateRule).toMatch(/font:\s*600 0\.69rem/);

    for (const definition of Object.values(statusDefinitions)) {
      const stateColor = hexColor(definition.color);
      for (const cardBackground of cardBackgrounds) {
        const chipBackground = blend(stateColor, cardBackground, 0.18);
        expect(contrastRatio(ink, chipBackground)).toBeGreaterThanOrEqual(4.5);
      }
    }

    expect(priorityRule).toMatch(/color:\s*var\(--ink-dim\)/);
    expect(urgentPriorityRule).toMatch(
      /border-color:\s*rgba\(229,\s*72,\s*77,\s*0\.6\)/,
    );
    expect(urgentPriorityRule).toMatch(/color:\s*var\(--ink\)/);
    for (const cardBackground of cardBackgrounds) {
      expect(contrastRatio(dimInk, cardBackground)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, cardBackground)).toBeGreaterThanOrEqual(4.5);
    }

    expect(sessionStateRule).toMatch(/color:\s*var\(--ink-dim\)/);
    expect(sessionStateRule).toMatch(/font:\s*400 0\.69rem/);
    expect(provenanceRule).toMatch(/background:\s*var\(--tint-ok\)/);
    expect(provenanceRule).toMatch(/color:\s*var\(--ink\)/);
    expect(
      contrastRatio(ink, blend(cssColor("--sig-ok"), normalCard, 0.16)),
    ).toBeGreaterThanOrEqual(4.5);
    expect(cssRule(/\.floor-task-reference\s*\{([^}]*)\}/)).toMatch(
      /font:\s*500 0\.69rem/,
    );
    expect(cssRule(/\.floor-task-handoff small\s*\{([^}]*)\}/)).toMatch(
      /font:\s*400 0\.69rem/,
    );
    expect(
      cssRule(
        /\.floor-task-reason,\s*\.floor-task-manual-hold,\s*\.floor-task-handoff,\s*\.floor-task-needs-you,\s*\.floor-task-provenance,\s*\.floor-task-finish\s*\{([^}]*)\}/,
      ),
    ).toMatch(/font-size:\s*0\.8125rem/);
    for (const cardBackground of cardBackgrounds) {
      expect(contrastRatio(dimInk, cardBackground)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
