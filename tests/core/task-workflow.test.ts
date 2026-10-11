import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";

const pullRequestUrl = "https://github.com/example/repo/pull/18";

function createWorkflowApp() {
  let id = 0;
  let currentTime = new Date("2026-10-09T18:00:00.000Z");
  const app = new FactoryApplication({
    clock: () => new Date(currentTime),
    idGenerator: () => `workflow-${++id}`,
  });
  const project = app.createProject({ name: "Factory" });
  return {
    app,
    project,
    setTime(value: string) {
      currentTime = new Date(value);
    },
  };
}

describe("Task workflow core", () => {
  test("a finished report cannot complete a PR-merge Task with no required PRs", () => {
    const { app, project } = createWorkflowApp();
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    const beforeReport = app.getTaskStatus(task.id);

    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: beforeReport.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
      summary: "The implementation is ready.",
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: false,
      taskState: "awaiting_verification",
      stateReason:
        "No required PR is linked. Link a new PR to finish on merge.",
      requiredPullRequests: [],
      subtasks: [],
    });
  });

  test("deduplicates Task and Step PR links and finishes only with default-branch proof", () => {
    const { app, project } = createWorkflowApp();
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    app.createSubtask({
      name: "Implementation step",
      taskId: task.id,
      pullRequestUrl,
    });
    const beforeReport = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: beforeReport.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const waiting = app.getTaskStatus(task.id);
    expect(waiting.requiredPullRequests).toHaveLength(1);
    expect(waiting.requiredPullRequests[0]?.sources).toHaveLength(2);

    const merge = {
      taskId: task.id,
      pullRequestUrl,
      workflowEpoch: waiting.workflowEpoch,
      mergeSha: "a".repeat(40),
      mergedAt: new Date("2026-10-09T18:01:00.000Z"),
      defaultBranch: "main",
      reachedDefaultBranch: true as const,
      observedAt: new Date("2026-10-09T18:02:00.000Z"),
    };
    expect(() =>
      app.recordTaskPullRequestMerge({
        ...merge,
        reachedDefaultBranch: false,
      } as unknown as typeof merge),
    ).toThrow("reaches the default branch");

    const proof = app.recordTaskPullRequestMerge(merge);
    const retry = app.recordTaskPullRequestMerge(merge);

    expect(retry.id).toBe(proof.id);
    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      finishMetadata: {
        kind: "pr_merge",
        mergeProofs: [{ id: proof.id, defaultBranch: "main" }],
      },
    });
    expect(
      app
        .getTaskWorkflowHistory(task.id)
        .filter((event) => event.kind === "pull_request_merged"),
    ).toHaveLength(1);
  });

  test("zero-Step human checks are revision-bound and record the checker", () => {
    const { app, project } = createWorkflowApp();
    const task = app.createTask({
      name: "Verify the result",
      projectId: project.id,
      finishRule: { kind: "agent_report", requireHumanCheck: true },
      humanCheckText: "Check the visible result.",
    });
    const initial = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: initial.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const ready = app.getTaskStatus(task.id);
    expect(ready).toMatchObject({
      taskCompleted: false,
      humanCheckReady: true,
      subtasks: [],
    });

    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: ready.workflowEpoch,
      reportedState: "in_progress",
      reporter: "Codex",
      summary: "One final adjustment is in progress.",
    });
    expect(() =>
      app.checkTask({
        taskId: task.id,
        expectedRevision: ready.taskRevision,
        checker: "Kevin",
      }),
    ).toThrow("current revision");

    const latest = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: latest.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
      summary: "Ready for the human check.",
    });
    const readyAgain = app.getTaskStatus(task.id);
    app.checkTask({
      taskId: task.id,
      expectedRevision: readyAgain.taskRevision,
      checker: "Kevin",
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      humanCheckReady: false,
      finishMetadata: { kind: "human_check", actor: "Kevin" },
    });
  });

  test("human check readiness excludes archived tasks and manual holds", () => {
    const { app, project } = createWorkflowApp();
    const archived = app.createTask({
      name: "Archived check",
      projectId: project.id,
      finishRule: { kind: "agent_report", requireHumanCheck: true },
      humanCheckText: "Check the visible result.",
    });
    const archivedStart = app.getTaskStatus(archived.id);
    app.reportTaskStatus({
      taskId: archived.id,
      workflowEpoch: archivedStart.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    app.archiveTask(archived.id, "released");
    expect(app.getTaskStatus(archived.id)).toMatchObject({
      archiveState: "released",
      humanCheckReady: false,
    });

    const held = app.createTask({
      name: "Held check",
      projectId: project.id,
      finishRule: { kind: "agent_report", requireHumanCheck: true },
      humanCheckText: "Check the visible result.",
    });
    const heldStart = app.getTaskStatus(held.id);
    app.reportTaskStatus({
      taskId: held.id,
      workflowEpoch: heldStart.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    app.setTaskWorkState({
      taskId: held.id,
      workState: "blocked",
      reason: "Wait for the owner to clear this hold.",
    });
    const heldStatus = app.getTaskStatus(held.id);
    expect(heldStatus).toMatchObject({
      taskState: "blocked",
      manualHold: true,
      humanCheckReady: false,
    });
    expect(() =>
      app.checkTask({
        taskId: held.id,
        expectedRevision: heldStatus.taskRevision,
        checker: "Kevin",
      }),
    ).toThrow("Clear the manual Task hold before checking it.");

    app.setTaskWorkState({ taskId: held.id, workState: "active" });
    const ready = app.getTaskStatus(held.id);
    expect(ready.humanCheckReady).toBe(true);
    app.checkTask({
      taskId: held.id,
      expectedRevision: ready.taskRevision,
      checker: "Kevin",
    });
    expect(app.getTaskStatus(held.id)).toMatchObject({
      taskCompleted: true,
      humanCheckReady: false,
    });
  });

  test("saving changed required PRs records the human cause of completion", () => {
    const { app, project } = createWorkflowApp();
    const prA = pullRequestUrl;
    const prB = "https://github.com/example/repo/pull/19";
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl: prA,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    app.createSubtask({
      name: "Second PR",
      taskId: task.id,
      pullRequestUrl: prB,
    });
    const initial = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: initial.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const waiting = app.getTaskStatus(task.id);
    app.recordTaskPullRequestMerge({
      taskId: task.id,
      pullRequestUrl: prA,
      workflowEpoch: waiting.workflowEpoch,
      mergeSha: "c".repeat(40),
      mergedAt: new Date("2026-10-09T18:01:00.000Z"),
      defaultBranch: "main",
      reachedDefaultBranch: true,
      observedAt: new Date("2026-10-09T18:02:00.000Z"),
    });
    const beforeSave = app.getTaskStatus(task.id);

    app.updateTaskFinishRule({
      taskId: task.id,
      actor: "Kevin",
      expectedRevision: beforeSave.taskRevision,
      expectedWorkflowEpoch: beforeSave.workflowEpoch,
      finishRule: beforeSave.finishRule,
      pullRequestRequirements: [
        { pullRequestUrl: prA, required: true },
        { pullRequestUrl: prB, required: false },
      ],
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      requiredPullRequests: [
        expect.objectContaining({ pullRequestUrl: prA, required: true }),
        expect.objectContaining({ pullRequestUrl: prB, required: false }),
      ],
      finishMetadata: {
        kind: "pr_merge",
        actor: "Kevin",
        mergeProofs: [expect.objectContaining({ pullRequestUrl: prA })],
      },
    });
    expect(
      app
        .getTaskWorkflowHistory(task.id)
        .find((event) => event.kind === "finish_rule_changed"),
    ).toMatchObject({
      actor: "Kevin",
      pullRequestRequirementChanges: [
        {
          pullRequestUrl: prB,
          sourceKind: "step",
          sourceId: expect.any(String),
          previousRequired: true,
          required: false,
        },
      ],
    });
  });

  test("agent-blocked Tasks are not manual holds and reflect the draft finish", () => {
    const { app, project } = createWorkflowApp();
    const prA = pullRequestUrl;
    const prB = "https://github.com/example/repo/pull/19";
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl: prA,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    app.createSubtask({
      name: "Second PR",
      taskId: task.id,
      pullRequestUrl: prB,
    });
    const initial = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: initial.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const waiting = app.getTaskStatus(task.id);
    app.recordTaskPullRequestMerge({
      taskId: task.id,
      pullRequestUrl: prA,
      workflowEpoch: waiting.workflowEpoch,
      mergeSha: "e".repeat(40),
      mergedAt: new Date("2026-10-09T18:01:00.000Z"),
      defaultBranch: "main",
      reachedDefaultBranch: true,
      observedAt: new Date("2026-10-09T18:02:00.000Z"),
    });
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: waiting.workflowEpoch,
      reportedState: "blocked",
      reporter: "Codex",
      reason: "Waiting on upstream for PR #19.",
    });
    const blocked = app.getTaskStatus(task.id);
    expect(blocked).toMatchObject({ taskState: "blocked", manualHold: false });

    app.updateTaskFinishRule({
      taskId: task.id,
      actor: "Kevin",
      expectedRevision: blocked.taskRevision,
      expectedWorkflowEpoch: blocked.workflowEpoch,
      finishRule: blocked.finishRule,
      pullRequestRequirements: [
        { pullRequestUrl: prA, required: true },
        { pullRequestUrl: prB, required: false },
      ],
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      manualHold: false,
      finishMetadata: { kind: "pr_merge", actor: "Kevin" },
    });
  });

  test("removing a human check preserves report proof and saves completion time", () => {
    const { app, project, setTime } = createWorkflowApp();
    const task = app.createTask({
      name: "Verify the result",
      projectId: project.id,
      finishRule: { kind: "agent_report", requireHumanCheck: true },
      humanCheckText: "Check the published result.",
    });
    const initial = app.getTaskStatus(task.id);
    const report = app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: initial.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
      reason: "The published result is ready.",
    });
    const beforeSave = app.getTaskStatus(task.id);
    setTime("2026-10-09T18:05:00.000Z");

    app.updateTaskFinishRule({
      taskId: task.id,
      actor: "Kevin",
      expectedRevision: beforeSave.taskRevision,
      expectedWorkflowEpoch: beforeSave.workflowEpoch,
      finishRule: { kind: "agent_report", requireHumanCheck: false },
      pullRequestRequirements: [],
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      finishMetadata: {
        kind: "agent_report",
        actor: "Codex",
        completedAt: new Date("2026-10-09T18:05:00.000Z"),
        reason: "The published result is ready.",
      },
    });
    expect(app.getTaskWorkflowHistory(task.id)[0]).toMatchObject({
      kind: "finish_rule_changed",
      actor: "Kevin",
    });
    expect(report.createdAt).toEqual(new Date("2026-10-09T18:00:00.000Z"));
  });

  test("requirement event prose deduplicates PRs and uses the CLI actor fallback", () => {
    const { app, project } = createWorkflowApp();
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    const step = app.createSubtask({
      name: "Duplicate PR source",
      taskId: task.id,
      pullRequestUrl,
    });
    const beforeSave = app.getTaskStatus(task.id);

    app.updateTaskFinishRule({
      taskId: task.id,
      expectedRevision: beforeSave.taskRevision,
      expectedWorkflowEpoch: beforeSave.workflowEpoch,
      finishRule: beforeSave.finishRule,
      pullRequestRequirements: [{ pullRequestUrl, required: false }],
    });

    expect(app.getTaskWorkflowHistory(task.id)[0]).toMatchObject({
      actor: "CLI",
      reason: "pr_merge · PR #18 not required",
      pullRequestRequirementChanges: [
        expect.objectContaining({ sourceKind: "task", sourceId: task.id }),
        expect.objectContaining({ sourceKind: "step", sourceId: step.id }),
      ],
    });
  });

  test("saving unchanged canonical PR requirements preserves mixed source flags", () => {
    const { app, project } = createWorkflowApp();
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    const step = app.createSubtask({
      name: "Optional duplicate link",
      taskId: task.id,
      pullRequestUrl,
      pullRequestRequired: false,
    });
    const beforeSave = app.getTaskStatus(task.id);
    const stepRevision = step.revision;

    app.updateTaskFinishRule({
      taskId: task.id,
      actor: "Kevin",
      expectedRevision: beforeSave.taskRevision,
      expectedWorkflowEpoch: beforeSave.workflowEpoch,
      finishRule: beforeSave.finishRule,
      pullRequestRequirements: [{ pullRequestUrl, required: true }],
    });

    expect(app.getTaskStatus(task.id).requiredPullRequests).toEqual([
      expect.objectContaining({
        pullRequestUrl,
        required: true,
        sources: [
          expect.objectContaining({
            kind: "task",
            id: task.id,
            required: true,
          }),
          expect.objectContaining({
            kind: "step",
            id: step.id,
            required: false,
          }),
        ],
      }),
    ]);
    expect(app.getSubtaskDetail(step.id).revision).toBe(stepRevision);
    expect(app.getTaskWorkflowHistory(task.id)).toEqual([]);
  });

  test("invalid or stale required PR drafts leave the Task untouched", () => {
    const { app, project } = createWorkflowApp();
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    const initial = app.getTaskStatus(task.id);
    const beforeHistory = app.getTaskWorkflowHistory(task.id);
    expect(() =>
      app.updateTaskFinishRule({
        taskId: task.id,
        actor: "Kevin",
        expectedRevision: initial.taskRevision,
        expectedWorkflowEpoch: initial.workflowEpoch,
        finishRule: { kind: "agent_report", requireHumanCheck: true },
        humanCheckText: "Check the published result.",
        pullRequestRequirements: [
          {
            pullRequestUrl: "https://github.com/example/repo/pull/999",
            required: false,
          },
        ],
      }),
    ).toThrow("no longer linked");
    expect(() =>
      app.updateTaskFinishRule({
        taskId: task.id,
        actor: "Kevin",
        expectedRevision: initial.taskRevision,
        expectedWorkflowEpoch: initial.workflowEpoch + 1,
        finishRule: { kind: "agent_report", requireHumanCheck: false },
      }),
    ).toThrow("stale");
    expect(app.getTaskDetail(task.id)).toMatchObject({
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
      revision: initial.taskRevision,
    });
    expect(app.getTaskWorkflowHistory(task.id)).toEqual(beforeHistory);
  });

  test("direct Step PR updates remain supported and record their actor", () => {
    const { app, project } = createWorkflowApp();
    const prA = pullRequestUrl;
    const prB = "https://github.com/example/repo/pull/19";
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl: prA,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    const step = app.createSubtask({
      name: "Second PR",
      taskId: task.id,
      pullRequestUrl: prB,
    });
    app.recordTaskPullRequestMerge({
      taskId: task.id,
      pullRequestUrl: prA,
      workflowEpoch: 0,
      mergeSha: "d".repeat(40),
      mergedAt: new Date("2026-10-09T18:01:00.000Z"),
      defaultBranch: "main",
      reachedDefaultBranch: true,
      observedAt: new Date("2026-10-09T18:02:00.000Z"),
    });

    app.updateSubtask({
      actor: "Kevin",
      pullRequestRequired: false,
      subtaskId: step.id,
    });

    expect(app.getTaskStatus(task.id)).toMatchObject({
      taskCompleted: true,
      finishMetadata: { kind: "pr_merge", actor: "Kevin" },
    });
    expect(
      app
        .getTaskWorkflowHistory(task.id)
        .find((event) => event.kind === "finish_rule_changed"),
    ).toMatchObject({
      actor: "Kevin",
      pullRequestRequirementChanges: [
        {
          pullRequestUrl: prB,
          sourceKind: "step",
          sourceId: step.id,
          previousRequired: true,
          required: false,
        },
      ],
    });
  });

  test("reopening invalidates old reports and merge evidence for the new epoch", () => {
    const { app, project, setTime } = createWorkflowApp();
    const task = app.createTask({
      name: "Merge implementation",
      projectId: project.id,
      pullRequestUrl,
      finishRule: { kind: "pr_merge", requireHumanCheck: false },
    });
    const initial = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: initial.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });
    const waiting = app.getTaskStatus(task.id);
    const merge = {
      taskId: task.id,
      pullRequestUrl,
      workflowEpoch: waiting.workflowEpoch,
      mergeSha: "b".repeat(40),
      mergedAt: new Date("2026-10-09T18:01:00.000Z"),
      defaultBranch: "main",
      reachedDefaultBranch: true as const,
      observedAt: new Date("2026-10-09T18:02:00.000Z"),
    };
    app.recordTaskPullRequestMerge(merge);
    setTime("2026-10-09T19:00:00.000Z");
    app.reopenTask({
      taskId: task.id,
      actor: "Kevin",
      reason: "The merged change needs a follow-up fix.",
    });

    const reopened = app.getTaskStatus(task.id);
    expect(reopened).toMatchObject({
      taskCompleted: false,
      taskState: "active",
      workflowEpoch: waiting.workflowEpoch + 1,
      requiredPullRequests: [{ required: false, mergedBeforeReopen: true }],
    });
    expect(reopened.latestTaskReport).toBeUndefined();
    expect(() =>
      app.reportTaskStatus({
        taskId: task.id,
        workflowEpoch: waiting.workflowEpoch,
        reportedState: "finished",
        reporter: "Codex",
      }),
    ).toThrow("is stale");
    expect(() =>
      app.recordTaskPullRequestMerge({
        ...merge,
        workflowEpoch: waiting.workflowEpoch,
      }),
    ).toThrow("is stale");
  });

  test("Done Task Steps cannot be added, removed, archived, or edited without reopening", () => {
    const { app, project } = createWorkflowApp();
    const task = app.createTask({
      name: "Deliver the result",
      projectId: project.id,
      finishRule: { kind: "agent_report", requireHumanCheck: false },
    });
    const step = app.createSubtask({ name: "Implementation", taskId: task.id });
    const initial = app.getTaskStatus(task.id);
    app.reportTaskStatus({
      taskId: task.id,
      workflowEpoch: initial.workflowEpoch,
      reportedState: "finished",
      reporter: "Codex",
    });

    expect(() =>
      app.createSubtask({ name: "More work", taskId: task.id }),
    ).toThrow("Reopen the Task");
    expect(() => app.removeSubtask(step.id)).toThrow("Reopen the Task");
    expect(() => app.archiveSubtask(step.id, "wont_do")).toThrow(
      "Reopen the Task",
    );
    expect(() => app.restoreSubtask(step.id)).toThrow("Reopen the Task");
    expect(() =>
      app.updateSubtask({ subtaskId: step.id, name: "Changed scope" }),
    ).toThrow("reopen the Task");

    app.reopenTask({
      taskId: task.id,
      actor: "Kevin",
      reason: "The delivered scope needs another implementation pass.",
    });
    app.updateSubtask({ subtaskId: step.id, name: "Revised implementation" });
    expect(app.getTaskStatus(task.id).taskCompleted).toBe(false);
  });
});
