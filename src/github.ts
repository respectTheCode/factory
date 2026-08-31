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
  workflowRuns: GitHubWorkflowRunStatus[];
  workflowRunsStatus: "not_requested" | "ok" | "unavailable";
};

export type GitHubStatusReader = {
  read: (
    reference: GitHubPullRequestReference,
  ) => Promise<GitHubStatusSnapshot>;
};

type GitHubPullRequestPayload = {
  base?: { ref?: unknown };
  draft?: unknown;
  head?: { ref?: unknown; sha?: unknown };
  html_url?: unknown;
  mergeable?: unknown;
  mergeable_state?: unknown;
  merged_at?: unknown;
  number?: unknown;
  state?: unknown;
  title?: unknown;
  updated_at?: unknown;
  user?: { login?: unknown };
};

type GitHubWorkflowRunsPayload = {
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
          status: "ok",
          workflowRuns: [],
          workflowRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub returned an invalid Actions response.",
        };
      }
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
          error:
            "The pull request loaded, but GitHub check runs could not be reached.",
          fetchedAt,
          pullRequest,
          status: "ok",
          workflowRuns: mapWorkflowRuns(runsPayload),
          workflowRunsStatus: "ok",
        };
      }

      if (
        checkRunsResponse.status === 401 ||
        checkRunsResponse.status === 403
      ) {
        return {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub check runs are not accessible.",
          fetchedAt,
          pullRequest,
          status: "ok",
          workflowRuns: mapWorkflowRuns(runsPayload),
          workflowRunsStatus: "ok",
        };
      }
      if (!checkRunsResponse.ok) {
        return {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          error: `The pull request loaded, but GitHub check runs returned HTTP ${checkRunsResponse.status}.`,
          fetchedAt,
          pullRequest,
          status: "ok",
          workflowRuns: mapWorkflowRuns(runsPayload),
          workflowRunsStatus: "ok",
        };
      }

      let checkRunsPayload: GitHubCheckRunsPayload;
      try {
        checkRunsPayload =
          (await checkRunsResponse.json()) as GitHubCheckRunsPayload;
      } catch {
        return {
          checkRuns: [],
          checkRunsStatus: "unavailable",
          error:
            "The pull request loaded, but GitHub returned an invalid check-runs response.",
          fetchedAt,
          pullRequest,
          status: "ok",
          workflowRuns: mapWorkflowRuns(runsPayload),
          workflowRunsStatus: "ok",
        };
      }

      return {
        checkRuns: mapCheckRuns(checkRunsPayload),
        checkRunsStatus: "ok",
        fetchedAt,
        pullRequest,
        status: "ok",
        workflowRuns: mapWorkflowRuns(runsPayload),
        workflowRunsStatus: "ok",
      };
    },
  };
}

async function request(
  url: string,
  headers: Record<string, string>,
  fetcher: Fetcher,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
  return (payload.workflow_runs ?? []).flatMap((run) => {
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

function mapCheckRuns(payload: GitHubCheckRunsPayload): GitHubCheckRunStatus[] {
  return (payload.check_runs ?? []).flatMap((run) => {
    const appSlug = stringValue(run.app?.slug);
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
