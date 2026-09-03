import { useState } from "react";

/**
 * The web layer deliberately owns this input shape. It keeps the presentation
 * independent of the T3 transport and of the Factory persistence model.
 */
export type ObservedConnectionState =
  | "connected"
  | "not_configured"
  | "unreachable"
  | "authentication_failed"
  | "permission_denied"
  | "incompatible"
  | "invalid_response"
  | "unavailable";

export type ObservedConnection = {
  error?: string;
  lastSuccessfulFetchAt?: string;
  observedAt?: string;
  sourceVersion?: string;
  state: ObservedConnectionState;
  warning?: string;
};

export type ObservedTarget = {
  id: string;
  kind: "task" | "subtask";
  label: string;
};

export type ObservedAssociation = {
  linkId?: string;
  target?: ObservedTarget;
  state: "linked" | "unmatched" | "ambiguous";
  candidateLabels?: string[];
};

export type ObservedThread = {
  association: ObservedAssociation;
  branch?: string;
  changedFileCount?: number;
  externalProjectId?: string;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  latestSessionState?:
    | "idle"
    | "starting"
    | "ready"
    | "running"
    | "interrupted"
    | "stopped"
    | "error";
  latestTurnState?: "running" | "interrupted" | "completed" | "error";
  linkedPullRequestUrl?: string;
  model?: string;
  observedAt?: string;
  provider?: string;
  sourceUpdatedAt?: string;
  title: string;
  threadId: string;
  worktreePath?: string;
};

export type ReconciliationFinding = {
  candidateLabels?: string[];
  explanation: string;
  kind:
    | "unlinked_activity"
    | "ambiguous_target"
    | "planned_but_running"
    | "reported_state_stale"
    | "session_needs_attention"
    | "branch_mismatch"
    | "source_unavailable";
  observedAt?: string;
  severity: "info" | "attention";
  suggestedAction: string;
  targetLabel?: string;
  threadId?: string;
  id: string;
};

export type ObservedActivityCounts = {
  ambiguous: number;
  linked: number;
  needsAttention: number;
  running: number;
  unmatched: number;
};

export type ObservedActivityViewModel = {
  connection: ObservedConnection;
  counts: ObservedActivityCounts;
  findings: ReconciliationFinding[];
  projectName?: string;
  targets: ObservedTarget[];
  threads: ObservedThread[];
};

/** A bounded detail summary. Transcript/message bodies intentionally have no
 * representation in the web view model. */
export type ObservedThreadDetail = {
  activityCount?: number;
  checkpointCount?: number;
  checkpointFiles?: string[];
  error?: string;
  observedAt?: string;
  sourceSequence?: number;
  sourceUpdatedAt?: string;
  turnCount?: number;
};

export type ObservedActivityProps = {
  activity: ObservedActivityViewModel | null;
  busy?: boolean;
  canMutate: boolean;
  onLinkThread?: (
    threadId: string,
    target: ObservedTarget,
  ) => void | Promise<void>;
  onOpenThreadDetail?: (threadId: string) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onUnlinkThread?: (threadId: string, linkId?: string) => void | Promise<void>;
  threadDetails?: Readonly<Record<string, ObservedThreadDetail>>;
  threadDetailLoadingIds?: ReadonlySet<string>;
};

const CONNECTION_LABELS: Record<ObservedConnectionState, string> = {
  authentication_failed: "Authentication failed",
  connected: "Connected",
  incompatible: "Incompatible T3 version",
  invalid_response: "Invalid T3 response",
  not_configured: "Not configured",
  permission_denied: "Permission denied",
  unavailable: "Unavailable",
  unreachable: "Unreachable",
};

const FINDING_LABELS: Record<ReconciliationFinding["kind"], string> = {
  ambiguous_target: "Ambiguous target",
  branch_mismatch: "Branch mismatch",
  planned_but_running: "Planned but running",
  reported_state_stale: "Report may be stale",
  session_needs_attention: "Session needs attention",
  source_unavailable: "Source unavailable",
  unlinked_activity: "Unlinked activity",
};

