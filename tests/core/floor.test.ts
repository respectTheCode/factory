import { describe, expect, test } from "bun:test";

import {
  FactoryApplication,
  type ReconciliationFinding,
} from "../../src/application";
import { buildFloorSnapshot, type FloorProjectActivity } from "../../src/floor";
import type {
  T3ObservedActivity,
  T3ObservedThread,
} from "../../src/t3-coordinator";

const now = new Date("2026-09-22T16:00:00.000Z");

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => now,
    idGenerator: () => `id-${++nextId}`,
  });
}

function activity(
  projectName: string,
  thread: T3ObservedThread,
  state: "connected" | "unreachable" = "connected",
): T3ObservedActivity {
  const connection = {
    machineId: "mac-mini",
    observedAt: now.toISOString(),
    sourceId: "source-a",
    state,
  } as const;
  const source = {
    connection,
    counts: {
      ambiguous: 0,
      linked: 0,
      needsAttention: 0,
      running: thread.latestSessionState === "running" ? 1 : 0,
      suggested: 0,
      unmatched: 1,
    },
    findings: [],
    machineId: "mac-mini",
    projectName,
    sourceId: "source-a",
    status: state === "connected" ? ("ok" as const) : ("unreachable" as const),
    targets: [],
    threads: [thread],
  };
  return {
    connection,
    counts: source.counts,
    findings: [],
    machineId: "mac-mini",
    projectName,
    sourceId: "source-a",
    sources: [source],
    status: source.status,
    targets: [],
    threads: [thread],
  };
}

function thread(overrides: Partial<T3ObservedThread> = {}): T3ObservedThread {
  return {
    association: { links: [], state: "unmatched" },
    externalProjectId: "t3-project",
    hasPendingApprovals: true,
    hasPendingUserInput: false,
    latestSessionState: "running",
    observedAt: now.toISOString(),
    provider: "t3",
    sourceId: "source-a",
    sourceUpdatedAt: now.toISOString(),
    threadId: "thread-1",
    title: "Unmatched live thread",
    machineId: "mac-mini",
    ...overrides,
  };
}

