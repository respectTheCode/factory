import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createFactoryApplication,
  type CodeSessionObservationInput,
} from "../../src/application";

function observation(projectId: string): CodeSessionObservationInput {
  const observedAt = new Date("2026-09-02T12:00:00.000Z");
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
        codeSession: { id: linked.codeSession.id, runId: linked.run.id },
        observation: { sourceSequence: 10 },
        run: { id: linked.run.id, subtaskId: subtask.id },
      });
      expect(reopened.listSessionEvidence(input.externalThreadId)).toEqual([
        evidence,
      ]);
      expect(reopened.listReconciliationFindings(project.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "ambiguous_target",
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

  test("clears deleted Task/Subtask targets while retaining Run provenance", () => {
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

      app.removeSubtask(subtask.id);
      expect(app.getT3ThreadDetail(input.externalThreadId).run).toMatchObject({
        id: linked.run.id,
        taskId: task.id,
      });
      expect(
        app.getT3ThreadDetail(input.externalThreadId).run,
      ).not.toHaveProperty("subtaskId");

      app.removeTask(task.id);
      expect(
        app.getT3ThreadDetail(input.externalThreadId).run,
      ).not.toHaveProperty("taskId");
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
