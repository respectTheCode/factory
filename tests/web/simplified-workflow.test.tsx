import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  finishProvenance,
  orderedSteps,
  StepRow,
  HumanCheckDialog,
} from "../../src/web/workflow-panel";
import {
  prPresentation,
  requiredPullRequestSummary,
} from "../../src/web/workflow-pr";
import { TaskWorkflow } from "../../src/web/task-workflow";
import { relativeAgeLabel } from "../../src/web/task-tracking";
import type { GitHubStatusSnapshot } from "../../src/github";
const now = new Date("2026-10-09T18:00:00Z");
const head = "a".repeat(40),
  old = "b".repeat(40);
const row = {
  pullRequestUrl: "https://github.com/example/repo/pull/18",
  required: true,
  sources: [],
};
const snapshot: GitHubStatusSnapshot = {
  status: "ok",
  fetchedAt: now.toISOString(),
  pullRequest: {
    number: 18,
    url: row.pullRequestUrl,
    title: "The change",
    baseBranch: "main",
    draft: false,
    headSha: head,
    headBranch: "feature",
    state: "open",
    mergeable: true,
    updatedAt: now.toISOString(),
  },
  checkRuns: [],
  allCheckRunsStatus: "ok",
  allCheckRuns: [
    {
      name: "test",
      status: "completed",
      conclusion: "success",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      event: "pull_request",
      id: 1,
      url: row.pullRequestUrl,
    },
  ],
  checkRunsStatus: "ok",
  workflowRunsStatus: "ok",
  workflowRuns: [],
  review: {
    status: "ok",
    headSha: head,
    completed: true,
    decision: "approved",
    unresolvedThreads: 0,
    reviewers: ["CodeRabbit"],
  },
};
const noop = async () => {};
const task = {
  id: "t",
  simpleId: "T-1",
  name: "The task",
  subtasks: [
    { id: "s1", simpleId: "ST-1", name: "Open blocker", sortOrder: 1 },
    { id: "s2", simpleId: "ST-2", name: "Done step", sortOrder: 2 },
  ],
};
const base = {
  task,
  disabled: false,
  githubStatuses: {},
  onOpenNeed: () => {},
  onSaveRule: noop,
  onCheck: noop,
  onSendBack: noop,
  onStep: noop,
  onAdd: noop,
  onEditStep: noop,
  onSkipStep: noop,
  onRemoveStep: noop,
  onReorder: noop,
  onRequired: noop,
  onLink: noop,
  onRefresh: () => {},
  onHistory: async () => ({ items: [], totalCount: 0 }),
  children: createElement("p", null, "Recorded evidence"),
};

