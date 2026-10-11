export type GitHubPullRequestReference = {
  number: number;
  owner: string;
  repo: string;
  url: string;
};

export type GitHubPullRequestStatus = {
  baseBranch: string;
  draft: boolean;
  headSha: string;
  headBranch: string;
  mergeable: boolean | null;
  mergeableState?: string;
  number: number;
  state: "open" | "closed";
  title: string;
  updatedAt: string;
  url: string;
  user?: string;
  mergedAt?: string;
  mergeSha?: string;
};

export type GitHubWorkflowRunStatus = {
  conclusion?: string;
  createdAt: string;
  event?: string;
  id: number;
  name: string;
  runNumber?: number;
  status: string;
  updatedAt: string;
  url: string;
  workflowName?: string;
};

export type GitHubCheckRunStatus = GitHubWorkflowRunStatus & {
  appSlug?: string;
};

export type GitHubStatusSnapshot = {
  error?: string;
  fetchedAt: string;
  pullRequest?: GitHubPullRequestStatus;
  status:
    | "not_linked"
    | "not_configured"
    | "not_found"
    | "permission_denied"
    | "ok"
    | "unavailable";
  checkRuns: GitHubCheckRunStatus[];
  checkRunsStatus: "not_requested" | "ok" | "unavailable";
  allCheckRuns?: GitHubCheckRunStatus[];
  allCheckRunsStatus?: "not_requested" | "ok" | "unavailable";
  workflowRuns: GitHubWorkflowRunStatus[];
  workflowRunsStatus: "not_requested" | "ok" | "unavailable";
  review?: {
    status: "ok" | "unavailable";
    headSha: string;
    completed: boolean;
    unresolvedThreads?: number;
    decision: "approved" | "changes_requested" | "commented" | "pending";
    reviewers: string[];
    error?: string;
  };
};

export type GitHubStatusReader = {
  read: (
    reference: GitHubPullRequestReference,
  ) => Promise<GitHubStatusSnapshot>;
  readMergeEvidence?: (reference: GitHubPullRequestReference) => Promise<
    | {
        mergeSha: string;
        mergedAt: string;
        defaultBranch: string;
        reachedDefaultBranch: true;
        observedAt: string;
      }
    | undefined
  >;
};

type GitHubPullRequestPayload = {
  base?: {
    ref?: unknown;
    repo?: { full_name?: unknown };
  };
  draft?: unknown;
  head?: { ref?: unknown; sha?: unknown };
  html_url?: unknown;
  mergeable?: unknown;
  mergeable_state?: unknown;
  merge_commit_sha?: unknown;
  merged_at?: unknown;
  number?: unknown;
  state?: unknown;
  title?: unknown;
  updated_at?: unknown;
  user?: { login?: unknown };
};

type GitHubRepositoryPayload = {
  default_branch?: unknown;
  full_name?: unknown;
};

type GitHubComparePayload = {
  merge_base_commit?: { sha?: unknown };
  status?: unknown;
};

type GitHubWorkflowRunsPayload = {
  total_count?: unknown;
  workflow_runs?: Array<{
    conclusion?: unknown;
    created_at?: unknown;
    event?: unknown;
    id?: unknown;
    name?: unknown;
    run_number?: unknown;
    status?: unknown;
    updated_at?: unknown;
    html_url?: unknown;
    workflow_name?: unknown;
  }>;
};

type GitHubCheckRunsPayload = {
  total_count?: unknown;
  check_runs?: Array<{
    app?: { slug?: unknown };
    completed_at?: unknown;
    conclusion?: unknown;
    html_url?: unknown;
    id?: unknown;
    name?: unknown;
    started_at?: unknown;
    status?: unknown;
  }>;
};

type GitHubReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING";

type GitHubReviewThread = {
  isOutdated: boolean;
  isResolved: boolean;
};

type GitHubReview = {
  author: string;
  commitSha?: string;
  state: GitHubReviewState;
  submittedAt?: string;
};

type GitHubReviewPageInfo = {
  endCursor: string | null;
  hasNextPage: boolean;
};

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_API_VERSION = "2022-11-28";

