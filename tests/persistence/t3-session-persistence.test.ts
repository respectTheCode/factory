import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { describe, expect, test } from "bun:test";

import {
  createFactoryApplication,
  type CodeSessionObservationInput,
} from "../../src/application";

function observation(projectId: string): CodeSessionObservationInput {
  // Persistence uses the production clock, so this fixture must remain inside
  // the reconciliation engine's 24-hour recent-activity window.
  const observedAt = new Date();
  return {
    branch: "feature/factory-t3",
    externalProjectId: "t3-project-factory",
    externalThreadId: "t3-thread-factory",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "ready",
    latestTurnState: "completed",
    observedAt,
    projectId,
    provider: "t3",
    repositoryIdentity: "github.com/app-press/factory",
    sourceDigest: "digest-1",
    sourceSequence: 10,
    sourceUpdatedAt: observedAt,
    title: "Build T3 integration",
    workspaceRoot: "/work/factory",
  };
}

describe("T3 session persistence", () => {
  test("reopens Runs, CodeSessions, observations, evidence, and findings", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-t3-persistence-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({
        gitOriginUrl: "git@github.com:app-press/factory.git",
        name: "Factory",
      });
      const task = first.createTask({
        branchName: "feature/factory-t3",
        name: "Add T3 integration",
        projectId: project.id,
      });
      const subtask = first.createSubtask({
        name: "Persist observations",
        taskId: task.id,
      });
      const input = observation(project.id);
      first.refreshT3Observations({ observations: [input] });
      const linked = first.linkT3Thread({
        observation: input,
        subtaskId: subtask.id,
      });
      const evidence = first.recordSessionEvidence({
        checkpointFiles: ["src/application.ts"],
        digest: "evidence-1",
        externalThreadId: input.externalThreadId,
        observedAt: input.observedAt,
        provider: "t3",
        sourceSequence: 10,
        turnIds: ["turn-10"],
      });
      first.reconcileT3Project({ projectId: project.id });

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getT3ThreadDetail(input.externalThreadId)).toMatchObject({
        associations: [
          {
            id: linked.association.id,
            subtaskId: subtask.id,
            taskId: task.id,
          },
        ],
        codeSession: { id: linked.codeSession.id, runId: linked.run.id },
        observation: { sourceSequence: 10 },
        run: { id: linked.run.id },
      });
      expect(reopened.listSessionEvidence(input.externalThreadId)).toEqual([
        evidence,
      ]);
      expect(reopened.listReconciliationFindings(project.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "unlinked_activity",
            projectId: project.id,
            status: "resolved",
          }),
        ]),
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("hydrates legacy state without any integration arrays", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-t3-legacy-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({ name: "Legacy Factory" });
      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getProjectDetail(project.id)).toMatchObject({
        id: project.id,
        name: "Legacy Factory",
      });
      expect(reopened.listProjectT3Activity(project.id)).toEqual([]);
      expect(reopened.listReconciliationFindings(project.id)).toEqual([]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("migrates a legacy Run target into a Code Session association", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-t3-link-migration-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({ name: "Factory" });
      const task = first.createTask({ name: "Task", projectId: project.id });
      const input = observation(project.id);
      first.refreshT3Observations({ observations: [input] });
      const linked = first.linkT3Thread({
        observation: input,
        taskId: task.id,
      });

      const database = new Database(databasePath);
      const row = database
        .query("SELECT state FROM factory_state WHERE id = 1")
        .get() as { state: string };
      const state = JSON.parse(row.state) as {
        codeSessionAssociations?: unknown[];
        runs: Array<{ id: string; taskId?: string }>;
      };
      delete state.codeSessionAssociations;
      const run = state.runs.find(
        (candidate) => candidate.id === linked.run.id,
      );
      if (!run) throw new Error("Legacy fixture lost its Run.");
      run.taskId = task.id;
      database
        .query("UPDATE factory_state SET state = $state WHERE id = 1")
        .run({ $state: JSON.stringify(state) });
      database.close();

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getT3ThreadDetail(input.externalThreadId)).toMatchObject({
        associations: [
          {
            codeSessionId: linked.codeSession.id,
            id: `legacy-${linked.codeSession.id}`,
            taskId: task.id,
          },
        ],
        run: { id: linked.run.id },
      });
      expect(
        reopened.getT3ThreadDetail(input.externalThreadId).run,
      ).not.toHaveProperty("taskId");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("removes deleted Task/Subtask associations while retaining Run provenance", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-t3-removal-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory" });
      const task = app.createTask({ name: "Task", projectId: project.id });
      const subtask = app.createSubtask({ name: "Subtask", taskId: task.id });
      const input = observation(project.id);
      app.refreshT3Observations({ observations: [input] });
      const linked = app.linkT3Thread({
        observation: input,
        subtaskId: subtask.id,
      });
      const taskLink = app.linkT3Thread({
        observation: input,
        taskId: task.id,
      });

      app.removeSubtask(subtask.id);
      expect(app.getT3ThreadDetail(input.externalThreadId)).toMatchObject({
        associations: [{ id: taskLink.association.id, taskId: task.id }],
        run: { id: linked.run.id },
      });

      app.removeTask(task.id);
      expect(
        app.getT3ThreadDetail(input.externalThreadId).associations,
      ).toEqual([]);
      expect(app.getT3ThreadDetail(input.externalThreadId).run).toMatchObject({
        id: linked.run.id,
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("cascades unlinked observations and evidence when a Project is removed", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-t3-project-removal-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory" });
      const input = observation(project.id);
      app.refreshT3Observations({ observations: [input] });
      app.recordSessionEvidence({
        checkpointFiles: ["src/application.ts"],
        digest: "evidence-unlinked",
        externalThreadId: input.externalThreadId,
        observedAt: input.observedAt,
        provider: "t3",
        sourceSequence: 10,
        turnIds: ["turn-10"],
      });

      app.removeProject(project.id);

      expect(app.listSessionEvidence(input.externalThreadId)).toEqual([]);
      expect(() => app.getT3ThreadDetail(input.externalThreadId)).toThrow(
        "does not exist",
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
