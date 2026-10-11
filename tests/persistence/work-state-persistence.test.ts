import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";

describe("work-state persistence", () => {
  test("persists the manual versus rollup source additively", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-work-state-source-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory V1" });
      const task = app.createTask({
        name: "Track source",
        projectId: project.id,
      });
      const subtask = app.createSubtask({
        name: "Child work",
        taskId: task.id,
      });
      const report = app.reportSubtaskStatus({
        reason: "The child is ready for verification.",
        reportedState: "in_progress",
        reporter: "codex",
        subtaskId: subtask.id,
      });

      const rollupDatabase = new Database(databasePath);
      const rollupState = rollupDatabase
        .query("SELECT state FROM factory_state WHERE id = 1")
        .get() as { state: string };
      rollupDatabase.close();
      expect(
        (
          JSON.parse(rollupState.state) as {
            tasks: Array<Record<string, unknown>>;
          }
        ).tasks.find((candidate) => candidate.id === task.id),
      ).toMatchObject({
        workState: "active",
        workStateSource: "rollup",
      });

      app.setTaskWorkState({ taskId: task.id, workState: "planned" });
      const manualDatabase = new Database(databasePath);
      const manualState = manualDatabase
        .query("SELECT state FROM factory_state WHERE id = 1")
        .get() as { state: string };
      manualDatabase.close();
      expect(
        (
          JSON.parse(manualState.state) as {
            tasks: Array<Record<string, unknown>>;
          }
        ).tasks.find((candidate) => candidate.id === task.id),
      ).toMatchObject({
        workState: "planned",
        workStateSource: "manual",
      });

      // Keep the report live so this test also proves the source is orthogonal
      // to immutable status history.
      expect(app.getTaskStatus(task.id).subtasks[0]?.reportId).toBe(report.id);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("hydrates legacy snapshots additively without changing derived state or counts", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-legacy-work-state-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const legacyState = {
      projects: [
        {
          createdAt: "2026-08-29T12:00:00.000Z",
          id: "project-1",
          name: "Factory V1",
        },
      ],
      tasks: [
        {
          acceptanceCriteria: [],
          createdAt: "2026-08-29T12:00:00.000Z",
          dependencies: [],
          id: "task-1",
          name: "Legacy task",
          projectId: "project-1",
          repositoryLinks: [],
        },
      ],
      subtasks: [
        {
          createdAt: "2026-08-29T12:00:00.000Z",
          id: "subtask-1",
          name: "Legacy subtask",
          taskId: "task-1",
        },
      ],
      statusReports: [
        {
          createdAt: "2026-08-29T12:00:00.000Z",
          evidence: "The legacy implementation is running.",
          id: "report-1",
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: "subtask-1",
        },
      ],
      verifications: [],
      trackerLinks: [],
    };

    try {
      const database = new Database(databasePath);
      database.exec(
        "CREATE TABLE factory_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)",
      );
      database
        .query("INSERT INTO factory_state (id, state) VALUES (1, $state)")
        .run({ $state: JSON.stringify(legacyState) });
      database.close();

      const first = createFactoryApplication({ databasePath });
      const firstStatus = first.getTaskStatus("task-1");
      const firstProjectStatus = first.getProjectStatus("project-1");

      expect(firstStatus).toMatchObject({
        taskCompleted: false,
        taskState: "active",
        subtasks: [
          {
            effectiveState: "active",
            reportedState: "in_progress",
            subtaskId: "subtask-1",
          },
        ],
      });
      expect(firstProjectStatus.counts).toMatchObject({
        active: 1,
        backlog: 0,
        blocked: 0,
        completed: 0,
        planned: 0,
        awaiting_verification: 0,
      });

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getTaskStatus("task-1")).toEqual(firstStatus);
      expect(reopened.getProjectStatus("project-1")).toEqual(
        firstProjectStatus,
      );

      first.setTaskWorkState({ taskId: "task-1", workState: "planned" });
      const migrated = createFactoryApplication({ databasePath });
      expect(migrated.getTaskDetail("task-1")).toMatchObject({
        workState: "planned",
      });
      expect(migrated.getTaskStatus("task-1")).toMatchObject({
        taskState: "planned",
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("migrates only legacy all-accepted Tasks and preserves modern Done provenance", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-legacy-task-completion-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const createdAt = "2026-08-29T12:00:00.000Z";
    const completedAt = "2026-08-29T13:00:00.000Z";
    const legacyState = {
      projects: [{ createdAt, id: "project-1", name: "Factory V1" }],
      tasks: [
        {
          acceptanceCriteria: [],
          createdAt,
          dependencies: [],
          id: "legacy-done",
          name: "Legacy completed Task",
          projectId: "project-1",
          repositoryLinks: [],
        },
        {
          acceptanceCriteria: [],
          createdAt,
          dependencies: [],
          id: "legacy-not-done",
          name: "Legacy unaccepted Task",
          projectId: "project-1",
          repositoryLinks: [],
        },
        {
          acceptanceCriteria: [],
          createdAt,
          dependencies: [],
          finishMetadata: {
            actor: "Kevin",
            completedAt,
            epoch: 0,
            kind: "human_mark_done",
            reason: "Kept the explicit human decision.",
          },
          finishRule: { kind: "agent_report", requireHumanCheck: false },
          id: "modern-done",
          name: "Modern completed Task",
          projectId: "project-1",
          repositoryLinks: [],
          workState: "completed",
          workStateSource: "manual",
        },
      ],
      subtasks: [
        {
          createdAt,
          id: "legacy-done-step",
          name: "Checked",
          taskId: "legacy-done",
        },
        {
          createdAt,
          id: "legacy-pending-step",
          name: "Unaccepted",
          taskId: "legacy-not-done",
        },
      ],
      statusReports: [
        {
          createdAt: completedAt,
          id: "legacy-done-report",
          reportedState: "complete",
          reporter: "Codex",
          subtaskId: "legacy-done-step",
        },
        {
          createdAt: completedAt,
          id: "legacy-pending-report",
          reportedState: "complete",
          reporter: "Codex",
          subtaskId: "legacy-pending-step",
        },
      ],
      verifications: [
        {
          createdAt: completedAt,
          decision: "accepted",
          id: "legacy-done-verification",
          reason: "The checked result is complete.",
          reportId: "legacy-done-report",
          source: "human",
          verifier: "Kevin",
        },
        {
          createdAt: completedAt,
          decision: "rejected",
          id: "legacy-pending-verification",
          reason: "The result needs another pass.",
          reportId: "legacy-pending-report",
          source: "human",
          verifier: "Kevin",
        },
      ],
    };

    try {
      const database = new Database(databasePath);
      database.exec(
        "CREATE TABLE factory_state (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL)",
      );
      database
        .query("INSERT INTO factory_state (id, state) VALUES (1, $state)")
        .run({ $state: JSON.stringify(legacyState) });
      database.close();

      const app = createFactoryApplication({ databasePath });
      expect(app.getTaskStatus("legacy-done")).toMatchObject({
        taskCompleted: true,
        finishMetadata: {
          kind: "legacy_completion",
          actor: "Kevin",
          reason: "The checked result is complete.",
        },
      });
      expect(app.getTaskStatus("legacy-not-done")).toMatchObject({
        taskCompleted: false,
      });
      expect(
        app.getTaskStatus("legacy-not-done").finishMetadata,
      ).toBeUndefined();
      expect(app.getTaskStatus("modern-done")).toMatchObject({
        taskCompleted: true,
        finishMetadata: {
          kind: "human_mark_done",
          actor: "Kevin",
          reason: "Kept the explicit human decision.",
        },
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("persists Task finish metadata and checklist ordering across restart", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-work-state-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory V1" });
      const task = app.createTask({
        name: "Ship the work",
        projectId: project.id,
        finishRule: { kind: "agent_report", requireHumanCheck: true },
        humanCheckText:
          "Check the deployment result in the production account.",
      });
      const first = app.createSubtask({ name: "First check", taskId: task.id });
      const second = app.createSubtask({
        name: "Second check",
        taskId: task.id,
      });
      app.reorderSubtasks({
        orderedSubtaskIds: [second.id, first.id],
        taskId: task.id,
        workState: "planned",
      });
      const status = app.getTaskStatus(task.id);
      app.reportTaskStatus({
        taskId: task.id,
        workflowEpoch: status.workflowEpoch,
        reportedState: "finished",
        reporter: "codex",
      });

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getTaskDetail(task.id)).toMatchObject({
        finishRule: { kind: "agent_report", requireHumanCheck: true },
        humanCheckText:
          "Check the deployment result in the production account.",
        workState: "awaiting_verification",
      });
      expect(
        reopened
          .getTaskStatus(task.id)
          .subtasks.map(({ subtaskId }) => subtaskId),
      ).toEqual([second.id, first.id]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("persists atomic PR requirement change events across restart", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-pr-requirement-history-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const pullRequestUrl = "https://github.com/example/repo/pull/24";

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory" });
      const task = app.createTask({
        name: "Ship the implementation",
        projectId: project.id,
        pullRequestUrl,
        finishRule: { kind: "pr_merge", requireHumanCheck: false },
      });
      const beforeSave = app.getTaskStatus(task.id);
      app.updateTaskFinishRule({
        taskId: task.id,
        actor: "Kevin",
        expectedRevision: beforeSave.taskRevision,
        expectedWorkflowEpoch: beforeSave.workflowEpoch,
        finishRule: beforeSave.finishRule,
        pullRequestRequirements: [{ pullRequestUrl, required: false }],
      });

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getTaskWorkflowHistory(task.id)[0]).toMatchObject({
        actor: "Kevin",
        kind: "finish_rule_changed",
        pullRequestRequirementChanges: [
          {
            pullRequestUrl,
            sourceKind: "task",
            sourceId: task.id,
            previousRequired: true,
            required: false,
          },
        ],
      });
      expect(reopened.getTaskStatus(task.id).requiredPullRequests).toEqual([
        expect.objectContaining({ pullRequestUrl, required: false }),
      ]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("restores manual hold provenance and report-proof completion across restart", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-manual-hold-and-report-proof-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const project = app.createProject({ name: "Factory" });
      const manualTask = app.createTask({
        name: "Manual hold",
        projectId: project.id,
      });
      app.setTaskWorkState({
        taskId: manualTask.id,
        workState: "blocked",
        reason: "Waiting on a human decision.",
      });

      const reportTask = app.createTask({
        name: "Agent proof",
        projectId: project.id,
        finishRule: { kind: "agent_report", requireHumanCheck: true },
        humanCheckText: "Check the published result.",
      });
      const initial = app.getTaskStatus(reportTask.id);
      app.reportTaskStatus({
        taskId: reportTask.id,
        workflowEpoch: initial.workflowEpoch,
        reportedState: "finished",
        reporter: "Codex",
      });
      const beforeSave = app.getTaskStatus(reportTask.id);
      app.updateTaskFinishRule({
        taskId: reportTask.id,
        actor: "Kevin",
        expectedRevision: beforeSave.taskRevision,
        expectedWorkflowEpoch: beforeSave.workflowEpoch,
        finishRule: { kind: "agent_report", requireHumanCheck: false },
        pullRequestRequirements: [],
      });

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getTaskStatus(manualTask.id)).toMatchObject({
        taskState: "blocked",
        manualHold: true,
      });
      expect(reopened.getTaskStatus(reportTask.id)).toMatchObject({
        taskCompleted: true,
        finishMetadata: { kind: "agent_report", actor: "Codex" },
      });
      expect(reopened.getTaskWorkflowHistory(reportTask.id)[0]).toMatchObject({
        kind: "finish_rule_changed",
        actor: "Kevin",
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