export function parseGitHubPullRequestUrl(
  value: string,
): GitHubPullRequestReference {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      "GitHub pull request URL must be an https://github.com/{owner}/{repo}/pull/{number} URL.",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    !["github.com", "www.github.com"].includes(parsed.hostname)
  ) {
    throw new Error(
      "GitHub pull request URL must be an https://github.com/{owner}/{repo}/pull/{number} URL.",
    );
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const numberText = segments[3];
  if (
    segments.length !== 4 ||
    !segments[0] ||
    !segments[1] ||
    segments[2] !== "pull" ||
    !numberText ||
    !/^\d+$/.test(numberText)
  ) {
    throw new Error(
      "GitHub pull request URL must be an https://github.com/{owner}/{repo}/pull/{number} URL.",
    );
  }

  const number = Number(numberText);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error("GitHub pull request number must be a positive integer.");
  }

  return {
    number,
    owner: decodeURIComponent(segments[0]),
    repo: decodeURIComponent(segments[1]),
    url: `https://github.com/${segments[0]}/${segments[1]}/pull/${number}`,
  };
}

export function createGitHubStatusReader({
  apiBaseUrl = "https://api.github.com",
  apiVersion = DEFAULT_API_VERSION,
  fetcher = fetch,
  now = () => new Date(),
  timeoutMs = 10_000,
  token,
}: {
  apiBaseUrl?: string;
  apiVersion?: string;
  fetcher?: Fetcher;
  now?: () => Date;
  timeoutMs?: number;
  token?: string;
} = {}): GitHubStatusReader {
  const baseUrl = apiBaseUrl.replace(/\/$/, "");
  const configuredToken = token?.trim();

  return {
    async readMergeEvidence(reference) {
      if (!configuredToken) return undefined;
      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${configuredToken}`,
        "Cache-Control": "no-cache",
        "X-GitHub-Api-Version": apiVersion,
      };
      const pullRequestPath = `/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}/pulls/${reference.number}`;
      try {
        const response = await request(
          `${baseUrl}${pullRequestPath}`,
          headers,
          fetcher,
          timeoutMs,
        );
        if (!response.ok) return undefined;
        const payload = (await response.json()) as GitHubPullRequestPayload;
        const expectedRepository = `${reference.owner}/${reference.repo}`;
        if (
          stringValue(payload.base?.repo?.full_name)?.toLowerCase() !==
            expectedRepository.toLowerCase() ||
          numberValue(payload.number) !== reference.number
        ) {
          return undefined;
        }
        if (stringValue(payload.state) !== "closed") return undefined;
        const mergedAt = stringValue(payload.merged_at);
        const mergeSha = stringValue(payload.merge_commit_sha);
        const mergedAtDate = mergedAt ? new Date(mergedAt) : undefined;
        if (
          !mergedAt ||
          !mergedAtDate ||
          !Number.isFinite(mergedAtDate.getTime()) ||
          !mergeSha ||
          !/^[a-f0-9]{40,64}$/i.test(mergeSha)
        ) {
          return undefined;
        }

        const repositoryResponse = await request(
          `${baseUrl}/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}`,
          headers,
          fetcher,
          timeoutMs,
        );
        if (!repositoryResponse.ok) return undefined;
        const repository =
          (await repositoryResponse.json()) as GitHubRepositoryPayload;
        const defaultBranch = stringValue(repository.default_branch);
        if (
          stringValue(repository.full_name)?.toLowerCase() !==
            expectedRepository.toLowerCase() ||
          !defaultBranch
        ) {
          return undefined;
        }

        const comparisonResponse = await request(
          `${baseUrl}/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}/compare/${encodeURIComponent(mergeSha)}...${encodeURIComponent(defaultBranch)}`,
          headers,
          fetcher,
          timeoutMs,
        );
        if (!comparisonResponse.ok) return undefined;
        const comparison =
          (await comparisonResponse.json()) as GitHubComparePayload;
        const mergeBaseSha = stringValue(comparison.merge_base_commit?.sha);
        if (
          mergeBaseSha?.toLowerCase() !== mergeSha.toLowerCase() ||
          (comparison.status !== "ahead" && comparison.status !== "identical")
        ) {
          return undefined;
        }

        const observedAt = now().toISOString();
        if (!Number.isFinite(Date.parse(observedAt))) return undefined;
        return {
          defaultBranch,
          mergeSha,
          mergedAt,
          observedAt,
          reachedDefaultBranch: true,
        };
      } catch {
        return undefined;
      }
    },
    async read(reference) {
      const fetchedAt = now().toISOString();
      if (!configuredToken) {
        return {
          checkRuns: [],
          checkRunsStatus: "not_requested",
          fetchedAt,
          status: "not_configured",
          workflowRuns: [],
          workflowRunsStatus: "not_requested",
          error: "GitHub credentials are not configured on the Factory server.",
        };
      }

      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${configuredToken}`,
        "X-GitHub-Api-Version": apiVersion,
      };
      const pullRequestPath = `/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}/pulls/${reference.number}`;

      let pullRequestResponse: Response;
      try {
        pullRequestResponse = await request(
          `${baseUrl}${pullRequestPath}`,
          headers,
          fetcher,
          timeoutMs,
        );
      } catch {
        return unavailableSnapshot(fetchedAt, "GitHub could not be reached.");
      }

      if (pullRequestResponse.status === 404) {
        return {
          checkRuns: [],
          checkRunsStatus: "not_requested",
          fetchedAt,
          status: "not_found",
          workflowRuns: [],
          workflowRunsStatus: "not_requested",
          error: "The pull request was not found or is not accessible.",
        };
      }
      if (
        pullRequestResponse.status === 401 ||
        pullRequestResponse.status === 403
      ) {
        return permissionDeniedSnapshot(fetchedAt);
      }
      if (!pullRequestResponse.ok) {
        return unavailableSnapshot(
          fetchedAt,
          `GitHub returned HTTP ${pullRequestResponse.status}.`,
        );
      }

      let payload: GitHubPullRequestPayload;
      try {
        payload =
          (await pullRequestResponse.json()) as GitHubPullRequestPayload;
      } catch {
        return unavailableSnapshot(
          fetchedAt,
          "GitHub returned an invalid pull request response.",
        );
      }
      const pullRequest = mapPullRequest(payload, reference);
      if (!pullRequest) {
        return unavailableSnapshot(
          fetchedAt,
          "GitHub returned an invalid pull request response.",
        );
      }

      const review = await readGitHubReviewStatus({
        apiBaseUrl: baseUrl,
        expectedHeadSha: pullRequest.headSha,
        fetcher,
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        reference,
        timeoutMs,
      });

      let workflowRunsResponse: Response;
      try {
        workflowRunsResponse = await request(
          `${baseUrl}/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}/actions/runs?head_sha=${encodeURIComponent(pullRequest.headSha)}&per_page=100`,
          headers,
          fetcher,
          timeoutMs,
        );
      } catch {
        return {
          checkRuns: [],
          checkRunsStatus: "not_requested",
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns: [],
          workflowRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub Actions could not be reached.",
        };
      }

      if (
        workflowRunsResponse.status === 401 ||
        workflowRunsResponse.status === 403
      ) {
        return {
          checkRuns: [],
          checkRunsStatus: "not_requested",
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns: [],
          workflowRunsStatus: "unavailable",
          error:
            "The pull request loaded, but Actions status is not accessible.",
        };
      }
      if (!workflowRunsResponse.ok) {
        return {
          checkRuns: [],
          checkRunsStatus: "not_requested",
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns: [],
          workflowRunsStatus: "unavailable",
          error: `The pull request loaded, but GitHub Actions returned HTTP ${workflowRunsResponse.status}.`,
        };
      }

      let runsPayload: GitHubWorkflowRunsPayload;
      try {
        runsPayload =
          (await workflowRunsResponse.json()) as GitHubWorkflowRunsPayload;
      } catch {
        return {
          checkRuns: [],
          checkRunsStatus: "not_requested",
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns: [],
          workflowRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub returned an invalid Actions response.",
        };
      }
      const workflowRuns = mapWorkflowRuns(runsPayload);
      const workflowRunsStatus =
        responseHasNextPage(workflowRunsResponse) ||
        !Array.isArray(runsPayload.workflow_runs) ||
        workflowRuns.length !== runsPayload.workflow_runs.length ||
        invalidTotalCount(runsPayload.total_count, runsPayload.workflow_runs) ||
        totalCountExceedsRows(
          runsPayload.total_count,
          runsPayload.workflow_runs,
        )
          ? "unavailable"
          : "ok";

      let checkRunsResponse: Response;
      try {
        checkRunsResponse = await request(
          `${baseUrl}/repos/${encodeURIComponent(reference.owner)}/${encodeURIComponent(reference.repo)}/commits/${encodeURIComponent(pullRequest.headSha)}/check-runs?per_page=100`,
          headers,
          fetcher,
          timeoutMs,
        );
      } catch {
        return {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          allCheckRuns: [],
          allCheckRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub check runs could not be reached.",
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns,
          workflowRunsStatus,
        };
      }

      if (
        checkRunsResponse.status === 401 ||
        checkRunsResponse.status === 403
      ) {
        return {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          allCheckRuns: [],
          allCheckRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub check runs are not accessible.",
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns,
          workflowRunsStatus,
        };
      }
      if (!checkRunsResponse.ok) {
        return {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          allCheckRuns: [],
          allCheckRunsStatus: "unavailable",
          error: `The pull request loaded, but GitHub check runs returned HTTP ${checkRunsResponse.status}.`,
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns,
          workflowRunsStatus,
        };
      }

      let checkRunsPayload: GitHubCheckRunsPayload;
      try {
        const checkRunsJson: unknown = await checkRunsResponse.json();
        if (!isRecord(checkRunsJson))
          throw new Error("Invalid check-runs payload.");
        checkRunsPayload = checkRunsJson as GitHubCheckRunsPayload;
      } catch {
        return {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          allCheckRuns: [],
          allCheckRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub returned an invalid check-runs response.",
          fetchedAt,
          pullRequest,
          review,
          status: "ok",
          workflowRuns,
          workflowRunsStatus,
        };
      }

      const allCheckRunProjection = mapAllCheckRuns(checkRunsPayload);
      const checkRunsIncomplete =
        !Array.isArray(checkRunsPayload.check_runs) ||
        responseHasNextPage(checkRunsResponse) ||
        invalidTotalCount(
          checkRunsPayload.total_count,
          checkRunsPayload.check_runs,
        ) ||
        totalCountExceedsRows(
          checkRunsPayload.total_count,
          checkRunsPayload.check_runs,
        );
      const allCheckRunsStatus =
        checkRunsIncomplete || !allCheckRunProjection.valid
          ? "unavailable"
          : "ok";

      return {
        checkRuns: mapCheckRuns(checkRunsPayload),
        checkRunsStatus: checkRunsIncomplete ? "unavailable" : "ok",
        allCheckRuns: allCheckRunProjection.runs,
        allCheckRunsStatus,
        fetchedAt,
        pullRequest,
        review,
        status: "ok",
        workflowRuns,
        workflowRunsStatus,
      };
    },
  };
}

