import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  FactoryApplication,
  createFactoryApplication,
  type FactoryState,
} from "../../src/application";
import {
  backfillSimpleIds,
  SUBTASK_SIMPLE_ID_PREFIX,
  TASK_SIMPLE_ID_PREFIX,
} from "../../src/simple-ids";

describe("simple Task and Subtask IDs", () => {
  test("backfills missing and duplicate references deterministically", () => {
    const records = backfillSimpleIds(
      [
        { id: "legacy-a" },
        { id: "existing", simpleId: "T-4" },
        { id: "duplicate", simpleId: "T-4" },
      ],
      TASK_SIMPLE_ID_PREFIX,
    );

    expect(records).toEqual([
      { id: "legacy-a", simpleId: "T-5" },
      { id: "existing", simpleId: "T-4" },
      { id: "duplicate", simpleId: "T-6" },
    ]);
  });

  test("backfills legacy records and resolves references across core operations", () => {
    const now = new Date("2026-09-10T12:00:00.000Z");
    const state: FactoryState = {
      projects: [{ id: "project-1", name: "Factory", createdAt: now }],
      tasks: [
        {
          id: "task-1",
          name: "Legacy Task",
          projectId: "project-1",
          acceptanceCriteria: [],
          dependencies: [],
          repositoryLinks: [],
          createdAt: now,
        },
      ],
      subtasks: [
        {
          id: "subtask-1",
          name: "Legacy Subtask",
          taskId: "task-1",
          createdAt: now,
        },
      ],
      statusReports: [],
      verifications: [],
    };
    const app = new FactoryApplication({
      clock: () => now,
      idGenerator: () => "new-id",
      state,
    });

    expect(app.getTaskDetail("t-1")).toMatchObject({
      id: "task-1",
      simpleId: "T-1",
    });
    expect(app.getSubtaskDetail("st-1")).toMatchObject({
      id: "subtask-1",
      simpleId: "ST-1",
    });

    app.setTaskWorkState({ taskId: "t-1", workState: "active" });
    const report = app.reportSubtaskStatus({
      reportedState: "in_progress",
      reporter: "codex",
      subtaskId: "ST-1",
    });

    expect(report.subtaskId).toBe("subtask-1");
    expect(app.getTaskStatus("T-1")).toMatchObject({
      taskId: "task-1",
      taskSimpleId: "T-1",
      subtasks: [{ subtaskId: "subtask-1", subtaskSimpleId: "ST-1" }],
    });
  });

  test("allocates durable references without reusing deletion gaps after reload", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-simple-ids-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({ name: "Factory" });
      const removed = first.createTask({
        name: "Removed",
        projectId: project.id,
      });
      const kept = first.createTask({ name: "Kept", projectId: project.id });
      const child = first.createSubtask({ name: "Child", taskId: kept.id });

      expect(removed.simpleId).toBe("T-1");
      expect(kept.simpleId).toBe("T-2");
      expect(child.simpleId).toBe("ST-1");

      first.removeTask("T-1");
      const reopened = createFactoryApplication({ databasePath });
      const next = reopened.createTask({ name: "Next", projectId: project.id });
      const nextChild = reopened.createSubtask({
        name: "Next child",
        taskId: next.simpleId!,
      });

      expect(next.simpleId).toBe("T-3");
      expect(nextChild.simpleId).toBe("ST-2");
      expect(reopened.getTaskDetail("T-2").id).toBe(kept.id);
      expect(reopened.getSubtaskDetail("st-2").id).toBe(nextChild.id);

      const final = createFactoryApplication({ databasePath });
      expect(final.getTaskDetail("T-3").simpleId).toBe("T-3");
      expect(final.getSubtaskDetail("ST-2").simpleId).toBe("ST-2");
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("keeps Task and Subtask prefixes distinct", () => {
    expect(TASK_SIMPLE_ID_PREFIX).not.toBe(SUBTASK_SIMPLE_ID_PREFIX);
  });
});
