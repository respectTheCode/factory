import { describe, expect, test } from "bun:test";
import { FactoryApplication } from "../../src/application";
import { buildFloorSnapshot } from "../../src/floor";
import type { GitHubStatusSnapshot } from "../../src/github";
const now = new Date("2026-10-09T18:00:00Z"),
  url = "https://github.com/example/repo/pull/18",
  head = "a".repeat(40);
function fixture() {
  let id = 0;
  const app = new FactoryApplication({
    clock: () => now,
    idGenerator: () => `id-${++id}`,
  });
  const project = app.createProject({
    name: "Factory",
    gitOriginUrl: "https://github.com/example/repo.git",
  });
  const task = app.createTask({
    name: "Code task",
    projectId: project.id,
    pullRequestUrl: url,
  });
  const status = app.getTaskStatus(task.id);
  app.reportTaskStatus({
    taskId: task.id,
    workflowEpoch: status.workflowEpoch,
    reportedState: "finished",
    reporter: "Codex",
    summary: "Ready to review",
  });
  return { app, project, task };
}
function github(
  overrides: Partial<GitHubStatusSnapshot> = {},
): GitHubStatusSnapshot {
  return {
    status: "ok",
    fetchedAt: now.toISOString(),
    checkRuns: [],
    checkRunsStatus: "ok",
    workflowRuns: [],
    workflowRunsStatus: "ok",
    pullRequest: {
      number: 18,
      url,
      title: "Change",
      baseBranch: "main",
      draft: false,
      headSha: head,
      headBranch: "feature",
      state: "open",
      mergeable: true,
      updatedAt: now.toISOString(),
    },
    ...overrides,
  };
}
function project(
  f: ReturnType<typeof fixture>,
  snapshot?: GitHubStatusSnapshot,
) {
  return buildFloorSnapshot({
    now,
    projects: [f.project],
    tasks: [
      {
        task: { ...f.task, ...f.app.getTaskDetail(f.task.id) },
        status: f.app.getTaskStatus(f.task.id),
        subtasks: f.app
          .getProjectHierarchy(f.project.id)
          .tasks.find((task) => task.id === f.task.id)!
          .subtasks.map((step) => ({ ...step, revision: 0, createdAt: now })),
      },
    ],
    statusReports: [],
    verifications: [],
    activities: [],
    githubStatuses: snapshot ? { [url]: snapshot } : {},
  });
}
describe("simplified Needs you projection", () => {
  test("only open non-draft required PRs produce REVIEW", () => {
    const f = fixture();
    expect(project(f, github()).queue.map((row) => row.action)).toEqual([
      "review",
    ]);
    expect(
      project(
        f,
        github({ pullRequest: { ...github().pullRequest!, draft: true } }),
      ).queue,
    ).toEqual([]);
  });
  test("stale, future and unavailable observations do not create decisions", () => {
    const f = fixture();
    for (const snapshot of [
      github({
        fetchedAt: new Date(now.getTime() - 16 * 60_000).toISOString(),
      }),
      github({ fetchedAt: new Date(now.getTime() + 60_000).toISOString() }),
      github({ status: "unavailable" }),
    ])
      expect(project(f, snapshot).queue).toEqual([]);
  });
  test("stacked merged PR waits without action while code has not reached default branch", () => {
    const f = fixture();
    expect(
      project(
        f,
        github({
          pullRequest: {
            ...github().pullRequest!,
            state: "closed",
            baseBranch: "feature/base",
            mergedAt: now.toISOString(),
            mergeSha: head,
          },
        }),
      ).queue,
    ).toEqual([]);
    expect(f.app.getTaskStatus(f.task.id).taskCompleted).toBe(false);
  });
  test("closed required PR and missing access require decisions", () => {
    const f = fixture();
    for (const snapshot of [
      github({ status: "not_found" }),
      github({ status: "permission_denied" }),
      github({ pullRequest: { ...github().pullRequest!, state: "closed" } }),
    ])
      expect(project(f, snapshot).queue.map((row) => row.action)).toEqual([
        "decide",
      ]);
  });
  test("finished task suppresses human-owned left-open Step blockers", () => {
    const f = fixture();
    const step = f.app.createSubtask({ taskId: f.task.id, name: "Left open" });
    f.app.reportSubtaskStatus({
      subtaskId: step.id,
      reporter: "Codex",
      reportedState: "blocked",
      reason: "Need access",
      handoff: {
        nextOwner: "Kevin",
        nextOwnerKind: "human",
        nextAction: "Grant access",
      },
    });
    f.app.markTaskDone({
      taskId: f.task.id,
      actor: "Kevin",
      reason: "Delivered elsewhere",
    });
    const view = project(f, github());
    expect(view.queue).toEqual([]);
    expect(view.scoreboard.finishedToday).toBe(1);
    expect(view.events.some((event) => event.summary.includes("Done"))).toBe(
      true,
    );
  });
  test("Done Step reports never create a stamp or parent check request", () => {
    const f = fixture();
    f.app.reportTaskStatus({
      taskId: f.task.id,
      workflowEpoch: f.app.getTaskStatus(f.task.id).workflowEpoch,
      reportedState: "in_progress",
      reporter: "Codex",
    });
    const step = f.app.createSubtask({ taskId: f.task.id, name: "Done Step" });
    f.app.reportSubtaskStatus({
      subtaskId: step.id,
      reporter: "Codex",
      reportedState: "complete",
    });
    expect(project(f, github()).queue).toEqual([]);
  });
});
