import { describe, expect, test } from "bun:test";

import {
  filterAttention,
  filterArchivedTasks,
  groupSubtasksByStatus,
  groupTasksByStatus,
  reorderIds,
  summarizeTaskProgress,
} from "../../src/web/task-summary";

describe("task presentation summaries", () => {
  test("counts released and human-accepted subtasks and finds the next action", () => {
    const summary = summarizeTaskProgress(
      {
        subtasks: [
          { id: "done", name: "Already verified" },
          { id: "next", name: "Choose the deployment shape" },
          { id: "released", name: "Released work" },
          { archiveState: "wont_do", id: "skip", name: "Out of scope" },
        ],
      },
      {
        subtasks: [
          { reportedState: "complete", verificationState: "accepted" },
          { reportedState: "in_progress", verificationState: "unreported" },
          { archiveState: "released", verificationState: "unreported" },
          { archiveState: "wont_do", verificationState: "unreported" },
        ],
      },
    );

    expect(summary).toEqual({
      completedSubtasks: 2,
      nextSubtaskName: "Choose the deployment shape",
      openSubtasks: 1,
      totalSubtasks: 3,
    });
  });

  test("keeps an agent-complete subtask open until human verification", () => {
    const summary = summarizeTaskProgress(
      { subtasks: [{ id: "pending", name: "Human review" }] },
      {
        subtasks: [
          {
            reportedState: "complete",
            verificationState: "awaiting_verification",
          },
        ],
      },
    );

    expect(summary).toEqual({
      completedSubtasks: 0,
      nextSubtaskName: "Human review",
      openSubtasks: 1,
      totalSubtasks: 1,
    });
  });

  test("keeps a task with no subtasks actionable without fake progress", () => {
    expect(summarizeTaskProgress({ subtasks: [] }, undefined)).toEqual({
      completedSubtasks: 0,
      openSubtasks: 0,
      totalSubtasks: 0,
    });
  });

  test("filters attention work without changing its stable order", () => {
    const items = [
      { state: "planned" as const, taskId: "planned" },
      { state: "blocked" as const, taskId: "blocked" },
      { state: "planned" as const, taskId: "planned-2" },
    ];

    expect(
      filterAttention(items, "planned").map((item) => item.taskId),
    ).toEqual(["planned", "planned-2"]);
    expect(filterAttention(items, "all")).toEqual(items);
  });

  test("hides released and wont-do tasks until archived work is requested", () => {
    const items = [
      { id: "active", name: "Current work" },
      { archiveState: "released" as const, id: "released", name: "Shipped" },
      { archiveState: "wont_do" as const, id: "wont-do", name: "Dropped" },
    ];

    expect(filterArchivedTasks(items, false).map((item) => item.id)).toEqual([
      "active",
    ]);
    expect(filterArchivedTasks(items, true)).toEqual(items);
  });

  test("groups tasks in workflow order and preserves each group's task order", () => {
    const tasks = [
      { id: "active-1", name: "Active one", sortOrder: 20 },
      { id: "planned-1", name: "Planned one", sortOrder: 1 },
      { id: "active-2", name: "Active two", sortOrder: 10 },
      { id: "blocked-1", name: "Blocked one", sortOrder: 1 },
    ];

    const groups = groupTasksByStatus(tasks, {
      "active-1": { taskState: "active" },
      "planned-1": { taskState: "planned" },
      "active-2": { taskState: "active" },
      "blocked-1": { taskState: "blocked" },
    });

    expect(groups.map((group) => group.state)).toEqual([
      "blocked",
      "active",
      "planned",
    ]);
    expect(groups[1]?.tasks.map((task) => task.id)).toEqual([
      "active-2",
      "active-1",
    ]);
  });

  test("uses an archived task disposition when status data is unavailable", () => {
    const groups = groupTasksByStatus(
      [{ archiveState: "released" as const, id: "released", name: "Shipped" }],
      {},
    );

    expect(groups).toEqual([
      {
        state: "released",
        tasks: [{ archiveState: "released", id: "released", name: "Shipped" }],
      },
    ]);
  });

  test("groups subtasks by state so their within-state order is visible", () => {
    const groups = groupSubtasksByStatus([
      {
        id: "active-1",
        name: "Active one",
        state: "active" as const,
        sortOrder: 20,
      },
      {
        id: "blocked",
        name: "Blocked",
        state: "blocked" as const,
        sortOrder: 1,
      },
      {
        id: "active-2",
        name: "Active two",
        state: "active" as const,
        sortOrder: 10,
      },
      {
        id: "planned",
        name: "Planned",
        state: "planned" as const,
        sortOrder: 1,
      },
    ]);

    expect(groups.map((group) => group.state)).toEqual([
      "blocked",
      "active",
      "planned",
    ]);
    expect(groups[1]?.subtasks.map((subtask) => subtask.id)).toEqual([
      "active-2",
      "active-1",
    ]);
  });

  test("moves an item before a same-state target or to the state tail", () => {
    expect(reorderIds(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderIds(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
    expect(reorderIds(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
    expect(reorderIds(["a", "b", "c"], "c")).toEqual(["a", "b", "c"]);
    expect(reorderIds(["a", "b", "c"], "missing", "a")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
