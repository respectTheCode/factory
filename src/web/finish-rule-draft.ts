import type { FinishRule, RequiredPullRequest } from "./workflow-panel";

export type PullRequestRequirementChange = {
  pullRequestUrl: string;
  required: boolean;
};
export type FinishRuleDraft = {
  rule: FinishRule;
  humanCheckText: string;
  requirements: Record<string, boolean>;
  rows: RequiredPullRequest[];
  expectedRevision?: number;
  expectedWorkflowEpoch?: number;
};
export function createFinishRuleDraft(
  rule: FinishRule,
  rows: RequiredPullRequest[],
  humanCheckText = "",
  expectedRevision?: number,
  expectedWorkflowEpoch?: number,
): FinishRuleDraft {
  return {
    rule: { ...rule },
    humanCheckText,
    rows: rows.map((row) => ({
      ...row,
      sources: row.sources.map((source) => ({ ...source })),
    })),
    expectedRevision,
    expectedWorkflowEpoch,
    requirements: Object.fromEntries(
      rows.map((row) => [row.pullRequestUrl, row.required]),
    ),
  };
}
export function draftPullRequests(
  rows: RequiredPullRequest[],
  draft: FinishRuleDraft,
): RequiredPullRequest[] {
  return rows.map((row) => ({
    ...row,
    required: draft.requirements[row.pullRequestUrl] ?? row.required,
  }));
}
export function finishRuleRequirementChanges(
  rows: RequiredPullRequest[],
  draft: FinishRuleDraft,
): PullRequestRequirementChange[] {
  return draftPullRequests(rows, draft).map((row) => ({
    pullRequestUrl: row.pullRequestUrl,
    required: row.required,
  }));
}
export function finishRuleConsequence(
  rule: FinishRule,
  rows: RequiredPullRequest[],
  agentFinished: boolean,
  held = false,
): { text: string; finishes: boolean; warning: boolean } {
  if (held)
    return {
      text: "After saving: this Task stays blocked until you resume it.",
      finishes: false,
      warning: true,
    };
  const required = rows.filter(
    (row) => row.required && !row.mergedBeforeReopen,
  );
  if (rule.kind === "pr_merge" && !required.length)
    return {
      text: "No required PR. This task can't finish on merge until you link one.",
      finishes: false,
      warning: true,
    };
  const conditionsMet =
    rule.kind === "pr_merge"
      ? required.every((row) => row.merge)
      : agentFinished;
  if (conditionsMet)
    return {
      text: rule.requireHumanCheck
        ? "After saving: the other finish conditions are met; waits for your check."
        : rule.kind === "pr_merge"
          ? "Saving finishes this task now: all required PRs reached the default branch."
          : "Saving finishes this task now: the agent has reported finished.",
      finishes: !rule.requireHumanCheck,
      warning: false,
    };
  return {
    text:
      rule.kind === "pr_merge"
        ? "After saving: waits for every required PR to reach the default branch."
        : "After saving: waits for the agent's Task finish report.",
    finishes: false,
    warning: false,
  };
}
