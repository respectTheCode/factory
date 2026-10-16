import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  parseGitHubPullRequestUrl,
  type GitHubStatusSnapshot,
} from "../github";
import type {
  FloorAction,
  FloorSnapshot,
  FloorTaskCard,
  FloorTarget,
} from "./floor";
import { homeSessionIsFresh, homeTaskSentence } from "./home-model";
import "./simple-task-detail.css";

type TaskRecord = {
  id: string;
  simpleId: string;
  name: string;
  projectId: string;
  humanCheckText?: string;
  pullRequestUrl?: string;
  objective?: string;
  acceptanceCriteria: string[];
  screenshots?: Array<{
    id: string;
    caption: string;
    uploadedAt: Date | string;
    testedRevision?: string;
  }>;
  subtasks: Array<{
    id: string;
    simpleId: string;
    name: string;
    description?: string;
    evidence?: string;
    pullRequestUrl?: string;
    workState?: string;
    archiveState?: "released" | "wont_do";
    screenshots?: Array<{
      id: string;
      caption: string;
      uploadedAt: Date | string;
      testedRevision?: string;
    }>;
  }>;
  trackerLinks: Array<{
    id: string;
    system: "linear" | "notion";
    stableId: string;
    title?: string;
    url: string;
  }>;
};

type TaskStatusView = {
  taskRevision: number;
  taskState: string;
  taskCompleted: boolean;
  stateReason?: string;
  manualHold?: boolean;
  finishRule: {
    kind: "pr_merge" | "agent_report";
    requireHumanCheck: boolean;
    requiredPrCount?: number;
  };
  humanCheckText?: string;
  humanCheckReady: boolean;
  latestTaskReport?: {
    reporter: string;
    summary?: string;
    reason?: string;
    createdAt: Date | string;
    reportedState: string;
    testedRevision?: string;
  };
  finishMetadata?: {
    reason?: string;
    completedAt?: Date | string;
    actor?: string;
    source?: string;
  };
  requiredPullRequests: Array<{
    pullRequestUrl: string;
    required: boolean;
    merge?: {
      mergeSha: string;
      mergedAt: Date | string;
      defaultBranch: string;
    };
  }>;
  subtasks: Array<{
    subtaskId: string;
    effectiveState: string;
    verificationState: string;
    reportedState?: string;
    reason?: string;
    evidence?: string;
  }>;
};

export type TaskHistoryRow = {
  id: string;
  actor: string;
  at: Date | string;
  text: string;
};

export type HistoryPage = {
  items: TaskHistoryRow[];
  totalCount: number;
  nextCursor?: string;
};

type Props = {
  task: TaskRecord;
  status?: TaskStatusView;
  card?: FloorTaskCard;
  snapshot: FloorSnapshot | null;
  githubStatus?: GitHubStatusSnapshot;
  projectName: string;
  requests: FloorAction[];
  connected: boolean;
  canMutate: boolean;
  busy: boolean;
  freshnessLabel?: string;
  freshnessTone?: "live" | "stale" | "offline" | "quiet";
  onBack: () => void;
  onOpenControls: () => void;
  onOpenTarget: (target: FloorTarget) => void;
  onCheck: (
    reason: string | undefined,
    expectedRevision: number,
  ) => Promise<unknown>;
  onSendBack: (reason: string, expectedRevision: number) => Promise<unknown>;
  onLoadHistory: (limit: number, cursor?: string) => Promise<HistoryPage>;
  evidence?: ReactNode;
};

function localTime(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  });
}

function shortTime(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });
}

