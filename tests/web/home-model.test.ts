import { describe, expect, test } from "bun:test";

import type {
  FloorProject,
  FloorQueueItem,
  FloorSnapshot as ServerFloorSnapshot,
  FloorTarget,
  FloorTaskCard,
} from "../../src/floor";
import { normalizeFloorSnapshot } from "../../src/web/floor";
import { buildHomeGroups, homeTaskSentence } from "../../src/web/home-model";

const finish = {
  kind: "agent_report",
  requireHumanCheck: false,
  humanCheckReady: false,
  requiredPrCount: 0,
  mergedPrCount: 0,
  agentReportedFinished: false,
} as const;

function target(
  projectId: string,
  taskId: string,
  taskName = taskId,
): FloorTarget {
  return {
    projectId,
    taskId,
    taskName,
    taskSimpleId: taskId.toUpperCase(),
  };
}

function task(
  projectId: string,
  taskId: string,
  overrides: Partial<FloorTaskCard> = {},
): FloorTaskCard {
  return {
    ...target(projectId, taskId, `Task ${taskId}`),
    finish,
    manualHold: false,
    needsYou: { count: 0, verbs: [] },
    sessions: [],
    sessionsAvailable: true,
    state: "active",
    ...overrides,
  };
}

function project(
  id: string,
  name: string,
  overrides: Partial<FloorProject> = {},
): FloorProject {
  return {
    bench: [],
    counter: [],
    counts: { blocked: 0, waiting: 0, working: 0 },
    id,
    name,
    reviewNeeded: [],
    stations: [],
    tasks: [],
    ...overrides,
  };
}

function workRequest(
  id: string,
  taskTarget: FloorTarget,
  timestamp: string,
  action: FloorQueueItem["action"] = "check",
): FloorQueueItem {
  return {
    id,
    action,
    target: { kind: "work", target: taskTarget },
    timestamp,
    projectId: taskTarget.projectId,
    projectName: `Queue name ${taskTarget.projectId}`,
    summary: `Request ${id}`,
  };
}

function threadRequest(
  id: string,
  projectId: string,
  timestamp: string,
  options: {
    linkedTask?: FloorTarget;
    relatedTargets?: FloorTarget[];
  } = {},
): FloorQueueItem {
  return {
    id,
    action: "decide",
    target: {
      kind: "thread",
      projectId,
      threadId: `thread-${id}`,
      threadTitle: `Thread ${id}`,
      sourceId: "t3-source",
      ...(options.linkedTask ? { target: options.linkedTask } : {}),
    },
    timestamp,
    projectId,
    projectName: `Queue name ${projectId}`,
    summary: `Thread request ${id}`,
    ...(options.relatedTargets
      ? { relatedTargets: options.relatedTargets }
      : {}),
  };
}

function serverSnapshot(
  projects: FloorProject[],
  queue: FloorQueueItem[],
): ServerFloorSnapshot {
  return {
    connections: [],
    events: [],
    generatedAt: "2026-10-15T12:00:00.000Z",
    projects,
    queue,
    scoreboard: { reportsToday: 0, stampedToday: 0, workingNow: 0 },
    timezone: "America/Indiana/Indianapolis",
  };
}

function group(projects: FloorProject[], queue: FloorQueueItem[]) {
  const normalized = normalizeFloorSnapshot(serverSnapshot(projects, queue));
  return buildHomeGroups(normalized.projects, normalized.yourTurn.items);
}

