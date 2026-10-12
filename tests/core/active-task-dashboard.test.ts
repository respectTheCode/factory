import { describe, expect, test } from "bun:test";

import {
  FactoryApplication,
  type Project,
  type StatusReport,
  type Subtask,
  type Task,
  type TaskStatus,
} from "../../src/application";
import type { GitHubStatusSnapshot } from "../../src/github";
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

const now = new Date("2026-10-11T16:00:00.000Z");
const nowIso = now.toISOString();
const pullRequestUrl = "https://github.com/example/repo/pull/18";

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => now,
    idGenerator: () => `dashboard-${++nextId}`,
  });
}

function taskInput(
  task: Task,
  status: TaskStatus,
  subtasks: Subtask[] = [],
): FloorTaskInput {
  return { task, status, subtasks };
}

function snapshot(
  project: Project,
  tasks: FloorTaskInput[],
  options: {
    activities?: FloorProjectActivity[];
    githubStatuses?: Readonly<Record<string, GitHubStatusSnapshot | undefined>>;
    now?: Date;
    statusReports?: StatusReport[];
  } = {},
) {
  return buildFloorSnapshot({
    activities: options.activities ?? [],
    now: options.now ?? now,
    projects: [project],
    statusReports: options.statusReports ?? [],
    tasks,
    verifications: [],
    ...(options.githubStatuses
      ? { githubStatuses: options.githubStatuses }
      : {}),
  });
}

function mergedGitHubStatus(): GitHubStatusSnapshot {
  return {
    status: "ok",
    fetchedAt: nowIso,
    checkRuns: [],
    checkRunsStatus: "ok",
    workflowRuns: [],
    workflowRunsStatus: "ok",
    pullRequest: {
      number: 18,
      url: pullRequestUrl,
      title: "Dashboard projection",
      baseBranch: "main",
      draft: false,
      headSha: "a".repeat(40),
      headBranch: "feature/dashboard",
      state: "closed",
      mergeable: true,
      updatedAt: nowIso,
      mergedAt: nowIso,
    },
  };
}

function linkedThread(
  threadId: string,
  taskIds: string[],
  overrides: Partial<T3ObservedThread> = {},
): T3ObservedThread {
  return {
    association: {
      state: "linked",
      links: taskIds.map((taskId, index) => ({
        linkId: `${threadId}-${index}`,
        target: { id: taskId, kind: "task", label: taskId },
      })),
    },
    externalProjectId: "t3-project",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "idle",
    observedAt: nowIso,
    provider: "t3",
    sourceCurrent: true,
    sourceId: "source-a",
    sourceUpdatedAt: nowIso,
    threadId,
    title: `Thread ${threadId}`,
    machineId: "mac-mini",
    ...overrides,
  };
}

function unmatchedThread(
  threadId: string,
  overrides: Partial<T3ObservedThread> = {},
): T3ObservedThread {
  return {
    ...linkedThread(threadId, []),
    association: { links: [], state: "unmatched" },
    ...overrides,
  };
}

function connection(
  sourceId: string,
  state: "connected" | "unreachable" = "connected",
  fetchedAt = nowIso,
) {
  return {
    machineId: "mac-mini",
    observedAt: fetchedAt,
    lastSuccessfulFetchAt: fetchedAt,
    sourceId,
    state,
  } as const;
}

function source(
  sourceId: string,
  threads: T3ObservedThread[],
  options: {
    status?: T3ObservedActivitySource["status"];
    connectionState?: "connected" | "unreachable";
    fetchedAt?: string;
  } = {},
): T3ObservedActivitySource {
  const status = options.status ?? "ok";
  const counts = {
    ambiguous: 0,
    linked: threads.filter((thread) => thread.association.state === "linked")
      .length,
    needsAttention: threads.filter(
      (thread) => thread.hasPendingApprovals || thread.hasPendingUserInput,
    ).length,
    running: threads.filter((thread) => thread.latestSessionState === "running")
      .length,
    suggested: 0,
    unmatched: threads.filter(
      (thread) => thread.association.state === "unmatched",
    ).length,
  };
  return {
    connection: connection(
      sourceId,
      options.connectionState ?? "connected",
      options.fetchedAt ?? nowIso,
    ),
    counts,
    error: status === "ok" ? undefined : "Source unavailable",
    findings: [],
    machineId: "mac-mini",
    projectName: "Factory",
    sourceId,
    status,
    targets: [],
    threads,
  };
}

