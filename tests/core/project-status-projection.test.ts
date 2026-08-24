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

function addTaskWithCurrentState(
  app: FactoryApplication,
  projectId: string,
  name: string,
  reportedState?: "in_progress" | "blocked" | "complete",
  accepted = false,
) {
  const task = app.createTask({ name, projectId });
  if (!reportedState) return task;

  const subtask = app.createSubtask({
    name: `${name} subtask`,
    taskId: task.id,
  });
  const report = app.reportSubtaskStatus({
    reporter: "codex",
    reportedState,
    subtaskId: subtask.id,
  });
  if (accepted) {
    app.verifyStatusReport({
      decision: "accepted",
      reportId: report.id,
      verifier: "kevin",
    });
  }

  return task;
}

describe("project status projection", () => {
  test("counts each required project work state from current task status", () => {
    const app = createApplication();
    const project = app.createProject({ name: "Factory V1" });

    addTaskWithCurrentState(app, project.id, "Plan the next slice");
    addTaskWithCurrentState(
      app,
      project.id,
      "Build the next slice",
      "in_progress",
    );
    addTaskWithCurrentState(
      app,
      project.id,
      "Verify the next slice",
      "complete",
    );
    addTaskWithCurrentState(
      app,
      project.id,
      "Ship the accepted slice",
      "complete",
      true,
    );
    addTaskWithCurrentState(
      app,
      project.id,
      "Unblock the next slice",
      "blocked",
    );

    expect(app.getProjectStatus(project.id)).toEqual({
      projectId: project.id,
      projectName: "Factory V1",
      totalTasks: 5,
      counts: {
        planned: 1,
        active: 1,
        awaiting_verification: 1,
        completed: 1,
        blocked: 1,
        released: 0,
        wont_do: 0,
      },
    });
  });

  test("aggregates project counts into a portfolio projection", () => {
    const app = createApplication();
    const factory = app.createProject({ name: "Factory V1" });
    const grail = app.createProject({ name: "Grail roadmap" });

    addTaskWithCurrentState(app, factory.id, "Plan factory work");
    addTaskWithCurrentState(
      app,
      factory.id,
      "Build factory work",
      "in_progress",
    );
    addTaskWithCurrentState(app, grail.id, "Verify Grail work", "complete");
    addTaskWithCurrentState(app, grail.id, "Ship Grail work", "complete", true);
    addTaskWithCurrentState(app, grail.id, "Unblock Grail work", "blocked");

    expect(app.getPortfolioStatus()).toEqual({
      totalTasks: 5,
      counts: {
        planned: 1,
        active: 1,
        awaiting_verification: 1,
        completed: 1,
        blocked: 1,
        released: 0,
        wont_do: 0,
      },
      projects: [
        {
          projectId: factory.id,
          projectName: "Factory V1",
          totalTasks: 2,
          counts: {
            planned: 1,
            active: 1,
            awaiting_verification: 0,
            completed: 0,
            blocked: 0,
            released: 0,
            wont_do: 0,
          },
        },
        {
          projectId: grail.id,
          projectName: "Grail roadmap",
          totalTasks: 3,
          counts: {
            planned: 0,
            active: 0,
            awaiting_verification: 1,
            completed: 1,
            blocked: 1,
            released: 0,
            wont_do: 0,
          },
        },
      ],
    });
  });
});
