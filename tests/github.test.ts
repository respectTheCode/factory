import { describe, expect, test } from "bun:test";

import {
  createGitHubStatusReader,
  parseGitHubPullRequestUrl,
} from "../src/github";

describe("GitHub pull request status adapter", () => {
  test("merge evidence requires a closed merged PR, merge timestamp, SHA, and credentials", async () => {
    const reference = parseGitHubPullRequestUrl(
      "https://github.com/acme/repo/pull/1",
    );
    const mergedPayload = {
      merge_commit_sha: "0123456789abcdef0123456789abcdef01234567",
      merged_at: "2026-10-04T10:00:00Z",
      state: "closed",
    };
    const read = async (
      status: number,
      payload: Record<string, unknown>,
      token = "server-token",
    ) =>
      createGitHubStatusReader({
        fetcher: async () => new Response(JSON.stringify(payload), { status }),
        token,
      }).readMergeEvidence!(reference);

    expect(await read(200, mergedPayload)).toEqual({
      mergeSha: mergedPayload.merge_commit_sha,
      mergedAt: mergedPayload.merged_at,
    });
    expect(
      await read(200, {
        ...mergedPayload,
        merge_commit_sha: null,
      }),
    ).toBeUndefined();
    expect(
      await read(200, {
        ...mergedPayload,
        state: "open",
      }),
    ).toBeUndefined();
    expect(await read(403, mergedPayload)).toBeUndefined();

    let unauthenticatedCalls = 0;
    const unconfigured = createGitHubStatusReader({
      fetcher: async () => {
        unauthenticatedCalls += 1;
        return new Response(JSON.stringify(mergedPayload), { status: 200 });
      },
    });
    expect(await unconfigured.readMergeEvidence!(reference)).toBeUndefined();
    expect(unauthenticatedCalls).toBe(0);
  });

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
                {
                  app: { slug: "external-ci" },
                  completed_at: "2026-08-31T14:03:00Z",
                  conclusion: "failure",
                  html_url: "https://ci.example.test/runs/71",
                  id: 71,
                  name: "External lint",
                  started_at: "2026-08-31T14:00:00Z",
                  status: "completed",
                },
                {
                  app: { slug: "external-pending" },
                  completed_at: null,
                  conclusion: null,
                  html_url: "https://ci.example.test/runs/72",
                  id: 72,
                  name: "External pending check",
                  started_at: "2026-08-31T14:00:00Z",
                  status: "in_progress",
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
    expect(result.allCheckRunsStatus).toBe("ok");
    expect(result.allCheckRuns).toMatchObject([
      { appSlug: "github-actions", conclusion: "success", id: 70 },
      { appSlug: "external-ci", conclusion: "failure", id: 71 },
      { appSlug: "external-pending", id: 72, status: "in_progress" },
    ]);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.github.com/repos/acme/private-repo/pulls/42",
      "https://api.github.com/graphql",
      "https://api.github.com/repos/acme/private-repo/actions/runs?head_sha=abc123&per_page=100",
      "https://api.github.com/repos/acme/private-repo/commits/abc123/check-runs?per_page=100",
    ]);
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "X-GitHub-Api-Version": "2022-11-28",
    });
    expect(result.review).toMatchObject({
      status: "unavailable",
      completed: false,
      decision: "pending",
    });
    expect(requests[1]?.init?.headers).toMatchObject({
      Authorization: "Bearer secret-token",
      "Content-Type": "application/json",
    });
    const graphQLBody = JSON.parse(String(requests[1]?.init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    expect(graphQLBody.query).toContain("reviewThreads(first: 100");
    expect(graphQLBody.query).toContain("reviews(first: 100");
    expect(graphQLBody.variables).toEqual({
      owner: "acme",
      repo: "private-repo",
      number: 42,
      includeThreads: true,
      includeReviews: true,
      threadCursor: null,
      reviewCursor: null,
    });
  });

  test("marks workflow and check evidence unavailable when another REST page remains", async () => {
    const reader = createGitHubStatusReader({
      token: "server-token",
      fetcher: async (input) => {
        const url = String(input);
        if (url.includes("/pulls/42")) {
          return new Response(
            JSON.stringify({
              base: { ref: "main" },
              head: { ref: "feature", sha: "abc123" },
              number: 42,
              state: "open",
              title: "Paged status",
              updated_at: "2026-08-31T15:00:00Z",
            }),
            { status: 200 },
          );
        }
        if (url.endsWith("/graphql")) {
          return new Response(JSON.stringify({ workflow_runs: [] }), {
            status: 200,
          });
        }
        if (url.includes("/actions/runs?")) {
          return new Response(JSON.stringify({ workflow_runs: [] }), {
            status: 200,
            headers: {
              Link: '<https://api.github.com/actions/runs?page=2>; rel="next"',
            },
          });
        }
        if (url.includes("/check-runs?")) {
          return new Response(
            JSON.stringify({ check_runs: [], total_count: 1 }),
            {
              status: 200,
            },
          );
        }
        return new Response("unexpected request", { status: 500 });
      },
    });

    const result = await reader.read(
      parseGitHubPullRequestUrl("https://github.com/acme/repo/pull/42"),
    );

    expect(result.workflowRuns).toEqual([]);
    expect(result.workflowRunsStatus).toBe("unavailable");
    expect(result.checkRuns).toEqual([]);
    expect(result.checkRunsStatus).toBe("unavailable");
    expect(result.review?.status).toBe("unavailable");
  });

  test.each([
    ["a string", "101"],
    ["a negative integer", -1],
    ["a fractional number", 1.5],
    ["an unsafe integer", Number.MAX_SAFE_INTEGER + 1],
    ["a count smaller than the returned rows", 0],
  ] as const)(
    "marks CI summaries unavailable for %s total_count metadata",
    async (_label, totalCount) => {
      const now = "2026-10-06T12:00:00Z";
      const reader = createGitHubStatusReader({
        token: "server-token",
        fetcher: async (input) => {
          const url = String(input);
          if (url.includes("/pulls/42")) {
            return new Response(
              JSON.stringify({
                base: { ref: "main" },
                head: { ref: "feature", sha: "a".repeat(40) },
                number: 42,
                state: "open",
                title: "Invalid CI count",
                updated_at: now,
              }),
              { status: 200 },
            );
          }
          if (url.endsWith("/graphql")) {
            return new Response(
              JSON.stringify({
                data: {
                  repository: {
                    pullRequest: {
                      headRefOid: "a".repeat(40),
                      reviewThreads: {
                        nodes: [],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                      reviews: {
                        nodes: [],
                        pageInfo: { hasNextPage: false, endCursor: null },
                      },
                    },
                  },
                },
              }),
              { status: 200 },
            );
          }
          if (url.includes("/actions/runs?")) {
            return new Response(
              JSON.stringify({
                total_count: totalCount,
                workflow_runs: [
                  {
                    conclusion: "success",
                    created_at: now,
                    html_url: "https://github.com/acme/repo/actions/runs/1",
                    id: 1,
                    name: "CI",
                    status: "completed",
                    updated_at: now,
                  },
                ],
              }),
              { status: 200 },
            );
          }
          if (url.includes("/check-runs?")) {
            return new Response(
              JSON.stringify({
                total_count: totalCount,
                check_runs: [
                  {
                    completed_at: now,
                    conclusion: "success",
                    html_url: "https://github.com/acme/repo/checks/2",
                    id: 2,
                    name: "CI",
                    started_at: now,
                    status: "completed",
                  },
                ],
              }),
              { status: 200 },
            );
          }
          return new Response("unexpected request", { status: 500 });
        },
      });

      const result = await reader.read(
        parseGitHubPullRequestUrl("https://github.com/acme/repo/pull/42"),
      );

      expect(result.workflowRunsStatus).toBe("unavailable");
      expect(result.checkRunsStatus).toBe("unavailable");
      expect(result.allCheckRunsStatus).toBe("unavailable");
    },
  );

  test.each([
    [
      "a non-array check_runs value",
      { check_runs: { unexpected: true } },
      "unavailable",
    ],
    [
      "a malformed check run among valid rows",
      {
        check_runs: [
          {
            app: { slug: "github-actions" },
            completed_at: "2026-08-31T14:02:00Z",
            conclusion: "success",
            html_url: "https://github.com/acme/repo/checks/70",
            id: 70,
            name: "setup",
            started_at: "2026-08-31T14:00:00Z",
            status: "completed",
          },
          { app: { slug: "external-ci" }, id: 71, name: "Missing status" },
        ],
      },
      "ok",
    ],
  ] as const)(
    "marks all-provider check evidence unavailable for %s",
    async (_label, checks, legacyStatus) => {
      const reader = createGitHubStatusReader({
        token: "server-token",
        fetcher: async (input) => {
          const url = String(input);
          if (url.includes("/pulls/42")) {
            return new Response(
              JSON.stringify({
                base: { ref: "main" },
                head: { ref: "feature", sha: "abc123" },
                number: 42,
                state: "open",
                title: "Malformed check data",
                updated_at: "2026-08-31T15:00:00Z",
              }),
              { status: 200 },
            );
          }
          if (url.endsWith("/graphql")) {
            return new Response(JSON.stringify({ workflow_runs: [] }), {
              status: 200,
            });
          }
          if (url.includes("/actions/runs?")) {
            return new Response(JSON.stringify({ workflow_runs: [] }), {
              status: 200,
            });
          }
          if (url.includes("/check-runs?")) {
            return new Response(JSON.stringify(checks), { status: 200 });
          }
          return new Response("unexpected request", { status: 500 });
        },
      });

      const result = await reader.read(
        parseGitHubPullRequestUrl("https://github.com/acme/repo/pull/42"),
      );

      expect(result.allCheckRunsStatus).toBe("unavailable");
      expect(result.checkRunsStatus).toBe(legacyStatus);
      expect(result.allCheckRuns).toHaveLength(
        Array.isArray(checks.check_runs)
          ? checks.check_runs.filter((run) => "status" in run).length
          : 0,
      );
    },
  );

  test("keeps malformed or omitted workflow rows unavailable beside valid checks", async () => {
    for (const workflow_runs of [
      undefined,
      "invalid",
      [null],
      [{ id: 1, conclusion: "failure" }],
    ]) {
      const reader = createGitHubStatusReader({
        token: "server-token",
        fetcher: async (input) => {
          const url = String(input);
          const payload = url.includes("/pulls/42")
            ? {
                base: { ref: "main" },
                head: { ref: "feature", sha: "a".repeat(40) },
                number: 42,
                state: "open",
                title: "Incomplete workflows",
                updated_at: "2026-10-06T12:00:00Z",
              }
            : url.includes("/actions/runs?")
              ? { workflow_runs }
              : url.includes("/check-runs?")
                ? { check_runs: [] }
                : { data: null };
          return new Response(JSON.stringify(payload), { status: 200 });
        },
      });
      const result = await reader.read(
        parseGitHubPullRequestUrl("https://github.com/acme/repo/pull/42"),
      );
      expect(result.workflowRunsStatus).toBe("unavailable");
      expect(result.workflowRuns).toEqual([]);
    }
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
