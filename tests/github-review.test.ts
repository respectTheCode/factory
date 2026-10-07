import { describe, expect, test } from "bun:test";

import {
  createGitHubStatusReader,
  parseGitHubPullRequestUrl,
} from "../src/github";

const reference = parseGitHubPullRequestUrl(
  "https://github.com/acme/repo/pull/42",
);
const HEAD_SHA = "current-head";
const OTHER_SHA = "old-head";

const restPullRequest = (headSha = HEAD_SHA) => ({
  base: { ref: "main" },
  draft: false,
  head: { ref: "feature", sha: headSha },
  html_url: reference.url,
  mergeable: true,
  number: reference.number,
  state: "open",
  title: "Review tracking",
  updated_at: "2026-10-06T10:00:00Z",
});

const pageInfo = (hasNextPage = false, endCursor: string | null = null) => ({
  hasNextPage,
  endCursor,
});

type GraphQLReview = {
  author: { login: string };
  state: string;
  commit: { oid: string } | null;
  submittedAt: string | null;
};

type GraphQLThread = { isResolved: boolean; isOutdated: boolean };

type GraphQLResponseOptions = {
  headSha?: string;
  threads?: GraphQLThread[];
  reviews?: GraphQLReview[];
  threadPageInfo?: ReturnType<typeof pageInfo>;
  reviewPageInfo?: ReturnType<typeof pageInfo>;
};

function graphQLResponse({
  headSha = HEAD_SHA,
  threads = [],
  reviews = [],
  threadPageInfo = pageInfo(),
  reviewPageInfo = pageInfo(),
}: GraphQLResponseOptions = {}) {
  return {
    data: {
      repository: {
        pullRequest: {
          headRefOid: headSha,
          reviewThreads: { nodes: threads, pageInfo: threadPageInfo },
          reviews: { nodes: reviews, pageInfo: reviewPageInfo },
        },
      },
    },
  };
}

function review(
  author: string,
  state: string,
  submittedAt: string,
  commitSha = HEAD_SHA,
): GraphQLReview {
  return {
    author: { login: author },
    state,
    commit: { oid: commitSha },
    submittedAt,
  };
}

function makeReader(
  graphQL: (variables: Record<string, unknown>) => unknown,
  options: {
    restHeadSha?: string;
    graphQLStatus?: number;
    apiBaseUrl?: string;
  } = {},
) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const reader = createGitHubStatusReader({
    apiBaseUrl: options.apiBaseUrl,
    token: "server-secret",
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/pulls/42")) {
        return new Response(
          JSON.stringify(restPullRequest(options.restHeadSha)),
          {
            status: 200,
          },
        );
      }
      if (url.endsWith("/graphql")) {
        const body = JSON.parse(String(init?.body)) as {
          variables: Record<string, unknown>;
        };
        return new Response(JSON.stringify(graphQL(body.variables)), {
          status: options.graphQLStatus ?? 200,
        });
      }
      if (url.includes("/actions/runs?")) {
        return new Response(JSON.stringify({ workflow_runs: [] }), {
          status: 200,
        });
      }
      if (url.includes("/check-runs?")) {
        return new Response(JSON.stringify({ check_runs: [] }), {
          status: 200,
        });
      }
      return new Response("unexpected request", { status: 500 });
    },
  });
  return { reader, requests };
}

async function readReview(
  graphQL: (variables: Record<string, unknown>) => unknown,
  options: {
    restHeadSha?: string;
    graphQLStatus?: number;
    apiBaseUrl?: string;
  } = {},
) {
  const configured = makeReader(graphQL, options);
  const snapshot = await configured.reader.read(reference);
  return { ...configured, snapshot };
}

