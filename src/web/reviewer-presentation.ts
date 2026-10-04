export type VerificationAttributionInput = {
  decision: "accepted" | "rejected" | "deferred" | string;
  source?: "human" | "reviewer" | "pr_merge" | string;
  verifier?: string;
};

export function verificationAttribution({
  decision,
  source,
  verifier,
}: VerificationAttributionInput): string {
  const actor =
    source === "pr_merge"
      ? "PR Merge"
      : verifier?.trim() || (source === "reviewer" ? "Reviewer" : "Human");
  return `${decision} by ${actor}`;
}

export type MergeReconciliationResult = {
  reconciled: boolean;
  reason: string;
  mergeSha?: string;
  mergedAt?: string | Date;
};

export function mergeReconciliationMessage(
  result: MergeReconciliationResult,
): string {
  if (!result.reconciled) return result.reason;
  const revision = result.mergeSha ? ` (${result.mergeSha.slice(0, 12)})` : "";
  return `Merged PR reconciled${revision}. ${result.reason}`;
}

export type ReviewScreenshotLink = {
  screenshotId: string;
  anchorId: string;
};

export function resolveReviewScreenshotLinks(
  screenshotIds: readonly string[],
  ownScreenshotAnchors: Readonly<Record<string, string>>,
  parentScreenshotAnchors: Readonly<Record<string, string>> = {},
): { links: ReviewScreenshotLink[]; unavailableCount: number } {
  const links: ReviewScreenshotLink[] = [];
  for (const screenshotId of screenshotIds) {
    const anchorId =
      ownScreenshotAnchors[screenshotId] ??
      parentScreenshotAnchors[screenshotId];
    if (anchorId) links.push({ screenshotId, anchorId });
  }
  return {
    links,
    unavailableCount: screenshotIds.length - links.length,
  };
}
