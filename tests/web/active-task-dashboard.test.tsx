import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  FloorProject as ServerFloorProject,
  FloorSnapshot as ServerFloorSnapshot,
  FloorTaskCard as ServerFloorTaskCard,
} from "../../src/floor";
import { Floor, normalizeFloorSnapshot } from "../../src/web/floor";

const finish = {
  kind: "pr_merge",
  requireHumanCheck: false,
  humanCheckReady: false,
  requiredPrCount: 1,
  mergedPrCount: 0,
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
        lastSuccessfulFetchAt: new Date().toISOString(),
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

function render(
  snapshot: ReturnType<typeof normalizeFloorSnapshot>,
  connected = true,
) {
  return renderToStaticMarkup(
    createElement(Floor, {
      connected,
      loading: false,
      onOpenTarget: () => {},
      snapshot,
    }),
  );
}

describe("simplified Home screen", () => {
  test("groups a task request under Needs you and keeps other work in progress", () => {
    const needsCheck = task({ taskId: "task-check", taskSimpleId: "T-101" });
    const active = task({
      taskId: "task-active",
      taskName: "Prepare release",
      taskSimpleId: "T-102",
    });
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([project({ tasks: [needsCheck, active] })], {
          queue: [
            {
              action: "check",
              id: "check-1",
              projectId: "project-a",
              projectName: "Factory",
              summary: "Refresh the task overview",
              target: { kind: "work", target: needsCheck },
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      ),
    );

    expect(html).toContain('class="simple-floor"');
    expect(html).toContain("Needs you");
    expect(html).toContain("Check it");
    expect(html).toContain("In progress");
    expect(html).toContain("Prepare release");
    expect(html).not.toContain("Create project");
    expect(html).not.toContain("The Floor");
  });

  test("presents the last snapshot as read-only when Factory is offline", () => {
    const checkTask = task({
      finish: {
        ...finish,
        requireHumanCheck: true,
        humanCheckReady: true,
      },
      state: "awaiting_verification",
    });
    const html = render(
      normalizeFloorSnapshot(
        serverSnapshot([project({ tasks: [checkTask] })], {
          connections: [
            {
              fresh: false,
              lastSuccessfulFetchAt: new Date(
                Date.now() - 3_600_000,
              ).toISOString(),
              machineId: "factory-host",
              sourceId: "t3-one",
              state: "unavailable",
            },
          ],
          queue: [
            {
              action: "check",
              id: "check-1",
              projectId: "project-a",
              projectName: "Factory",
              summary: "Refresh the task overview",
              target: { kind: "work", target: checkTask },
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      ),
      false,
    );

    expect(html).toContain("Factory is offline");
    expect(html).toContain("As of");
    expect(html).toContain("read-only");
    expect(html).toContain("Check it");
    expect(html).toContain("disabled");
  });
});
