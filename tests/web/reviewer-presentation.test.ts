import { describe, expect, test } from "bun:test";

import {
  mergeReconciliationMessage,
  resolveReviewScreenshotLinks,
  verificationAttribution,
} from "../../src/web/reviewer-presentation";

describe("reviewer presentation", () => {
  test("attributes human decisions to the signed-in human identity", () => {
    expect(
      verificationAttribution({
        decision: "accepted",
        source: "human",
        verifier: "Kevin",
      }),
    ).toBe("accepted by Kevin");
  });

  test("attributes reviewer decisions to Bitsy and merge decisions to PR Merge", () => {
    expect(
      verificationAttribution({
        decision: "accepted",
        source: "reviewer",
        verifier: "Bitsy",
      }),
    ).toBe("accepted by Bitsy");
    expect(
      verificationAttribution({ decision: "accepted", source: "reviewer" }),
    ).toBe("accepted by Reviewer");
    expect(
      verificationAttribution({
        decision: "accepted",
        source: "pr_merge",
        verifier: "server",
      }),
    ).toBe("accepted by PR Merge");
  });

  test("does not present a reconciliation denial as success", () => {
    expect(
      mergeReconciliationMessage({
        reconciled: false,
        reason: "The linked pull request is still open.",
      }),
    ).toBe("The linked pull request is still open.");
  });

  test("reports successful reconciliation with the merge revision", () => {
    expect(
      mergeReconciliationMessage({
        reconciled: true,
        mergeSha: "1234567890abcdef",
        reason: "Task and eligible subtasks accepted.",
      }),
    ).toBe(
      "Merged PR reconciled (1234567890ab). Task and eligible subtasks accepted.",
    );
  });

  test("resolves cascade proof to the parent Task anchor and keeps missing IDs unavailable", () => {
    expect(
      resolveReviewScreenshotLinks(
        ["task-proof", "child-proof", "missing-proof"],
        { "child-proof": "screenshot-subtask-child-proof" },
        { "task-proof": "screenshot-task-task-proof" },
      ),
    ).toEqual({
      links: [
        {
          screenshotId: "task-proof",
          anchorId: "screenshot-task-task-proof",
        },
        {
          screenshotId: "child-proof",
          anchorId: "screenshot-subtask-child-proof",
        },
      ],
      unavailableCount: 1,
    });
  });
});