describe("simplified workflow UI", () => {
  test("steps retain author order and Done uses a matte dial without approval controls", () => {
    expect(
      orderedSteps([
        { id: "doing", simpleId: "ST-1", name: "Doing", sortOrder: 2 },
        { id: "todo", simpleId: "ST-2", name: "To do", sortOrder: 1 },
      ]).map((step) => step.id),
    ).toEqual(["todo", "doing"]);
    const html = renderToStaticMarkup(
      createElement(StepRow, {
        step: task.subtasks[1]!,
        status: { subtaskId: "s2", reportedState: "complete" },
        disabled: false,
        onChange: noop,
      }),
    );
    expect(html).toContain('class="step-dial done"');
    expect(html).toContain("DONE");
    expect(html).not.toContain("Accept");
    expect(html).not.toContain("Reviewer");
  });
  test("Done task retains left-open Steps under a collapsed disclosure, with no add row", () => {
    const html = renderToStaticMarkup(
      createElement(TaskWorkflow, {
        ...base,
        status: {
          taskState: "completed",
          taskCompleted: true,
          finishRule: { kind: "agent_report", requireHumanCheck: false },
          humanCheckReady: false,
          requiredPullRequests: [],
          subtasks: [
            { subtaskId: "s1", reportedState: "blocked" },
            { subtaskId: "s2", reportedState: "complete" },
          ],
        },
      }),
    );
    expect(html).toContain("Left open when the task finished (1)");
    expect(html).not.toContain('class="workflow-left-open" open');
    expect(html).not.toContain("Add step");
    expect(html).toContain("Recorded evidence");
    expect(html).not.toContain('class="workflow-evidence" open');
  });
  test("zero-step task supports finish rules, activity and an optional human check", () => {
    const html = renderToStaticMarkup(
      createElement(TaskWorkflow, {
        ...base,
        task: { ...task, subtasks: [] },
        status: {
          taskState: "awaiting_verification",
          taskCompleted: false,
          finishRule: { kind: "agent_report", requireHumanCheck: true },
          humanCheckReady: true,
          humanCheckText: "Check the visible result",
          requiredPullRequests: [],
          subtasks: [],
        },
      }),
    );
    expect(html).toContain("No steps.");
    expect(html).toContain("AGENT FINISHES + YOUR CHECK");
    expect(html).toContain("Check…");
    expect(html).not.toContain("Accept task");
  });
  test("new PR head cannot display old review or check evidence as passing", () => {
    const changed = {
      ...snapshot,
      pullRequest: { ...snapshot.pullRequest!, headSha: old },
    };
    const view = prPresentation(row, changed, head, now);
    expect(view.proof).toContain("not this head");
    expect(view.proof).not.toContain("checks passing");
    expect(view.proof).not.toContain("0 open threads");
  });
  test("stale and future GitHub observations fail closed", () => {
    expect(
      prPresentation(
        row,
        {
          ...snapshot,
          fetchedAt: new Date(now.getTime() - 16 * 60_000).toISOString(),
        },
        head,
        now,
      ).label,
    ).toBe("STALE");
    expect(
      prPresentation(
        row,
        {
          ...snapshot,
          fetchedAt: new Date(now.getTime() + 60_000).toISOString(),
        },
        head,
        now,
      ).proof,
    ).not.toContain("checks passing");
  });
  test("stacked merge waits for code reachability and merge provenance names its proof", () => {
    const view = prPresentation(
      row,
      {
        ...snapshot,
        pullRequest: {
          ...snapshot.pullRequest!,
          state: "closed",
          mergedAt: now.toISOString(),
        },
      },
      head,
      now,
    );
    expect(view.label).toBe("MERGED · WAITING");
    expect(view.proof).toContain("reach the default branch");
    expect(
      finishProvenance({
        kind: "pr_merge",
        actor: "GitHub",
        epoch: 0,
        completedAt: now,
        mergeProofs: [
          {
            id: "merge",
            taskId: "t",
            workflowEpoch: 0,
            pullRequestUrl: row.pullRequestUrl,
            mergeSha: head,
            mergedAt: now,
            defaultBranch: "main",
            reachedDefaultBranch: true,
            observedAt: now,
          },
        ],
      }),
    ).toContain("Done · PR #18 merged to main · aaaaaaa · merged");
  });
  test("relative action ages do not duplicate ago or invent an age", () => {
    expect(relativeAgeLabel("now")).toBe("just now");
    expect(relativeAgeLabel("15m")).toBe("15m ago");
    expect(relativeAgeLabel("15m ago")).toBe("15m ago");
    expect(relativeAgeLabel("time unknown")).toBe("time unknown");
  });
  test("PR tones follow evidence state instead of successful transport", () => {
    expect(prPresentation(row, snapshot, head, now).tone).toBe("neutral");
    expect(
      prPresentation(
        row,
        {
          ...snapshot,
          pullRequest: { ...snapshot.pullRequest!, state: "closed" },
        },
        head,
        now,
      ).tone,
    ).toBe("down");
    const changed = prPresentation(row, snapshot, old, now);
    expect(changed.tone).toBe("warn");
    expect(changed.proof).toContain("reported ready at bbbbbbb");
    expect(changed.changedHead).toBe(true);
  });
  test("closed PR action names the replacement behavior and keeps the visible label in its accessible name", () => {
    const html = renderToStaticMarkup(
      createElement(TaskWorkflow, {
        ...base,
        task: { ...task, subtasks: [], pullRequestUrl: row.pullRequestUrl },
        status: {
          taskState: "awaiting_verification",
          taskCompleted: false,
          manualHold: false,
          taskRevision: 1,
          workflowEpoch: 0,
          finishRule: { kind: "pr_merge", requireHumanCheck: false },
          humanCheckReady: false,
          requiredPullRequests: [
            {
              ...row,
              sources: [
                { kind: "task", id: task.id, name: task.name, required: true },
              ],
            },
          ],
          subtasks: [],
        },
        needs: [
          {
            id: `decide:closed:t:${row.pullRequestUrl}`,
            kind: "decide",
            label: "PR #18 closed without merging",
            ageLabel: "5m",
          },
        ],
      }),
    );
    expect(html).toContain("Link a replacement PR");
    expect(html).toContain('aria-label="Link a replacement PR:');
    expect(html).not.toContain("Link another PR");
  });
  test("Step-only closed PR never offers to replace an unrelated Task PR", () => {
    const stepPR = {
      ...row,
      sources: [
        { kind: "step" as const, id: "s1", name: "Step", required: true },
      ],
    };
    const html = renderToStaticMarkup(
      createElement(TaskWorkflow, {
        ...base,
        task: {
          ...task,
          pullRequestUrl: "https://github.com/example/repo/pull/36",
        },
        status: {
          taskState: "active",
          taskCompleted: false,
          manualHold: false,
          taskRevision: 1,
          workflowEpoch: 0,
          finishRule: { kind: "pr_merge", requireHumanCheck: false },
          humanCheckReady: false,
          requiredPullRequests: [stepPR],
          subtasks: [],
        },
        needs: [
          {
            id: `decide:closed:t:${row.pullRequestUrl}`,
            kind: "decide",
            label: "PR #18 closed without merging",
            ageLabel: "5m",
          },
        ],
      }),
    );
    expect(html).not.toContain("Link a replacement PR");
    expect(html).toContain("Mark not required");
    expect(html).toContain("Open PR ↗");
    expect(html).toContain("Change finish rule");
  });
  test("human check dialog has full title, optional note, check and send-back actions", () => {
    const html = renderToStaticMarkup(
      createElement(HumanCheckDialog, {
        title: "T-1 · The full task title",
        onClose: () => {},
        onCheck: noop,
        onSendBack: noop,
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("T-1 · The full task title");
    expect(html).toContain("What you checked (optional)");
    expect(html).toContain("What to check");
    expect(html).toContain("Mark checked");
    expect(html).toContain("Send back");
  });
});

describe("required PR collapsed summary", () => {
  test("includes Step-linked required PRs and excludes optional legacy Task links", () => {
    const optional = { ...row, required: false };
    const required = {
      ...row,
      pullRequestUrl: "https://github.com/example/repo/pull/19",
      sources: [
        { kind: "step" as const, id: "step", name: "Step", required: true },
      ],
    };
    const view = requiredPullRequestSummary(
      [optional, required],
      { "subtask:step": snapshot },
      false,
      head,
      now,
    );
    expect(view.text).toContain("PR #19 open");
    expect(view.text).not.toContain("PR #18");
    expect(view.tone).toBe("neutral");
  });
  test("chooses unmet required PR and never paints a partial merge or held Task green", () => {
    const merged = {
      ...row,
      merge: {
        id: "merge",
        taskId: "task",
        pullRequestUrl: row.pullRequestUrl,
        workflowEpoch: 0,
        mergeSha: head,
        mergedAt: now,
        defaultBranch: "main",
        reachedDefaultBranch: true as const,
        observedAt: now,
      },
    };
    const unmet = {
      ...row,
      pullRequestUrl: "https://github.com/example/repo/pull/19",
    };
    const statuses = { [unmet.pullRequestUrl]: snapshot };
    expect(
      requiredPullRequestSummary([merged, unmet], statuses, false, head, now),
    ).toMatchObject({
      tone: "neutral",
      text: expect.stringContaining("PR #19 open · 1 of 2 merged"),
    });
    expect(
      requiredPullRequestSummary([merged], {}, false, head, now).tone,
    ).toBe("neutral");
    expect(requiredPullRequestSummary([merged], {}, true, head, now).tone).toBe(
      "ok",
    );
  });
});
