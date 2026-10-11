import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createFinishRuleDraft,
  draftPullRequests,
  finishRuleConsequence,
  finishRuleRequirementChanges,
} from "../../src/web/finish-rule-draft";
import {
  WorkflowPullRequests,
  TaskPullRequestLinkForm,
} from "../../src/web/workflow-pr";
import { FinishRulePanel } from "../../src/web/workflow-panel";
import type { RequiredPullRequest } from "../../src/web/workflow-panel";
const rule = { kind: "pr_merge" as const, requireHumanCheck: false };
const rows: RequiredPullRequest[] = [
  {
    pullRequestUrl: "https://github.com/example/repo/pull/18",
    required: true,
    sources: [{ kind: "task", id: "task", name: "Task", required: true }],
    merge: {
      id: "merge",
      taskId: "task",
      pullRequestUrl: "https://github.com/example/repo/pull/18",
      workflowEpoch: 2,
      mergeSha: "a".repeat(40),
      mergedAt: new Date(),
      defaultBranch: "main",
      reachedDefaultBranch: true,
      observedAt: new Date(),
    },
  },
  {
    pullRequestUrl: "https://github.com/example/repo/pull/19",
    required: true,
    sources: [{ kind: "step", id: "step", name: "Step", required: true }],
  },
];
describe("finish-rule drafts", () => {
  test("removing an open PR previews completion but does not mutate the server snapshot; Cancel then reopen restores all fields", () => {
    const original = JSON.stringify(rows);
    const draft = createFinishRuleDraft(rule, rows, "Check the result", 7, 2);
    expect(
      finishRuleConsequence(
        draft.rule,
        draftPullRequests(draft.rows, draft),
        true,
      ).finishes,
    ).toBe(false);
    draft.requirements[rows[1]!.pullRequestUrl] = false;
    draft.humanCheckText = "Changed locally";
    expect(
      finishRuleConsequence(
        draft.rule,
        draftPullRequests(draft.rows, draft),
        true,
      ),
    ).toMatchObject({
      finishes: true,
      text: "Saving finishes this task now: all required PRs reached the default branch.",
    });
    expect(JSON.stringify(rows)).toBe(original);
    const reopened = createFinishRuleDraft(
      rule,
      rows,
      "Check the result",
      7,
      2,
    );
    expect(reopened.requirements[rows[1]!.pullRequestUrl]).toBe(true);
    expect(reopened.humanCheckText).toBe("Check the result");
    expect(reopened.rule).toEqual(rule);
  });
  test("one save includes the complete canonical URL snapshot and retains opening revision/epoch after live data changes", () => {
    const draft = createFinishRuleDraft(rule, rows, "", 7, 2);
    draft.requirements[rows[1]!.pullRequestUrl] = false;
    const liveRows = [
      ...rows,
      {
        pullRequestUrl: "https://github.com/example/repo/pull/20",
        required: true,
        sources: [],
      },
    ];
    expect(finishRuleRequirementChanges(draft.rows, draft)).toEqual([
      { pullRequestUrl: rows[0]!.pullRequestUrl, required: true },
      { pullRequestUrl: rows[1]!.pullRequestUrl, required: false },
    ]);
    expect(draft.rows).toHaveLength(2);
    expect(liveRows).toHaveLength(3);
    expect(draft.expectedRevision).toBe(7);
    expect(draft.expectedWorkflowEpoch).toBe(2);
  });
  test("empty required set, human checks, agent reports and deliberate blocked holds preview their actual finish condition", () => {
    expect(
      finishRuleConsequence(
        rule,
        rows.map((row) => ({ ...row, required: false })),
        true,
      ),
    ).toMatchObject({ finishes: false, warning: true });
    expect(
      finishRuleConsequence(
        { ...rule, requireHumanCheck: true },
        [rows[0]!],
        true,
      ),
    ).toMatchObject({
      finishes: false,
      text: expect.stringContaining("waits for your check"),
    });
    expect(
      finishRuleConsequence(
        { kind: "agent_report", requireHumanCheck: false },
        [],
        true,
      ).finishes,
    ).toBe(true);
    expect(
      finishRuleConsequence(
        { kind: "agent_report", requireHumanCheck: false },
        [],
        false,
      ).finishes,
    ).toBe(false);
    expect(finishRuleConsequence(rule, [rows[0]!], true, true)).toMatchObject({
      finishes: false,
      text: expect.stringContaining("stays blocked"),
    });
  });
  test("missing snapshot guards disable the editor without inventing a revision or epoch", () => {
    const html = renderToStaticMarkup(
      createElement(FinishRulePanel, {
        rule,
        rows,
        disabled: false,
        agentFinished: true,
        onSave: async () => {},
        children: () => null,
      }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain("Refresh Factory before editing this finish rule");
    expect(html).not.toContain("finish-rule-editor");
  });
  test("normal PR rows are descriptive and only an editor callback exposes draft checkboxes", () => {
    const props = {
      rows,
      statuses: {},
      disabled: false,
      onLink: async () => {},
      onRefresh: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(WorkflowPullRequests, props),
    );
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("required");
    const editing = renderToStaticMarkup(
      createElement(WorkflowPullRequests, {
        ...props,
        onDraftRequired: () => {},
      }),
    );
    expect(editing).toContain('type="checkbox"');
    expect(editing).toContain('aria-label="required: PR #19"');
    expect(editing).not.toContain("Link a PR");
  });
});

describe("blocked Task consequence", () => {
  test("an agent blocked report does not imply a manual hold when remaining required PRs reached the default branch", () => {
    const status = { taskState: "blocked", manualHold: false };
    expect(
      finishRuleConsequence(rule, [rows[0]!], false, status.manualHold),
    ).toMatchObject({
      finishes: true,
      text: expect.stringContaining("Saving finishes this task now"),
    });
    expect(finishRuleConsequence(rule, [rows[0]!], false, true)).toMatchObject({
      finishes: false,
      text: expect.stringContaining("stays blocked"),
    });
  });
});

describe("Task PR replacement form", () => {
  test("shows the old Task URL, explicit replacement action and potential finish warning", () => {
    const html = renderToStaticMarkup(
      createElement(TaskPullRequestLinkForm, {
        oldUrl: rows[0]!.pullRequestUrl,
        oldRequired: true,
        url: rows[1]!.pullRequestUrl,
        onUrl: () => {},
        disabled: false,
        saving: false,
        stale: false,
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain('aria-label="Replace Task PR #18"');
    expect(html).toContain("Replaces PR #18 on this Task.");
    expect(html).toContain(rows[0]!.pullRequestUrl);
    expect(html).toContain("Replacing this required link may finish this Task");
    expect(html).toContain("Replace PR");
  });
  test("a stale form keeps its original replacement context and disables saving", () => {
    const html = renderToStaticMarkup(
      createElement(TaskPullRequestLinkForm, {
        oldUrl: rows[0]!.pullRequestUrl,
        oldRequired: true,
        url: rows[1]!.pullRequestUrl,
        onUrl: () => {},
        disabled: true,
        saving: false,
        stale: true,
        onSubmit: () => {},
        onCancel: () => {},
      }),
    );
    expect(html).toContain("This Task changed while you were editing.");
    expect(html).toContain('type="submit" disabled=""');
    expect(html).toContain("Replaces PR #18 on this Task.");
  });
});
