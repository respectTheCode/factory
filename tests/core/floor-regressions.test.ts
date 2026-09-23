import { describe, expect, test } from "bun:test";

import {
  FactoryApplication,
  type Project,
  type ReconciliationFinding,
  type StatusReport,
  type Subtask,
  type Task,
  type Verification,
} from "../../src/application";
import {
  buildFloorSnapshot,
  type FloorProjectActivity,
  type FloorSnapshot,
  type FloorTaskInput,
} from "../../src/floor";
import type {
  T3ObservedActivity,
  T3ObservedActivitySource,
  T3ObservedThread,
} from "../../src/t3-coordinator";

const NOW = new Date("2026-09-22T16:00:00.000Z");
const NOW_ISO = NOW.toISOString();

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => NOW,
    idGenerator: () => `floor-regression-${++nextId}`,
  });
}

function thread(overrides: Partial<T3ObservedThread> = {}): T3ObservedThread {
  return {
    association: { links: [], state: "unmatched" },
    externalProjectId: "t3-project",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "idle",
    observedAt: NOW_ISO,
    provider: "t3",
    sourceId: "source-a",
    sourceUpdatedAt: NOW_ISO,
    threadId: "thread-1",
    title: "Synthetic worker",
    machineId: "mac-mini",
    ...overrides,
  };
}

function linkedThread(
  taskIds: string[],
  overrides: Partial<T3ObservedThread> = {},
): T3ObservedThread {
  return thread({
    association: {
      state: "linked",
      links: taskIds.map((taskId, index) => ({
        linkId: `link-${index + 1}`,
        target: { id: taskId, kind: "task", label: taskId },
      })),
    },
    ...overrides,
  });
}

function activity(
  threads: T3ObservedThread[],
  options: {
    observedAt?: string;
    findings?: ReconciliationFinding[];
    status?: T3ObservedActivity["status"];
  } = {},
): T3ObservedActivity {
  const status = options.status ?? "ok";
  const observedAt = options.observedAt ?? NOW_ISO;
  const connection = {
    machineId: "mac-mini",
    observedAt,
    lastSuccessfulFetchAt: observedAt,
    sourceId: "source-a",
    state: status === "ok" ? ("connected" as const) : ("unreachable" as const),
  };
  const counts = {
    ambiguous: 0,
    linked: threads.filter((item) => item.association.state === "linked")
      .length,
    needsAttention: threads.filter(
      (item) => item.hasPendingApprovals || item.hasPendingUserInput,
    ).length,
    running: threads.filter((item) => item.latestSessionState === "running")
      .length,
    suggested: 0,
    unmatched: threads.filter((item) => item.association.state === "unmatched")
      .length,
  };
  const source: T3ObservedActivitySource = {
    connection,
    counts,
    findings: options.findings ?? [],
    machineId: "mac-mini",
    projectName: "Regression project",
    sourceId: "source-a",
    status,
    targets: [],
    threads,
  };
  return {
    connection,
    counts,
    findings: options.findings ?? [],
    machineId: "mac-mini",
    projectName: "Regression project",
    sourceId: "source-a",
    sources: [source],
    status,
    targets: [],
    threads,
  };
}

function taskInputs(
  app: FactoryApplication,
  tasks: Task[],
  subtasks: Subtask[],
): FloorTaskInput[] {
  return tasks.map((task) => ({
    status: app.getTaskStatus(task.id),
    subtasks: subtasks.filter((subtask) => subtask.taskId === task.id),
    task,
  }));
}

function snapshot(
  app: FactoryApplication,
  project: Project,
  tasks: Task[],
  subtasks: Subtask[],
  options: {
    activities?: FloorProjectActivity[];
    now?: Date;
    statusReports?: StatusReport[];
    verifications?: Verification[];
  } = {},
): FloorSnapshot {
  return buildFloorSnapshot({
    activities: options.activities ?? [],
    now: options.now ?? NOW,
    projects: [project],
    statusReports: options.statusReports ?? [],
    tasks: taskInputs(app, tasks, subtasks),
    verifications: options.verifications ?? [],
  });
}

function attentionFinding(
  projectId: string,
  taskId: string,
  threadId: string,
): ReconciliationFinding {
  return {
    candidateIds: [taskId],
    createdAt: NOW,
    dedupeKey: `session_needs_attention:source-a:${threadId}`,
    explanation: "The worker needs attention.",
    externalThreadId: threadId,
    id: "finding-attention-1",
    kind: "session_needs_attention",
    observedAt: NOW,
    projectId,
    severity: "attention",
    sourceId: "source-a",
    status: "open",
    suggestedAction: "Inspect the worker.",
    taskId,
    updatedAt: NOW,
  };
}