describe("Floor projection", () => {
  test("projects active work, one current complete claim, and timezone-aware daily totals", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const planned = app.createTask({ name: "Planned", projectId: project.id });
    const active = app.createTask({ name: "Active", projectId: project.id });
    const blocked = app.createTask({ name: "Blocked", projectId: project.id });
    const archived = app.createTask({
      name: "Archived",
      projectId: project.id,
    });

    const plannedSubtask = app.createSubtask({
      name: "Plan it",
      taskId: planned.id,
    });
    const activeSubtask = app.createSubtask({
      name: "Do it",
      taskId: active.id,
    });
    const blockedSubtask = app.createSubtask({
      name: "Unblock it",
      taskId: blocked.id,
    });
    const archivedSubtask = app.createSubtask({
      name: "Old work",
      taskId: archived.id,
    });
    app.reportSubtaskStatus({
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: activeSubtask.id,
    });
    app.reportSubtaskStatus({
      reason: "Needs a decision",
      reportedState: "blocked",
      reporter: "codex",
      subtaskId: blockedSubtask.id,
    });
    const claim = app.reportSubtaskStatus({
      evidence: "The bounded check passed.",
      reason: "Ready for Kevin's stamp",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: plannedSubtask.id,
    });
    app.archiveSubtask(archivedSubtask.id, "wont_do");
    app.archiveTask(archived.id, "wont_do");

    const acceptedTask = app.createTask({
      name: "Accepted today",
      projectId: project.id,
    });
    const acceptedSubtask = app.createSubtask({
      name: "Stamped",
      taskId: acceptedTask.id,
    });
    const accepted = app.reportSubtaskStatus({
      reportedState: "complete",
      reason: "Ready",
      reporter: "codex",
      subtaskId: acceptedSubtask.id,
    });
    app.verifyStatusReport({
      decision: "accepted",
      reportId: accepted.id,
      verifier: "kevin",
    });

    const snapshot = app.getFloorSnapshot({
      activities: [],
      timezone: "America/Indiana/Indianapolis",
    });
    const bay = snapshot.projects[0]!;
    expect(bay.bench.map((item) => item.taskName)).toEqual([]);
    expect(bay.stations.map((station) => station.target?.taskName)).toEqual([
      "Active",
      "Blocked",
    ]);
    expect(bay.counter).toHaveLength(1);
    expect(bay.counter[0]).toMatchObject({
      reportId: claim.id,
      evidence: "The bounded check passed.",
    });
    expect(bay.counter.some((item) => item.taskName === "Archived")).toBe(
      false,
    );
    expect(snapshot.queue.map((item) => item.action)).toContain("stamp");
    expect(snapshot.queue.map((item) => item.action)).toContain("unblock");
    expect(snapshot.scoreboard.reportsToday).toBe(4);
    expect(snapshot.scoreboard.stampedToday).toBe(1);
  });

  test("keeps actionable unmatched work discoverable, dedupes source/thread, and suppresses stale activity", () => {
    const app = createApplication();
    const first = app.createProject({ name: "Same name" });
    const second = app.createProject({ name: "Same name" });
    const firstTask = app.createTask({
      name: "First active",
      projectId: first.id,
    });
    const firstSubtask = app.createSubtask({
      name: "First work",
      taskId: firstTask.id,
    });
    app.reportSubtaskStatus({
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: firstSubtask.id,
    });
    const secondTask = app.createTask({
      name: "Second active",
      projectId: second.id,
    });
    const secondSubtask = app.createSubtask({
      name: "Second work",
      taskId: secondTask.id,
    });
    app.reportSubtaskStatus({
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: secondSubtask.id,
    });

    const live = thread();
    const stale = thread({ threadId: "thread-2", title: "Stale thread" });
    const activities: FloorProjectActivity[] = [
      { projectId: first.id, activity: activity(first.name, live) },
      { projectId: first.id, activity: activity(first.name, live) },
      {
        projectId: second.id,
        activity: activity(second.name, stale, "unreachable"),
      },
    ];
    const snapshot = buildFloorSnapshot({
      activities,
      now,
      projects: [first, second],
      statusReports: [],
      tasks: [
        {
          status: app.getTaskStatus(firstTask.id),
          subtasks: [firstSubtask],
          task: firstTask,
        },
        {
          status: app.getTaskStatus(secondTask.id),
          subtasks: [secondSubtask],
          task: secondTask,
        },
      ],
      verifications: [],
    });
    const firstBay = snapshot.projects.find(
      (project) => project.id === first.id,
    )!;
    const secondBay = snapshot.projects.find(
      (project) => project.id === second.id,
    )!;
    expect(
      firstBay.stations.filter((station) => station.threadId === "thread-1"),
    ).toHaveLength(1);
    expect(
      firstBay.stations.find((station) => station.threadId === "thread-1"),
    ).toMatchObject({ association: "unmatched", threadId: "thread-1" });
    expect(
      snapshot.queue.filter((item) => item.id === "approve:source-a:thread-1"),
    ).toHaveLength(1);
    expect(secondBay.stations).toEqual([
      expect.objectContaining({
        association: "none",
        target: expect.objectContaining({ taskId: secondTask.id }),
      }),
    ]);
    expect(
      snapshot.queue.some(
        (item) =>
          item.target.kind === "thread" && item.target.threadId === "thread-2",
      ),
    ).toBe(false);
    expect(
      snapshot.connections.find(
        (connection) => connection.sourceId === "source-a",
      )?.fresh,
    ).toBe(false);
  });

  test("does not surface archived linked threads as attention or turn events", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Archived work" });
    const archivedTask = app.createTask({
      name: "Old task",
      projectId: project.id,
    });
    app.archiveTask(archivedTask.id, "wont_do");

    const archivedThread = thread({
      association: {
        links: [
          {
            linkId: "old-link",
            target: {
              id: archivedTask.id,
              kind: "task",
              label: archivedTask.name,
            },
          },
        ],
        state: "linked",
      },
      hasPendingApprovals: false,
      latestSessionState: "idle",
      latestTurnCompletedAt: now.toISOString(),
      latestTurnState: "completed",
      threadId: "archived-thread",
    });
    const staleFinding: ReconciliationFinding = {
      candidateIds: [],
      createdAt: now,
      dedupeKey: "ambiguous_target:source-a:archived-thread",
      explanation:
        "The linked Factory target no longer exists in this Project.",
      externalThreadId: archivedThread.threadId,
      id: "finding-archived",
      kind: "ambiguous_target",
      observedAt: now,
      projectId: project.id,
      severity: "attention",
      sourceId: archivedThread.sourceId,
      status: "open",
      suggestedAction: "Choose an existing Factory Task or Subtask explicitly.",
      updatedAt: now,
    };
    const archivedActivity = {
      ...activity(project.name, archivedThread),
      findings: [staleFinding],
    };

    const snapshot = buildFloorSnapshot({
      activities: [{ activity: archivedActivity, projectId: project.id }],
      now,
      projects: [project],
      statusReports: [],
      tasks: [
        {
          status: app.getTaskStatus(archivedTask.id),
          subtasks: [],
          task: archivedTask,
        },
      ],
      verifications: [],
    });

    expect(snapshot.projects[0]?.stations).toEqual([]);
    expect(snapshot.queue).toEqual([]);
    expect(snapshot.events).toEqual([]);
  });

  test("keeps a healthy source fresh when another project is unmatched", () => {
    const app = createApplication();
    const healthyProject = app.createProject({ name: "Healthy project" });
    const unmatchedProject = app.createProject({ name: "Unmatched project" });
    const task = app.createTask({
      name: "Healthy task",
      projectId: healthyProject.id,
      workState: "active",
    });
    const worker = thread({
      association: {
        links: [
          {
            linkId: "healthy-link",
            target: { id: task.id, kind: "task", label: task.name },
          },
        ],
        state: "linked",
      },
      hasPendingApprovals: false,
      latestSessionState: "running",
      threadId: "healthy-thread",
    });
    const unmatchedActivity = activity(
      unmatchedProject.name,
      thread({
        hasPendingApprovals: false,
        latestSessionState: "idle",
        threadId: "unmatched-thread",
      }),
    );
    unmatchedActivity.status = "unmatched";
    unmatchedActivity.sources[0]!.status = "unmatched";

    const snapshot = buildFloorSnapshot({
      activities: [
        {
          activity: activity(healthyProject.name, worker),
          projectId: healthyProject.id,
        },
        { activity: unmatchedActivity, projectId: unmatchedProject.id },
      ],
      now,
      projects: [healthyProject, unmatchedProject],
      statusReports: [],
      tasks: [
        {
          status: app.getTaskStatus(task.id),
          subtasks: [],
          task,
        },
      ],
      verifications: [],
    });

    expect(snapshot.connections[0]?.fresh).toBe(true);
    expect(snapshot.scoreboard.workingNow).toBe(1);
    expect(snapshot.projects[0]?.counts.working).toBe(1);
    expect(snapshot.projects[1]?.stations).toEqual([]);
  });
});
