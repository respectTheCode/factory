import { describe, expect, test } from "bun:test";

import { issueNeedsMergedPullRequestsForDone } from "../../src/web/issue-completion";
import type { IssuePullRequest } from "../../src/issues";

function pullRequest(
  url: string,
  state: IssuePullRequest["state"],
  merged = state === "merged",
): IssuePullRequest {
  return { merged, state, url };
}

describe("issue completion evidence", () => {
  test("allows manual completion when no pull requests are linked", () => {
    expect(issueNeedsMergedPullRequestsForDone([], [])).toBe(false);
  });

  test("requires evidence for new, unavailable, open, or closed-unmerged PRs", () => {
    const url = "https://github.com/org/repo/pull/3";
    expect(issueNeedsMergedPullRequestsForDone([url], [])).toBe(true);
    expect(
      issueNeedsMergedPullRequestsForDone(
        [url],
        [pullRequest(url, "unavailable", false)],
      ),
    ).toBe(true);
    expect(
      issueNeedsMergedPullRequestsForDone(
        [url],
        [pullRequest(url, "open", false)],
      ),
    ).toBe(true);
    expect(
      issueNeedsMergedPullRequestsForDone(
        [url],
        [pullRequest(url, "closed", false)],
      ),
    ).toBe(true);
  });

  test("allows completion after every linked PR is confirmed merged", () => {
    const first = "https://github.com/org/repo/pull/3";
    const second = "https://github.com/org/repo/pull/4";
    expect(
      issueNeedsMergedPullRequestsForDone(
        [first, second],
        [pullRequest(first, "merged"), pullRequest(second, "merged")],
      ),
    ).toBe(false);
  });

  test("does not bypass unresolved existing PRs by removing their URLs", () => {
    expect(
      issueNeedsMergedPullRequestsForDone(
        [],
        [pullRequest("https://github.com/org/repo/pull/3", "open", false)],
      ),
    ).toBe(true);
  });
});
