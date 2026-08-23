import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

const clock = () => new Date("2026-08-23T12:00:00.000Z");

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock,
    idGenerator: () => `id-${++nextId}`,
  });
}

function addTask(
  app: FactoryApplication,
  projectId: string,
  input: {
    name: string;
    priority: "low" | "medium" | "high" | "urgent";
    owner: string;
    reportedState?: "in_progress" | "blocked" | "complete";
    accepted?: boolean;
  },
) {
  const task = app.createTask({
    name: input.name,
    owner: input.owner,
    priority: input.priority,
    projectId,
  });

  if (!input.reportedState) return task;

  const subtask = app.createSubtask({
    name: `${input.name} subtask`,
    taskId: task.id,
  });
  const report = app.reportSubtaskStatus({
    reportedState: input.reportedState,
    reporter: "codex",
    subtaskId: subtask.id,
  });

  if (input.accepted) {
    app.verifyStatusReport({
      decision: "accepted",
      reportId: report.id,
      verifier: "kevin",
    });
  }

  return task;
}

describe("attention projection", () => {
  test("returns every non-completed task with identity, state, metadata, and stable ordering", () => {
    const app = createApplication();
    const zeta = app.createProject({ name: "Zeta launch" });
    const alpha = app.createProject({ name: "Alpha roadmap" });

    const zetaBlocked = addTask(app, zeta.id, {
      name: "Unblock deployment",
      owner: "kevin",
      priority: "urgent",
      reportedState: "blocked",
    });
    const zetaAwaiting = addTask(app, zeta.id, {
      name: "Verify deployment",
      owner: "alex",
      priority: "high",
      reportedState: "complete",
    });
    const zetaActive = addTask(app, zeta.id, {
      name: "Build deployment",
      owner: "sam",
      priority: "medium",
      reportedState: "in_progress",
    });
    const zetaCompleted = addTask(app, zeta.id, {
      name: "Archive deployment",
      owner: "kevin",
      priority: "urgent",
      reportedState: "complete",
      accepted: true,
    });
    const alphaPlanned = addTask(app, alpha.id, {
      name: "Draft release",
      owner: "kevin",
      priority: "low",
    });

    const attention = app.getAttentionProjection();

    expect(attention).toEqual([
      {
        projectId: alpha.id,
        projectName: "Alpha roadmap",
        taskId: alphaPlanned.id,
        taskName: "Draft release",
        state: "planned",
        priority: "low",
        owner: "kevin",
      },
      {
        projectId: zeta.id,
        projectName: "Zeta launch",
        taskId: zetaActive.id,
        taskName: "Build deployment",
        state: "active",
        priority: "medium",
        owner: "sam",
      },
      {
        projectId: zeta.id,
        projectName: "Zeta launch",
        taskId: zetaBlocked.id,
        taskName: "Unblock deployment",
        state: "blocked",
        priority: "urgent",
        owner: "kevin",
      },
      {
        projectId: zeta.id,
        projectName: "Zeta launch",
        taskId: zetaAwaiting.id,
        taskName: "Verify deployment",
        state: "awaiting_verification",
        priority: "high",
        owner: "alex",
      },
    ]);

    expect(attention).not.toContainEqual(
      expect.objectContaining({ taskId: zetaCompleted.id }),
    );
    expect(app.getAttentionProjection()).toEqual(attention);
  });
});
