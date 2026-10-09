import { useEffect, useRef, useState } from "react";
import { focusWorkflowControl } from "./workflow-focus";
import type { GitHubStatusSnapshot } from "../github";
import type { RequiredPullRequest } from "./workflow-panel";
import {
  elapsedLabel,
  evaluateCheckState,
  evaluateReviewState,
} from "./task-tracking";

export function prPresentation(
  row: RequiredPullRequest,
  snapshot?: GitHubStatusSnapshot,
  testedRevision?: string,
  now = new Date(),
) {
  const age = snapshot
    ? now.getTime() - new Date(snapshot.fetchedAt).getTime()
    : undefined;
  const stale =
    age !== undefined &&
    (!Number.isFinite(age) || age > 15 * 60_000 || age < -5000);
  const pr = snapshot?.pullRequest;
  const label = row.merge
    ? "MERGED"
    : stale
      ? "STALE"
      : snapshot?.status === "not_configured"
        ? "CAN'T CHECK"
        : snapshot?.status === "not_found"
          ? "NOT FOUND"
          : snapshot?.status === "permission_denied"
            ? "NO ACCESS"
            : !snapshot || snapshot.status !== "ok"
              ? "UNAVAILABLE"
              : pr?.mergedAt
                ? "MERGED · WAITING"
                : pr?.draft
                  ? "DRAFT"
                  : pr?.state === "closed"
                    ? "CLOSED"
                    : "OPEN";
  const head = pr?.headSha;
  const checks = evaluateCheckState(snapshot, testedRevision, now);
  const review = evaluateReviewState(
    snapshot?.review,
    head,
    testedRevision,
    snapshot,
    now,
  );
  const changedHead = Boolean(
    testedRevision && head && testedRevision !== head,
  );
  const unavailableProof =
    label === "CAN'T CHECK"
      ? "Factory can't confirm merges until GitHub is connected."
      : label === "UNAVAILABLE"
        ? "GitHub evidence is unavailable. Try again."
        : label === "NOT FOUND"
          ? "PR not found. Check its URL."
          : label === "NO ACCESS"
            ? "Factory has no access to this PR."
            : undefined;
  const proof = row.merge
    ? `${row.merge.mergeSha.slice(0, 7)} · reached ${row.merge.defaultBranch}`
    : pr?.state === "closed" && !pr.mergedAt
      ? "Closed without merging"
      : pr?.mergedAt
        ? `Waiting for this PR's code to reach the default branch`
        : `${checks === "passing" ? "checks passing" : checks === "failing" ? "checks failing" : checks === "pending" ? "checks pending" : "checks not confirmed on this head"} · ${review === "finished" ? "reviewed this head" : snapshot?.review?.headSha && snapshot.review.headSha !== head ? `reviewed ${snapshot.review.headSha.slice(0, 7)} · not this head` : "review not confirmed on this head"} · ${review === "finished" ? `${snapshot?.review?.unresolvedThreads ?? "unknown"} open threads` : "threads not confirmed on this head"} · head ${head?.slice(0, 7) || "unknown"}`;
  return {
    label,
    proof: row.mergedBeforeReopen
      ? "Merged before reopen · not required"
      : stale && !row.merge
        ? "Observation is stale. Refresh before relying on this evidence."
        : (unavailableProof ??
          `${proof}${changedHead ? ` · reported ready at ${testedRevision!.slice(0, 7)} · new commits on ${head!.slice(0, 7)}` : ""}`),
    changedHead,
    tone:
      label === "MERGED"
        ? "ok"
        : ["CLOSED", "NOT FOUND", "NO ACCESS"].includes(label)
          ? "down"
          : ["STALE", "UNAVAILABLE", "CAN'T CHECK"].includes(label) ||
              changedHead
            ? "warn"
            : "neutral",
  };
}