describe("buildHomeGroups", () => {
  test("keeps every queue request, including a thread with no task", () => {
    const linked = task("project-a", "task-a");
    const planned = task("project-a", "task-planned", { state: "planned" });
    const backlog = task("project-a", "task-backlog", { state: "backlog" });
    const completed = task("project-a", "task-completed", {
      state: "completed",
    });
    const queue = [
      threadRequest("unlinked-thread", "project-a", "2026-10-15T10:00:00Z"),
      workRequest(
        "planned-approval",
        target("project-a", "task-planned"),
        "2026-10-15T10:01:00Z",
      ),
      workRequest(
        "backlog-check",
        target("project-a", "task-backlog"),
        "2026-10-15T10:02:00Z",
      ),
      workRequest(
        "completed-thread-request",
        target("project-a", "task-completed"),
        "2026-10-15T10:03:00Z",
        "review",
      ),
      workRequest(
        "active-check",
        target("project-a", "task-a"),
        "2026-10-15T10:04:00Z",
      ),
    ];
    const groups = group(
      [
        project("project-a", "Factory", {
          tasks: [linked, planned, backlog, completed],
        }),
      ],
      queue,
    );

    const needsYouRequests = groups.needsYou.flatMap((row) => row.requests);
    expect(new Set(needsYouRequests.map((request) => request.id))).toEqual(
      new Set(queue.map((request) => request.id)),
    );
    expect(
      groups.needsYou.find((row) => row.id === "request:unlinked-thread"),
    ).toMatchObject({
      projectId: "project-a",
      projectName: "Queue name project-a",
      title: "Thread request unlinked-thread",
    });
    expect(
      groups.needsYou.find((row) => row.taskId === "task-planned"),
    ).toBeDefined();
    expect(
      groups.needsYou.find((row) => row.taskId === "task-backlog"),
    ).toBeDefined();
    expect(
      groups.needsYou.find((row) => row.taskId === "task-completed"),
    ).toBeDefined();
    expect(
      groups.doneToday.some((row) => row.taskId === "task-completed"),
    ).toBe(false);
    expect(groups.plannedNotStarted).toBe(0);
  });

  test("orders multiple requests for one task oldest first", () => {
    const groups = group(
      [
        project("project-a", "Factory", {
          tasks: [task("project-a", "task-a")],
        }),
      ],
      [
        workRequest(
          "newer-review",
          target("project-a", "task-a"),
          "2026-10-15T11:00:00Z",
          "review",
        ),
        workRequest(
          "older-check",
          target("project-a", "task-a"),
          "2026-10-15T09:00:00Z",
        ),
      ],
    );

    expect(groups.needsYou[0]?.requests.map((request) => request.id)).toEqual([
      "older-check",
      "newer-review",
    ]);
  });

  test("places a related thread request on each linked task using each task's project name", () => {
    const request = threadRequest(
      "shared-thread",
      "project-a",
      "2026-10-15T09:00:00Z",
      {
        linkedTask: target("project-a", "task-a"),
        relatedTargets: [
          target("project-b", "task-b"),
          target("project-c", "task-c"),
        ],
      },
    );
    const groups = group(
      [
        project("project-a", "Alpha", { tasks: [task("project-a", "task-a")] }),
        project("project-b", "Beta", { tasks: [task("project-b", "task-b")] }),
        project("project-c", "Gamma", { tasks: [task("project-c", "task-c")] }),
      ],
      [request],
    );

    expect(
      groups.needsYou.map((row) => [
        row.projectId,
        row.projectName,
        row.requests.map((item) => item.id),
      ]),
    ).toEqual([
      ["project-a", "Alpha", ["shared-thread"]],
      ["project-b", "Beta", ["shared-thread"]],
      ["project-c", "Gamma", ["shared-thread"]],
    ]);
  });

  test("deduplicates repeated queue IDs and duplicate task cards", () => {
    const duplicateCard = task("project-a", "duplicate-task");
    const duplicateRequest = threadRequest(
      "same-queue-id",
      "project-a",
      "2026-10-15T09:00:00Z",
    );
    const groups = group(
      [
        project("project-a", "Factory", {
          tasks: [duplicateCard, { ...duplicateCard }],
        }),
      ],
      [duplicateRequest, { ...duplicateRequest }],
    );

    expect(
      groups.needsYou
        .flatMap((row) => row.requests)
        .filter((item) => item.id === "same-queue-id"),
    ).toHaveLength(1);
    expect(
      groups.inProgress.filter((row) => row.taskId === "duplicate-task"),
    ).toHaveLength(1);
  });

  test("shows an overlapping recently-done task only once, in Done today", () => {
    const activeCard = task("project-a", "task-a", { state: "active" });
    const completedCard = task("project-a", "task-a", {
      state: "completed",
      completedAt: "2026-10-15T10:00:00Z",
    });
    const groups = group(
      [
        project("project-a", "Factory", {
          tasks: [activeCard],
          recentlyDone: [completedCard, { ...completedCard }],
        }),
      ],
      [],
    );

    expect(groups.inProgress.some((row) => row.taskId === "task-a")).toBe(
      false,
    );
    expect(
      groups.doneToday.filter((row) => row.taskId === "task-a"),
    ).toHaveLength(1);
  });

  test("preserves server order for tasks in progress", () => {
    const serverOrderedTasks = [
      task("project-a", "active-first", { state: "active" }),
      task("project-a", "blocked-second", { state: "blocked" }),
      task("project-a", "review-third", { state: "awaiting_verification" }),
    ];
    const groups = group(
      [project("project-a", "Factory", { tasks: serverOrderedTasks })],
      [],
    );

    expect(groups.inProgress.map((row) => row.taskId)).toEqual([
      "active-first",
      "blocked-second",
      "review-third",
    ]);
  });
});

describe("Home task status copy", () => {
  test("keeps blocked handoff sentences punctuated once and clear about ownership", () => {
    const agentBlocked = task("project-a", "agent-blocked", {
      state: "blocked",
      handoff: {
        nextOwner: "Codex",
        nextOwnerKind: "agent",
        nextAction: "Continue the migration..",
        reporter: "Codex",
        reportedAt: "2026-10-15T12:00:00Z",
        additionalCount: 0,
      },
    });
    const userBlocked = task("project-a", "user-blocked", {
      state: "blocked",
      stateReason: "Waiting for your input.",
      handoff: {
        nextOwner: "you",
        nextOwnerKind: "human",
        nextAction: "Approve the release.",
        reporter: "Codex",
        reportedAt: "2026-10-15T12:00:00Z",
        additionalCount: 0,
      },
    });

    expect(homeTaskSentence(agentBlocked, null)).toBe(
      "Blocked on Codex: Continue the migration. Nothing needed from you.",
    );
    expect(homeTaskSentence(agentBlocked, null)).not.toContain("..");
    expect(homeTaskSentence(userBlocked, null)).toBe(
      "Blocked: Waiting for your input.",
    );
  });
});
