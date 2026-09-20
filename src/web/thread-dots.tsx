import { useEffect, useState } from "react";

import {
  observedThreadKey,
  type ObservedActivityViewModel,
  type ObservedConnection,
  type ObservedTarget,
  type ObservedThread,
} from "./observed-activity";

export type ThreadDotsActivity = Pick<
  ObservedActivityViewModel,
  "connection" | "sources" | "threads"
>;

export type ThreadDotTone =
  | "active"
  | "attention"
  | "error"
  | "neutral"
  | "ready";

export type ThreadDotState = {
  label: string;
  unknown: boolean;
  stale: boolean;
  tone: ThreadDotTone;
};

export type ThreadDot = {
  key: string;
  state: ThreadDotState;
  thread: ObservedThread;
};

export type ThreadDotsProps = {
  activity: ThreadDotsActivity | null;
  onOpenThread?: (threadId: string, sourceId?: string) => void | Promise<void>;
  target: ObservedTarget;
};

// Match reconciliation's existing recent-activity window. A successful T3
// refresh keeps a thread observation current even when that thread is idle.
export const THREAD_DOT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function normalizedState(value: string | undefined): string | undefined {
  return value?.replaceAll("_", " ");
}

function threadStateLabel(thread: ObservedThread): string {
  if (
    thread.latestSessionState === "error" ||
    thread.latestTurnState === "error"
  ) {
    return "error";
  }
  if (thread.hasPendingApprovals && thread.hasPendingUserInput) {
    return "waiting for approval and user input";
  }
  if (thread.hasPendingApprovals) {
    return "waiting for approval";
  }
  if (thread.hasPendingUserInput) {
    return "waiting for user input";
  }
  const session = normalizedState(thread.latestSessionState);
  const turn = normalizedState(thread.latestTurnState);
  if (session && turn) return `${session} · turn ${turn}`;
  if (session) return session;
  if (turn) return `turn ${turn}`;
  return "state not reported";
}

function sourceConnectionState(
  activity: ThreadDotsActivity,
  thread: ObservedThread,
): string {
  if (thread.sourceId === undefined) return activity.connection.state;
  return (
    activity.sources?.find((source) => source.sourceId === thread.sourceId)
      ?.connection.state ??
    (activity.sources && activity.sources.length > 0
      ? "unknown"
      : activity.connection.state)
  );
}

function sourceFreshness(
  activity: ThreadDotsActivity,
  thread: ObservedThread,
  now: Date,
): "fresh" | "stale" | "unknown" {
  const source: Pick<
    ObservedConnection,
    "lastSuccessfulFetchAt" | "observedAt"
  > =
    thread.sourceId === undefined
      ? activity.connection
      : (activity.sources?.find(
          (candidate) => candidate.sourceId === thread.sourceId,
        )?.connection ??
        (activity.sources && activity.sources.length > 0
          ? {}
          : activity.connection));
  const value = source.lastSuccessfulFetchAt ?? source.observedAt;
  if (!value) return "unknown";
  const fetchedAt = new Date(value);
  if (Number.isNaN(fetchedAt.getTime())) return "unknown";
  return now.getTime() - fetchedAt.getTime() > THREAD_DOT_STALE_AFTER_MS
    ? "stale"
    : "fresh";
}

export function threadDotState(
  activity: ThreadDotsActivity,
  thread: ObservedThread,
  now: Date = new Date(),
): ThreadDotState {
  const unavailable = sourceConnectionState(activity, thread) !== "connected";
  const freshness = sourceFreshness(activity, thread, now);
  const stale = freshness === "stale";
  if (unavailable) {
    return {
      label: "observation unavailable",
      stale,
      tone: "neutral",
      unknown: false,
    };
  }
  if (stale) {
    return {
      label: "stale observation",
      stale: true,
      tone: "neutral",
      unknown: false,
    };
  }
  if (freshness === "unknown") {
    return {
      label: "observation age unknown",
      stale: false,
      tone: "neutral",
      unknown: true,
    };
  }

  const label = threadStateLabel(thread);
  if (label === "error") {
    return { label, stale: false, tone: "error", unknown: false };
  }
  if (label.startsWith("waiting for ")) {
    return { label, stale: false, tone: "attention", unknown: false };
  }
  if (
    thread.latestSessionState === "running" ||
    thread.latestSessionState === "starting" ||
    thread.latestTurnState === "running"
  ) {
    return { label, stale: false, tone: "active", unknown: false };
  }
  if (
    thread.latestSessionState === "idle" ||
    thread.latestSessionState === "ready" ||
    thread.latestTurnState === "completed"
  ) {
    return { label, stale: false, tone: "ready", unknown: false };
  }
  return { label, stale: false, tone: "neutral", unknown: false };
}

export function getThreadDots(
  activity: ThreadDotsActivity | null,
  target: ObservedTarget,
  now: Date = new Date(),
): ThreadDot[] {
  if (!activity) return [];
  return activity.threads
    .filter(
      (thread) =>
        thread.association.state === "linked" &&
        thread.association.links.some(
          (link) =>
            link.target.id === target.id && link.target.kind === target.kind,
        ),
    )
    .map((thread) => ({
      key: observedThreadKey(thread.threadId, thread.sourceId),
      state: threadDotState(activity, thread, now),
      thread,
    }));
}

function threadDotElementId(target: ObservedTarget, key: string): string {
  return `thread-dot-${target.kind}-${target.id}-${key}`.replace(
    /[^a-z0-9_-]+/gi,
    "-",
  );
}

export function ThreadDots({
  activity,
  onOpenThread,
  target,
}: ThreadDotsProps) {
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const dots = getThreadDots(activity, target, clock);
  if (dots.length === 0) return null;

  return (
    <span
      aria-label={`Observed T3 threads for ${target.label}`}
      className="thread-dots"
    >
      {dots.map((dot) => {
        const title = dot.thread.title || "Untitled T3 thread";
        const detailId = threadDotElementId(target, dot.key);
        const state = dot.state;
        return (
          <details
            className="thread-dot-disclosure"
            data-thread-dot-key={dot.key}
            key={dot.key}
          >
            <summary
              aria-controls={detailId}
              aria-label={`T3 thread ${title}: ${state.label}`}
              className={`thread-dot-trigger thread-dot-${state.tone}`}
              title={`${title} · ${state.label}`}
            >
              <span aria-hidden="true" className="thread-dot" />
            </summary>
            <div className="thread-dot-popover" id={detailId} role="group">
              <strong>{title}</strong>
              <span>{state.label}</span>
              {dot.thread.sourceId && (
                <small>Source: {dot.thread.sourceId}</small>
              )}
              {state.stale && (
                <small>Refresh observations to check again.</small>
              )}
              {onOpenThread ? (
                <button
                  className="thread-dot-link"
                  onClick={(event) => {
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                    void onOpenThread(dot.thread.threadId, dot.thread.sourceId);
                  }}
                  type="button"
                >
                  Open thread details
                </button>
              ) : (
                <small>Thread details unavailable.</small>
              )}
            </div>
          </details>
        );
      })}
    </span>
  );
}