const GITHUB_REVIEW_QUERY = `
  query PullRequestReviewSnapshot(
    $owner: String!
    $repo: String!
    $number: Int!
    $includeThreads: Boolean!
    $includeReviews: Boolean!
    $threadCursor: String
    $reviewCursor: String
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        headRefOid
        reviewThreads(first: 100, after: $threadCursor) @include(if: $includeThreads) {
          nodes { isResolved isOutdated }
          pageInfo { hasNextPage endCursor }
        }
        reviews(first: 100, after: $reviewCursor) @include(if: $includeReviews) {
          nodes {
            author { login }
            state
            commit { oid }
            submittedAt
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

const MAX_GITHUB_REVIEW_PAGES = 10;
const CODERABBIT_LOGINS = new Set(["coderabbitai", "coderabbitai[bot]"]);

type ReadGitHubReviewStatusOptions = {
  apiBaseUrl: string;
  expectedHeadSha: string;
  fetcher: Fetcher;
  headers: Record<string, string>;
  reference: GitHubPullRequestReference;
  timeoutMs: number;
};

async function readGitHubReviewStatus({
  apiBaseUrl,
  expectedHeadSha,
  fetcher,
  headers,
  reference,
  timeoutMs,
}: ReadGitHubReviewStatusOptions): Promise<
  NonNullable<GitHubStatusSnapshot["review"]>
> {
  const reviewHeaders = {
    ...headers,
    Accept: "application/vnd.github+json",
  };
  const url = githubGraphqlUrl(apiBaseUrl);
  let threadCursor: string | null = null;
  let reviewCursor: string | null = null;
  let includeThreads = true;
  let includeReviews = true;
  const seenThreadCursors = new Set<string>();
  const seenReviewCursors = new Set<string>();
  const threads: GitHubReviewThread[] = [];
  const reviews: GitHubReview[] = [];

  for (let page = 0; page < MAX_GITHUB_REVIEW_PAGES; page += 1) {
    let response: Response;
    try {
      response = await request(url, reviewHeaders, fetcher, timeoutMs, {
        method: "POST",
        body: JSON.stringify({
          query: GITHUB_REVIEW_QUERY,
          variables: {
            owner: reference.owner,
            repo: reference.repo,
            number: reference.number,
            includeThreads,
            includeReviews,
            threadCursor,
            reviewCursor,
          },
        }),
      });
    } catch {
      return unavailableReview(
        expectedHeadSha,
        "GitHub review data could not be reached.",
      );
    }

    if (!response.ok) {
      const message =
        response.status === 401 || response.status === 403
          ? "GitHub review data is not accessible."
          : `GitHub review data returned HTTP ${response.status}.`;
      return unavailableReview(expectedHeadSha, message);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return unavailableReview(
        expectedHeadSha,
        "GitHub returned an invalid review response.",
      );
    }
    if (!isRecord(payload)) {
      return unavailableReview(
        expectedHeadSha,
        "GitHub returned an invalid review response.",
      );
    }
    if (
      "errors" in payload &&
      (!Array.isArray(payload.errors) || payload.errors.length > 0)
    ) {
      return unavailableReview(
        expectedHeadSha,
        "GitHub could not provide complete review data.",
      );
    }
    const data = payload.data;
    if (
      !isRecord(data) ||
      !isRecord(data.repository) ||
      !isRecord(data.repository.pullRequest)
    ) {
      return unavailableReview(
        expectedHeadSha,
        "GitHub returned an invalid review response.",
      );
    }
    const pullRequest = data.repository.pullRequest;
    if (typeof pullRequest.headRefOid !== "string" || !pullRequest.headRefOid) {
      return unavailableReview(
        expectedHeadSha,
        "GitHub returned an invalid review response.",
      );
    }
    if (pullRequest.headRefOid !== expectedHeadSha) {
      return unavailableReview(
        expectedHeadSha,
        "GitHub review data does not match the pull request head.",
      );
    }

    let threadPage: GitHubReviewPageInfo | undefined;
    if (includeThreads) {
      const parsedThreads = parseReviewThreads(pullRequest.reviewThreads);
      if (!parsedThreads) {
        return unavailableReview(
          expectedHeadSha,
          "GitHub returned an invalid review-thread response.",
        );
      }
      threads.push(...parsedThreads.nodes);
      threadPage = parsedThreads.pageInfo;
    }

    let reviewsPage:
      | { nodes: GitHubReview[]; pageInfo: GitHubReviewPageInfo }
      | undefined;
    if (includeReviews) {
      reviewsPage = parseReviews(pullRequest.reviews);
      if (!reviewsPage) {
        return unavailableReview(
          expectedHeadSha,
          "GitHub returned an invalid review response.",
        );
      }
      reviews.push(...reviewsPage.nodes);
    }

    if (threadPage?.hasNextPage) {
      const cursor = threadPage.endCursor;
      if (!cursor || seenThreadCursors.has(cursor)) {
        return unavailableReview(
          expectedHeadSha,
          "GitHub review-thread pagination did not advance.",
        );
      }
      seenThreadCursors.add(cursor);
      threadCursor = cursor;
    } else {
      includeThreads = false;
    }

    if (reviewsPage?.pageInfo.hasNextPage) {
      const cursor = reviewsPage.pageInfo.endCursor;
      if (!cursor || seenReviewCursors.has(cursor)) {
        return unavailableReview(
          expectedHeadSha,
          "GitHub review pagination did not advance.",
        );
      }
      seenReviewCursors.add(cursor);
      reviewCursor = cursor;
    } else {
      includeReviews = false;
    }

    if (!includeThreads && !includeReviews) {
      return summarizeGitHubReview(expectedHeadSha, threads, reviews);
    }
  }

  return unavailableReview(
    expectedHeadSha,
    "GitHub review data exceeded the pagination limit.",
  );
}

function githubGraphqlUrl(apiBaseUrl: string): string {
  if (apiBaseUrl.endsWith("/api/v3")) {
    return apiBaseUrl.replace(/\/api\/v3$/, "/api/graphql");
  }
  return `${apiBaseUrl.replace(/\/$/, "")}/graphql`;
}

function parseReviewThreads(
  value: unknown,
): { nodes: GitHubReviewThread[]; pageInfo: GitHubReviewPageInfo } | undefined {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return undefined;
  const nodes: GitHubReviewThread[] = [];
  for (const node of value.nodes) {
    if (
      !isRecord(node) ||
      typeof node.isResolved !== "boolean" ||
      typeof node.isOutdated !== "boolean"
    ) {
      return undefined;
    }
    nodes.push({ isOutdated: node.isOutdated, isResolved: node.isResolved });
  }
  const pageInfo = parseReviewPageInfo(value.pageInfo);
  if (!pageInfo) return undefined;
  return { nodes, pageInfo };
}

function parseReviews(
  value: unknown,
): { nodes: GitHubReview[]; pageInfo: GitHubReviewPageInfo } | undefined {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return undefined;
  const nodes: GitHubReview[] = [];
  const allowedStates = new Set<GitHubReviewState>([
    "APPROVED",
    "CHANGES_REQUESTED",
    "COMMENTED",
    "DISMISSED",
    "PENDING",
  ]);
  for (const node of value.nodes) {
    if (!isRecord(node) || !isRecord(node.author)) return undefined;
    const author = stringValue(node.author.login);
    if (!author) return undefined;
    if (
      typeof node.state !== "string" ||
      !allowedStates.has(node.state as GitHubReviewState)
    ) {
      return undefined;
    }
    const state = node.state as GitHubReviewState;
    let commitSha: string | undefined;
    if (node.commit !== null) {
      if (!isRecord(node.commit)) return undefined;
      commitSha = stringValue(node.commit.oid);
      if (!commitSha) return undefined;
    } else if (state !== "PENDING") {
      return undefined;
    }
    let submittedAt: string | undefined;
    if (node.submittedAt !== null) {
      submittedAt = stringValue(node.submittedAt);
      if (!submittedAt || !Number.isFinite(Date.parse(submittedAt)))
        return undefined;
    } else if (state !== "PENDING") {
      return undefined;
    }
    nodes.push({ author, commitSha, state, submittedAt });
  }
  const pageInfo = parseReviewPageInfo(value.pageInfo);
  if (!pageInfo) return undefined;
  return { nodes, pageInfo };
}

function parseReviewPageInfo(value: unknown): GitHubReviewPageInfo | undefined {
  if (
    !isRecord(value) ||
    typeof value.hasNextPage !== "boolean" ||
    !(value.endCursor === null || typeof value.endCursor === "string")
  ) {
    return undefined;
  }
  return { endCursor: value.endCursor, hasNextPage: value.hasNextPage };
}

function summarizeGitHubReview(
  headSha: string,
  threads: GitHubReviewThread[],
  reviews: GitHubReview[],
): NonNullable<GitHubStatusSnapshot["review"]> {
  // A comment-only review does not supersede an author's latest decisive
  // approval or changes request. Keep CodeRabbit's comment completion signal
  // separate so it remains visible without clearing those decisions.
  const latestByAuthor = new Map<string, GitHubReview>();
  const latestCodeRabbitCommentByAuthor = new Map<string, GitHubReview>();
  for (const review of reviews) {
    if (
      review.commitSha !== headSha ||
      !review.submittedAt ||
      review.state === "PENDING"
    ) {
      continue;
    }
    const key = review.author.toLowerCase();
    const target =
      review.state === "COMMENTED"
        ? CODERABBIT_LOGINS.has(key)
          ? latestCodeRabbitCommentByAuthor
          : undefined
        : latestByAuthor;
    if (!target) continue;

    const previous = target.get(key);
    if (
      !previous ||
      Date.parse(review.submittedAt) >= Date.parse(previous.submittedAt ?? "")
    ) {
      target.set(key, review);
    }
  }

  const completedReviews = [...latestByAuthor.values()].filter(
    (review) =>
      review.state === "APPROVED" || review.state === "CHANGES_REQUESTED",
  );
  for (const comment of latestCodeRabbitCommentByAuthor.values()) {
    const decisive = latestByAuthor.get(comment.author.toLowerCase());
    if (
      !decisive ||
      Date.parse(comment.submittedAt ?? "") >
        Date.parse(decisive.submittedAt ?? "")
    ) {
      completedReviews.push(comment);
    }
  }
  const hasChangesRequested = completedReviews.some(
    (review) => review.state === "CHANGES_REQUESTED",
  );
  const hasApproval = completedReviews.some(
    (review) => review.state === "APPROVED",
  );
  const hasCodeRabbitComment = completedReviews.some(
    (review) => review.state === "COMMENTED",
  );
  const decision = hasChangesRequested
    ? "changes_requested"
    : hasApproval
      ? "approved"
      : hasCodeRabbitComment
        ? "commented"
        : "pending";
  const reviewers = [
    ...new Set(completedReviews.map((review) => review.author)),
  ].sort((left, right) => left.localeCompare(right));

  return {
    status: "ok",
    headSha,
    completed: completedReviews.length > 0,
    unresolvedThreads: threads.filter((thread) => !thread.isResolved).length,
    decision,
    reviewers,
  };
}

function unavailableReview(
  headSha: string,
  error: string,
): NonNullable<GitHubStatusSnapshot["review"]> {
  return {
    status: "unavailable",
    headSha,
    completed: false,
    decision: "pending",
    reviewers: [],
    error,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function request(
  url: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
  timeoutMs: number,
  options: Pick<RequestInit, "body" | "method"> = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function responseHasNextPage(response: Response): boolean {
  const link = response.headers.get("Link");
  if (!link) return false;
  return link
    .split(",")
    .some((part) => /(?:^|[;\s])rel="?next"?(?:[;\s]|$)/i.test(part));
}

function totalCountExceedsRows(totalCount: unknown, rows: unknown): boolean {
  return (
    typeof totalCount === "number" &&
    Number.isSafeInteger(totalCount) &&
    totalCount > (Array.isArray(rows) ? rows.length : 0)
  );
}

function invalidTotalCount(totalCount: unknown, rows: unknown): boolean {
  if (totalCount === undefined) return false;
  return (
    typeof totalCount !== "number" ||
    !Number.isSafeInteger(totalCount) ||
    totalCount < 0 ||
    (Array.isArray(rows) && totalCount < rows.length)
  );
}

function unavailableSnapshot(
  fetchedAt: string,
  error: string,
): GitHubStatusSnapshot {
  return {
    checkRuns: [],
    checkRunsStatus: "not_requested",
    error,
    fetchedAt,
    status: "unavailable",
    workflowRuns: [],
    workflowRunsStatus: "not_requested",
  };
}

function permissionDeniedSnapshot(fetchedAt: string): GitHubStatusSnapshot {
  return {
    checkRuns: [],
    checkRunsStatus: "not_requested",
    error: "GitHub denied access to this pull request.",
    fetchedAt,
    status: "permission_denied",
    workflowRuns: [],
    workflowRunsStatus: "not_requested",
  };
}

function mapPullRequest(
  payload: GitHubPullRequestPayload,
  reference: GitHubPullRequestReference,
): GitHubPullRequestStatus | undefined {
  const number = numberValue(payload.number);
  const state = stringValue(payload.state);
  const title = stringValue(payload.title);
  const url = stringValue(payload.html_url) ?? reference.url;
  const headBranch = stringValue(payload.head?.ref);
  const headSha = stringValue(payload.head?.sha);
  const baseBranch = stringValue(payload.base?.ref);
  const updatedAt = stringValue(payload.updated_at);
  if (
    number === undefined ||
    (state !== "open" && state !== "closed") ||
    !title ||
    !headBranch ||
    !headSha ||
    !baseBranch ||
    !updatedAt
  ) {
    return undefined;
  }

  return {
    baseBranch,
    draft: payload.draft === true,
    headSha,
    headBranch,
    mergeable:
      payload.mergeable === true || payload.mergeable === false
        ? payload.mergeable
        : null,
    ...(stringValue(payload.mergeable_state)
      ? { mergeableState: stringValue(payload.mergeable_state) }
      : {}),
    mergedAt: stringValue(payload.merged_at),
    mergeSha: stringValue(payload.merge_commit_sha),
    number,
    state,
    title,
    updatedAt,
    url,
    user: stringValue(payload.user?.login),
  };
}

function mapWorkflowRuns(
  payload: GitHubWorkflowRunsPayload,
): GitHubWorkflowRunStatus[] {
  if (!Array.isArray(payload.workflow_runs)) return [];
  return payload.workflow_runs.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const run = candidate;
    const id = numberValue(run.id);
    const name = stringValue(run.name);
    const status = stringValue(run.status);
    const createdAt = stringValue(run.created_at);
    const updatedAt = stringValue(run.updated_at);
    const url = stringValue(run.html_url);
    if (!id || !name || !status || !createdAt || !updatedAt || !url) return [];
    return [
      {
        ...(stringValue(run.conclusion)
          ? { conclusion: stringValue(run.conclusion) }
          : {}),
        createdAt,
        ...(stringValue(run.event) ? { event: stringValue(run.event) } : {}),
        id,
        name,
        ...(numberValue(run.run_number) !== undefined
          ? { runNumber: numberValue(run.run_number) }
          : {}),
        status,
        updatedAt,
        url,
        ...(stringValue(run.workflow_name)
          ? { workflowName: stringValue(run.workflow_name) }
          : {}),
      },
    ];
  });
}

function mapAllCheckRuns(payload: GitHubCheckRunsPayload): {
  runs: GitHubCheckRunStatus[];
  valid: boolean;
} {
  if (!Array.isArray(payload.check_runs)) return { runs: [], valid: false };
  const runs: GitHubCheckRunStatus[] = [];
  let valid = true;
  for (const candidate of payload.check_runs) {
    const run = mapAllCheckRun(candidate);
    if (!run) {
      valid = false;
      continue;
    }
    runs.push(run);
  }
  return { runs, valid };
}

function mapAllCheckRun(candidate: unknown): GitHubCheckRunStatus | undefined {
  if (!isRecord(candidate)) return undefined;
  const appValue = candidate.app;
  let appSlug: string | undefined;
  if (appValue !== undefined && appValue !== null) {
    if (!isRecord(appValue)) return undefined;
    if (appValue.slug !== undefined && appValue.slug !== null) {
      appSlug = stringValue(appValue.slug);
      if (!appSlug) return undefined;
    }
  }

  const id = numberValue(candidate.id);
  const name = stringValue(candidate.name);
  const status = stringValue(candidate.status);
  const createdAt = stringValue(candidate.started_at);
  const url = stringValue(candidate.html_url);
  const completedAt = optionalString(candidate.completed_at);
  const conclusion = optionalString(candidate.conclusion);
  if (
    !id ||
    !name ||
    !status ||
    !createdAt ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !url ||
    !isHttpUrl(url) ||
    (completedAt !== null &&
      completedAt !== undefined &&
      !Number.isFinite(Date.parse(completedAt))) ||
    (completedAt === undefined &&
      candidate.completed_at !== undefined &&
      candidate.completed_at !== null) ||
    (conclusion === undefined &&
      candidate.conclusion !== undefined &&
      candidate.conclusion !== null)
  ) {
    return undefined;
  }
  return {
    ...(appSlug ? { appSlug } : {}),
    ...(conclusion ? { conclusion } : {}),
    createdAt,
    id,
    name,
    status,
    updatedAt: completedAt ?? createdAt,
    url,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return typeof value === "string" && value ? value : undefined;
}

function mapCheckRuns(payload: GitHubCheckRunsPayload): GitHubCheckRunStatus[] {
  if (!Array.isArray(payload.check_runs)) return [];
  return payload.check_runs.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const run = candidate;
    const app = isRecord(run.app) ? run.app : undefined;
    const appSlug = stringValue(app?.slug);
    if (appSlug && appSlug !== "github-actions") return [];

    const id = numberValue(run.id);
    const name = stringValue(run.name);
    const status = stringValue(run.status);
    const createdAt = stringValue(run.started_at);
    const completedAt = stringValue(run.completed_at);
    const url = stringValue(run.html_url);
    if (!id || !name || !status || !createdAt || !url) return [];
    return [
      {
        ...(appSlug ? { appSlug } : {}),
        ...(stringValue(run.conclusion)
          ? { conclusion: stringValue(run.conclusion) }
          : {}),
        createdAt,
        id,
        name,
        status,
        updatedAt: completedAt ?? createdAt,
        url,
      },
    ];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}
