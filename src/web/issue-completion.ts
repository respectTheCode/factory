import type { IssuePullRequest } from "../issues";

function isConfirmedMerged(pullRequest: IssuePullRequest): boolean {
  return pullRequest.merged || pullRequest.state === "merged";
}

export function issueNeedsMergedPullRequestsForDone(
  currentUrls: readonly string[],
  existingPullRequests: readonly IssuePullRequest[],
): boolean {
  const pullRequestsByUrl = new Map(
    existingPullRequests.map((pullRequest) => [pullRequest.url, pullRequest]),
  );
  return (
    existingPullRequests.some(
      (pullRequest) => !isConfirmedMerged(pullRequest),
    ) ||
    currentUrls.some((url) => {
      const pullRequest = pullRequestsByUrl.get(url);
      return !pullRequest || !isConfirmedMerged(pullRequest);
    })
  );
}