describe("GitHub current-head review observation", () => {
  test("accepts an approval only when GraphQL confirms the REST head", async () => {
    const { snapshot, requests } = await readReview(() =>
      graphQLResponse({
        reviews: [review("reviewer", "APPROVED", "2026-10-06T10:05:00Z")],
      }),
    );

    expect(snapshot.review).toEqual({
      status: "ok",
      headSha: HEAD_SHA,
      completed: true,
      unresolvedThreads: 0,
      decision: "approved",
      reviewers: ["reviewer"],
    });
    expect(snapshot.checkRunsStatus).toBe("ok");
    expect(
      requests.find(({ url }) => url.endsWith("/graphql"))?.init,
    ).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer server-secret",
        "Content-Type": "application/json",
      },
    });
  });

  test("marks a head change during observation unavailable", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        headSha: "moved-head",
        reviews: [review("reviewer", "APPROVED", "2026-10-06T10:05:00Z")],
      }),
    );

    expect(snapshot.status).toBe("ok");
    expect(snapshot.review).toMatchObject({
      status: "unavailable",
      headSha: HEAD_SHA,
      completed: false,
      decision: "pending",
      reviewers: [],
    });
    expect(snapshot.review?.error).toContain("does not match");
  });

  test("fails closed if the PR head changes between review pages", async () => {
    const observedCursors: unknown[] = [];
    const { snapshot } = await readReview((variables) => {
      observedCursors.push(variables.reviewCursor);
      if (variables.reviewCursor === "reviews-page-2") {
        return graphQLResponse({
          headSha: "moved-head",
          reviews: [review("reviewer", "APPROVED", "2026-10-06T10:05:00Z")],
        });
      }
      return graphQLResponse({
        reviews: [review("older-reviewer", "APPROVED", "2026-10-06T10:01:00Z")],
        reviewPageInfo: pageInfo(true, "reviews-page-2"),
      });
    });

    expect(observedCursors).toEqual([null, "reviews-page-2"]);
    expect(snapshot.review).toMatchObject({
      status: "unavailable",
      headSha: HEAD_SHA,
      completed: false,
      decision: "pending",
      reviewers: [],
    });
  });

  test("treats CodeRabbit comments as completed and ignores human comments", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        reviews: [
          review("helpful-human", "COMMENTED", "2026-10-06T10:01:00Z"),
          review("CodeRabbitAi[bot]", "COMMENTED", "2026-10-06T10:02:00Z"),
        ],
      }),
    );

    expect(snapshot.review).toMatchObject({
      status: "ok",
      completed: true,
      decision: "commented",
      reviewers: ["CodeRabbitAi[bot]"],
    });
  });

  test("uses the latest review per author and preserves another reviewer changes request", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        reviews: [
          review("alice", "CHANGES_REQUESTED", "2026-10-06T10:01:00Z"),
          review("alice", "APPROVED", "2026-10-06T10:04:00Z"),
          review("bob", "CHANGES_REQUESTED", "2026-10-06T10:03:00Z"),
          review("carol", "APPROVED", "2026-10-06T10:02:00Z"),
        ],
      }),
    );

    expect(snapshot.review).toMatchObject({
      completed: true,
      decision: "changes_requested",
      reviewers: ["alice", "bob", "carol"],
    });
  });

  test("keeps decisive reviews through later human comments and other approvals", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        reviews: [
          review("alice", "CHANGES_REQUESTED", "2026-10-06T10:01:00Z"),
          review("bob", "APPROVED", "2026-10-06T10:02:00Z"),
          review("alice", "COMMENTED", "2026-10-06T10:04:00Z"),
          review("coderabbitai", "COMMENTED", "2026-10-06T10:05:00Z"),
        ],
      }),
    );

    expect(snapshot.review).toMatchObject({
      completed: true,
      decision: "changes_requested",
      reviewers: ["alice", "bob", "coderabbitai"],
    });
  });

  test("keeps an approval through the same reviewer's later comment", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        reviews: [
          review("alice", "APPROVED", "2026-10-06T10:01:00Z"),
          review("alice", "COMMENTED", "2026-10-06T10:04:00Z"),
        ],
      }),
    );

    expect(snapshot.review).toMatchObject({
      completed: true,
      decision: "approved",
      reviewers: ["alice"],
    });
  });

  test("lets a later dismissal clear that reviewer's decisive state", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        reviews: [
          review("alice", "CHANGES_REQUESTED", "2026-10-06T10:01:00Z"),
          review("bob", "APPROVED", "2026-10-06T10:02:00Z"),
          review("alice", "DISMISSED", "2026-10-06T10:04:00Z"),
        ],
      }),
    );

    expect(snapshot.review).toMatchObject({
      completed: true,
      decision: "approved",
      reviewers: ["bob"],
    });
  });

  test("does not count pending or dismissed reviews as completed", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        reviews: [
          review("reviewer", "APPROVED", "2026-10-06T10:01:00Z"),
          review("reviewer", "DISMISSED", "2026-10-06T10:02:00Z"),
          {
            author: { login: "pending-reviewer" },
            state: "PENDING",
            commit: null,
            submittedAt: null,
          },
        ],
      }),
    );

    expect(snapshot.review).toMatchObject({
      status: "ok",
      completed: false,
      decision: "pending",
      reviewers: [],
    });
  });

  test("fails closed when the GraphQL response omits a requested connection", async () => {
    const { snapshot } = await readReview(() => ({
      data: {
        repository: {
          pullRequest: { headRefOid: HEAD_SHA },
        },
      },
    }));

    expect(snapshot.review).toMatchObject({
      status: "unavailable",
      completed: false,
      decision: "pending",
      reviewers: [],
    });
    expect(snapshot.checkRunsStatus).toBe("ok");
  });

  test("ignores reviews attached to older commits and leaves empty current-head review pending", async () => {
    const { snapshot } = await readReview(() =>
      graphQLResponse({
        threads: [
          { isResolved: false, isOutdated: true },
          { isResolved: true, isOutdated: false },
        ],
        reviews: [
          review(
            "stale-approver",
            "APPROVED",
            "2026-10-06T10:01:00Z",
            OTHER_SHA,
          ),
          review(
            "coderabbitai[bot]",
            "COMMENTED",
            "2026-10-06T10:02:00Z",
            OTHER_SHA,
          ),
        ],
      }),
    );

    expect(snapshot.review).toEqual({
      status: "ok",
      headSha: HEAD_SHA,
      completed: false,
      unresolvedThreads: 1,
      decision: "pending",
      reviewers: [],
    });
  });

  test("counts unresolved outdated threads across pages", async () => {
    const cursors: Array<{ includeThreads: unknown; threadCursor: unknown }> =
      [];
    const { snapshot } = await readReview((variables) => {
      cursors.push({
        includeThreads: variables.includeThreads,
        threadCursor: variables.threadCursor,
      });
      if (variables.threadCursor === "threads-page-2") {
        return graphQLResponse({
          threads: [{ isResolved: false, isOutdated: false }],
          reviews: [],
        });
      }
      return graphQLResponse({
        threads: [
          { isResolved: false, isOutdated: true },
          { isResolved: true, isOutdated: false },
        ],
        threadPageInfo: pageInfo(true, "threads-page-2"),
        reviews: [],
      });
    });

    expect(snapshot.review).toMatchObject({
      status: "ok",
      unresolvedThreads: 2,
    });
    expect(cursors).toEqual([
      { includeThreads: true, threadCursor: null },
      { includeThreads: true, threadCursor: "threads-page-2" },
    ]);
  });

  test("paginates beyond the first 100 reviews", async () => {
    let reviewPages = 0;
    const { snapshot } = await readReview((variables) => {
      if (variables.includeReviews === true) {
        reviewPages += 1;
        if (variables.reviewCursor === "reviews-page-2") {
          return graphQLResponse({
            reviews: [
              review("coderabbitai", "COMMENTED", "2026-10-06T11:00:00Z"),
            ],
          });
        }
        return graphQLResponse({
          reviews: Array.from({ length: 100 }, (_, index) =>
            review(
              `human-${index}`,
              "COMMENTED",
              `2026-10-06T10:${String(index % 60).padStart(2, "0")}:00Z`,
            ),
          ),
          reviewPageInfo: pageInfo(true, "reviews-page-2"),
        });
      }
      return graphQLResponse();
    });

    expect(reviewPages).toBe(2);
    expect(snapshot.review).toMatchObject({
      completed: true,
      decision: "commented",
      reviewers: ["coderabbitai"],
    });
  });

  test("keeps review evidence unavailable when GraphQL access is denied", async () => {
    const { snapshot } = await readReview(() => graphQLResponse(), {
      graphQLStatus: 403,
    });

    expect(snapshot.status).toBe("ok");
    expect(snapshot.checkRunsStatus).toBe("ok");
    expect(snapshot.review).toMatchObject({
      status: "unavailable",
      completed: false,
      decision: "pending",
      reviewers: [],
      error: "GitHub review data is not accessible.",
    });
  });

  test("uses GitHub Enterprise GraphQL endpoint when REST base ends in api/v3", async () => {
    const { requests } = await readReview(() => graphQLResponse(), {
      apiBaseUrl: "https://github.example.test/api/v3",
    });

    expect(
      requests.some(
        ({ url }) => url === "https://github.example.test/api/graphql",
      ),
    ).toBe(true);
  });
});
