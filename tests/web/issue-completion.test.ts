import { describe, expect, test } from "bun:test";

import { issueHasUnresolvedPullRequests } from "../../src/web/issue-completion";
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
    expect(issueHasUnresolvedPullRequests([], [])).toBe(false);
  });

  test("identifies new, unavailable, and open PRs as unresolved", () => {
    const url = "https://github.com/org/repo/pull/3";
    expect(issueHasUnresolvedPullRequests([url], [])).toBe(true);
    expect(
      issueHasUnresolvedPullRequests(
        [url],
        [pullRequest(url, "unavailable", false)],
      ),
    ).toBe(true);
    expect(
      issueHasUnresolvedPullRequests([url], [pullRequest(url, "open", false)]),
    ).toBe(true);
  });

  test("allows terminal status after every linked PR is confirmed closed or merged", () => {
    const first = "https://github.com/org/repo/pull/3";
    const second = "https://github.com/org/repo/pull/4";
    expect(
      issueHasUnresolvedPullRequests(
        [first, second],
        [pullRequest(first, "closed", false), pullRequest(second, "merged")],
      ),
    ).toBe(false);
  });

  test("does not bypass unresolved existing PRs by removing their URLs", () => {
    expect(
      issueHasUnresolvedPullRequests(
        [],
        [pullRequest("https://github.com/org/repo/pull/3", "open", false)],
      ),
    ).toBe(true);
  });

  test("blocks a terminal status when any one linked PR is unresolved", () => {
    const first = "https://github.com/org/repo/pull/3";
    const second = "https://github.com/org/repo/pull/4";
    expect(
      issueHasUnresolvedPullRequests(
        [first, second],
        [
          pullRequest(first, "closed", false),
          pullRequest(second, "open", false),
        ],
      ),
    ).toBe(true);
  });
});