export function TaskHistoryEntries({
  history,
  expanded,
  loading,
  onToggle,
}: {
  history: HistoryPage;
  expanded: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <ol className="simple-task-history">
        {(expanded ? history.items : history.items.slice(0, 3)).map((item) => (
          <li key={item.id}>
            <time>{shortTime(item.at) ?? "Time unavailable"}</time>
            <span>{item.text}</span>
          </li>
        ))}
      </ol>
      {history.totalCount > 3 && (
        <button
          className="simple-task-link"
          disabled={loading}
          onClick={onToggle}
          type="button"
        >
          {loading
            ? "Loading…"
            : expanded
              ? history.nextCursor
                ? "Show more history"
                : "Show less"
              : `Show all ${history.totalCount}`}
        </button>
      )}
    </>
  );
}

function pullRequestLabel(url: string): string {
  try {
    return `PR #${parseGitHubPullRequestUrl(url).number}`;
  } catch {
    return "pull request";
  }
}

function taskStateLabel(state: string): string {
  switch (state) {
    case "backlog":
      return "Backlog";
    case "planned":
      return "Planned";
    case "active":
      return "In progress";
    case "blocked":
      return "Blocked";
    case "awaiting_verification":
      return "Waiting for finish evidence";
    case "completed":
      return "Done";
    case "released":
      return "Released";
    case "wont_do":
      return "Won’t do";
    default:
      return "Status unavailable";
  }
}

function requestTarget(task: TaskRecord, request: FloorAction): FloorTarget {
  return {
    projectId: task.projectId,
    taskId: task.id,
    ...(request.subtaskId ? { subtaskId: request.subtaskId } : {}),
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
    ...(request.threadId ? { threadId: request.threadId } : {}),
    ...(request.sourceId ? { sourceId: request.sourceId } : {}),
    ...(request.findingId ? { findingId: request.findingId } : {}),
    action: request.kind,
  };
}

function requestCopy(request: FloorAction): string {
  if (request.kind === "check") return "Ready for your check.";
  if (request.kind === "review")
    return "A pull request needs review in GitHub.";
  if (request.kind === "decide" && (request.threadId || request.sessionId)) {
    return "An agent is waiting for you in T3.";
  }
  if (request.kind === "unblock") {
    return request.label
      ? `Blocked on you: ${request.label}`
      : "Blocked on you.";
  }
  return request.label
    ? `Factory needs you to resolve a task tracking issue: ${request.label}`
    : "Factory needs you to resolve a task tracking issue.";
}

function stateReasonRepeatsHeadline(
  headline: string,
  reason: string | undefined,
): boolean {
  if (!reason) return false;
  const normalizedHeadline = headline.toLowerCase().replace(/[^a-z]+/gu, " ");
  const normalizedReason = reason.toLowerCase().replace(/[^a-z]+/gu, " ");
  if (
    normalizedHeadline.includes(normalizedReason) ||
    normalizedReason.includes(normalizedHeadline)
  ) {
    return true;
  }
  return (
    normalizedHeadline.includes("pull request") &&
    normalizedHeadline.includes("merge") &&
    normalizedReason.includes("pull request") &&
    normalizedReason.includes("merge")
  );
}

function agentName(identity: string | undefined): string {
  if (identity === "claude") return "Claude";
  if (identity === "codex") return "Codex";
  return identity ?? "Observed agent";
}

function statusHeadline(
  status: TaskStatusView | undefined,
  request?: FloorAction,
  card?: FloorTaskCard,
  snapshot: FloorSnapshot | null = null,
  now = Date.now(),
): string {
  if (request) return requestCopy(request);
  if (!status) return "Task status is unavailable.";
  if (status.taskState === "awaiting_verification") {
    if (status.humanCheckReady) {
      return `${status.latestTaskReport?.reporter ?? "An agent"} finished. It’s ready for your check.`;
    }
    if (status.finishRule.kind === "pr_merge") {
      const required = status.requiredPullRequests.filter(
        (request) => request.required,
      );
      const merged = required.filter((request) => request.merge).length;
      if (required.length > merged)
        return "Waiting for the required pull requests to merge.";
    }
    return "Factory doesn’t have the finish evidence needed to complete this task yet.";
  }
  if (status.taskState === "blocked") {
    return card
      ? homeTaskSentence(card, snapshot, now)
      : status.stateReason
        ? `Blocked: ${status.stateReason}`
        : "This task is blocked.";
  }
  if (
    status.taskState === "completed" ||
    status.taskState === "released" ||
    status.finishMetadata
  ) {
    return (
      card?.finishProvenance ??
      status.finishMetadata?.reason ??
      "This task is done."
    );
  }
  if (status.latestTaskReport?.reportedState === "finished") {
    return "An agent reported it finished. Factory is waiting for its finish rule.";
  }
  if (status.taskState === "active" && card) {
    return homeTaskSentence(card, snapshot, now);
  }
  return taskStateLabel(status.taskState) + ".";
}