describe("Floor projection regressions", () => {
  test("dedupes a pending approval and its matching session attention finding", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Regression project" });
    const task = app.createTask({
      name: "Approval task",
      projectId: project.id,
      workState: "active",
    });
    const worker = linkedThread([task.id], {
      hasPendingApprovals: true,
      threadId: "thread-approval",
      title: "Approval worker",
    });
    const finding = attentionFinding(project.id, task.id, worker.threadId);

    const result = snapshot(app, project, [task], [], {
      activities: [
        {
          activity: activity([worker], { findings: [finding] }),
          projectId: project.id,
        },
      ],
    });

    expect(result.queue.map((item) => item.action)).toEqual(["approve"]);
    expect(result.queue.some((item) => item.action === "reconcile")).toBe(
      false,
    );
  });

  test("excludes archived-only work from queue and working counts while retaining daily history", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Regression project" });
    const task = app.createTask({
      name: "Archived task",
      projectId: project.id,
      workState: "active",
    });
    const subtask = app.createSubtask({
      name: "Archived subtask",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      evidence: "Completed before archival.",
      reason: "Ready for archival history.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    const verification: Verification = {
      createdAt: NOW,
      decision: "accepted",
      id: "verification-archived",
      reportId: report.id,
      verifier: "kevin",
    };
    app.archiveTask(task.id, "released");
    const worker = linkedThread([task.id], {
      hasPendingApprovals: true,
      latestSessionState: "running",
      threadId: "thread-archived",
    });

    const result = snapshot(app, project, [task], [subtask], {
      activities: [{ activity: activity([worker]), projectId: project.id }],
      statusReports: [report],
      verifications: [verification],
    });

    expect(result.queue).toEqual([]);
    expect(result.projects[0]?.stations).toEqual([]);
    expect(result.scoreboard.workingNow).toBe(0);
    expect(result.scoreboard.reportsToday).toBe(1);
    expect(result.scoreboard.stampedToday).toBe(1);
  });

  test("does not treat a connected activity with an old observation as live", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Regression project" });
    const task = app.createTask({
      name: "Stale task",
      projectId: project.id,
      workState: "active",
    });
    const old = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    const worker = linkedThread([task.id], {
      latestSessionState: "running",
      observedAt: old,
      sourceUpdatedAt: old,
      threadId: "thread-stale",
    });

    const result = snapshot(app, project, [task], [], {
      activities: [
        {
          activity: activity([worker], { observedAt: old }),
          projectId: project.id,
        },
      ],
    });

    expect(result.connections[0]?.fresh).toBe(false);
    expect(result.scoreboard.workingNow).toBe(0);
    expect(result.projects[0]?.stations[0]?.association).toBe("none");
  });

  test("shows every task association for one global worker", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Regression project" });
    const first = app.createTask({
      name: "First associated task",
      projectId: project.id,
      workState: "active",
    });
    const second = app.createTask({
      name: "Second associated task",
      projectId: project.id,
      workState: "active",
    });
    const worker = linkedThread([first.id, second.id], {
      latestSessionState: "running",
      threadId: "thread-global-worker",
    });

    const result = snapshot(app, project, [first, second], [], {
      activities: [{ activity: activity([worker]), projectId: project.id }],
    });

    const linkedStations = result.projects[0]?.stations.filter(
      (station) => station.threadId === worker.threadId,
    );
    expect(linkedStations?.map((station) => station.target?.taskId)).toEqual([
      first.id,
      second.id,
    ]);
  });

  test("counts an actually running worker without counting an approval waiter as working", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Regression project" });
    const task = app.createTask({
      name: "Worker task",
      projectId: project.id,
      workState: "active",
    });
    const approvalWaiter = thread({
      hasPendingApprovals: true,
      latestSessionState: "running",
      threadId: "thread-approval-waiter",
    });
    const actualWorker = thread({
      latestSessionState: "running",
      threadId: "thread-actual-worker",
    });

    const result = snapshot(app, project, [task], [], {
      activities: [
        {
          activity: activity([approvalWaiter, actualWorker]),
          projectId: project.id,
        },
      ],
    });

    expect(result.scoreboard.workingNow).toBe(1);
  });

  test("uses the stable turn completion time when observedAt is refreshed", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Regression project" });
    const task = app.createTask({
      name: "Completed turn task",
      projectId: project.id,
      workState: "active",
    });
    const completedAt = new Date(NOW.getTime() - 45 * 60 * 1000).toISOString();
    const firstObservedAt = new Date(
      NOW.getTime() - 30 * 60 * 1000,
    ).toISOString();
    const refreshedObservedAt = new Date(
      NOW.getTime() - 2 * 60 * 1000,
    ).toISOString();
    const first = thread({
      latestSessionState: "idle",
      latestTurnCompletedAt: completedAt,
      latestTurnState: "completed",
      observedAt: firstObservedAt,
      sourceUpdatedAt: firstObservedAt,
      threadId: "thread-completed",
    });
    const refreshed = {
      ...first,
      observedAt: refreshedObservedAt,
      sourceUpdatedAt: refreshedObservedAt,
    };

    const firstResult = snapshot(app, project, [task], [], {
      activities: [{ activity: activity([first]), projectId: project.id }],
    });
    const refreshedResult = snapshot(app, project, [task], [], {
      activities: [{ activity: activity([refreshed]), projectId: project.id }],
    });

    const firstTurn = firstResult.events.find((event) => event.kind === "turn");
    const refreshedTurn = refreshedResult.events.find(
      (event) => event.kind === "turn",
    );
    expect(firstTurn?.timestamp).toBe(completedAt);
    expect(refreshedTurn?.timestamp).toBe(completedAt);
  });

  test("projects current edited subtask evidence instead of stale report evidence", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Regression project" });
    const task = app.createTask({
      name: "Evidence task",
      projectId: project.id,
      workState: "planned",
    });
    const subtask = app.createSubtask({
      name: "Evidence subtask",
      taskId: task.id,
    });
    const report = app.reportSubtaskStatus({
      evidence: "Original evidence",
      reason: "Ready for review.",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: subtask.id,
    });
    app.updateSubtask({
      evidence: "Edited current evidence",
      subtaskId: subtask.id,
    });

    const result = snapshot(app, project, [task], [subtask], {
      statusReports: [report],
    });

    expect(result.projects[0]?.counter[0]?.evidence).toBe(
      "Edited current evidence",
    );
  });
});
