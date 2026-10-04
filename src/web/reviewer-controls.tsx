import { createTRPCProxyClient } from "@trpc/client";
import { useEffect, useState, type FormEvent } from "react";

import type { FactoryRouter } from "../server";
import { screenshotAnchorId } from "./screenshot-proof";
import type { ScreenshotEvidenceSummary } from "../screenshot-evidence";

import {
  mergeReconciliationMessage,
  resolveReviewScreenshotLinks,
  verificationAttribution,
  type MergeReconciliationResult,
} from "./reviewer-presentation";

type TRPCClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;

export type ReviewerIdentity = {
  id: string;
  reviewerName: string;
  machineId: string;
  createdAt: string | Date;
};

export type ReviewerAssignment = {
  targetType: "task" | "subtask";
  targetId: string;
  reviewerCredentialId: string;
  reviewerName: string;
  machineId: string;
  assignedBy: string;
  assignedAt: string | Date;
};

export type VerificationSummary = {
  decision: "accepted" | "rejected" | "deferred" | string;
  source?: "human" | "reviewer" | "pr_merge" | string;
  verifier?: string;
  reportText?: string;
  reason?: string;
  screenshotIds?: string[];
  mergeSha?: string;
  mergedAt?: string | Date;
};

export function ReviewerControls({
  canManage,
  client,
  disabled,
  kind,
  onRefresh,
  onAssignmentChanged,
  assignmentGeneration,
  pullRequestUrl,
  reviewers,
  reviewersError,
  reviewersLoading,
  screenshots,
  screenshotAnchorPrefix,
  parentScreenshotAnchors,
  targetId,
  parentTaskId,
  verification,
}: {
  canManage: boolean;
  client: TRPCClient | null;
  disabled: boolean;
  kind: "task" | "subtask";
  onRefresh: () => Promise<void>;
  onAssignmentChanged: () => void;
  assignmentGeneration: number;
  pullRequestUrl?: string;
  reviewers: ReviewerIdentity[] | null;
  reviewersError: string | null;
  reviewersLoading: boolean;
  screenshots: ScreenshotEvidenceSummary[];
  screenshotAnchorPrefix: string;
  parentScreenshotAnchors?: Readonly<Record<string, string>>;
  targetId: string;
  parentTaskId?: string;
  verification?: VerificationSummary;
}) {
  const [assignment, setAssignment] = useState<ReviewerAssignment | null>(null);
  const [parentAssignment, setParentAssignment] =
    useState<ReviewerAssignment | null>(null);
  const [assignmentLoading, setAssignmentLoading] = useState(true);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [selectedReviewerId, setSelectedReviewerId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileMessage, setReconcileMessage] = useState<string | null>(null);
  const [reconcileError, setReconcileError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const loadAssignment = async () => {
    if (!client) return;
    setAssignmentLoading(true);
    setAssignmentError(null);
    try {
      if (kind === "task") {
        const result = await client.tasks.reviewerAssignment.query({
          taskId: targetId,
        });
        setAssignment(result as ReviewerAssignment | null);
        setParentAssignment(null);
      } else {
        const [result, parentResult] = await Promise.all([
          client.subtasks.reviewerAssignment.query({ subtaskId: targetId }),
          parentTaskId
            ? client.tasks.reviewerAssignment.query({ taskId: parentTaskId })
            : Promise.resolve(null),
        ]);
        setAssignment(result as ReviewerAssignment | null);
        setParentAssignment(parentResult as ReviewerAssignment | null);
      }
    } catch (error: unknown) {
      setAssignmentError(
        error instanceof Error
          ? error.message
          : "Reviewer assignment could not be loaded.",
      );
    } finally {
      setAssignmentLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    if (!client) {
      setAssignment(null);
      setParentAssignment(null);
      setAssignmentLoading(false);
      setAssignmentError("Factory connection is unavailable.");
      return;
    }
    setAssignmentLoading(true);
    setAssignmentError(null);
    const load = async () => {
      try {
        if (kind === "task") {
          const result = await client.tasks.reviewerAssignment.query({
            taskId: targetId,
          });
          if (active) {
            setAssignment(result as ReviewerAssignment | null);
            setParentAssignment(null);
          }
        } else {
          const [result, parentResult] = await Promise.all([
            client.subtasks.reviewerAssignment.query({ subtaskId: targetId }),
            parentTaskId
              ? client.tasks.reviewerAssignment.query({ taskId: parentTaskId })
              : Promise.resolve(null),
          ]);
          if (active) {
            setAssignment(result as ReviewerAssignment | null);
            setParentAssignment(parentResult as ReviewerAssignment | null);
          }
        }
      } catch (error: unknown) {
        if (!active) return;
        setAssignmentError(
          error instanceof Error
            ? error.message
            : "Reviewer assignment could not be loaded.",
        );
      } finally {
        if (active) setAssignmentLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, kind, parentTaskId, targetId, assignmentGeneration]);

  useEffect(() => {
    setSelectedReviewerId(assignment?.reviewerCredentialId ?? "");
  }, [assignment?.reviewerCredentialId]);

  const assignReviewer = async (event: FormEvent) => {
    event.preventDefault();
    if (!client || !canManage || disabled || assigning) return;
    if (selectedReviewerId === (assignment?.reviewerCredentialId ?? "")) return;
    setAssigning(true);
    setAssignError(null);
    try {
      if (kind === "task") {
        await client.tasks.assignReviewer.mutate({
          reviewerCredentialId: selectedReviewerId || null,
          taskId: targetId,
        });
      } else {
        await client.subtasks.assignReviewer.mutate({
          reviewerCredentialId: selectedReviewerId || null,
          subtaskId: targetId,
        });
      }
      await loadAssignment();
      onAssignmentChanged();
    } catch (error: unknown) {
      setAssignError(
        error instanceof Error
          ? error.message
          : "Reviewer assignment could not be saved.",
      );
    } finally {
      setAssigning(false);
    }
  };

  const reconcileMergedPullRequest = async () => {
    if (!client || !canManage || disabled || reconciling || !pullRequestUrl)
      return;
    setReconciling(true);
    setReconcileMessage(null);
    setReconcileError(null);
    setRefreshError(null);
    try {
      const result =
        kind === "task"
          ? await client.tasks.reconcileMergedPullRequest.mutate({
              taskId: targetId,
            })
          : await client.subtasks.reconcileMergedPullRequest.mutate({
              subtaskId: targetId,
            });
      const display = result as MergeReconciliationResult;
      setReconcileMessage(mergeReconciliationMessage(display));
      if (display.reconciled) {
        try {
          await onRefresh();
        } catch (error: unknown) {
          setRefreshError(
            error instanceof Error
              ? error.message
              : "The task data could not be refreshed after reconciliation.",
          );
        }
      }
    } catch (error: unknown) {
      setReconcileError(
        error instanceof Error
          ? error.message
          : "Merged pull request status could not be checked.",
      );
    } finally {
      setReconciling(false);
    }
  };

  const heading = kind === "task" ? "Task review" : "Subtask review";
  const blankAssignmentLabel =
    kind === "subtask" && parentAssignment
      ? "Inherit task reviewer"
      : "No reviewer assigned";
  const ownScreenshotAnchors = Object.fromEntries(
    screenshots.map((screenshot) => [
      screenshot.id,
      screenshotAnchorId(screenshot.id, screenshotAnchorPrefix),
    ]),
  );
  const reviewScreenshotLinks = resolveReviewScreenshotLinks(
    verification?.screenshotIds ?? [],
    ownScreenshotAnchors,
    parentScreenshotAnchors,
  );
  const canSaveAssignment =
    canManage &&
    !disabled &&
    !assigning &&
    !assignmentLoading &&
    !assignmentError &&
    !reviewersLoading &&
    selectedReviewerId !== (assignment?.reviewerCredentialId ?? "") &&
    (selectedReviewerId === "" ||
      reviewers?.some((reviewer) => reviewer.id === selectedReviewerId));

  return (
    <section aria-label={heading} className="reviewer-controls">
      <div className="reviewer-controls-heading">
        <strong>{heading}</strong>
        {verification && (
          <span
            className={`review-decision review-decision-${verification.decision}`}
          >
            {verificationAttribution(verification)}
          </span>
        )}
      </div>

      {verification ? (
        <div className="review-verification">
          {(verification.reportText ?? verification.reason) && (
            <p>
              <strong>Review report / what was tested:</strong>{" "}
              {verification.reportText ?? verification.reason}
            </p>
          )}
          {verification.mergeSha && (
            <p>
              <strong>Merge commit:</strong>{" "}
              <code>{verification.mergeSha}</code>
              {verification.mergedAt
                ? ` · ${new Date(verification.mergedAt).toLocaleString()}`
                : ""}
            </p>
          )}
          {verification.screenshotIds &&
            verification.screenshotIds.length > 0 && (
              <p className="review-screenshot-links">
                <strong>Review screenshots:</strong>{" "}
                {reviewScreenshotLinks.links.map(
                  ({ screenshotId, anchorId }, index) => (
                    <a href={`#${anchorId}`} key={screenshotId}>
                      Screenshot {index + 1}
                    </a>
                  ),
                )}
                {reviewScreenshotLinks.unavailableCount > 0 && (
                  <span>
                    {reviewScreenshotLinks.unavailableCount} screenshot
                    {reviewScreenshotLinks.unavailableCount === 1
                      ? ""
                      : "s"}{" "}
                    unavailable
                  </span>
                )}
              </p>
            )}
        </div>
      ) : (
        <p className="review-verification-empty">
          No review verification has been recorded for this {kind}.
        </p>
      )}

      {canManage && (
        <form className="reviewer-assignment" onSubmit={assignReviewer}>
          <label>
            <span>Assigned reviewer</span>
            <select
              aria-label={`Assigned reviewer for ${kind}`}
              disabled={
                disabled ||
                assigning ||
                assignmentLoading ||
                Boolean(assignmentError) ||
                reviewersLoading
              }
              onChange={(event) => setSelectedReviewerId(event.target.value)}
              value={selectedReviewerId}
            >
              <option value="">{blankAssignmentLabel}</option>
              {assignment &&
                !reviewers?.some(
                  (reviewer) => reviewer.id === assignment.reviewerCredentialId,
                ) && (
                  <option
                    key={assignment.reviewerCredentialId}
                    value={assignment.reviewerCredentialId}
                  >
                    {assignment.reviewerName} (not configured)
                  </option>
                )}
              {(reviewers ?? []).map((reviewer) => (
                <option key={reviewer.id} value={reviewer.id}>
                  {reviewer.reviewerName}
                </option>
              ))}
            </select>
          </label>
          {canSaveAssignment && (
            <button type="submit">
              {assigning
                ? "Saving…"
                : selectedReviewerId
                  ? "Assign reviewer"
                  : assignment && parentAssignment
                    ? "Revoke override"
                    : "Revoke assignment"}
            </button>
          )}
          {assignmentLoading && (
            <span className="reviewer-control-note">Loading assignment…</span>
          )}
          {!assignmentLoading && (
            <span className="reviewer-control-note">
              {assignment
                ? `Assigned to ${assignment.reviewerName}`
                : parentAssignment
                  ? `Inherits task reviewer: ${parentAssignment.reviewerName}`
                  : "Unassigned"}
            </span>
          )}
          {reviewersLoading && (
            <span className="reviewer-control-note">
              Loading reviewer identities…
            </span>
          )}
          {reviewersError && (
            <span className="reviewer-control-error" role="alert">
              Reviewer identities could not be loaded: {reviewersError}
            </span>
          )}
          {reviewers && reviewers.length === 0 && (
            <span className="reviewer-control-note">
              No reviewer identities are configured.
            </span>
          )}
          {assignmentError && (
            <span className="reviewer-control-error" role="alert">
              {assignmentError}{" "}
              <button onClick={() => void loadAssignment()} type="button">
                Retry
              </button>
            </span>
          )}
          {assignError && (
            <span className="reviewer-control-error" role="alert">
              {assignError}
            </span>
          )}
        </form>
      )}

      {canManage && pullRequestUrl && (
        <div className="merge-reconciliation">
          <button
            className="secondary"
            disabled={disabled || reconciling}
            onClick={() => void reconcileMergedPullRequest()}
            type="button"
          >
            {reconciling ? "Checking merged PR…" : "Check merged PR"}
          </button>
          {reconcileMessage && (
            <p aria-live="polite" className="reviewer-control-note">
              {reconcileMessage}
            </p>
          )}
          {reconcileError && (
            <p className="reviewer-control-error" role="alert">
              {reconcileError}
            </p>
          )}
          {refreshError && (
            <p className="reviewer-control-error" role="alert">
              Reconciliation completed, but the latest task data could not be
              loaded: {refreshError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function TaskAcceptanceForm({
  disabled,
  id,
  onAccept,
}: {
  disabled: boolean;
  id: string;
  onAccept: (reason?: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await onAccept(reason.trim() || undefined);
      setSuccess(true);
    } catch (acceptError: unknown) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : "Task acceptance failed.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="task-acceptance-form" id={id} onSubmit={submit}>
      <label>
        <span>Review report / what was tested (optional)</span>
        <textarea
          disabled={disabled || submitting}
          onChange={(event) => {
            setReason(event.target.value);
            setSuccess(false);
          }}
          placeholder="Summarize what you reviewed or tested"
          value={reason}
        />
      </label>
      <button disabled={disabled || submitting} type="submit">
        {submitting ? "Accepting…" : "Accept task and all subtasks"}
      </button>
      {success && (
        <p aria-live="polite" className="reviewer-control-note">
          Task and subtasks accepted.
        </p>
      )}
      {error && (
        <p className="reviewer-control-error" role="alert">
          Acceptance was not recorded: {error}
        </p>
      )}
    </form>
  );
}
