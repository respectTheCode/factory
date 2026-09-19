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
  machineId?: string;
  error?: string;
  lastSuccessfulFetchAt?: string;
  observedAt?: string;
  sourceVersion?: string;
  state: ObservedConnectionState;
  sourceId?: string;
  warning?: string;
};

export type ObservedTarget = {
  id: string;
  kind: "task" | "subtask";
  label: string;
};

export type ObservedAssociationLink = {
  linkId: string;
  target: ObservedTarget;
};

export type ObservedAssociation = {
  candidateIds?: string[];
  links: ObservedAssociationLink[];
  state: "linked" | "suggested" | "unmatched" | "ambiguous";
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
  machineId?: string;
  provider?: string;
  sourceId?: string;
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
    | "source_unavailable"
    | "project_unresolved";
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
  suggested: number;
  unmatched: number;
};

export type ObservedActivityViewModel = {
  connection: ObservedConnection;
  counts: ObservedActivityCounts;
  findings: ReconciliationFinding[];
  projectName?: string;
  targets: ObservedTarget[];
  threads: ObservedThread[];
  sources?: ObservedActivitySource[];
};

export type ObservedActivitySource = {
  connection: ObservedConnection;
  counts: ObservedActivityCounts;
  error?: string;
  label?: string;
  machineId: string;
  sourceId: string;
  status: string;
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
    sourceId?: string,
  ) => void | Promise<void>;
  onOpenThreadDetail?: (
    threadId: string,
    sourceId?: string,
  ) => void | Promise<void>;
  onRefresh?: () => void | Promise<void>;
  onUnlinkThread?: (
    threadId: string,
    linkId?: string,
    sourceId?: string,
  ) => void | Promise<void>;
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
  project_unresolved: "Project unresolved",
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

export function suggestedAssociationTarget(
  association: ObservedAssociation,
  targets: readonly ObservedTarget[],
): ObservedTarget | undefined {
  if (
    association.state !== "suggested" ||
    association.candidateIds?.length !== 1
  ) {
    return undefined;
  }
  return targets.find((target) => target.id === association.candidateIds?.[0]);
}