export function SimpleTaskDetail({
  task,
  status,
  card,
  snapshot,
  githubStatus,
  projectName,
  requests,
  connected,
  canMutate,
  busy,
  freshnessLabel,
  freshnessTone = "quiet",
  onBack,
  onOpenControls,
  onOpenTarget,
  onCheck,
  onSendBack,
  onLoadHistory,
  evidence,
}: Props) {
  const primaryRequest = requests[0];
  const checkReady = Boolean(status?.humanCheckReady);
  const [moreOpen, setMoreOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(checkReady);
  const [sendBack, setSendBack] = useState(false);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [checkError, setCheckError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sendBackNotice, setSendBackNotice] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const statusHeadlineRef = useRef<HTMLHeadingElement>(null);
  const taskTitleRef = useRef<HTMLHeadingElement>(null);
  const moreRootRef = useRef<HTMLDivElement>(null);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const sendBackToggleRef = useRef<HTMLButtonElement>(null);
  const mutationDisabledReason = !connected
    ? "Factory is offline. This check can’t be recorded until it reconnects."
    : !canMutate
      ? "Your signed-in human session can’t record a check right now."
      : undefined;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      taskTitleRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [task.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!moreRootRef.current?.contains(event.target as Node))
        setMoreOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!sendBack) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSendBack(false);
      setReason("");
      setCheckError(null);
      sendBackToggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sendBack]);

  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    setHistoryError(null);
    void onLoadHistory(6)
      .then((result) => {
        if (active) setHistory(result);
      })
      .catch((error: unknown) => {
        if (active)
          setHistoryError(
            error instanceof Error
              ? error.message
              : "Task history is unavailable.",
          );
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [task.id, status?.taskRevision]);

  useEffect(() => {
    if (checkReady) setCheckOpen(true);
  }, [checkReady, status?.taskRevision]);

  const loadFullHistory = async () => {
    if (historyExpanded && !history?.nextCursor) {
      setHistoryExpanded(false);
      return;
    }
    setHistoryExpanded(true);
    if (!history?.nextCursor || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const page = await onLoadHistory(100, history.nextCursor);
      const knownIds = new Set(history.items.map((item) => item.id));
      const items = [
        ...history.items,
        ...page.items.filter((item) => !knownIds.has(item.id)),
      ];
      setHistory({
        items,
        totalCount: page.totalCount,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      });
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "Task history is unavailable.",
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  const submitCheck = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!status || !connected || !canMutate || busy) return;
    if (sendBack && !reason.trim()) {
      setCheckError("Say what needs to change so the agent knows what to do.");
      return;
    }
    setCheckError(null);
    try {
      if (sendBack) await onSendBack(reason.trim(), status.taskRevision);
      else await onCheck(note.trim() || undefined, status.taskRevision);
      setSendBackNotice(sendBack);
      setCheckOpen(false);
      setSendBack(false);
      setNote("");
      setReason("");
      window.requestAnimationFrame(() => statusHeadlineRef.current?.focus());
    } catch (error) {
      setCheckError(
        error instanceof Error
          ? error.message
          : "Your check could not be recorded.",
      );
    }
  };

  const done = Boolean(
    status?.taskCompleted ||
    status?.taskState === "completed" ||
    status?.taskState === "released" ||
    status?.finishMetadata ||
    card?.finishProvenance,
  );
  const statusTone =
    primaryRequest?.kind === "unblock"
      ? "blocked"
      : done
        ? "done"
        : status?.taskState === "blocked"
          ? "blocked"
          : primaryRequest || checkReady
            ? "needs"
            : card?.sessions.some(
                  (session) =>
                    session.state === "working" &&
                    homeSessionIsFresh(session.sourceId, snapshot, now),
                )
              ? "working"
              : "quiet";
  const headline = statusHeadline(status, primaryRequest, card, snapshot, now);
  const stateLabel =
    primaryRequest || checkReady
      ? "Needs you"
      : status?.taskState === "blocked"
        ? "Blocked"
        : status?.taskState === "awaiting_verification" &&
            status.finishRule.kind === "pr_merge"
          ? "Waiting for a merge"
          : taskStateLabel(status?.taskState ?? "unknown");
  const showStateReason =
    !primaryRequest &&
    status?.stateReason &&
    !stateReasonRepeatsHeadline(headline, status.stateReason);
  const activeSteps = task.subtasks.filter(
    (step) => step.archiveState !== "wont_do",
  );
  const completedSteps = activeSteps.filter((step) => {
    const stepStatus = status?.subtasks.find(
      (row) => row.subtaskId === step.id,
    );
    return (
      stepStatus?.effectiveState === "completed" ||
      stepStatus?.verificationState === "accepted" ||
      stepStatus?.reportedState === "complete"
    );
  }).length;
  const requiredPullRequests = status?.requiredPullRequests ?? [];
  const availablePRs = requiredPullRequests.length
    ? requiredPullRequests
    : task.pullRequestUrl
      ? [{ pullRequestUrl: task.pullRequestUrl, required: true }]
      : [];
  const unmergedRequiredPRs = availablePRs.filter(
    (request) => request.required && !request.merge,
  );

  return (
    <section className="simple-task-page" aria-labelledby="simple-task-title">
      <div className="simple-task-content">
        {freshnessLabel && (
          <p className={`home-freshness ${freshnessTone}`} role="status">
            <span aria-hidden="true" className="home-freshness-dot" />
            {freshnessLabel}
          </p>
        )}
        <button className="simple-task-back" onClick={onBack} type="button">
          ‹ Home
        </button>
        <div className="simple-task-heading">
          <div>
            <p className="simple-task-crumbs">
              <span>{projectName}</span>
              <span>{task.simpleId}</span>
            </p>
            <h1 id="simple-task-title" ref={taskTitleRef} tabIndex={-1}>
              {task.name}
            </h1>
          </div>
          <div className="simple-task-more" ref={moreRootRef}>
            <button
              aria-expanded={moreOpen}
              aria-controls="simple-task-more-menu"
              onClick={() => setMoreOpen((current) => !current)}
              ref={moreTriggerRef}
              type="button"
            >
              More
            </button>
            {moreOpen && (
              <div className="simple-task-more-menu" id="simple-task-more-menu">
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    onOpenControls();
                  }}
                  type="button"
                >
                  Open task controls in All tasks
                </button>
                <p>
                  Finish rules, status, editing, Steps and deletion keep their
                  current confirmations there.
                </p>
              </div>
            )}
          </div>
        </div>

        <section
          className={`simple-task-state ${statusTone}`}
          aria-labelledby="simple-task-state-title"
        >
          <p className="simple-task-state-label">
            <span className={`home-mark ${statusTone}`} aria-hidden="true" />
            {stateLabel}
          </p>
          <h2
            id="simple-task-state-title"
            ref={statusHeadlineRef}
            tabIndex={-1}
          >
            {headline}
          </h2>
          {showStateReason && <p>{status?.stateReason}</p>}
          {status?.latestTaskReport &&
            !(primaryRequest?.kind === "check" && checkOpen) && (
              <p className="simple-task-source">
                {`${agentName(status.latestTaskReport.reporter)} reported${
                  localTime(status.latestTaskReport.createdAt)
                    ? ` ${localTime(status.latestTaskReport.createdAt)}`
                    : ""
                }${
                  primaryRequest?.kind !== "check" &&
                  status.latestTaskReport.summary
                    ? `: ${status.latestTaskReport.summary}`
                    : "."
                }`}
              </p>
            )}
          {githubStatus?.pullRequest && (
            <p className="simple-task-source">
              GitHub pull request is{" "}
              {githubStatus.pullRequest.draft ? "a draft" : "open"}
              {githubStatus.pullRequest.state === "closed" ? " and closed" : ""}
              {localTime(githubStatus.fetchedAt)
                ? `, observed ${localTime(githubStatus.fetchedAt)}`
                : ""}
              .
            </p>
          )}
          {sendBackNotice && (
            <p className="simple-task-note" role="status">
              Factory recorded your note. The agent will see it the next time it
              reads this task; Factory hasn’t sent a message.
              {card?.sessions.find((session) => session.threadTitle)
                ?.threadTitle
                ? ` Its observed thread is “${card.sessions.find((session) => session.threadTitle)?.threadTitle}”.`
                : ""}
            </p>
          )}

          {primaryRequest &&
            !(primaryRequest.kind === "check" && checkOpen) && (
              <div className="simple-task-primary-action">
                {primaryRequest.kind === "review" ? (
                  unmergedRequiredPRs.length > 0 ? (
                    <span className="simple-task-pr-actions">
                      {unmergedRequiredPRs.map((request) => (
                        <a
                          className="simple-task-action primary"
                          href={request.pullRequestUrl}
                          key={request.pullRequestUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Review ${pullRequestLabel(request.pullRequestUrl)} on GitHub (opens in a new tab)`}
                        >
                          Review {pullRequestLabel(request.pullRequestUrl)} on
                          GitHub
                        </a>
                      ))}
                    </span>
                  ) : availablePRs.length === 0 ? (
                    <button
                      className="simple-task-action primary"
                      onClick={onOpenControls}
                      type="button"
                    >
                      Task controls
                    </button>
                  ) : (
                    <p className="simple-task-note">
                      No unmerged required pull requests need review.
                    </p>
                  )
                ) : primaryRequest.kind === "check" ? (
                  checkReady ? (
                    <button
                      className="simple-task-action primary"
                      onClick={() => setCheckOpen(true)}
                      type="button"
                    >
                      Check it
                    </button>
                  ) : (
                    <p className="simple-task-note" role="status">
                      The current task status does not show a check ready to
                      record.
                    </p>
                  )
                ) : primaryRequest.threadId || primaryRequest.sessionId ? (
                  <div>
                    <button
                      aria-describedby={
                        !connected ? "simple-thread-disabled" : undefined
                      }
                      aria-disabled={!connected ? "true" : undefined}
                      className="simple-task-action primary"
                      disabled={!connected}
                      onClick={() =>
                        onOpenTarget(requestTarget(task, primaryRequest))
                      }
                      type="button"
                    >
                      Thread details
                    </button>
                    {!connected && (
                      <span
                        className="visually-hidden"
                        id="simple-thread-disabled"
                      >
                        Factory is offline. Thread details are unavailable until
                        it reconnects.
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    className="simple-task-action primary"
                    onClick={onOpenControls}
                    type="button"
                  >
                    Task controls
                  </button>
                )}
              </div>
            )}

          {requests.length > 1 && (
            <div className="simple-task-also">
              <h3>Also needs you</h3>
              <ul>
                {requests.slice(1).map((request) => (
                  <li key={request.id}>
                    <span>
                      {requestCopy(request)} <small>{request.ageLabel}</small>
                    </span>
                    {request.threadId || request.sessionId ? (
                      <span>
                        <button
                          aria-describedby={
                            !connected
                              ? `also-thread-disabled-${request.id}`
                              : undefined
                          }
                          className="simple-task-link"
                          disabled={!connected}
                          onClick={() =>
                            onOpenTarget(requestTarget(task, request))
                          }
                          type="button"
                        >
                          Thread details
                        </button>
                        {!connected && (
                          <span
                            className="visually-hidden"
                            id={`also-thread-disabled-${request.id}`}
                          >
                            Factory is offline. Thread details are unavailable
                            until it reconnects.
                          </span>
                        )}
                      </span>
                    ) : request.kind === "check" ? (
                      <span>
                        <button
                          aria-describedby={
                            !checkReady || mutationDisabledReason
                              ? `also-check-disabled-${request.id}`
                              : undefined
                          }
                          className="simple-task-link"
                          disabled={
                            !checkReady || Boolean(mutationDisabledReason)
                          }
                          onClick={() => {
                            setSendBack(false);
                            setCheckOpen(true);
                            setCheckError(null);
                          }}
                          type="button"
                        >
                          Check it
                        </button>
                        {(!checkReady || mutationDisabledReason) && (
                          <span
                            className="visually-hidden"
                            id={`also-check-disabled-${request.id}`}
                          >
                            {mutationDisabledReason ??
                              "The current task status does not show a check ready to record."}
                          </span>
                        )}
                      </span>
                    ) : request.kind === "review" &&
                      unmergedRequiredPRs.length > 0 ? (
                      <span className="simple-task-pr-links">
                        {unmergedRequiredPRs.map((pullRequest) => (
                          <a
                            className="simple-task-link"
                            href={pullRequest.pullRequestUrl}
                            key={pullRequest.pullRequestUrl}
                            rel="noopener noreferrer"
                            target="_blank"
                            aria-label={`Review ${pullRequestLabel(pullRequest.pullRequestUrl)} on GitHub (opens in a new tab)`}
                          >
                            Review{" "}
                            {pullRequestLabel(pullRequest.pullRequestUrl)} on
                            GitHub
                          </a>
                        ))}
                      </span>
                    ) : request.kind === "review" && availablePRs.length > 0 ? (
                      <span>No unmerged required PRs</span>
                    ) : (
                      <button
                        className="simple-task-link"
                        onClick={onOpenControls}
                        type="button"
                      >
                        Task controls
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {checkOpen && checkReady && (
            <form
              className="simple-check-form"
              onSubmit={(event) => void submitCheck(event)}
            >
              {status?.humanCheckText && (
                <blockquote>
                  <p>{status.humanCheckText}</p>
                  <footer>What this task asked you to check</footer>
                </blockquote>
              )}
              {status?.latestTaskReport?.summary && (
                <p className="simple-task-report">
                  {status.latestTaskReport.reporter}: “
                  {status.latestTaskReport.summary}”
                </p>
              )}
              {sendBack ? (
                <label>
                  What needs to change?
                  <textarea
                    aria-describedby={
                      mutationDisabledReason
                        ? "simple-check-disabled"
                        : undefined
                    }
                    disabled={Boolean(mutationDisabledReason) || busy}
                    onChange={(event) => setReason(event.target.value)}
                    value={reason}
                  />
                </label>
              ) : (
                <label>
                  What you checked <span>(optional)</span>
                  <input
                    aria-describedby={
                      mutationDisabledReason
                        ? "simple-check-disabled"
                        : undefined
                    }
                    disabled={Boolean(mutationDisabledReason) || busy}
                    onChange={(event) => setNote(event.target.value)}
                    value={note}
                  />
                </label>
              )}
              {mutationDisabledReason && (
                <p className="simple-check-hint" id="simple-check-disabled">
                  {mutationDisabledReason}
                </p>
              )}
              {checkError && (
                <p className="simple-check-error" role="alert">
                  {checkError}
                </p>
              )}
              <div className="simple-check-actions">
                <button
                  className="simple-task-action primary"
                  disabled={Boolean(mutationDisabledReason) || busy || !status}
                  type="submit"
                >
                  {sendBack ? "Send back to agent" : "Mark checked"}
                </button>
                <button
                  className="simple-task-action secondary"
                  disabled={Boolean(mutationDisabledReason) || busy}
                  onClick={() => {
                    setSendBack((current) => !current);
                    setCheckError(null);
                  }}
                  ref={sendBackToggleRef}
                  type="button"
                >
                  {sendBack ? "Back to check" : "Send back…"}
                </button>
                <button
                  className="simple-task-action secondary"
                  onClick={() => {
                    setCheckOpen(false);
                    setCheckError(null);
                    window.requestAnimationFrame(() =>
                      statusHeadlineRef.current?.focus(),
                    );
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {!primaryRequest && unmergedRequiredPRs.length > 0 && !done && (
            <p className="simple-task-pr-links">
              {unmergedRequiredPRs.map((request) => (
                <a
                  className="simple-task-link"
                  href={request.pullRequestUrl}
                  key={request.pullRequestUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                  aria-label={`Review ${pullRequestLabel(request.pullRequestUrl)} on GitHub (opens in a new tab)`}
                >
                  Review {pullRequestLabel(request.pullRequestUrl)} on GitHub
                </a>
              ))}
            </p>
          )}
        </section>

        {task.subtasks.length > 0 && (
          <section
            className="simple-task-part"
            aria-labelledby="simple-task-steps-title"
          >
            <h2 id="simple-task-steps-title">
              Steps{" "}
              <span>
                {completedSteps} of {activeSteps.length} done
              </span>
            </h2>
            <ol className="simple-task-steps">
              {task.subtasks.map((step) => {
                const stepStatus = status?.subtasks.find(
                  (row) => row.subtaskId === step.id,
                );
                const state =
                  step.archiveState === "wont_do"
                    ? "Skipped"
                    : stepStatus?.verificationState === "accepted" ||
                        stepStatus?.effectiveState === "completed" ||
                        stepStatus?.reportedState === "complete"
                      ? "Done"
                      : stepStatus?.effectiveState === "in_progress" ||
                          stepStatus?.reportedState === "in_progress"
                        ? "Doing"
                        : stepStatus?.effectiveState === "blocked" ||
                            stepStatus?.reportedState === "blocked"
                          ? "Blocked"
                          : "To do";
                const leftOpen =
                  status?.taskCompleted &&
                  state !== "Done" &&
                  state !== "Skipped";
                return (
                  <li key={step.id}>
                    <span
                      className={`simple-step-mark ${state === "Done" ? "done" : state === "Blocked" ? "blocked" : "quiet"}`}
                      aria-hidden="true"
                    />
                    <span>
                      {step.name}
                      {state === "Blocked" && stepStatus?.reason ? (
                        <small>Blocked: {stepStatus.reason}</small>
                      ) : null}
                    </span>
                    <span className="simple-step-state">
                      {leftOpen ? "Left open" : state}
                    </span>
                  </li>
                );
              })}
            </ol>
            {status?.taskCompleted && completedSteps < activeSteps.length && (
              <p className="simple-task-note">
                Steps don’t decide when a task is done.
              </p>
            )}
          </section>
        )}

        <section
          className="simple-task-part"
          aria-labelledby="simple-task-history-title"
        >
          <h2 id="simple-task-history-title">What happened</h2>
          {historyLoading && !history ? (
            <p className="simple-task-note">Loading task history…</p>
          ) : historyError ? (
            <p className="simple-check-error" role="status">
              {historyError}
            </p>
          ) : history?.items.length ? (
            <TaskHistoryEntries
              expanded={historyExpanded}
              history={history}
              loading={historyLoading}
              onToggle={() => void loadFullHistory()}
            />
          ) : (
            <p className="simple-task-note">
              No task history has been recorded.
            </p>
          )}
        </section>

        <details className="simple-task-evidence">
          <summary>Evidence</summary>
          <p className="simple-task-note">
            Factory records what agents and connected services report. It
            doesn’t judge the work.
          </p>
          <dl>
            <dt>How it finishes</dt>
            <dd>
              {status?.finishRule.kind === "pr_merge"
                ? status.requiredPullRequests.filter(
                    (request) => request.required,
                  ).length > 0
                  ? `Required pull requests merge (${status.requiredPullRequests.filter((request) => request.merge && request.required).length} of ${status.requiredPullRequests.filter((request) => request.required).length} required merged).`
                  : "No required pull requests are recorded."
                : "An agent must report that it finished."}{" "}
              {status?.finishRule.requireHumanCheck
                ? "A human check is also required."
                : ""}
            </dd>
            {availablePRs.length > 0 && (
              <>
                <dt>Pull requests</dt>
                <dd>
                  {availablePRs.map((request) => (
                    <p key={request.pullRequestUrl}>
                      <a
                        href={request.pullRequestUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                        aria-label={`${pullRequestLabel(request.pullRequestUrl)} on GitHub (opens in a new tab)`}
                      >
                        {pullRequestLabel(request.pullRequestUrl)} on GitHub
                      </a>
                      {request.merge ? (
                        <span>
                          {" "}
                          Merged into {request.merge.defaultBranch} at{" "}
                          {localTime(request.merge.mergedAt) ??
                            "a recorded time"}
                          . Merge revision {request.merge.mergeSha}.
                        </span>
                      ) : (
                        <span> Merge not recorded.</span>
                      )}
                    </p>
                  ))}
                </dd>
              </>
            )}
            {card?.sessions.length ? (
              <>
                <dt>Agent sessions</dt>
                <dd>
                  {card.sessions.map((session) => (
                    <p className="simple-task-session" key={session.id}>
                      {agentName(session.worker?.identity)}
                      {session.threadTitle
                        ? ` in “${session.threadTitle}”`
                        : ""}
                      {session.observedAt
                        ? `, seen ${localTime(session.observedAt) ?? "at an unknown time"}`
                        : ""}
                      {session.threadId && (
                        <button
                          className="simple-task-link"
                          disabled={!connected}
                          onClick={() =>
                            onOpenTarget({
                              projectId: task.projectId,
                              taskId: task.id,
                              threadId: session.threadId,
                              sourceId: session.sourceId,
                              sessionId: session.threadId,
                              action: "decide",
                            })
                          }
                          type="button"
                        >
                          Thread details
                        </button>
                      )}
                    </p>
                  ))}
                </dd>
              </>
            ) : null}
            {task.objective && (
              <>
                <dt>Objective</dt>
                <dd>{task.objective}</dd>
              </>
            )}
            {task.acceptanceCriteria.length > 0 && (
              <>
                <dt>Requirements</dt>
                <dd>
                  <ul>
                    {task.acceptanceCriteria.map((criterion, index) => (
                      <li key={`${index}:${criterion}`}>{criterion}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
            {task.trackerLinks.length > 0 && (
              <>
                <dt>Tracker</dt>
                <dd>
                  {task.trackerLinks.map((link) => (
                    <p key={link.id}>
                      <a
                        href={link.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        Requirements in{" "}
                        {link.system === "linear" ? "Linear" : "Notion"}
                        {link.title ? `, ${link.title}` : `, ${link.stableId}`}
                      </a>
                    </p>
                  ))}
                </dd>
              </>
            )}
            {status?.finishMetadata && (
              <>
                <dt>Finish recorded</dt>
                <dd>
                  {status.finishMetadata.actor
                    ? `${status.finishMetadata.actor}, `
                    : ""}
                  {localTime(status.finishMetadata.completedAt) ??
                    "time unavailable"}
                  {status.finishMetadata.reason
                    ? `, ${status.finishMetadata.reason}`
                    : ""}
                </dd>
              </>
            )}
          </dl>
          {evidence}
        </details>
      </div>
    </section>
  );
}
