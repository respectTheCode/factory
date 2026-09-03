import { describe, expect, test } from "bun:test";

import {
  FactoryApplication,
  type CodeSessionObservationInput,
} from "../../src/application";

function createApplication() {
  let nextId = 0;
  let now = new Date("2026-09-02T12:00:00.000Z");
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
    observedAt: new Date("2026-09-02T12:00:00.000Z"),
    projectId,
    provider: "t3",
    repositoryIdentity: "github.com/app-press/watchtower",
    sourceDigest: "digest-1",
    sourceSequence: 1,
    sourceStream: "shell",
    sourceUpdatedAt: new Date("2026-09-02T12:00:00.000Z"),
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
          sourceUpdatedAt: new Date("2026-09-02T12:01:00.000Z"),
        }),
      ],
    });
    app.refreshT3Observations({
      observations: [
        observation(project.id, {
          latestTurnState: "error",
          sourceDigest: "old-digest",
          sourceSequence: 1,
          sourceUpdatedAt: new Date("2026-09-02T12:00:30.000Z"),
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
      latestTurnCompletedAt: new Date("2026-09-02T12:01:00.000Z"),
      sourceDigest: "digest-2",
      sourceSequence: 2,
      sourceUpdatedAt: new Date("2026-09-02T12:01:00.000Z"),
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
          sourceUpdatedAt: new Date("2026-09-02T12:01:00.000Z"),
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
          sourceUpdatedAt: new Date("2026-09-02T12:01:00.000Z"),
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
          observedAt: new Date("2026-09-02T12:01:00.000Z"),
          projectId: project.id,
          sourceSequence: 2,
          sourceStream: "shell",
          sourceUpdatedAt: new Date("2026-09-02T12:01:00.000Z"),
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
          observedAt: new Date("2026-09-02T12:00:01.000Z"),
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
      observedAt: new Date("2026-09-02T12:00:00.000Z"),
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
