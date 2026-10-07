import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";
import {
  buildFloorSnapshot,
  type FloorProjectActivity,
  type FloorTaskInput,
} from "../../src/floor";
import type {
  T3ObservedActivity,
  T3ObservedActivitySource,
  T3ObservedThread,
} from "../../src/t3-coordinator";

type OwnerKind = "agent" | "human" | "unknown";

const NOW = new Date("2026-10-06T16:00:00.000Z");
const NOW_ISO = NOW.toISOString();
const STALE_ISO = new Date(NOW.getTime() - 120_000).toISOString();

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => NOW,
    idGenerator: () => `floor-tracking-${++nextId}`,
  });
}

function runningChildThread(
  subtaskId: string,
  observedAt: string,
): T3ObservedThread {
  return {
    association: {
      state: "linked",
      links: [
        {
          linkId: "child-link",
          target: { id: subtaskId, kind: "subtask", label: "Child" },
        },
      ],
    },
    externalProjectId: "t3-project",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "running",
    observedAt,
    provider: "t3",
    sourceId: "source-a",
    sourceUpdatedAt: observedAt,
    threadId: "child-thread",
    title: "Child worker",
    machineId: "mac-mini",
  };
}

function activity(
  thread: T3ObservedThread,
  fetchedAt: string,
): T3ObservedActivity {
  const connection = {
    machineId: "mac-mini",
    observedAt: fetchedAt,
    lastSuccessfulFetchAt: fetchedAt,
    sourceId: "source-a",
    state: "connected" as const,
  };
  const counts = {
    ambiguous: 0,
    linked: 1,
    needsAttention: 0,
    running: 1,
    suggested: 0,
    unmatched: 0,
  };
  const source: T3ObservedActivitySource = {
    connection,
    counts,
    findings: [],
    machineId: "mac-mini",
    projectName: "Handoff project",
    sourceId: "source-a",
    status: "ok",
    targets: [],
    threads: [thread],
  };
  return {
    connection,
    counts,
    findings: [],
    machineId: "mac-mini",
    projectName: "Handoff project",
    sourceId: "source-a",
    sources: [source],
    status: "ok",
    targets: [],
    threads: [thread],
  };
}

function createBlockedHandoff(
  options: {
    ownerKind?: OwnerKind;
    waiting?: boolean;
    activeChild?: boolean;
    handoff?: boolean;
    observationAt?: string;
    manualTaskBlock?: boolean;
    childPendingApproval?: boolean;
    childSourceCurrent?: boolean;
    secondBlockerOwnerKind?: OwnerKind;
  } = {},
) {
  const app = createApplication();
  const project = app.createProject({ name: "Handoff project" });
  const task = app.createTask({ name: "Parent work", projectId: project.id });
  const blocker = app.createSubtask({ name: "Blocked step", taskId: task.id });
  const child = app.createSubtask({ name: "Agent child", taskId: task.id });

  const statusReports = [
    app.reportSubtaskStatus({
      reason: "Waiting on child work.",
      reportedState: "blocked",
      reporter: "codex",
      subtaskId: blocker.id,
      ...(options.handoff === false
        ? {}
        : {
            handoff: {
              nextAction: "Continue the dependent child step.",
              nextOwner: "Codex",
              nextOwnerKind: options.ownerKind ?? "agent",
              ...(options.waiting === false
                ? {}
                : { waitingOnSubtaskIds: [child.id] }),
            },
          }),
    }),
  ];
  const subtasks = [blocker, child];
  if (options.secondBlockerOwnerKind) {
    const secondBlocker = app.createSubtask({
      name: "Independent blocker",
      taskId: task.id,
    });
    subtasks.push(secondBlocker);
    statusReports.push(
      app.reportSubtaskStatus({
        handoff: {
          nextAction: "Resolve the independent blocker.",
          nextOwner: "Other owner",
          nextOwnerKind: options.secondBlockerOwnerKind,
        },
        reason: "This child is independently blocked.",
        reportedState: "blocked",
        reporter: "codex",
        subtaskId: secondBlocker.id,
      }),
    );
  }
  if (options.activeChild !== false) {
    statusReports.push(
      app.reportSubtaskStatus({
        reason: "The dependent child work is active.",
        reportedState: "in_progress",
        reporter: "codex",
        subtaskId: child.id,
      }),
    );
  }
  if (options.manualTaskBlock) {
    app.setTaskWorkState({
      taskId: task.id,
      workState: "blocked",
      reason: "A human placed this task on hold.",
    });
  }

  const observationAt = options.observationAt ?? NOW_ISO;
  const childThread = runningChildThread(child.id, observationAt);
  if (options.childPendingApproval) childThread.hasPendingApprovals = true;
  if (options.childSourceCurrent !== undefined)
    childThread.sourceCurrent = options.childSourceCurrent;
  const observation = activity(childThread, observationAt);
  const status = app.getTaskStatus(task.id);
  const taskInput: FloorTaskInput = {
    status,
    subtasks,
    task,
  };
  const activities: FloorProjectActivity[] = [
    { projectId: project.id, activity: observation },
  ];
  return {
    app,
    project,
    task,
    status,
    taskInput,
    activities,
    snapshot: buildFloorSnapshot({
      activities,
      now: NOW,
      projects: [project],
      statusReports,
      tasks: [taskInput],
      verifications: [],
    }),
  };
}

describe("Floor report tracking projection", () => {
  test("does not queue a human unblock for a fresh active child in an agent handoff", () => {
    const { status, snapshot, task } = createBlockedHandoff();
    const project = snapshot.projects[0]!;

    expect(status.taskState).toBe("blocked");
    expect(project.counts.blocked).toBe(1);
    expect(project.stations).toContainEqual(
      expect.objectContaining({ state: "working", threadId: "child-thread" }),
    );
    expect(
      snapshot.queue.some((item) => item.id === `unblock:${task.id}`),
    ).toBe(false);
  });

  test("keeps an independent unknown blocker visible beside a satisfied agent handoff", () => {
    const { snapshot, task, status } = createBlockedHandoff({
      secondBlockerOwnerKind: "unknown",
    });

    expect(status.taskState).toBe("blocked");
    expect(
      snapshot.queue.some((item) => item.id === `unblock:${task.id}`),
    ).toBe(true);
  });

  test.each([
    ["human-owned handoff", { ownerKind: "human" as const }],
    ["unknown handoff owner", { ownerKind: "unknown" as const }],
    ["missing handoff", { handoff: false }],
    ["handoff without a child dependency", { waiting: false }],
    ["child is not active in Factory", { activeChild: false }],
    ["child observation is stale", { observationAt: STALE_ISO }],
    ["child source has been superseded", { childSourceCurrent: false }],
    ["child is waiting for human approval", { childPendingApproval: true }],
    ["task block is manual", { manualTaskBlock: true }],
  ])("keeps the unblock action for %s", (_label, options) => {
    const { snapshot, task, status } = createBlockedHandoff(options);

    expect(status.taskState).toBe("blocked");
    expect(snapshot.projects[0]?.counts.blocked).toBe(1);
    expect(
      snapshot.queue.some((item) => item.id === `unblock:${task.id}`),
    ).toBe(true);
  });
});
