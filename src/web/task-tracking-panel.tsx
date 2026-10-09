import { useState, type FormEvent } from "react";

import type { ReportedStatus } from "./status-presentation";
import {
  buildReviewPacket,
  buildTaskScreenshotEvidence,
  buildTaskTrackingSummary,
  checkStateLabel,
  compareRevisionEvidence,
  elapsedLabel,
  revisionMatchLabel,
  reviewStateLabel,
  type TrackingArtifact,
  type TrackingGitHubStatus,
  type TrackingStatus,
  type TrackingTask,
} from "./task-tracking";
import type { ObservedActivityViewModel } from "./observed-activity";
import "./task-tracking.css";

export type TrackingReportInput = {
  subtaskId?: string;
  taskId?: string;
  reportedState: ReportedStatus;
  reporter: string;
  reason: string;
  evidence?: string;
  handoff?: {
    nextOwner: string;
    nextOwnerKind: "human" | "agent" | "unknown";
    nextAction: string;
    dependency?: string;
    waitingOnSubtaskIds?: string[];
  };
  testedRevision?: string;
  artifacts?: TrackingArtifact[];
};

type Props = {
  task: TrackingTask;
  status?: TrackingStatus;
  activity: ObservedActivityViewModel | null;
  githubStatuses: Readonly<Record<string, TrackingGitHubStatus | undefined>>;
  operatorName?: string;
  connected: boolean;
  canMutate: boolean;
  busy: boolean;
  onReport?: (input: TrackingReportInput) => void | Promise<void>;
  onRefreshPullRequests?: () => void | Promise<void>;
};

type Tab = "contributors" | "handoff" | "review";
type ArtifactDraft = {
  label: string;
  url: string;
  kind: TrackingArtifact["kind"];
  testedRevision: string;
};
const reportStates: Array<{ label: string; value: ReportedStatus }> = [
  { label: "To do", value: "not_started" },
  { label: "Doing", value: "in_progress" },
  { label: "Blocked", value: "blocked" },
  { label: "Done", value: "complete" },
];

function displayState(value: string | undefined): string {
  return value ? value.replaceAll("_", " ") : "Unknown";
}

function attentionLabel(
  value: "approval" | "user_input" | "approval_and_input" | null,
): string | undefined {
  if (value === "approval") return "Waiting for approval";
  if (value === "user_input") return "Waiting for user input";
  if (value === "approval_and_input")
    return "Waiting for approval and user input";
  return undefined;
}

function freshnessLabel(value: string): string {
  return value === "fresh"
    ? "Source fresh"
    : value === "stale"
      ? "Stale source"
      : value === "unavailable"
        ? "Source unavailable"
        : "Freshness unknown";
}

function checkTone(value: string): string {
  return value === "passing"
    ? "ok"
    : value === "failing"
      ? "down"
      : value === "pending" || value === "stale"
        ? "warn"
        : "neutral";
}

function RevisionLabel({
  value,
  revision,
}: {
  value: string;
  revision?: string;
}) {
  return (
    <span
      className={`task-tracking-tag task-tracking-tag-${value}`}
      data-revision-state={value}
    >
      {revisionMatchLabel(value as "matches" | "mismatch" | "unknown")}
      {revision ? (
        <span className="task-tracking-mono"> · {revision}</span>
      ) : null}
    </span>
  );
}

