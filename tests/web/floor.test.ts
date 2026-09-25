import { describe, expect, test } from "bun:test";

import type { FloorSnapshot as ServerFloorSnapshot } from "../../src/floor";
import {
  normalizeFloorSnapshot,
  parseCollapsedBayIds,
  readCollapsedBayIds,
  serializeCollapsedBayIds,
  toggleCollapsedBayIds,
  writeCollapsedBayIds,
} from "../../src/web/floor";

const target = {
  projectId: "project-1",
  taskId: "task-1",
  taskName: "Floor work",
  taskSimpleId: "T-1",
};

describe("Floor projection view model", () => {
  test("preserves typed bays, worker states, oldest claims, and exact report IDs", () => {
    const snapshot: ServerFloorSnapshot = {
      connections: [
        {
          fresh: true,
          machineId: "mac-mini",
          sourceId: "source-1",
          state: "connected",
        },
      ],
      events: [],
      generatedAt: "2026-09-22T15:00:00.000Z",
      projects: [
        {
          bench: [],
          counter: [
            {
              ...target,
              evidence: "Synthetic evidence: Floor claim is ready for review.",
              reportId: "report-1",
              reportedAt: "2026-09-18T15:00:00.000Z",
              reporter: "codex",
              reason: "Claim reason stays separate from evidence.",
              subtaskId: "subtask-1",
              subtaskName: "Verify Floor",
              subtaskSimpleId: "ST-1",
            },
          ],
          counts: { blocked: 0, waiting: 1, working: 1 },
          id: "project-1",
          name: "Factory",
          reviewNeeded: [],
          stations: [
            {
              association: "linked",
              id: "thread:source-1:thread-1",
              state: "working",
              target: {
                ...target,
                subtaskId: "subtask-1",
                subtaskName: "Verify Floor",
                subtaskSimpleId: "ST-1",
              },
              threadId: "thread-1",
              worker: { identity: "codex", initials: "CX" },
            },
          ],
        },
      ],
      queue: [
        {
          action: "stamp",
          id: "stamp:report-1",
          projectId: "project-1",
          projectName: "Factory",
          summary: "Stamp Floor work / Verify Floor",
          target: {
            kind: "work",
            target: {
              ...target,
              subtaskId: "subtask-1",
              subtaskName: "Verify Floor",
              subtaskSimpleId: "ST-1",
            },
          },
          timestamp: "2026-09-18T15:00:00.000Z",
        },
      ],
      scoreboard: { reportsToday: 1, stampedToday: 0, workingNow: 1 },
      timezone: "America/Indiana/Indianapolis",
    };

    const view = normalizeFloorSnapshot(snapshot);
    expect(view.projects[0]?.stations[0]?.reporter).toBe("codex");
    expect(view.projects[0]?.stations[0]?.tokenState).toBe("working");
    expect(view.projects[0]?.counter[0]?.reportId).toBe("report-1");
    expect(view.projects[0]?.counter[0]?.claim).toBe(
      "Claim reason stays separate from evidence.",
    );
    expect(view.projects[0]?.counter[0]?.evidence).toBe(
      "Synthetic evidence: Floor claim is ready for review.",
    );
    expect(view.projects[0]?.counter[0]?.simpleId).toBe("ST-1");
    expect(view.yourTurn.items[0]?.paper?.reportId).toBe("report-1");
    expect(view.scoreboard.workingNow).toBe(1);
  });

  test("keeps manual review links separate from stamp actions and reports stale connections", () => {
    const snapshot: ServerFloorSnapshot = {
      connections: [
        {
          fresh: false,
          machineId: "mac-mini",
          sourceId: "source-1",
          state: "unavailable",
        },
      ],
      events: [],
      generatedAt: "2026-09-22T15:00:00.000Z",
      projects: [
        {
          bench: [],
          counter: [],
          counts: { blocked: 0, waiting: 1, working: 0 },
          id: "project-1",
          name: "Factory",
          reviewNeeded: [
            {
              ...target,
              createdAt: "2026-09-20T15:00:00.000Z",
              state: "planned",
            },
          ],
          stations: [],
        },
      ],
      queue: [
        {
          action: "review",
          id: "review:task-1",
          projectId: "project-1",
          projectName: "Factory",
          summary: "Review Floor work",
          target: { kind: "work", target },
          timestamp: "2026-09-20T15:00:00.000Z",
        },
      ],
      scoreboard: { reportsToday: 0, stampedToday: 0, workingNow: 0 },
      timezone: "America/Indiana/Indianapolis",
    };

    const view = normalizeFloorSnapshot(snapshot);
    expect(view.stale).toBe(true);
    expect(view.yourTurn.items[0]?.kind).toBe("unblock");
    expect(view.yourTurn.items[0]?.paper).toBeUndefined();
  });
});

describe("Floor project visibility persistence", () => {
  test("round trips versioned hidden IDs and toggles one project", () => {
    let stored: string | null = null;
    const storage = {
      getItem: () => stored,
      setItem: (_key: string, value: string) => {
        stored = value;
      },
    };
    const initial = new Set(["project-b", "project-a"]);

    expect(serializeCollapsedBayIds(initial)).toBe(
      '{"collapsed":["project-a","project-b"],"version":1}',
    );
    writeCollapsedBayIds(initial, storage);
    expect(readCollapsedBayIds(storage)).toEqual(initial);
    expect(toggleCollapsedBayIds(initial, "project-a")).toEqual(
      new Set(["project-b"]),
    );
    expect(toggleCollapsedBayIds(initial, "project-c")).toEqual(
      new Set(["project-b", "project-a", "project-c"]),
    );
  });

  test("fails closed for malformed, old-version, and unavailable storage", () => {
    expect(parseCollapsedBayIds("not json")).toEqual(new Set());
    expect(
      parseCollapsedBayIds('{"collapsed":["project-a"],"version":0}'),
    ).toEqual(new Set());
    expect(
      parseCollapsedBayIds('{"collapsed":["project-a",7,""],"version":1}'),
    ).toEqual(new Set(["project-a"]));

    const unavailable = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };
    expect(readCollapsedBayIds(unavailable)).toEqual(new Set());
    expect(() =>
      writeCollapsedBayIds(new Set(["project-a"]), unavailable),
    ).not.toThrow();
  });
});
