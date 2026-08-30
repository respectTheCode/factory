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
        reportedState: "complete",
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
        workState: "awaiting_verification",
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

  test("persists explicit state, reasons, and state-scoped ordering across restart", () => {
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
      app.setTaskWorkState({
        reason: "Check the deployment result in the production account.",
        taskId: task.id,
        workState: "awaiting_verification",
      });

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.getTaskDetail(task.id)).toMatchObject({
        stateReason: "Check the deployment result in the production account.",
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
});