export function WorkflowPullRequests({
  rows,
  statuses,
  testedRevision,
  onDraftRequired,
  disabled,
  onLink,
  onRefresh,
  linkRequest,
  taskPullRequestUrl,
  taskPullRequestRequired,
  snapshotRevision,
}: {
  taskPullRequestUrl?: string;
  taskPullRequestRequired?: boolean;
  snapshotRevision?: number;
  linkRequest?: number;
  rows: RequiredPullRequest[];
  statuses: Readonly<Record<string, GitHubStatusSnapshot | undefined>>;
  testedRevision?: string;
  onDraftRequired?: (pullRequestUrl: string, required: boolean) => void;
  disabled: boolean;
  onLink: (url: string, expectedRevision: number) => Promise<unknown>;
  onRefresh: () => void;
}) {
  return (
    <div className="workflow-prs">
      {rows.length ? (
        rows.map((row) => {
          const snapshot =
            statuses[row.pullRequestUrl] ??
            row.sources
              .map(
                (source) =>
                  statuses[
                    `${source.kind === "step" ? "subtask" : "task"}:${source.id}`
                  ],
              )
              .find(Boolean);
          const view = prPresentation(row, snapshot, testedRevision);
          return (
            <div className="workflow-pr-row" key={row.pullRequestUrl}>
              <div>
                <a href={row.pullRequestUrl} rel="noreferrer" target="_blank">
                  PR #{row.pullRequestUrl.split("/").pop()} ↗
                </a>
                {snapshot?.pullRequest?.title && (
                  <span> · {snapshot.pullRequest.title}</span>
                )}{" "}
                <span className={`workflow-chip ${view.tone}`}>
                  {view.label}
                </span>
                <small
                  className={view.changedHead ? "workflow-warning" : undefined}
                >
                  {view.proof}
                  {snapshot?.fetchedAt
                    ? ` · observed ${elapsedLabel(snapshot.fetchedAt)}`
                    : ""}
                </small>
                {(view.label === "STALE" || view.label === "UNAVAILABLE") && (
                  <button
                    type="button"
                    className="workflow-text-button"
                    onClick={onRefresh}
                  >
                    {view.label === "STALE" ? "Check now" : "Try again"}
                  </button>
                )}
                {view.label === "CAN'T CHECK" && (
                  <a href="/connections">Open Connections</a>
                )}
              </div>
              {onDraftRequired ? (
                <label>
                  <input
                    data-pr-url={row.pullRequestUrl}
                    type="checkbox"
                    title={
                      disabled ? "Reconnect to Factory to edit" : undefined
                    }
                    disabled={disabled || row.mergedBeforeReopen}
                    checked={row.required}
                    aria-label={`required: PR #${row.pullRequestUrl.split("/").pop()}`}
                    onChange={(event) =>
                      onDraftRequired(row.pullRequestUrl, event.target.checked)
                    }
                  />{" "}
                  required
                </label>
              ) : (
                <span className="workflow-pr-requirement">
                  {row.required ? "required" : "optional"}
                </span>
              )}
            </div>
          );
        })
      ) : (
        <p className="workflow-muted">No PR is linked yet.</p>
      )}
      {!onDraftRequired && (
        <LinkPullRequest
          disabled={disabled}
          onLink={onLink}
          openRequest={linkRequest}
          currentTaskUrl={taskPullRequestUrl}
          currentRequired={taskPullRequestRequired}
          snapshotRevision={snapshotRevision}
        />
      )}
    </div>
  );
}
function LinkPullRequest({
  disabled,
  onLink,
  openRequest,
  currentTaskUrl,
  currentRequired,
  snapshotRevision,
}: {
  openRequest?: number;
  disabled: boolean;
  onLink: (url: string, expectedRevision: number) => Promise<unknown>;
  currentTaskUrl?: string;
  currentRequired?: boolean;
  snapshotRevision?: number;
}) {
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState<{
    revision?: number;
    url?: string;
    required?: boolean;
  }>({});
  const input = useRef<HTMLInputElement>(null);
  const reveal = () => {
    setOpening({
      revision: snapshotRevision,
      url: currentTaskUrl,
      required: currentRequired,
    });
    setError("");
    setOpen(true);
  };
  useEffect(() => {
    if (openRequest) reveal();
  }, [openRequest]);
  useEffect(() => {
    if (open) focusWorkflowControl(input.current);
  }, [open, openRequest]);
  const stale =
    opening.revision !== snapshotRevision || opening.url !== currentTaskUrl;
  const available =
    typeof snapshotRevision === "number" &&
    Number.isSafeInteger(snapshotRevision) &&
    snapshotRevision >= 1;
  return (
    <>
      {!open ? (
        <button
          type="button"
          className="workflow-text-button workflow-link-pr"
          title={
            !available
              ? "Refresh Factory before editing this PR"
              : disabled
                ? "Reconnect to Factory to edit"
                : undefined
          }
          disabled={disabled || !available}
          onClick={reveal}
        >
          {currentTaskUrl
            ? `Replace Task PR #${currentTaskUrl.split("/").pop()}`
            : "Link a PR"}
        </button>
      ) : (
        <TaskPullRequestLinkForm
          oldUrl={opening.url}
          oldRequired={opening.required}
          url={url}
          onUrl={setUrl}
          inputRef={input}
          disabled={disabled || saving || !available || stale}
          saving={saving}
          stale={stale}
          onCancel={() => setOpen(false)}
          onSubmit={() => {
            const expectedRevision = opening.revision;
            if (expectedRevision === undefined || stale || !available) return;
            setSaving(true);
            setError("");
            void onLink(url.trim(), expectedRevision)
              .then(() => {
                setUrl("");
                setOpen(false);
              })
              .catch((err) =>
                setError(
                  err instanceof Error ? err.message : "Couldn't link the PR.",
                ),
              )
              .finally(() => setSaving(false));
          }}
        />
      )}
      {error && (
        <p role="alert" className="workflow-error">
          {error}
        </p>
      )}
    </>
  );
}
export function TaskPullRequestLinkForm({
  oldUrl,
  oldRequired,
  url,
  onUrl,
  inputRef,
  disabled,
  saving,
  stale,
  onSubmit,
  onCancel,
}: {
  oldUrl?: string;
  oldRequired?: boolean;
  url: string;
  onUrl: (url: string) => void;
  inputRef?: import("react").Ref<HTMLInputElement>;
  disabled: boolean;
  saving: boolean;
  stale: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="workflow-pr-link-form"
      aria-label={
        oldUrl
          ? `Replace Task PR #${oldUrl.split("/").pop()}`
          : "Link a Task PR"
      }
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && url.trim()) onSubmit();
      }}
    >
      {oldUrl && (
        <>
          <p>Replaces PR #{oldUrl.split("/").pop()} on this Task.</p>
          <a href={oldUrl} target="_blank" rel="noreferrer">
            {oldUrl}
          </a>
          {oldRequired && (
            <p className="workflow-warning">
              Replacing this required link may finish this Task if every
              remaining required PR has a confirmed merge to the default branch.
            </p>
          )}
        </>
      )}
      {stale && (
        <p role="alert" className="workflow-warning">
          This Task changed while you were editing. Cancel and reopen the PR
          form before saving.
        </p>
      )}
      <input
        ref={inputRef}
        type="url"
        required
        autoFocus
        aria-label="Pull request URL"
        value={url}
        disabled={saving}
        onChange={(event) => onUrl(event.target.value)}
      />
      <div className="workflow-dialog-actions">
        <button type="submit" disabled={disabled || !url.trim()}>
          {saving ? "Saving…" : oldUrl ? "Replace PR" : "Link"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export function taskPRWaitingCopy(
  rows: RequiredPullRequest[],
  statuses: Record<string, GitHubStatusSnapshot | undefined>,
  testedRevision?: string,
) {
  const required = rows.filter((row) => row.required && !row.merge);
  if (!required.length) return undefined;
  return required
    .map((row) => {
      const snapshot =
        statuses[row.pullRequestUrl] ??
        row.sources
          .map(
            (source) =>
              statuses[
                `${source.kind === "step" ? "subtask" : "task"}:${source.id}`
              ],
          )
          .find(Boolean);
      const view = prPresentation(row, snapshot, testedRevision);
      const number = row.pullRequestUrl.split("/").pop();
      if (view.label === "MERGED · WAITING")
        return `PR #${number} merged into ${snapshot?.pullRequest?.baseBranch ?? "its base branch"}. Waiting for its code to reach the default branch.`;
      if (view.label === "CAN'T CHECK")
        return "Factory can't confirm merges until GitHub is connected.";
      if (view.label === "NOT FOUND")
        return `PR #${number} was not found. Check its URL or link another PR.`;
      if (view.label === "NO ACCESS")
        return `Factory has no access to PR #${number}. Check GitHub access or link another PR.`;
      if (view.label === "CLOSED")
        return `PR #${number} closed without merging.`;
      if (view.changedHead)
        return `PR #${number} has new commits since the agent reported ready at ${testedRevision?.slice(0, 7)}.`;
      if (view.label === "OPEN" || view.label === "DRAFT")
        return `Waiting for required PR #${number} to merge and reach the default branch.`;
      return `PR #${number}: ${view.label.toLowerCase()}. Refresh its evidence before relying on it.`;
    })
    .join(" ");
}

export function requiredPullRequestSummary(
  rows: RequiredPullRequest[],
  statuses: Record<string, GitHubStatusSnapshot | undefined>,
  taskCompleted: boolean,
  testedRevision?: string,
  now = new Date(),
) {
  const required = rows.filter(
    (row) => row.required && !row.mergedBeforeReopen,
  );
  if (!required.length)
    return { text: "No required PR", tone: "neutral", url: undefined };
  const merged = required.filter((row) => row.merge).length;
  const first = required.find((row) => !row.merge) ?? required[0]!;
  const snapshot =
    statuses[first.pullRequestUrl] ??
    first.sources
      .map(
        (source) =>
          statuses[
            `${source.kind === "step" ? "subtask" : "task"}:${source.id}`
          ],
      )
      .find(Boolean);
  const view = prPresentation(first, snapshot, testedRevision, now);
  const suffix =
    required.length > 1
      ? ` · ${merged} of ${required.length} merged${required.length - merged > 1 ? ` · +${required.length - merged - 1} required` : ""}`
      : "";
  return {
    text: `PR #${first.pullRequestUrl.split("/").pop()} ${view.label.toLowerCase()}${suffix}`,
    tone:
      taskCompleted && merged === required.length
        ? "ok"
        : view.tone === "ok"
          ? "neutral"
          : view.tone,
    url: first.pullRequestUrl,
  };
}