function activity(
  sources: T3ObservedActivitySource[],
  options: { status?: T3ObservedActivity["status"] } = {},
): T3ObservedActivity {
  const threads = sources.flatMap((item) => item.threads);
  const counts = {
    ambiguous: 0,
    linked: threads.filter((thread) => thread.association.state === "linked")
      .length,
    needsAttention: threads.filter(
      (thread) => thread.hasPendingApprovals || thread.hasPendingUserInput,
    ).length,
    running: threads.filter((thread) => thread.latestSessionState === "running")
      .length,
    suggested: 0,
    unmatched: threads.filter(
      (thread) => thread.association.state === "unmatched",
    ).length,
  };
  const first = sources[0];
  return {
    connection: first?.connection ?? connection("source-a", "unreachable"),
    counts,
    findings: [],
    machineId: "mac-mini",
    projectName: "Factory",
    sourceId: first?.sourceId ?? "source-a",
    sources,
    status: options.status ?? first?.status ?? "unreachable",
    targets: [],
    threads,
  };
}

function projectActivity(
  projectId: string,
  observed: T3ObservedActivity,
): FloorProjectActivity {
  return { activity: observed, projectId };
}

describe("active task dashboard projection", () => {
  test("includes in-review and backlog Tasks without relying on queue or session rows", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const review = app.createTask({
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
      name: "In review without GitHub evidence",
      projectId: project.id,
      pullRequestUrl,
    });
    app.reportTaskStatus({
      taskId: review.id,
      workflowEpoch: app.getTaskStatus(review.id).workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const check = app.createTask({
      finishRule: { kind: "agent_report", requireHumanCheck: true },
      humanCheckText: "Verify the delivered task.",
      name: "Human check ready",
      projectId: project.id,
    });
    app.reportTaskStatus({
      taskId: check.id,
      workflowEpoch: app.getTaskStatus(check.id).workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const active = app.createTask({
      name: "Active without Steps",
      projectId: project.id,
      workState: "active",
    });
    const planned = app.createTask({ name: "Planned", projectId: project.id });
    const backlog = app.createTask({
      name: "Backlog",
      projectId: project.id,
      workState: "backlog",
    });

    const result = snapshot(
      project,
      [review, check, active, planned, backlog].map((task) =>
        taskInput(task, app.getTaskStatus(task.id)),
      ),
      { githubStatuses: { [pullRequestUrl]: mergedGitHubStatus() } },
    );
    const cards = result.projects[0]!.tasks!;

    expect(cards.map((card) => [card.taskName, card.state])).toEqual([
      ["Human check ready", "awaiting_verification"],
      ["In review without GitHub evidence", "awaiting_verification"],
      ["Active without Steps", "active"],
      ["Planned", "planned"],
      ["Backlog", "backlog"],
    ]);
    expect(
      cards.find((card) => card.taskId === review.id)?.finish,
    ).toMatchObject({
      agentReportedFinished: true,
      humanCheckReady: false,
      mergedPrCount: 0,
      requiredPrCount: 1,
    });
    expect(
      cards.find((card) => card.taskId === check.id)?.finish,
    ).toMatchObject({
      humanCheckReady: true,
      requireHumanCheck: true,
    });
    expect(
      cards.find((card) => card.taskId === check.id)?.needsYou,
    ).toMatchObject({
      count: 1,
      verbs: ["check"],
    });
    expect(
      cards.find((card) => card.taskId === active.id)?.steps,
    ).toBeUndefined();
    expect(
      result.queue.some(
        (item) =>
          item.target.kind === "work" &&
          item.target.target.taskId === review.id,
      ),
    ).toBe(false);
  });

  test("groups deduplicated linked sessions on every Task and keeps unmatched sessions separate", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const first = app.createTask({
      name: "First",
      projectId: project.id,
      workState: "active",
    });
    const second = app.createTask({
      name: "Second",
      projectId: project.id,
      workState: "active",
    });
    const planned = app.createTask({
      name: "Planned approval",
      projectId: project.id,
    });
    const shared = linkedThread("shared", [first.id, second.id], {
      latestSessionState: "running",
    });
    const approval = linkedThread("approval", [planned.id, second.id], {
      hasPendingApprovals: true,
    });
    const unmatched = unmatchedThread("unmatched", {
      hasPendingUserInput: true,
      latestSessionState: "running",
    });
    const observed = activity([
      source("source-a", [shared, approval, unmatched]),
    ]);

    const result = snapshot(
      project,
      [first, second, planned].map((task) =>
        taskInput(task, app.getTaskStatus(task.id)),
      ),
      { activities: [projectActivity(project.id, observed)] },
    );
    const cards = result.projects[0]!.tasks!;
    const firstCard = cards.find((card) => card.taskId === first.id)!;
    const secondCard = cards.find((card) => card.taskId === second.id)!;
    const plannedCard = cards.find((card) => card.taskId === planned.id)!;

    expect(firstCard.sessions.map((session) => session.threadId)).toEqual([
      "shared",
    ]);
    expect(secondCard.sessions.map((session) => session.threadId)).toEqual([
      "approval",
      "shared",
    ]);
    expect(
      firstCard.sessions[0]?.relatedTargets?.map((target) => target.taskId),
    ).toEqual([first.id, second.id]);
    expect(plannedCard.sessions[0]?.state).toBe("waiting_approval");
    expect(plannedCard.needsYou).toMatchObject({
      count: 1,
      verbs: ["decide"],
    });
    expect(secondCard.needsYou).toMatchObject({
      count: 1,
      verbs: ["decide"],
    });
    expect(
      result.projects[0]?.unmatchedSessions?.map((session) => session.threadId),
    ).toEqual(["unmatched"]);
    expect(cards.some((card) => card.taskName === "Thread unmatched")).toBe(
      false,
    );
    expect(result.scoreboard.workingNow).toBe(1);
  });

  test("uses per-source freshness so an aggregate error does not hide a healthy thread", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Active",
      projectId: project.id,
      workState: "active",
    });
    const observedThread = linkedThread("healthy", [task.id], {
      latestSessionState: "running",
    });
    const observed = activity(
      [
        source("source-a", [observedThread]),
        source("source-b", [], {
          connectionState: "unreachable",
          fetchedAt: new Date(now.getTime() - 90_000).toISOString(),
          status: "unreachable",
        }),
      ],
      { status: "unreachable" },
    );

    const result = snapshot(
      project,
      [taskInput(task, app.getTaskStatus(task.id))],
      { activities: [projectActivity(project.id, observed)] },
    );
    const card = result.projects[0]!.tasks![0]!;

    expect(card.sessions.map((session) => session.threadId)).toEqual([
      "healthy",
    ]);
    expect(card.sessionsAvailable).toBe(false);
    const missing = snapshot(project, [
      taskInput(task, app.getTaskStatus(task.id)),
    ]);
    expect(missing.projects[0]?.sessionsAvailable).toBe(false);
    expect(missing.projects[0]?.tasks?.[0]?.sessions).toEqual([]);

    const missingSourceThread = linkedThread("missing-source", [task.id], {
      sourceId: "source-missing",
    });
    const incompleteObservation = {
      ...activity([source("source-a", [])]),
      threads: [missingSourceThread],
    };
    const incomplete = snapshot(
      project,
      [taskInput(task, app.getTaskStatus(task.id))],
      { activities: [projectActivity(project.id, incompleteObservation)] },
    );
    expect(incomplete.projects[0]?.sessionsAvailable).toBe(false);
    expect(incomplete.projects[0]?.tasks?.[0]?.sessions).toEqual([]);
  });

  test("excludes superseded observations from cards, unmatched sessions, and working count", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Active",
      projectId: project.id,
      workState: "active",
    });
    const supersededLinked = linkedThread("superseded-linked", [task.id], {
      latestSessionState: "running",
      sourceCurrent: false,
    });
    const supersededUnmatched = unmatchedThread("superseded-unmatched", {
      latestSessionState: "running",
      sourceCurrent: false,
    });
    const healthy = linkedThread("healthy", [task.id], {
      latestSessionState: "running",
      sourceId: "source-b",
    });
    const observed = activity([
      source("source-a", [supersededLinked, supersededUnmatched]),
      source("source-b", [healthy]),
    ]);

    const result = snapshot(
      project,
      [taskInput(task, app.getTaskStatus(task.id))],
      { activities: [projectActivity(project.id, observed)] },
    );
    const projectResult = result.projects[0]!;

    expect(
      projectResult.tasks?.[0]?.sessions.map((session) => session.threadId),
    ).toEqual(["healthy"]);
    expect(
      projectResult.unmatchedSessions?.map((session) => session.threadId),
    ).toEqual([]);
    expect(projectResult.stations.map((station) => station.threadId)).toContain(
      "superseded-unmatched",
    );
    expect(result.scoreboard.workingNow).toBe(1);
  });

  test("counts Steps by ID, excludes won't-do, and omits zero-Step progress", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "With Steps",
      projectId: project.id,
      workState: "active",
    });
    const done = app.createSubtask({ name: "Done", taskId: task.id });
    const open = app.createSubtask({ name: "Open", taskId: task.id });
    const skipped = app.createSubtask({ name: "Skipped", taskId: task.id });
    app.reportSubtaskStatus({
      reportedState: "complete",
      reporter: "Codex",
      subtaskId: done.id,
    });
    app.reportSubtaskStatus({
      reportedState: "in_progress",
      reporter: "Codex",
      subtaskId: open.id,
    });
    app.reportSubtaskStatus({
      reportedState: "blocked",
      reason: "Will not do",
      reporter: "Codex",
      subtaskId: skipped.id,
    });
    app.archiveSubtask(skipped.id, "wont_do");
    const zeroStep = app.createTask({
      name: "Zero Steps",
      projectId: project.id,
    });
    const status = app.getTaskStatus(task.id);

    const result = snapshot(project, [
      taskInput(task, status, [skipped, open, done]),
      taskInput(zeroStep, app.getTaskStatus(zeroStep.id)),
    ]);
    const cards = result.projects[0]!.tasks!;

    expect(cards.find((card) => card.taskId === task.id)?.steps).toEqual({
      done: 1,
      total: 2,
    });
    expect(
      cards.find((card) => card.taskId === zeroStep.id)?.steps,
    ).toBeUndefined();
  });

  test("prefers a Task handoff, otherwise picks the newest unfinished Step handoff", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const task = app.createTask({
      name: "Task handoff wins",
      projectId: project.id,
      workState: "active",
    });
    const liveOne = app.createSubtask({ name: "Live one", taskId: task.id });
    const liveTwo = app.createSubtask({ name: "Live two", taskId: task.id });
    const archived = app.createSubtask({ name: "Archived", taskId: task.id });
    const stepReports = [liveOne, liveTwo, archived].map((subtask, index) =>
      app.reportSubtaskStatus({
        handoff: {
          nextAction: `Step action ${index}`,
          nextOwner: `Step owner ${index}`,
          nextOwnerKind: "agent",
        },
        reason: "Waiting for handoff",
        reportedState: "blocked",
        reporter: `Step reporter ${index}`,
        subtaskId: subtask.id,
      }),
    );
    app.archiveSubtask(archived.id, "wont_do");
    app.reportTaskStatus({
      handoff: {
        nextAction: "Task action",
        nextOwner: "Kevin",
        nextOwnerKind: "human",
      },
      reporter: "Task reporter",
      reportedState: "in_progress",
      taskId: task.id,
      workflowEpoch: app.getTaskStatus(task.id).workflowEpoch,
    });
    const taskCardResult = snapshot(
      project,
      [
        taskInput(task, app.getTaskStatus(task.id), [
          liveOne,
          liveTwo,
          archived,
        ]),
      ],
      { statusReports: stepReports },
    );
    expect(taskCardResult.projects[0]?.tasks?.[0]?.handoff).toMatchObject({
      additionalCount: 2,
      nextAction: "Task action",
      nextOwner: "Kevin",
      reporter: "Task reporter",
    });

    const fallbackTask = app.createTask({
      name: "Step handoff fallback",
      projectId: project.id,
      workState: "active",
    });
    const older = app.createSubtask({ name: "Older", taskId: fallbackTask.id });
    const newer = app.createSubtask({ name: "Newer", taskId: fallbackTask.id });
    const excluded = app.createSubtask({
      name: "Excluded",
      taskId: fallbackTask.id,
    });
    const fallbackReports = [older, newer, excluded].map((subtask, index) =>
      app.reportSubtaskStatus({
        handoff: {
          nextAction: `Fallback action ${index}`,
          nextOwner: `Fallback owner ${index}`,
          nextOwnerKind: "human",
        },
        reason: "Blocked",
        reportedState: "blocked",
        reporter: `Fallback reporter ${index}`,
        subtaskId: subtask.id,
      }),
    );
    app.archiveSubtask(excluded.id, "released");
    const fallbackStatus = app.getTaskStatus(fallbackTask.id);
    const orderedStatuses = fallbackStatus.subtasks.map((row) => ({
      ...row,
      ...(row.subtaskId === older.id
        ? { reportCreatedAt: new Date(now.getTime() - 10_000) }
        : {}),
      ...(row.subtaskId === newer.id
        ? { reportCreatedAt: new Date(now.getTime() - 1_000) }
        : {}),
    }));
    const fallbackResult = snapshot(
      project,
      [
        taskInput(
          fallbackTask,
          { ...fallbackStatus, subtasks: orderedStatuses },
          [older, newer, excluded],
        ),
      ],
      { statusReports: fallbackReports },
    );
    expect(fallbackResult.projects[0]?.tasks?.[0]?.handoff).toMatchObject({
      additionalCount: 1,
      nextAction: "Fallback action 1",
      nextOwner: "Fallback owner 1",
      reporter: "Fallback reporter 1",
    });
  });

  test("recently done follows current finish metadata, including a Task archived after finishing", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const archivedDone = app.createTask({
      name: "Done then archived",
      projectId: project.id,
    });
    app.reportTaskStatus({
      taskId: archivedDone.id,
      workflowEpoch: app.getTaskStatus(archivedDone.id).workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    app.archiveTask(archivedDone.id, "released");

    const staleFinish = app.createTask({
      name: "Old finish epoch",
      projectId: project.id,
    });
    app.reportTaskStatus({
      taskId: staleFinish.id,
      workflowEpoch: app.getTaskStatus(staleFinish.id).workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const staleStatus = app.getTaskStatus(staleFinish.id);
    const { finishMetadata, ...withoutCurrentFinish } = staleStatus;
    const mismatchedStatus: TaskStatus = {
      ...withoutCurrentFinish,
      ...(finishMetadata
        ? {
            finishMetadata: {
              ...finishMetadata,
              epoch: staleStatus.workflowEpoch + 1,
            },
          }
        : {}),
    };

    const legacy = app.createTask({
      name: "Legacy completed without proof",
      projectId: project.id,
      workState: "active",
    });
    const legacyStatus = app.getTaskStatus(legacy.id);
    const { finishMetadata: _legacyMetadata, ...legacyWithoutFinish } =
      legacyStatus;
    const legacyCompleted: TaskStatus = {
      ...legacyWithoutFinish,
      taskCompleted: true,
      taskState: "completed",
    };

    const result = snapshot(project, [
      taskInput(archivedDone, app.getTaskStatus(archivedDone.id)),
      taskInput(staleFinish, mismatchedStatus),
      taskInput(legacy, legacyCompleted),
    ]);

    expect(
      result.projects[0]?.recentlyDone?.map((card) => card.taskId),
    ).toEqual([archivedDone.id]);
    expect(result.projects[0]?.recentlyDone?.[0]).toMatchObject({
      finishProvenance: "Agent report by Codex",
      state: "completed",
    });
    expect(result.scoreboard.finishedToday).toBe(1);
  });

  test("sorts by oldest attention, then state and priority regardless of session state", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory" });
    const olderBlocked = app.createTask({
      name: "Older blocked",
      projectId: project.id,
    });
    const newerBlocked = app.createTask({
      name: "Newer blocked",
      projectId: project.id,
    });
    for (const task of [olderBlocked, newerBlocked])
      app.setTaskWorkState({
        reason: "Waiting for a decision",
        taskId: task.id,
        workState: "blocked",
      });
    const high = app.createTask({
      name: "High priority active",
      priority: "high",
      projectId: project.id,
      workState: "active",
    });
    const mediumLater = app.createTask({
      name: "Medium later",
      priority: "medium",
      projectId: project.id,
      workState: "active",
    });
    const mediumEarlier = app.createTask({
      name: "Medium earlier",
      priority: "medium",
      projectId: project.id,
      workState: "active",
    });
    const planned = app.createTask({ name: "Planned", projectId: project.id });
    const backlog = app.createTask({
      name: "Backlog",
      projectId: project.id,
      workState: "backlog",
    });
    const inputs = [
      taskInput(
        { ...olderBlocked, createdAt: new Date(now.getTime() - 60_000) },
        app.getTaskStatus(olderBlocked.id),
      ),
      taskInput(
        { ...newerBlocked, createdAt: new Date(now.getTime() - 10_000) },
        app.getTaskStatus(newerBlocked.id),
      ),
      taskInput({ ...high, sortOrder: 90 }, app.getTaskStatus(high.id)),
      taskInput(
        { ...mediumLater, sortOrder: 20 },
        app.getTaskStatus(mediumLater.id),
      ),
      taskInput(
        { ...mediumEarlier, sortOrder: 10 },
        app.getTaskStatus(mediumEarlier.id),
      ),
      taskInput(planned, app.getTaskStatus(planned.id)),
      taskInput(backlog, app.getTaskStatus(backlog.id)),
    ];
    const first = snapshot(project, inputs);
    const sessionActivity = activity([
      source("source-a", [
        linkedThread("active-running", [high.id], {
          latestSessionState: "running",
        }),
        linkedThread("active-idle", [mediumEarlier.id]),
      ]),
    ]);
    const second = snapshot(project, inputs, {
      activities: [projectActivity(project.id, sessionActivity)],
    });
    const order = first.projects[0]!.tasks!.map((card) => card.taskId);

    expect(order).toEqual([
      olderBlocked.id,
      newerBlocked.id,
      high.id,
      mediumEarlier.id,
      mediumLater.id,
      planned.id,
      backlog.id,
    ]);
    expect(
      first.projects[0]?.tasks?.find((card) => card.taskId === olderBlocked.id),
    ).toMatchObject({ manualHold: true, state: "blocked" });
    expect(second.projects[0]!.tasks!.map((card) => card.taskId)).toEqual(
      order,
    );
  });
});
