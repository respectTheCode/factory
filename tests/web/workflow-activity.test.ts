import { describe, expect, test } from "bun:test";
import { workflowActivityText } from "../../src/web/workflow-activity";
const steps = [{ id: "s1", name: "Build screenshot preview" }];
describe("workflow Activity language", () => {
  test("keeps report actor and action beside its summary", () => {
    expect(
      workflowActivityText(
        {
          kind: "task_report",
          actor: "Codex",
          reportedState: "finished",
          summary: "PR #18 is ready",
        },
        steps,
      ),
    ).toBe("Codex reported ready: PR #18 is ready");
    expect(
      workflowActivityText(
        {
          kind: "task_report",
          actor: "Claude",
          reportedState: "in_progress",
          reason: "Writing notes",
        },
        steps,
      ),
    ).toBe("Claude reported progress: Writing notes");
  });
  test("names the Step and direct state when report evidence exists", () => {
    expect(
      workflowActivityText(
        {
          kind: "step_report",
          actor: "Kevin",
          subtaskId: "s1",
          reportedState: "complete",
          summary: "Desktop and phone captured",
        },
        steps,
      ),
    ).toBe(
      "Kevin set “Build screenshot preview” to Done: Desktop and phone captured",
    );
  });
  test("translates finish rule enums without changing the recorded actor", () => {
    expect(
      workflowActivityText(
        {
          kind: "finish_rule_changed",
          actor: "Human",
          reason: "agent_report with human check",
        },
        steps,
      ),
    ).toBe("Human changed the finish rule: agent finishes with your check");
    expect(
      workflowActivityText(
        { kind: "finish_rule_changed", actor: "Kevin", reason: "pr_merge" },
        steps,
      ),
    ).toBe("Kevin changed the finish rule: required PRs merge");
  });
  test("preserves earlier verification attribution and merge proof", () => {
    expect(
      workflowActivityText(
        {
          kind: "verification",
          actor: "GitHub",
          subtaskId: "s1",
          verificationDecision: "accepted",
          verificationSource: "pr_merge",
          mergeSha: "a".repeat(40),
        },
        steps,
      ),
    ).toBe("accepted by PR Merge · “Build screenshot preview” · merge aaaaaaa");
  });
});