export function observedThreadKey(threadId: string, sourceId?: string): string {
  return `${sourceId ?? "legacy"}:${threadId}`;
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
    suggested: 0,
    unmatched: 0,
  };
  const threads = activity?.threads ?? [];
  const findings = activity?.findings ?? [];
  const targets = activity?.targets ?? [];
  const sources = activity?.sources ?? [];
  const lastFetch = formatObservedTime(
    connection.lastSuccessfulFetchAt ?? connection.observedAt,
  );
  const unavailable = connection.state !== "connected";
  const sourceNeedsReview = unavailable || Boolean(connection.warning);

  const linkTarget = (thread: ObservedThread, target: ObservedTarget) => {
    if (!onLinkThread) return;
    const key = observedThreadKey(thread.threadId, thread.sourceId);
    void Promise.resolve(
      onLinkThread(thread.threadId, target, thread.sourceId),
    ).then(() =>
      setPendingTargets((current) => ({
        ...current,
        [key]: "",
      })),
    );
  };

  const linkThread = (thread: ObservedThread) => {
    const key = observedThreadKey(thread.threadId, thread.sourceId);
    const targetId = pendingTargets[key];
    const target = targets.find((candidate) => candidate.id === targetId);
    if (!target) return;
    linkTarget(thread, target);
  };

  return (
    <details className="panel observed-activity" data-observed-activity="true">
      <summary className="observed-activity-summary">
        <span className="observed-activity-summary-title">
          <span className="eyebrow">Execution observations</span>
          <span
            aria-level={2}
            className="observed-activity-summary-heading"
            id="observed-activity-title"
            role="heading"
          >
            Observed activity
          </span>
        </span>
        <span className="observed-activity-summary-state">
          <span
            className={`observed-connection observed-connection-${connectionTone(connection.state)}`}
            data-observed-connection={connection.state}
          >
            <span aria-hidden="true" className="observed-connection-dot" />
            {observedConnectionLabel(connection.state)}
          </span>
          <span className="observed-activity-summary-counts">
            {threads.length} session{threads.length === 1 ? "" : "s"} ·{" "}
            {counts.running} running · {counts.needsAttention} needing attention
          </span>
        </span>
      </summary>

      <div className="observed-activity-header">
        <p className="observed-authority-copy">
          T3 activity is read-only evidence. Factory remains the planning and
          verification authority.
        </p>
        <div className="observed-activity-header-actions">
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

      {sources.length > 1 && (
        <div
          aria-label="T3 source connections"
          className="observed-source-list"
        >
          {sources.map((source) => (
            <div className="observed-source-row" key={source.sourceId}>
              <strong>{source.label ?? source.sourceId}</strong>
              <span>{source.machineId}</span>
              <span data-observed-source-state={source.connection.state}>
                {observedConnectionLabel(source.connection.state)}
              </span>
              {formatObservedTime(
                source.connection.lastSuccessfulFetchAt ??
                  source.connection.observedAt,
              ) && (
                <span>
                  Last observed{" "}
                  {formatObservedTime(
                    source.connection.lastSuccessfulFetchAt ??
                      source.connection.observedAt,
                  )}
                </span>
              )}
              {source.error && <span>{source.error}</span>}
            </div>
          ))}
        </div>
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
          <strong>{counts.suggested}</strong>
          <span>Suggested</span>
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
            const linked =
              association.state === "linked" && association.links.length > 0;
            const suggestedTarget = suggestedAssociationTarget(
              association,
              targets,
            );
            const threadKey = observedThreadKey(
              thread.threadId,
              thread.sourceId,
            );
            const loading = threadDetailLoadingIds?.has(threadKey) ?? false;
            const threadTime = formatObservedTime(
              thread.sourceUpdatedAt ?? thread.observedAt,
            );
            const detail = threadDetails?.[threadKey];
            return (
              <article
                className="observed-thread"
                key={observedThreadKey(thread.threadId, thread.sourceId)}
              >
                <div className="observed-thread-heading">
                  <div className="observed-thread-title">
                    <strong>{thread.title || "Untitled T3 thread"}</strong>
                    <code>{thread.threadId}</code>
                  </div>
                  <span
                    className={`observed-thread-association observed-thread-association-${association.state}${
                      association.state === "suggested"
                        ? " observed-thread-association-linked"
                        : ""
                    }`}
                  >
                    {linked
                      ? association.links.length === 1
                        ? `Linked to ${association.links[0]?.target.label}`
                        : `Linked to ${association.links.length} targets`
                      : association.state === "ambiguous"
                        ? "Ambiguous target"
                        : association.state === "suggested"
                          ? "Suggested"
                          : "Unmatched"}
                  </span>
                </div>

                <div className="observed-thread-meta">
                  <span>{threadStateLabel(thread)}</span>
                  {thread.provider && <span>{thread.provider}</span>}
                  {thread.sourceId && <span>Source: {thread.sourceId}</span>}
                  {thread.machineId && <span>Machine: {thread.machineId}</span>}
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

                {(association.state === "ambiguous" ||
                  association.state === "suggested") &&
                  association.candidateLabels &&
                  association.candidateLabels.length > 0 && (
                    <p className="observed-thread-candidates">
                      {association.state === "suggested"
                        ? `Suggested target: ${association.candidateLabels[0]}`
                        : `Candidates: ${association.candidateLabels.join(", ")}`}
                    </p>
                  )}

                {linked && (
                  <ul
                    aria-label={`Factory associations for ${thread.title}`}
                    className="observed-thread-links"
                  >
                    {association.links.map((link) => (
                      <li key={link.linkId}>{link.target.label}</li>
                    ))}
                  </ul>
                )}

                <div className="observed-thread-actions">
                  {onOpenThreadDetail && (
                    <button
                      className="secondary"
                      disabled={loading}
                      onClick={() =>
                        void onOpenThreadDetail(
                          thread.threadId,
                          thread.sourceId,
                        )
                      }
                      type="button"
                    >
                      {loading ? "Loading details…" : "View details"}
                    </button>
                  )}
                  {(onLinkThread || (linked && onUnlinkThread)) && (
                    <details className="observed-association-manager">
                      <summary>Manage associations</summary>
                      <p>
                        Manual fallback. Agents normally associate their T3
                        session when they resolve Factory work. Linking changes
                        Factory metadata only; it does not control T3 or change
                        Work State.
                      </p>
                      {suggestedTarget && (
                        <button
                          className="secondary"
                          disabled={!canMutate || busy}
                          onClick={() => linkTarget(thread, suggestedTarget)}
                          type="button"
                        >
                          Link suggested target
                        </button>
                      )}
                      {onLinkThread && (
                        <div className="observed-link-control">
                          <span className="visually-hidden">
                            Factory target
                          </span>
                          <select
                            aria-label={`Factory target for ${thread.title}`}
                            disabled={
                              !canMutate || busy || targets.length === 0
                            }
                            onChange={(event) =>
                              setPendingTargets((current) => ({
                                ...current,
                                [threadKey]: event.target.value,
                              }))
                            }
                            value={pendingTargets[threadKey] ?? ""}
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
                              !canMutate || busy || !pendingTargets[threadKey]
                            }
                            onClick={() => linkThread(thread)}
                            type="button"
                          >
                            Add association
                          </button>
                        </div>
                      )}
                      {linked && onUnlinkThread && (
                        <ul className="observed-association-removals">
                          {association.links.map((link) => (
                            <li key={link.linkId}>
                              <span>{link.target.label}</span>
                              <button
                                className="secondary"
                                disabled={!canMutate || busy}
                                onClick={() =>
                                  void onUnlinkThread(
                                    thread.threadId,
                                    link.linkId,
                                    thread.sourceId,
                                  )
                                }
                                type="button"
                              >
                                Remove
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
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
    </details>
  );
}
