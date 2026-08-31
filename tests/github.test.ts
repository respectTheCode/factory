import { describe, expect, test } from "bun:test";

import {
  createGitHubStatusReader,
  parseGitHubPullRequestUrl,
} from "../src/github";

describe("GitHub pull request status adapter", () => {
  test("normalizes a pull request URL and reads Actions for the exact head SHA", async () => {
    const requests: Array<{ init?: RequestInit; url: string }> = [];
    const reader = createGitHubStatusReader({
      fetcher: async (input, init) => {
        const url = String(input);
        requests.push({ init, url });
        if (url.includes("/pulls/42")) {
          return new Response(
            JSON.stringify({
              base: { ref: "main" },
              draft: false,
              head: { ref: "feature/status", sha: "abc123" },
              html_url: "https://github.com/acme/private-repo/pull/42",
              mergeable: true,
              mergeable_state: "clean",
              number: 42,
              state: "open",
              title: "Show status",
              updated_at: "2026-08-31T15:00:00Z",
              user: { login: "agent" },
            }),
            { status: 200 },
          );
        }
        if (url.includes("/commits/abc123/check-runs")) {
          return new Response(
            JSON.stringify({
              check_runs: [
                {
                  app: { slug: "github-actions" },
                  completed_at: "2026-08-31T14:02:00Z",
                  conclusion: "success",
                  html_url:
                    "https://github.com/acme/private-repo/actions/runs/7/job/70",
                  id: 70,
                  name: "setup",
                  started_at: "2026-08-31T14:00:00Z",
                  status: "completed",
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            workflow_runs: [
              {
                conclusion: "success",
                created_at: "2026-08-31T14:00:00Z",
                event: "pull_request",
                html_url: "https://github.com/acme/private-repo/actions/runs/7",
                id: 7,
                name: "Test",
                run_number: 12,
                status: "completed",
                updated_at: "2026-08-31T14:02:00Z",
                workflow_name: "CI",
              },
            ],
          }),
          { status: 200 },
        );
      },
      now: () => new Date("2026-08-31T15:01:00Z"),
      token: "secret-token",
    });

    const result = await reader.read(
      parseGitHubPullRequestUrl(
        "https://www.github.com/acme/private-repo/pull/42?view=checks",
      ),
    );

    expect(result).toMatchObject({
      fetchedAt: "2026-08-31T15:01:00.000Z",
      pullRequest: {
        headSha: "abc123",
        number: 42,
        title: "Show status",
      },
      status: "ok",
      checkRunsStatus: "ok",
      workflowRunsStatus: "ok",
    });
    expect(result.workflowRuns).toHaveLength(1);
    expect(result.checkRuns).toMatchObject([
      { conclusion: "success", id: 70, name: "setup", status: "completed" },
    ]);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.github.com/repos/acme/private-repo/pulls/42",
      "https://api.github.com/repos/acme/private-repo/actions/runs?head_sha=abc123&per_page=100",
      "https://api.github.com/repos/acme/private-repo/commits/abc123/check-runs?per_page=100",
    ]);
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "X-GitHub-Api-Version": "2022-11-28",
    });
  });

  test("fails closed without making a network request when credentials are absent", async () => {
    let calls = 0;
    const result = await createGitHubStatusReader({
      fetcher: async () => {
        calls += 1;
        return new Response();
      },
    }).read(parseGitHubPullRequestUrl("https://github.com/acme/repo/pull/1"));

    expect(result.status).toBe("not_configured");
    expect(result.workflowRunsStatus).toBe("not_requested");
    expect(calls).toBe(0);
  });

  test("rejects non-canonical hosts and non-pull-request paths", () => {
    expect(() =>
      parseGitHubPullRequestUrl(
        "https://gitlab.com/acme/repo/-/merge_requests/1",
      ),
    ).toThrow("GitHub pull request URL");
    expect(() =>
      parseGitHubPullRequestUrl("https://github.com/acme/repo/issues/1"),
    ).toThrow("GitHub pull request URL");
  });
});
