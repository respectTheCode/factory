import type { IssuePullRequest } from "../issues";

function isConfirmedResolved(pullRequest: IssuePullRequest): boolean {
  return (
    pullRequest.merged ||
    pullRequest.state === "merged" ||
    pullRequest.state === "closed"
  );
}

export function issueHasUnresolvedPullRequests(
  currentUrls: readonly string[],
  existingPullRequests: readonly IssuePullRequest[],
): boolean {
  const pullRequestsByUrl = new Map(
    existingPullRequests.map((pullRequest) => [pullRequest.url, pullRequest]),
  );
  return (
    existingPullRequests.some(
      (pullRequest) => !isConfirmedResolved(pullRequest),
    ) ||
    currentUrls.some((url) => {
      const pullRequest = pullRequestsByUrl.get(url);
      return !pullRequest || !isConfirmedResolved(pullRequest);
    })
  );
}