export function TaskTracking({
  task,
  status,
  activity,
  githubStatuses,
  operatorName,
  connected,
  canMutate,
  busy,
  onReport,
  onRefreshPullRequests,
}: Props) {
  const [tab, setTab] = useState<Tab>("contributors");
  const [selectedStepId, setSelectedStepId] = useState(task.id);
  const [reportedState, setReportedState] = useState<ReportedStatus>(() => {
    const current = status?.subtasks.find(
      (entry) => entry.subtaskId === task.subtasks[0]?.id,
    )?.reportedState;
    return current ?? "in_progress";
  });
  const [reason, setReason] = useState("");
  const [reportEvidence, setReportEvidence] = useState("");
  const [nextOwnerKind, setNextOwnerKind] = useState<
    "human" | "agent" | "unknown"
  >("unknown");
  const [nextOwner, setNextOwner] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [dependency, setDependency] = useState("");
  const [waitingOnIds, setWaitingOnIds] = useState("");
  const [testedRevision, setTestedRevision] = useState("");
  const [artifacts, setArtifacts] = useState<ArtifactDraft[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const tracking = buildTaskTrackingSummary(task, status, activity);
  const reviewPacket = buildReviewPacket(task, status, githubStatuses);
  const taskScreenshots = buildTaskScreenshotEvidence(task, githubStatuses);
  const reportEnabled = Boolean(
    canMutate &&
    connected &&
    !busy &&
    !submitting &&
    operatorName?.trim() &&
    onReport,
  );
  const prefix = `task-tracking-${task.id}`;

  const changeStep = (subtaskId: string) => {
    setSelectedStepId(subtaskId);
    const current = status?.subtasks.find(
      (entry) => entry.subtaskId === subtaskId,
    )?.reportedState;
    setReportedState(current ?? "in_progress");
  };

  const submitReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSuccess(false);
    const cleanReason = reason.trim();
    if (!selectedStepId || !operatorName?.trim() || !onReport) return;
    if (!cleanReason) {
      setFormError("Add a reason for this report.");
      return;
    }
    const hasHandoff = Boolean(
      nextOwner.trim() ||
      nextAction.trim() ||
      dependency.trim() ||
      waitingOnIds.trim(),
    );
    if (hasHandoff && (!nextOwner.trim() || !nextAction.trim())) {
      setFormError("A handoff needs a next owner and next action.");
      return;
    }
    const cleanRevision = testedRevision.trim();
    if (cleanRevision && !/^[a-f0-9]{7,40}$/i.test(cleanRevision)) {
      setFormError("Tested revision must be 7 to 40 hexadecimal characters.");
      return;
    }
    const cleanArtifacts: TrackingArtifact[] = [];
    for (const artifact of artifacts) {
      const label = artifact.label.trim();
      const url = artifact.url.trim();
      if (!label && !url && !artifact.testedRevision.trim()) continue;
      if (!label || !url) {
        setFormError("Each artifact needs a label and URL.");
        return;
      }
      try {
        const parsed = new URL(url);
        if (
          (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
          parsed.username ||
          parsed.password
        )
          throw new Error("unsupported or credentialed URL");
      } catch {
        setFormError(
          "Artifact URLs must use http or https and cannot contain credentials.",
        );
        return;
      }
      const artifactRevision = artifact.testedRevision.trim();
      if (artifactRevision && !/^[a-f0-9]{7,40}$/i.test(artifactRevision)) {
        setFormError(
          "Artifact revision must be 7 to 40 hexadecimal characters.",
        );
        return;
      }
      if (
        label.length > 200 ||
        url.length > 2048 ||
        cleanArtifacts.length >= 20
      ) {
        setFormError(
          "Artifacts allow up to 20 links; each label must be at most 200 characters and each URL at most 2048.",
        );
        return;
      }
      cleanArtifacts.push({
        label,
        url,
        kind: artifact.kind,
        ...(artifactRevision
          ? { testedRevision: artifactRevision.toLowerCase() }
          : {}),
      });
    }
    const waitIds = waitingOnIds
      .split(/[\n,]/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (waitIds.length > 100) {
      setFormError("A report can wait on at most 100 subtask IDs.");
      return;
    }
    if (
      nextOwner.trim().length > 200 ||
      nextAction.trim().length > 2000 ||
      dependency.trim().length > 2000
    ) {
      setFormError("Handoff fields exceed the allowed length.");
      return;
    }
    const handoff = hasHandoff
      ? {
          nextOwner: nextOwner.trim(),
          nextOwnerKind,
          nextAction: nextAction.trim(),
          ...(dependency.trim() ? { dependency: dependency.trim() } : {}),
          ...(waitIds.length ? { waitingOnSubtaskIds: waitIds } : {}),
        }
      : undefined;
    const input: TrackingReportInput = {
      ...(selectedStepId === task.id
        ? { taskId: task.id }
        : { subtaskId: selectedStepId }),
      reportedState,
      reporter: operatorName.trim(),
      reason: cleanReason,
      ...(reportEvidence.trim() ? { evidence: reportEvidence.trim() } : {}),
      ...(handoff ? { handoff } : {}),
      ...(testedRevision.trim()
        ? { testedRevision: testedRevision.trim() }
        : {}),
      ...(cleanArtifacts.length ? { artifacts: cleanArtifacts } : {}),
    };
    setSubmitting(true);
    try {
      await onReport(input);
      setReason("");
      setReportEvidence("");
      setNextOwner("");
      setNextAction("");
      setDependency("");
      setWaitingOnIds("");
      setTestedRevision("");
      setArtifacts([]);
      setSuccess(true);
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "The report could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label={`Task execution tracking for ${task.name}`}
      className="task-tracking"
    >
      <div className="task-tracking-heading">
        <div>
          <p className="task-tracking-eyebrow">Evidence</p>
          <h4>Sessions, handoffs, and PR packet</h4>
        </div>
        <span className="task-tracking-task-id">{task.simpleId}</span>
      </div>
      <div
        aria-label="Task tracking views"
        className="task-tracking-tabs"
        role="tablist"
      >
        {(
          [
            ["contributors", "Contributors"],
            ["handoff", "Handoff"],
            ["review", "Review packet"],
          ] as const
        ).map(([key, label]) => (
          <button
            aria-controls={`${prefix}-${key}`}
            aria-selected={tab === key}
            className={tab === key ? "is-selected" : ""}
            id={`${prefix}-tab-${key}`}
            key={key}
            onClick={() => setTab(key)}
            role="tab"
            type="button"
          >
            {label}
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`${prefix}-tab-contributors`}
        className="task-tracking-panel"
        hidden={tab !== "contributors"}
        id={`${prefix}-contributors`}
        role="tabpanel"
      >
        <div className="task-tracking-stats">
          <div>
            <span>Task-linked sessions</span>
            <strong>{tracking.sessions.length}</strong>
          </div>
          <div>
            <span>Fresh running children</span>
            <strong>{tracking.activeChildCount}</strong>
          </div>
          <div>
            <span>Latest activity</span>
            <strong>
              {tracking.sessions[0]?.activityAge ?? "No observed activity"}
            </strong>
          </div>
        </div>
        <div className="task-tracking-claims">
          <p className="task-tracking-eyebrow">Current reports</p>
          {task.subtasks.map((subtask) => {
            const current = status?.subtasks.find(
              (entry) => entry.subtaskId === subtask.id,
            );
            if (!current?.reportedState && !current?.reportId) return null;
            return (
              <div key={subtask.id}>
                <strong>
                  {subtask.simpleId} · {subtask.name}
                </strong>
                <span>Claim · {displayState(current.reportedState)}</span>
                <span>
                  {current.reportedState === "complete"
                    ? "Done"
                    : displayState(current.reportedState)}{" "}
                  · reported by {current.reporter || "unknown"}
                </span>
              </div>
            );
          })}
          {!status?.subtasks.some(
            (entry) => entry.reportedState || entry.reportId,
          ) ? (
            <p>No current subtask reports are recorded.</p>
          ) : null}
        </div>
        {tracking.sessions.length === 0 ? (
          <p className="task-tracking-empty">
            No explicitly linked T3 sessions are currently observed for this
            task or its subtasks.
          </p>
        ) : (
          <div className="task-tracking-session-list">
            {tracking.sessions.map((session) => {
              const attention = attentionLabel(session.humanAttention);
              const sessionError =
                session.thread.latestSessionState === "error" ||
                session.thread.latestTurnState === "error";
              const agent = session.thread.agent?.trim();
              const model = session.thread.model?.trim();
              const sessionIdentity =
                session.thread.codeSessionId ?? session.thread.runId;
              return (
                <article className="task-tracking-session" key={session.id}>
                  <div className="task-tracking-session-main">
                    <span
                      aria-hidden="true"
                      className={`task-tracking-token ${session.isRunning ? "is-running" : ""}`}
                    >
                      {agent?.slice(0, 2).toUpperCase() ?? "—"}
                    </span>
                    <div className="task-tracking-session-copy">
                      <strong>{agent || "T3 session"}</strong>
                      <span>
                        {model ? `Model ${model}` : "Model not reported"} · Role
                        unknown
                      </span>
                    </div>
                  </div>
                  <div className="task-tracking-session-id task-tracking-mono">
                    <span>
                      Source {session.thread.sourceId ?? "unknown"} · machine{" "}
                      {session.thread.machineId ?? "unknown"}
                    </span>
                    <details className="task-tracking-session-identifiers">
                      <summary>
                        {sessionIdentity
                          ? `session …${sessionIdentity.slice(-8)}`
                          : "Session identifiers"}
                      </summary>
                      <p>Thread · {session.thread.threadId}</p>
                      <p>
                        Code session ·{" "}
                        {session.thread.codeSessionId ?? "not reported"}
                      </p>
                      <p>Run · {session.thread.runId ?? "not reported"}</p>
                    </details>
                  </div>
                  <div className="task-tracking-session-state">
                    <span
                      className={`task-tracking-tag task-tracking-tag-${session.isRunning ? "info" : session.humanAttention ? "warn" : "neutral"}`}
                    >
                      {attention ??
                        (sessionError
                          ? "Session reports error"
                          : session.freshness === "fresh" && session.isRunning
                            ? "Working"
                            : freshnessLabel(session.freshness))}
                    </span>
                    {session.freshness === "fresh" ? (
                      <span className="task-tracking-tag task-tracking-tag-neutral">
                        Source fresh
                      </span>
                    ) : null}
                    <span>
                      Latest activity · {session.activityAge} ·{" "}
                      {session.targetLabels.join(", ")}
                    </span>
                  </div>
                  {session.latestReport ? (
                    <p className="task-tracking-attribution">
                      Latest associated report:{" "}
                      <strong>
                        {displayState(session.latestReport.reportedState)} claim
                      </strong>
                      {session.latestReport.reporter
                        ? ` · reporter ${session.latestReport.reporter}`
                        : ""}
                      {session.latestReport.reportCreatedAt
                        ? ` · ${elapsedLabel(session.latestReport.reportCreatedAt)}`
                        : ""}
                    </p>
                  ) : session.reportAttributionAmbiguous ? (
                    <p className="task-tracking-attribution">
                      Report attribution is ambiguous because the source session
                      was not recorded.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        <div className="task-tracking-note">
          Freshness describes the source observation. Activity age is shown
          separately, so an idle session can still have a fresh source record.
        </div>
      </div>

      <div
        aria-labelledby={`${prefix}-tab-handoff`}
        className="task-tracking-panel"
        hidden={tab !== "handoff"}
        id={`${prefix}-handoff`}
        role="tabpanel"
      >
        <div className="task-tracking-handoff-summary">
          <div>
            <p className="task-tracking-eyebrow">Current Factory state</p>
            <strong>{displayState(status?.taskState)}</strong>
            <p>
              {status?.stateReason || "No task-level state reason recorded."}
            </p>
          </div>
          <div>
            <p className="task-tracking-eyebrow">Observed child work</p>
            <strong>
              {tracking.activeChildCount} fresh running child
              {tracking.activeChildCount === 1 ? "" : "ren"}
            </strong>
            <p>
              {tracking.activeChildNames.length
                ? tracking.activeChildNames.join(" · ")
                : "No fresh running child sessions are explicitly associated."}
            </p>
          </div>
        </div>
        {tracking.waitHandoffSubtaskIds.length > 0 ? (
          <p className="task-tracking-handoff-callout">
            <strong>Waiting on child work:</strong>{" "}
            {tracking.waitHandoffSubtaskIds
              .map(
                (id) =>
                  task.subtasks.find((subtask) => subtask.id === id)
                    ?.simpleId ?? id,
              )
              .join(", ")}
          </p>
        ) : null}
        {tracking.handoffs.map(({ subtask, handoff }) => (
          <div className="task-tracking-handoff-row" key={subtask.id}>
            <strong>
              {subtask.simpleId} · {subtask.name}
            </strong>
            <span>
              Next owner: {handoff.nextOwner} ({handoff.nextOwnerKind})
            </span>
            <p>{handoff.nextAction}</p>
            {handoff.dependency ? (
              <small>Dependency: {handoff.dependency}</small>
            ) : null}
            {handoff.waitingOnSubtaskIds?.length ? (
              <small>
                Waiting on:{" "}
                {handoff.waitingOnSubtaskIds
                  .map(
                    (id) =>
                      task.subtasks.find((item) => item.id === id)?.simpleId ??
                      id,
                  )
                  .join(", ")}
              </small>
            ) : null}
          </div>
        ))}
        {tracking.blockedReasons.length > 0 ? (
          <div className="task-tracking-blocked-list">
            <p className="task-tracking-eyebrow">Blocked reports</p>
            {tracking.blockedReasons.map((item) => (
              <p key={item.label}>
                <strong>{item.label}</strong>:{" "}
                {item.reason || "Reason not recorded."}
              </p>
            ))}
          </div>
        ) : null}
        {tracking.handoffs.length === 0 &&
        tracking.waitHandoffSubtaskIds.length === 0 &&
        tracking.blockedReasons.length === 0 ? (
          <p className="task-tracking-empty">
            No structured handoff or blocked reason is recorded.
          </p>
        ) : null}

        <details className="task-tracking-report-details">
          <summary>Append a structured report</summary>
          <form
            className="task-tracking-report-form"
            onSubmit={(event) => void submitReport(event)}
          >
            <div className="task-tracking-form-heading">
              <div>
                <p className="task-tracking-eyebrow">Current Factory report</p>
                <h5>Record the current state and next subtask</h5>
              </div>
              {operatorName?.trim() ? (
                <span>Reporter · {operatorName}</span>
              ) : (
                <span>Reporter attribution unavailable</span>
              )}
            </div>
            <div className="task-tracking-form-grid">
              <label>
                <span>Report target</span>
                <select
                  disabled={!reportEnabled}
                  onChange={(event) => changeStep(event.target.value)}
                  required
                  value={selectedStepId}
                >
                  <option value={task.id}>This task</option>
                  {task.subtasks.map((subtask) => (
                    <option key={subtask.id} value={subtask.id}>
                      {subtask.simpleId} · {subtask.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Reported state</span>
                <select
                  disabled={!reportEnabled}
                  onChange={(event) =>
                    setReportedState(event.target.value as ReportedStatus)
                  }
                  value={reportedState}
                >
                  {(selectedStepId === task.id
                    ? [
                        { label: "Active", value: "in_progress" as const },
                        { label: "Blocked", value: "blocked" as const },
                        { label: "Finished", value: "complete" as const },
                      ]
                    : reportStates
                  ).map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>
                Reason <em>required</em>
              </span>
              <textarea
                disabled={!reportEnabled}
                onChange={(event) => setReason(event.target.value)}
                required
                value={reason}
              />
            </label>
            <label>
              <span>Report evidence</span>
              <textarea
                disabled={!reportEnabled}
                onChange={(event) => setReportEvidence(event.target.value)}
                placeholder="Evidence included in this report"
                value={reportEvidence}
              />
            </label>
            <fieldset className="task-tracking-fieldset">
              <legend>
                Handoff details <span>optional</span>
              </legend>
              <div className="task-tracking-form-grid">
                <label>
                  <span>Next owner kind</span>
                  <select
                    disabled={!reportEnabled}
                    onChange={(event) =>
                      setNextOwnerKind(
                        event.target.value as "human" | "agent" | "unknown",
                      )
                    }
                    value={nextOwnerKind}
                  >
                    <option value="unknown">Unknown</option>
                    <option value="human">Human</option>
                    <option value="agent">Agent</option>
                  </select>
                </label>
                <label>
                  <span>Next owner</span>
                  <input
                    maxLength={200}
                    disabled={!reportEnabled}
                    onChange={(event) => setNextOwner(event.target.value)}
                    value={nextOwner}
                  />
                </label>
              </div>
              <label>
                <span>Next action</span>
                <input
                  maxLength={2000}
                  disabled={!reportEnabled}
                  onChange={(event) => setNextAction(event.target.value)}
                  value={nextAction}
                />
              </label>
              <label>
                <span>Dependency</span>
                <input
                  maxLength={2000}
                  disabled={!reportEnabled}
                  onChange={(event) => setDependency(event.target.value)}
                  value={dependency}
                />
              </label>
              <label>
                <span>Wait on subtask IDs</span>
                <input
                  disabled={!reportEnabled}
                  onChange={(event) => setWaitingOnIds(event.target.value)}
                  placeholder="ST-12, ST-13"
                  value={waitingOnIds}
                />
              </label>
            </fieldset>
            <label>
              <span>Tested revision</span>
              <input
                disabled={!reportEnabled}
                onChange={(event) => setTestedRevision(event.target.value)}
                placeholder="7–40 hexadecimal characters"
                value={testedRevision}
              />
            </label>
            <fieldset className="task-tracking-fieldset">
              <legend>
                Reported artifacts <span>links are claims</span>
              </legend>
              {artifacts.map((artifact, index) => (
                <div className="task-tracking-artifact-row" key={index}>
                  <label>
                    <span>Label</span>
                    <input
                      maxLength={200}
                      disabled={!reportEnabled}
                      onChange={(event) =>
                        setArtifacts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, label: event.target.value }
                              : item,
                          ),
                        )
                      }
                      value={artifact.label}
                    />
                  </label>
                  <label>
                    <span>URL</span>
                    <input
                      maxLength={2048}
                      disabled={!reportEnabled}
                      onChange={(event) =>
                        setArtifacts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, url: event.target.value }
                              : item,
                          ),
                        )
                      }
                      value={artifact.url}
                    />
                  </label>
                  <label>
                    <span>Kind</span>
                    <select
                      disabled={!reportEnabled}
                      onChange={(event) =>
                        setArtifacts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  kind: event.target
                                    .value as TrackingArtifact["kind"],
                                }
                              : item,
                          ),
                        )
                      }
                      value={artifact.kind}
                    >
                      <option value="artifact">Artifact</option>
                      <option value="preview">Preview</option>
                      <option value="test">Test</option>
                      <option value="review">Review</option>
                    </select>
                  </label>
                  <label>
                    <span>Artifact revision</span>
                    <input
                      maxLength={40}
                      disabled={!reportEnabled}
                      onChange={(event) =>
                        setArtifacts((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, testedRevision: event.target.value }
                              : item,
                          ),
                        )
                      }
                      value={artifact.testedRevision}
                    />
                  </label>
                  <button
                    aria-label={`Remove artifact ${index + 1}`}
                    className="task-tracking-remove"
                    disabled={!reportEnabled}
                    onClick={() =>
                      setArtifacts((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="task-tracking-secondary-button"
                disabled={!reportEnabled || artifacts.length >= 20}
                onClick={() =>
                  setArtifacts((current) => [
                    ...current,
                    {
                      label: "",
                      url: "",
                      kind: "artifact",
                      testedRevision: "",
                    },
                  ])
                }
                type="button"
              >
                Add artifact link
              </button>
            </fieldset>
            {formError ? (
              <p
                aria-live="polite"
                className="task-tracking-error"
                role="alert"
              >
                {formError}
              </p>
            ) : null}
            {success ? (
              <p
                aria-live="polite"
                className="task-tracking-success"
                role="status"
              >
                Update added.
              </p>
            ) : null}
            {!connected ? (
              <p className="task-tracking-form-note">
                Connect to Factory to add a report.
              </p>
            ) : !canMutate ? (
              <p className="task-tracking-form-note">
                This session cannot edit Factory records.
              </p>
            ) : null}
            <button
              className="task-tracking-submit"
              disabled={!reportEnabled}
              type="submit"
            >
              {submitting ? "Saving report…" : "Add report"}
            </button>
          </form>
        </details>
      </div>

      <div
        aria-labelledby={`${prefix}-tab-review`}
        className="task-tracking-panel"
        hidden={tab !== "review"}
        id={`${prefix}-review`}
        role="tabpanel"
      >
        <div className="task-tracking-review-heading">
          <div>
            <p className="task-tracking-eyebrow">
              Reported work and current evidence
            </p>
            <h5>Exact revision review packet</h5>
          </div>
          {onRefreshPullRequests ? (
            <button
              className="task-tracking-secondary-button"
              disabled={busy || !connected}
              onClick={() => void onRefreshPullRequests()}
              type="button"
            >
              Refresh PR evidence
            </button>
          ) : null}
        </div>
        {reviewPacket.length === 0 ? (
          <p className="task-tracking-empty">
            No current subtask reports are available for a review packet.
          </p>
        ) : (
          <div className="task-tracking-review-list">
            {reviewPacket.map((item) => {
              const checksLabel = checkStateLabel(item.checks);
              const shownChecks = [
                ...(item.snapshot?.allCheckRunsStatus === "ok"
                  ? (item.snapshot.allCheckRuns ?? [])
                  : item.snapshot?.checkRunsStatus === "ok"
                    ? item.snapshot.checkRuns
                    : []),
                ...(item.snapshot?.workflowRunsStatus === "ok"
                  ? item.snapshot.workflowRuns
                  : []),
              ];
              const snapshotAge = item.snapshot
                ? elapsedLabel(item.snapshot.fetchedAt)
                : "time unknown";
              const evidence = item.status.reportEvidence?.trim();
              const currentNotes = !evidence
                ? item.subtask.evidence?.trim()
                : undefined;
              const acceptance = item.status.verificationState ?? "unreported";
              return (
                <article
                  className="task-tracking-review-item"
                  key={item.subtask.id}
                >
                  <div className="task-tracking-review-item-heading">
                    <div>
                      <p className="task-tracking-eyebrow">
                        {item.subtask.simpleId}
                      </p>
                      <h6>{item.subtask.name}</h6>
                    </div>
                    <span className="task-tracking-claim">
                      {displayState(item.status.reportedState)} · report claim
                    </span>
                  </div>
                  {item.status.reason ? (
                    <p className="task-tracking-report-reason">
                      <strong>Current report reason:</strong>{" "}
                      {item.status.reason}
                    </p>
                  ) : (
                    <p className="task-tracking-report-reason">
                      <strong>Current report reason:</strong> Not recorded.
                    </p>
                  )}
                  <p className="task-tracking-provenance">
                    Report {item.status.reportId ?? "ID unavailable"} ·{" "}
                    {item.status.reportCreatedAt
                      ? elapsedLabel(item.status.reportCreatedAt)
                      : "time unavailable"}{" "}
                    · reporter {item.status.reporter ?? "unknown"} · machine{" "}
                    {item.status.machineId ?? "not recorded"}
                    {item.status.sessionRef
                      ? ` · T3 source ${item.status.sessionRef.sourceId ?? "unknown"} · thread ${item.status.sessionRef.externalThreadId}`
                      : " · no T3 session reference"}
                  </p>
                  {evidence ? (
                    <p className="task-tracking-report-evidence">
                      <strong>Report evidence:</strong> {evidence}
                    </p>
                  ) : currentNotes ? (
                    <p className="task-tracking-current-notes">
                      <strong>Current notes:</strong> {currentNotes}
                    </p>
                  ) : null}
                  {item.pullRequestUrl ? (
                    <a
                      className="task-tracking-pr-link"
                      href={item.pullRequestUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open associated pull request
                    </a>
                  ) : (
                    <p className="task-tracking-form-note">
                      No pull request is associated with this subtask report.
                    </p>
                  )}
                  <div className="task-tracking-evidence-grid">
                    <div>
                      <span>Report tested revision</span>
                      <RevisionLabel
                        value={item.revisionMatch}
                        revision={item.status.testedRevision}
                      />
                    </div>
                    <div>
                      <span>Current PR head</span>
                      <span className="task-tracking-mono">
                        {item.headSha ?? "Unknown"}
                      </span>
                    </div>
                    <div>
                      <span>
                        {item.checkEvidenceScope === "all-checks"
                          ? "All checks · exact head"
                          : item.checkEvidenceScope === "all-checks-partial"
                            ? "All check runs · workflow status unavailable"
                            : item.checkEvidenceScope === "actions-only"
                              ? "Actions checks only · exact head"
                              : item.checkEvidenceScope ===
                                  "actions-and-workflows"
                                ? "Actions and workflow runs · partial"
                                : item.checkEvidenceScope === "workflows-only"
                                  ? "Workflow runs only · partial"
                                  : "Check evidence unavailable"}
                      </span>
                      <span
                        className={`task-tracking-tag task-tracking-tag-${checkTone(item.checks)}`}
                      >
                        {checksLabel}
                      </span>
                      <small>Snapshot {snapshotAge}</small>
                    </div>
                    <div>
                      <span>Code review</span>
                      <span
                        className={`task-tracking-tag task-tracking-tag-${item.review === "finished" ? "neutral" : item.review === "changes_requested" ? "down" : item.review === "pending" || item.review === "stale" ? "warn" : "neutral"}`}
                      >
                        {reviewStateLabel(item.review)}
                      </span>
                      <small>
                        {item.snapshot?.review?.status === "unavailable"
                          ? (item.snapshot.review.error ??
                            "Review details unavailable.")
                          : item.snapshot?.review
                            ? `${item.snapshot.review.decision.replaceAll("_", " ")} · ${item.snapshot.review.unresolvedThreads === undefined ? "thread count unknown" : `${item.snapshot.review.unresolvedThreads} unresolved`} · ${item.snapshot.review.reviewers.join(", ") || "reviewer names unavailable"}`
                            : "No review snapshot supplied."}
                      </small>
                    </div>
                  </div>
                  {shownChecks.length > 0 ? (
                    <ul className="task-tracking-check-list">
                      {shownChecks.map((check) => (
                        <li key={`${check.name}:${check.id}`}>
                          <span>
                            {("workflowName" in check
                              ? check.workflowName
                              : undefined) ?? check.name}
                          </span>
                          <span>
                            {check.status === "completed"
                              ? (check.conclusion ?? "Unknown conclusion")
                              : check.status.replaceAll("_", " ")}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : item.checkEvidenceScope === "all-checks-partial" ? (
                    <p className="task-tracking-form-note">
                      Workflow status is unavailable; check-run results are
                      partial evidence.
                    </p>
                  ) : item.snapshot?.allCheckRunsStatus === "unavailable" ? (
                    <p className="task-tracking-form-note">
                      All-check evidence is unavailable. Empty or partial checks
                      are not passing evidence.
                    </p>
                  ) : (
                    <p className="task-tracking-form-note">
                      CI detail is unavailable or empty. Empty checks are not
                      passing evidence.
                    </p>
                  )}
                  {item.screenshots.length > 0 ? (
                    <div className="task-tracking-screenshot-list">
                      <p className="task-tracking-eyebrow">
                        Screenshot revision evidence
                      </p>
                      {item.screenshots.map(({ screenshot, revisionMatch }) => (
                        <div key={screenshot.id}>
                          <span>{screenshot.caption || screenshot.id}</span>
                          <RevisionLabel
                            value={revisionMatch}
                            revision={screenshot.testedRevision}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="task-tracking-form-note">
                      No screenshot revision evidence is attached to this
                      subtask report.
                    </p>
                  )}
                  {item.status.artifacts?.length ? (
                    <div className="task-tracking-artifact-list">
                      <p className="task-tracking-eyebrow">
                        Reported artifact links · claims
                      </p>
                      {item.status.artifacts.map((artifact, index) => (
                        <div key={`${artifact.url}:${index}`}>
                          <a
                            href={artifact.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {artifact.label}
                          </a>
                          <span>
                            {artifact.kind} ·{" "}
                            {!artifact.testedRevision
                              ? "revision not recorded"
                              : compareRevisionEvidence(
                                    artifact.testedRevision,
                                    item.status.testedRevision,
                                  ) === "matches"
                                ? "exact report revision"
                                : compareRevisionEvidence(
                                      artifact.testedRevision,
                                      item.status.testedRevision,
                                    ) === "mismatch"
                                  ? "revision differs from report"
                                  : "revision comparison unknown"}
                          </span>
                        </div>
                      ))}
                      <p className="task-tracking-form-note">
                        Links are recorded claims; this packet does not load
                        preview content or verify deployment status.
                      </p>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        {taskScreenshots.length > 0 ? (
          <section
            className="task-tracking-criteria"
            aria-label="Task-level screenshot revision evidence"
          >
            <p className="task-tracking-eyebrow">
              Task-level screenshot evidence
            </p>
            {taskScreenshots.map(({ screenshot, revisionMatch }) => (
              <p className="task-tracking-task-screenshot" key={screenshot.id}>
                <span className="task-tracking-scope-label">Task-level</span>
                <span>{screenshot.caption || screenshot.id}</span>
                <RevisionLabel
                  value={revisionMatch}
                  revision={screenshot.testedRevision}
                />
              </p>
            ))}
          </section>
        ) : null}
        {task.acceptanceCriteria?.length ? (
          <section
            className="task-tracking-criteria"
            aria-label="Task requirements"
          >
            <p className="task-tracking-eyebrow">Task requirements</p>
            {task.acceptanceCriteria.map((criterion, index) => (
              <p className="task-tracking-criteria-item" key={index}>
                <span aria-hidden="true" />
                {criterion}
              </p>
            ))}
          </section>
        ) : null}
        <p className="task-tracking-note">
          Reports, CI, review, screenshots, and artifact links are separate
          evidence. Task completion follows its finish rule.
        </p>
      </div>
    </section>
  );
}