export function observedConnectionLabel(
  state: ObservedConnectionState,
): string {
  return CONNECTION_LABELS[state];
}

export function observedFindingLabel(
  kind: ReconciliationFinding["kind"],
): string {
  return FINDING_LABELS[kind];
}

export function formatObservedTime(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function threadStateLabel(thread: ObservedThread): string {
  const session = thread.latestSessionState?.replaceAll("_", " ");
  const turn = thread.latestTurnState?.replaceAll("_", " ");
  if (session && turn) return `${session} · turn ${turn}`;
  if (session) return session;
  if (turn) return `turn ${turn}`;
  return "state not reported";
}

function connectionTone(
  state: ObservedConnectionState,
): "ok" | "warn" | "down" {
  if (state === "connected") return "ok";
  if (state === "not_configured") return "warn";
  return "down";
}

export function ObservedActivitySection({
  activity,
  busy = false,
  canMutate,
  onLinkThread,
  onOpenThreadDetail,
  onRefresh,
  onUnlinkThread,
  threadDetails,
  threadDetailLoadingIds,
}: ObservedActivityProps) {
  const [pendingTargets, setPendingTargets] = useState<Record<string, string>>(
    {},
  );
  const connection = activity?.connection ?? {
    state: "not_configured" as const,
  };
  const counts = activity?.counts ?? {
    ambiguous: 0,
    linked: 0,
    needsAttention: 0,
    running: 0,
    unmatched: 0,
  };
  const threads = activity?.threads ?? [];
  const findings = activity?.findings ?? [];
  const targets = activity?.targets ?? [];
  const lastFetch = formatObservedTime(
    connection.lastSuccessfulFetchAt ?? connection.observedAt,
  );
  const unavailable = connection.state !== "connected";
  const sourceNeedsReview = unavailable || Boolean(connection.warning);

  const linkThread = (thread: ObservedThread) => {
    const targetId =
      pendingTargets[thread.threadId] ?? thread.association.target?.id;
    const target = targets.find((candidate) => candidate.id === targetId);
    if (!target || !onLinkThread) return;
    void onLinkThread(thread.threadId, target);
  };

  return (
    <section
      aria-labelledby="observed-activity-title"
      className="panel observed-activity"
      data-observed-activity="true"
    >
      <div className="observed-activity-header">
        <div>
          <p className="eyebrow">Execution observations</p>
          <h2 id="observed-activity-title">Observed activity</h2>
          <p className="observed-authority-copy">
            T3 activity is read-only evidence. Factory remains the planning and
            verification authority.
          </p>
        </div>
        <div className="observed-activity-header-actions">
          <span
            className={`observed-connection observed-connection-${connectionTone(connection.state)}`}
            data-observed-connection={connection.state}
          >
            <span aria-hidden="true" className="observed-connection-dot" />
            {observedConnectionLabel(connection.state)}
          </span>
          {onRefresh && (
            <button
              className="secondary observed-refresh"
              disabled={busy}
              onClick={() => void onRefresh()}
              type="button"
            >
              {busy ? "Refreshing…" : "Refresh observations"}
            </button>
          )}
        </div>
      </div>

      {sourceNeedsReview && (
        <div
          className={`observed-source-message observed-source-${connectionTone(connection.state)}`}
          role={connection.state === "connected" ? undefined : "status"}
        >
          <strong>
            {connection.warning
              ? "Project matching needs review."
              : connection.state === "not_configured"
                ? "T3 is not configured."
                : "T3 observations are not current."}
          </strong>{" "}
          {lastFetch
            ? `Showing the last observation from ${lastFetch}.`
            : "No observation has been recorded yet."}{" "}
          {connection.warning
            ? connection.warning
            : "This does not represent current execution state."}
          {connection.error && (
            <span className="observed-source-error"> {connection.error}</span>
          )}
        </div>
      )}

      {connection.state === "connected" && lastFetch && (
        <p className="observed-freshness">Last observed {lastFetch}</p>
      )}

      <div aria-label="Observed activity counts" className="observed-counts">
        <div className="observed-count">
          <strong>{counts.running}</strong>
          <span>Running</span>
        </div>
        <div className="observed-count">
          <strong>{counts.needsAttention}</strong>
          <span>Needs attention</span>
        </div>
        <div className="observed-count">
          <strong>{counts.linked}</strong>
          <span>Linked</span>
        </div>
        <div className="observed-count">
          <strong>{counts.unmatched}</strong>
          <span>Unmatched</span>
        </div>
        <div className="observed-count">
          <strong>{counts.ambiguous}</strong>
          <span>Ambiguous</span>
        </div>
      </div>

      {threads.length > 0 ? (
        <div aria-label="T3 threads" className="observed-thread-list">
          {threads.map((thread) => {
            const association = thread.association;
            const linked = association.state === "linked" && association.target;
            const loading =
              threadDetailLoadingIds?.has(thread.threadId) ?? false;
            const threadTime = formatObservedTime(
              thread.sourceUpdatedAt ?? thread.observedAt,
            );
            const detail = threadDetails?.[thread.threadId];
            return (
              <article className="observed-thread" key={thread.threadId}>
                <div className="observed-thread-heading">
                  <div className="observed-thread-title">
                    <strong>{thread.title || "Untitled T3 thread"}</strong>
                    <code>{thread.threadId}</code>
                  </div>
                  <span
                    className={`observed-thread-association observed-thread-association-${association.state}`}
                  >
                    {linked
                      ? `Linked to ${association.target?.label}`
                      : association.state === "ambiguous"
                        ? "Ambiguous target"
                        : "Unmatched"}
                  </span>
                </div>

                <div className="observed-thread-meta">
                  <span>{threadStateLabel(thread)}</span>
                  {thread.provider && <span>{thread.provider}</span>}
                  {thread.model && <span>{thread.model}</span>}
                  {thread.externalProjectId && (
                    <span>T3 project: {thread.externalProjectId}</span>
                  )}
                  {thread.branch && <span>Branch: {thread.branch}</span>}
                  {thread.worktreePath && (
                    <span>Worktree: {thread.worktreePath}</span>
                  )}
                  {threadTime && <span>Observed: {threadTime}</span>}
                  {thread.changedFileCount !== undefined && (
                    <span>
                      {thread.changedFileCount} changed file
                      {thread.changedFileCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>

                {thread.linkedPullRequestUrl && (
                  <p className="observed-thread-pr">
                    <a
                      href={thread.linkedPullRequestUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Pull request
                    </a>
                  </p>
                )}

                {(thread.hasPendingApprovals || thread.hasPendingUserInput) && (
                  <p className="observed-thread-attention">
                    <strong>Needs attention:</strong>{" "}
                    {thread.hasPendingApprovals && "approval pending"}
                    {thread.hasPendingApprovals &&
                      thread.hasPendingUserInput &&
                      "; "}
                    {thread.hasPendingUserInput && "user input pending"}
                  </p>
                )}

                {association.state === "ambiguous" &&
                  association.candidateLabels &&
                  association.candidateLabels.length > 0 && (
                    <p className="observed-thread-candidates">
                      Candidates: {association.candidateLabels.join(", ")}
                    </p>
                  )}

                <div className="observed-thread-actions">
                  {onOpenThreadDetail && (
                    <button
                      className="secondary"
                      disabled={loading}
                      onClick={() => void onOpenThreadDetail(thread.threadId)}
                      type="button"
                    >
                      {loading ? "Loading details…" : "View details"}
                    </button>
                  )}
                  {onLinkThread && (
                    <div className="observed-link-control">
                      <span className="visually-hidden">Factory target</span>
                      <select
                        aria-label={`Factory target for ${thread.title}`}
                        disabled={!canMutate || busy || targets.length === 0}
                        onChange={(event) =>
                          setPendingTargets((current) => ({
                            ...current,
                            [thread.threadId]: event.target.value,
                          }))
                        }
                        value={
                          pendingTargets[thread.threadId] ??
                          association.target?.id ??
                          ""
                        }
                      >
                        <option value="">Choose Factory target</option>
                        {targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={
                          !canMutate ||
                          busy ||
                          !(
                            pendingTargets[thread.threadId] ??
                            association.target?.id
                          )
                        }
                        onClick={() => linkThread(thread)}
                        type="button"
                      >
                        {linked ? "Change link" : "Link"}
                      </button>
                    </div>
                  )}
                  {linked && onUnlinkThread && (
                    <button
                      className="secondary"
                      disabled={!canMutate || busy}
                      onClick={() =>
                        void onUnlinkThread(thread.threadId, association.linkId)
                      }
                      type="button"
                    >
                      Unlink
                    </button>
                  )}
                </div>
                {detail && (
                  <div
                    aria-label={"Bounded detail for " + thread.title}
                    className="observed-thread-detail"
                  >
                    <strong>Bounded detail</strong>
                    {detail.error ? (
                      <p>Details unavailable: {detail.error}</p>
                    ) : (
                      <>
                        <div className="observed-thread-detail-meta">
                          {detail.turnCount !== undefined && (
                            <span>
                              {detail.turnCount} turn
                              {detail.turnCount === 1 ? "" : "s"}
                            </span>
                          )}
                          {detail.activityCount !== undefined && (
                            <span>
                              {detail.activityCount} activity event
                              {detail.activityCount === 1 ? "" : "s"}
                            </span>
                          )}
                          {detail.checkpointCount !== undefined && (
                            <span>
                              {detail.checkpointCount} checkpoint
                              {detail.checkpointCount === 1 ? "" : "s"}
                            </span>
                          )}
                          {detail.sourceSequence !== undefined && (
                            <span>Source sequence {detail.sourceSequence}</span>
                          )}
                        </div>
                        {detail.checkpointFiles &&
                          detail.checkpointFiles.length > 0 && (
                            <p>
                              Checkpoint files:{" "}
                              {detail.checkpointFiles.join(", ")}
                            </p>
                          )}
                        <p>
                          Metadata only; transcript text is intentionally
                          omitted.
                        </p>
                      </>
                    )}
                  </div>
                )}
                <p className="observed-thread-authority">
                  Linking changes Factory metadata only; it does not control T3
                  or change Work State.
                </p>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty observed-empty">
          {unavailable
            ? "No current T3 activity is available."
            : "No T3 threads were observed for this Project."}
        </p>
      )}

      {findings.length > 0 && (
        <div
          aria-labelledby="observed-findings-title"
          className="observed-findings"
        >
          <div className="observed-findings-heading">
            <div>
              <p className="eyebrow">Reconciliation</p>
              <h3 id="observed-findings-title">Possible drift</h3>
            </div>
            <span>{findings.length}</span>
          </div>
          <div className="observed-finding-list">
            {findings.map((finding) => {
              const findingTime = formatObservedTime(finding.observedAt);
              return (
                <article
                  className={`observed-finding observed-finding-${finding.severity}`}
                  key={finding.id}
                >
                  <div className="observed-finding-heading">
                    <strong>{observedFindingLabel(finding.kind)}</strong>
                    {finding.targetLabel && <span>{finding.targetLabel}</span>}
                  </div>
                  <p>{finding.explanation}</p>
                  <p className="observed-finding-action">
                    <strong>Suggested action:</strong> {finding.suggestedAction}
                  </p>
                  {finding.candidateLabels &&
                    finding.candidateLabels.length > 0 && (
                      <p className="observed-thread-candidates">
                        Candidates: {finding.candidateLabels.join(", ")}
                      </p>
                    )}
                  {findingTime && <small>Observed {findingTime}</small>}
                  <p className="observed-finding-authority">
                    Observation only. It does not change Factory state or verify
                    work.
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
