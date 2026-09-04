import { describe, expect, test } from "bun:test";

import {
  FactoryApplication,
  type CodeSessionObservationInput,
} from "../../src/application";
import type { T3ShellObservation } from "../../src/t3";
import { createT3Coordinator } from "../../src/t3-coordinator";

const fixtureStart = Date.now();

function fixtureDate(offset = 0): Date {
  return new Date(fixtureStart + offset);
}

function createApplication() {
  let nextId = 0;
  let now = fixtureDate();
  const app = new FactoryApplication({
    clock: () => new Date(now),
    idGenerator: () => `id-${++nextId}`,
  });
  return {
    app,
    advance(milliseconds: number) {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

function observation(
  projectId: string,
  overrides: Partial<CodeSessionObservationInput> = {},
): CodeSessionObservationInput {
  return {
    branch: "feature/watchtower",
    externalProjectId: "t3-project-watchtower",
    externalThreadId: "t3-thread-1",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "running",
    latestTurnState: "running",
    observedAt: fixtureDate(),
    projectId,
    provider: "t3",
    repositoryIdentity: "github.com/app-press/watchtower",
    sourceDigest: "digest-1",
    sourceSequence: 1,
    sourceStream: "shell",
    sourceUpdatedAt: fixtureDate(),
    title: "Build Watchtower",
    workspaceRoot: "/work/watchtower",
    worktreePath: "/work/watchtower",
    ...overrides,
  };
}

describe("T3 session observations", () => {
  test("persists unlinked bounded observations without changing Factory work authority", () => {
    const { app } = createApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app-press/watchtower.git",
      name: "Watchtower",
    });
    const task = app.createTask({
      branchName: "feature/watchtower",
      name: "Build the Watchtower shell",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Implement the shell",
      taskId: task.id,
    });

    app.refreshT3Observations({ observations: [observation(project.id)] });

    expect(app.listProjectT3Activity(project.id)).toMatchObject([
      {
        observation: {
          externalThreadId: "t3-thread-1",
          latestSessionState: "running",
        },
      },
    ]);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskState: "planned",
      subtasks: [
        { effectiveState: "planned", verificationState: "unreported" },
      ],
    });
    expect(app.getSubtaskReportHistory(subtask.id)).toEqual([]);
    expect(app.getSubtaskVerificationHistory(subtask.id)).toEqual([]);
  });

  test("deduplicates equal observations and ignores older source sequence or timestamp", () => {
    const { app, advance } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    const first = observation(project.id);

    app.refreshT3Observations({ observations: [first, first] });
    expect(app.listProjectT3Activity(project.id)).toHaveLength(1);

    advance(60_000);
    app.refreshT3Observations({
      observations: [
        observation(project.id, {
          latestTurnState: "completed",
          sourceDigest: "digest-2",
          sourceSequence: 2,
          sourceUpdatedAt: fixtureDate(60_000),
        }),
      ],
    });
    app.refreshT3Observations({
      observations: [
        observation(project.id, {
          latestTurnState: "error",
          sourceDigest: "old-digest",
          sourceSequence: 1,
          sourceUpdatedAt: fixtureDate(30_000),
        }),
      ],
    });

    expect(app.getT3ThreadDetail("t3-thread-1").observation).toMatchObject({
      latestTurnState: "completed",
      sourceSequence: 2,
      sourceDigest: "digest-2",
    });
  });

  test("supports zero-to-many idempotent work associations while keeping Run state separate from Work State", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    const task = app.createTask({
      branchName: "feature/watchtower",
      name: "Build the Watchtower shell",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Implement the shell",
      taskId: task.id,
    });
    const secondTask = app.createTask({
      name: "Document the shell",
      projectId: project.id,
    });
    const input = observation(project.id);
    app.refreshT3Observations({ observations: [input] });

    const linked = app.linkT3Thread({
      observation: input,
      subtaskId: subtask.id,
      taskId: task.id,
    });
    expect(linked.run).toMatchObject({
      projectId: project.id,
      state: "observed",
    });
    expect(linked.association).toMatchObject({
      subtaskId: subtask.id,
      taskId: task.id,
    });
    expect(linked.codeSession).not.toHaveProperty("projectId");
    expect(app.getTaskStatus(task.id)).toMatchObject({ taskState: "planned" });
    expect(app.getT3ThreadDetail("t3-thread-1")).toMatchObject({
      associations: [{ subtaskId: subtask.id, taskId: task.id }],
      codeSession: { runId: linked.run.id },
      run: { id: linked.run.id },
    });

    const duplicate = app.linkT3Thread({
      observation: input,
      subtaskId: subtask.id,
    });
    expect(duplicate.association.id).toBe(linked.association.id);

    const second = app.linkT3Thread({
      observation: input,
      taskId: secondTask.id,
    });
    expect(app.getT3ThreadDetail("t3-thread-1").associations).toHaveLength(2);
    expect(() =>
      app.unlinkT3Thread({ externalThreadId: "t3-thread-1" }),
    ).toThrow("multiple associations");

    const unlinked = app.unlinkT3Thread({
      associationId: linked.association.id,
      externalThreadId: "t3-thread-1",
    });
    expect(unlinked.run).toMatchObject({
      id: linked.run.id,
      state: "observed",
    });
    expect(unlinked.association.id).toBe(linked.association.id);
    expect(app.getT3ThreadDetail("t3-thread-1")).toMatchObject({
      associations: [{ id: second.association.id, taskId: secondTask.id }],
      codeSession: { id: linked.codeSession.id },
    });

    app.unlinkT3Thread({
      associationId: second.association.id,
      externalThreadId: "t3-thread-1",
    });
    expect(
      app
        .listReconciliationFindings(project.id)
        .find(
          (finding) =>
            finding.externalThreadId === "t3-thread-1" &&
            finding.status === "open",
        ),
    ).toMatchObject({ kind: "unlinked_activity" });
  });

  test("refreshes a newer observation supplied while linking an existing thread", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    const task = app.createTask({
      branchName: "feature/watchtower",
      name: "Build the Watchtower shell",
      projectId: project.id,
    });
    const first = observation(project.id);
    app.refreshT3Observations({ observations: [first] });

    const newer = observation(project.id, {
      latestSessionState: "ready",
      latestTurnState: "completed",
      latestTurnCompletedAt: fixtureDate(60_000),
      sourceDigest: "digest-2",
      sourceSequence: 2,
      sourceUpdatedAt: fixtureDate(60_000),
    });
    const linked = app.linkT3Thread({
      observation: newer,
      taskId: task.id,
    });

    expect(linked.codeSession).toMatchObject({
      latestTurnState: "completed",
      sourceSequence: 2,
      sourceStream: "shell",
    });
    expect(
      app.getT3ThreadDetail(newer.externalThreadId).observation,
    ).toMatchObject({
      latestTurnState: "completed",
      sourceSequence: 2,
    });
  });

  test("rejects a link to a Task or Subtask in another Project", () => {
    const { app } = createApplication();
    const firstProject = app.createProject({ name: "Watchtower" });
    const secondProject = app.createProject({ name: "Grail" });
    const secondTask = app.createTask({
      name: "Unrelated task",
      projectId: secondProject.id,
    });
    app.refreshT3Observations({ observations: [observation(firstProject.id)] });

    expect(() =>
      app.linkT3Thread({
        observation: observation(firstProject.id),
        taskId: secondTask.id,
      }),
    ).toThrow("selected Project");
  });

  test("inherits parent branch metadata when reconciling a linked Subtask", () => {
    const { app } = createApplication();
    const project = app.createProject({
      name: "Watchtower",
      workspaceRoot: "/work/watchtower",
    });
    const task = app.createTask({
      branchName: "feature/watchtower",
      name: "Build the Watchtower shell",
      projectId: project.id,
    });
    const subtask = app.createSubtask({
      name: "Implement the shell",
      taskId: task.id,
    });
    const mismatched = observation(project.id, {
      branch: "feature/other",
    });
    app.refreshT3Observations({ observations: [mismatched] });
    app.linkT3Thread({ observation: mismatched, subtaskId: subtask.id });

    expect(app.listReconciliationFindings(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "branch_mismatch",
          status: "open",
          subtaskId: subtask.id,
          taskId: task.id,
        }),
      ]),
    );
  });

  test("suppresses and resolves branch mismatch when one linked target matches", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    const matchingTask = app.createTask({
      branchName: "feature/watchtower",
      name: "Build the Watchtower shell",
      projectId: project.id,
    });
    const otherTask = app.createTask({
      branchName: "feature/other",
      name: "Document the Watchtower shell",
      projectId: project.id,
    });
    const mismatched = observation(project.id, {
      branch: "feature/old",
    });
    app.refreshT3Observations({ observations: [mismatched] });
    app.linkT3Thread({ observation: mismatched, taskId: matchingTask.id });
    app.linkT3Thread({ observation: mismatched, taskId: otherTask.id });
    expect(
      app
        .listReconciliationFindings(project.id)
        .filter(
          (finding) =>
            finding.kind === "branch_mismatch" && finding.status === "open",
        ),
    ).toHaveLength(2);

    const corrected = observation(project.id, {
      branch: "feature/watchtower",
      sourceDigest: "digest-2",
      sourceSequence: 2,
      sourceUpdatedAt: fixtureDate(60_000),
    });
    app.refreshT3Observations({ observations: [corrected] });

    expect(
      app
        .listReconciliationFindings(project.id)
        .filter(
          (finding) =>
            finding.kind === "branch_mismatch" && finding.status === "open",
        ),
    ).toEqual([]);
    expect(
      app
        .listReconciliationFindings(project.id)
        .filter((finding) => finding.kind === "branch_mismatch")
        .every((finding) => finding.status === "resolved"),
    ).toBe(true);
  });

  test("matches a stale exact observation without relying on recent findings", () => {
    const { app } = createApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app-press/watchtower.git",
      name: "Watchtower",
    });
    const task = app.createTask({
      branchName: "feature/watchtower",
      name: "Build the Watchtower shell",
      projectId: project.id,
    });
    const stale = observation(project.id, {
      latestSessionState: "ready",
      latestTurnState: "completed",
      observedAt: fixtureDate(-48 * 60 * 60 * 1000),
      sourceUpdatedAt: fixtureDate(-48 * 60 * 60 * 1000),
    });
    app.refreshT3Observations({ observations: [stale] });

    expect(app.matchT3Observation(stale)).toMatchObject({
      basis: "repository_branch",
      candidate: { taskId: task.id },
      status: "matched",
    });
  });

  test("shows a stale exact match as suggested in the activity view", async () => {
    const { app } = createApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app-press/watchtower.git",
      name: "Watchtower",
    });
    const task = app.createTask({
      branchName: "feature/watchtower",
      name: "Build the Watchtower shell",
      projectId: project.id,
    });
    const staleTime = fixtureDate(-48 * 60 * 60 * 1000);
    const stale = observation(project.id, {
      latestSessionState: "ready",
      latestTurnState: "completed",
      observedAt: staleTime,
      sourceUpdatedAt: staleTime,
    });
    app.refreshT3Observations({ observations: [stale] });

    const coordinator = createT3Coordinator({
      application: app,
      reader: {
        async readShell() {
          return {
            fetchedAt: staleTime.toISOString(),
            ok: true,
            projects: [
              {
                createdAt: staleTime.toISOString(),
                id: stale.externalProjectId,
                repositoryIdentity: {
                  canonicalKey: stale.repositoryIdentity,
                },
                title: "Watchtower",
                updatedAt: staleTime.toISOString(),
                workspaceRoot: stale.workspaceRoot,
              },
            ],
            sourceDigest: stale.sourceDigest,
            sourceSequence: stale.sourceSequence,
            sourceStream: stale.sourceStream,
            sourceUpdatedAt: stale.sourceUpdatedAt.toISOString(),
            status: "ok",
            threads: [
              {
                branch: stale.branch,
                createdAt: staleTime.toISOString(),
                hasActionableProposedPlan: false,
                hasPendingApprovals: false,
                hasPendingUserInput: false,
                id: stale.externalThreadId,
                latestTurn: {
                  completedAt: staleTime.toISOString(),
                  requestedAt: staleTime.toISOString(),
                  startedAt: staleTime.toISOString(),
                  state: "completed",
                  turnId: "turn-stale",
                },
                projectId: stale.externalProjectId,
                session: {
                  providerName: "codex",
                  status: "ready",
                  updatedAt: staleTime.toISOString(),
                },
                title: stale.title,
                updatedAt: staleTime.toISOString(),
                worktreePath: stale.worktreePath,
              },
            ],
          } as unknown as Extract<T3ShellObservation, { ok: true }>;
        },
        async readThread() {
          throw new Error("Thread detail should not be requested.");
        },
      },
    });

    const activity = await coordinator.projectActivity(project.id);
    expect(activity).toMatchObject({
      counts: { suggested: 1, unmatched: 0 },
      threads: [
        {
          association: {
            candidateIds: [task.id],
            candidateLabels: [task.name],
            state: "suggested",
          },
        },
      ],
    });
  });

  test("resolves a transport finding when Project resolution emits its own kind", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Beacon" });
    const observedAt = fixtureDate();

    app.refreshT3Observations({
      observations: [],
      sourceUnavailable: [
        {
          explanation: "T3 could not be reached.",
          observedAt,
          projectId: project.id,
        },
      ],
    });
    app.refreshT3Observations({
      observations: [],
      projectUnresolved: [
        {
          explanation: "The Project has no matching T3 Project.",
          observedAt,
          projectId: project.id,
        },
      ],
    });

    expect(app.listReconciliationFindings(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "project_unresolved", status: "open" }),
        expect.objectContaining({
          kind: "source_unavailable",
          status: "resolved",
        }),
      ]),
    );
  });

  test("honors explicit T3 project and workspace mappings", () => {
    const { app } = createApplication();
    const project = app.createProject({
      name: "Watchtower",
      t3ProjectId: "t3-project-watchtower",
      workspaceRoot: "/work/watchtower",
    });

    expect(() =>
      app.refreshT3Observations({
        observations: [
          observation(project.id, {
            externalProjectId: "t3-project-other",
          }),
        ],
      }),
    ).toThrow("does not match Factory Project");

    app.refreshT3Observations({ observations: [observation(project.id)] });
    expect(app.listProjectT3Activity(project.id)).toHaveLength(1);
  });

  test("preserves idle and interrupted T3 session states", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    app.refreshT3Observations({
      observations: [
        observation(project.id, {
          latestSessionState: "idle",
          latestTurnState: "interrupted",
          sourceDigest: "digest-idle",
          sourceSequence: 2,
          sourceUpdatedAt: fixtureDate(60_000),
        }),
      ],
    });

    expect(app.getT3ThreadDetail("t3-thread-1").observation).toMatchObject({
      latestSessionState: "idle",
      latestTurnState: "interrupted",
    });
  });

  test("uses source streams instead of comparing unrelated sequence numbers", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    app.refreshT3Observations({
      observations: [
        observation(project.id, {
          sourceSequence: 200,
          sourceStream: "shell",
        }),
      ],
    });
    app.refreshT3Observations({
      observations: [
        observation(project.id, {
          latestTurnState: "completed",
          sourceDigest: "detail-digest",
          sourceSequence: 1,
          sourceStream: "thread:t3-thread-1",
          sourceUpdatedAt: fixtureDate(60_000),
        }),
      ],
    });

    expect(app.getT3ThreadDetail("t3-thread-1").observation).toMatchObject({
      sourceSequence: 1,
      sourceStream: "thread:t3-thread-1",
    });
  });

  test("ages absent threads only across an explicit successful refresh boundary", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    app.refreshT3Observations({ observations: [observation(project.id)] });
    expect(app.listProjectT3Activity(project.id)).toHaveLength(1);

    app.refreshT3Observations({
      observations: [],
      refreshedProjects: [
        {
          observedAt: fixtureDate(60_000),
          projectId: project.id,
          sourceSequence: 2,
          sourceStream: "shell",
          sourceUpdatedAt: fixtureDate(60_000),
        },
      ],
    });

    expect(app.listProjectT3Activity(project.id)).toEqual([]);
    expect(app.getT3ThreadDetail("t3-thread-1").observation).toMatchObject({
      sourceCurrent: false,
    });
    expect(app.listReconciliationFindings(project.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "unlinked_activity",
          status: "resolved",
        }),
      ]),
    );
  });

  test("records bounded detail evidence through observation refresh", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    app.refreshT3Observations({
      evidence: [
        {
          checkpointFiles: ["src/t3.ts"],
          digest: "detail-evidence",
          externalThreadId: "t3-thread-1",
          observedAt: fixtureDate(1_000),
          provider: "t3",
          sourceSequence: 1,
          sourceStream: "thread:t3-thread-1",
          turnIds: ["turn-1"],
        },
      ],
      observations: [observation(project.id)],
    });

    expect(app.listSessionEvidence("t3-thread-1")).toMatchObject([
      {
        checkpointFiles: ["src/t3.ts"],
        sourceStream: "thread:t3-thread-1",
      },
    ]);
  });

  test("deduplicates bounded evidence by source sequence or digest", () => {
    const { app } = createApplication();
    const project = app.createProject({ name: "Watchtower" });
    app.refreshT3Observations({ observations: [observation(project.id)] });
    const input = {
      checkpointFiles: ["dist/main.js"],
      digest: "evidence-1",
      externalThreadId: "t3-thread-1",
      linkedPullRequestUrl: "https://github.com/app-press/watchtower/pull/1",
      observedAt: fixtureDate(),
      provider: "t3" as const,
      sourceSequence: 1,
      turnIds: ["turn-1"],
    };
    const first = app.recordSessionEvidence(input);
    const duplicate = app.recordSessionEvidence({
      ...input,
      checkpointFiles: ["different-file.js"],
    });
    expect(duplicate).toEqual(first);
    expect(app.listSessionEvidence("t3-thread-1")).toEqual([first]);

    const differentStream = app.recordSessionEvidence({
      ...input,
      digest: input.digest,
      sourceSequence: undefined,
      sourceStream: "thread:t3-thread-1",
    });
    expect(differentStream).not.toEqual(first);
    expect(app.listSessionEvidence("t3-thread-1")).toHaveLength(2);
  });
});
