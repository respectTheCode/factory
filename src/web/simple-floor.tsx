import { useEffect, useState, type ReactNode } from "react";

import type { FloorQueueAction } from "../floor";
import type {
  FloorAction,
  FloorBay,
  FloorSnapshot,
  FloorTarget,
} from "./floor";
import {
  buildHomeGroups,
  homeFreshness,
  homeRequestLabel,
  homeSessionIsFresh,
  homeTaskSentence,
  homeTimeOf,
  type HomeRow,
} from "./home-model";

const PROJECT_FILTER_KEY = "factory.home.project.v1";

type Props = {
  busy?: boolean;
  canMutate?: boolean;
  connected: boolean;
  error?: string | null;
  loading: boolean;
  onOpenTarget: (target: FloorTarget) => void;
  onOpenAllTasks?: (projectId?: string) => void;
  onOpenConnections?: () => void;
  focusTaskId?: string | null;
  onTaskFocusRestored?: () => void;
  snapshot: FloorSnapshot | null;
};

function readProjectFilter(): string {
  if (typeof window === "undefined") return "all";
  try {
    return window.localStorage.getItem(PROJECT_FILTER_KEY) ?? "all";
  } catch {
    return "all";
  }
}

function saveProjectFilter(value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECT_FILTER_KEY, value);
  } catch {
    // Storage may be unavailable in private browsing.
  }
}

function relativeAge(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function requestSentence(item: FloorAction): string {
  switch (item.kind) {
    case "check":
      return "An agent finished. The task is ready for your check.";
    case "review":
      return "A pull request needs review in GitHub.";
    case "decide":
      return item.threadId || item.sessionId
        ? "An agent is waiting for you in T3."
        : `Factory needs you to resolve a task tracking issue${item.label ? `: ${item.label}` : "."}`;
    case "unblock":
      return item.label ? `Blocked on you: ${item.label}` : "Blocked on you.";
  }
}

function isThreadAction(item: FloorAction): boolean {
  return Boolean(item.threadId || item.sessionId);
}

function requestTarget(row: HomeRow, item: FloorAction): FloorTarget {
  return {
    projectId: row.projectId,
    ...(row.taskId
      ? { taskId: row.taskId }
      : item.taskId
        ? { taskId: item.taskId }
        : {}),
    ...(item.subtaskId ? { subtaskId: item.subtaskId } : {}),
    ...(item.sessionId ? { sessionId: item.sessionId } : {}),
    ...(item.threadId ? { threadId: item.threadId } : {}),
    ...(item.sourceId ? { sourceId: item.sourceId } : {}),
    ...(item.findingId ? { findingId: item.findingId } : {}),
    action: item.kind,
  };
}

function requestAge(item: FloorAction): string {
  return `waiting ${item.ageLabel}`;
}

function taskMeta(
  row: HomeRow,
  snapshot: FloorSnapshot | null,
): string | undefined {
  if (row.task?.state === "completed") {
    const doneAt = homeTimeOf(row.task.completedAt);
    return doneAt ? `done ${doneAt}` : undefined;
  }
  const working = row.task?.sessions.find(
    (session) =>
      session.state === "working" &&
      homeSessionIsFresh(session.sourceId, snapshot),
  );
  const seen = relativeAge(working?.observedAt);
  return seen ? `seen ${seen}` : undefined;
}

function HomeMark({ kind }: { kind: string }) {
  return <span className={`home-mark ${kind}`} aria-hidden="true" />;
}

function HomeRequestAction({
  row,
  item,
  connected,
  canMutate,
  onOpenTarget,
  secondary = false,
}: {
  row: HomeRow;
  item: FloorAction;
  connected: boolean;
  canMutate: boolean;
  onOpenTarget: Props["onOpenTarget"];
  secondary?: boolean;
}) {
  const thread = isThreadAction(item);
  const label = homeRequestLabel(item.kind as FloorQueueAction, thread);
  if (!label) return null;
  const blockedReason =
    !connected && thread
      ? "Factory is offline. Thread details are unavailable until it reconnects."
      : item.kind === "check" && !canMutate
        ? "A signed-in human session is required to record this check."
        : undefined;
  return (
    <button
      aria-describedby={
        blockedReason ? `request-disabled-${item.id}` : undefined
      }
      aria-disabled={blockedReason ? "true" : undefined}
      aria-label={`${label}, ${row.title}`}
      className={
        secondary ? "home-action home-action-secondary" : "home-action"
      }
      disabled={Boolean(blockedReason)}
      onClick={() => onOpenTarget(requestTarget(row, item))}
      title={blockedReason}
      type="button"
    >
      {label}
      {blockedReason && (
        <span className="visually-hidden" id={`request-disabled-${item.id}`}>
          {blockedReason}
        </span>
      )}
    </button>
  );
}

function SummaryRow({
  row,
  group,
  snapshot,
  now,
  connected,
  canMutate,
  onOpenTarget,
}: {
  row: HomeRow;
  group: "needs" | "progress" | "done";
  snapshot: FloorSnapshot | null;
  now: number;
  connected: boolean;
  canMutate: boolean;
  onOpenTarget: Props["onOpenTarget"];
}) {
  const primary = row.requests[0];
  const mark = primary
    ? primary.kind === "unblock"
      ? "blocked"
      : "needs"
    : row.task?.state === "completed"
      ? "done"
      : row.task?.state === "blocked"
        ? "blocked"
        : row.task?.sessions.some(
              (session) =>
                session.state === "working" &&
                homeSessionIsFresh(session.sourceId, snapshot, now),
            )
          ? "working"
          : "quiet";
  const sentence = primary
    ? requestSentence(primary)
    : homeTaskSentence(row.task, snapshot, now);
  const meta = primary ? requestAge(primary) : taskMeta(row, snapshot);
  const queueIds = row.requests.map((request) => request.id).join(" ");
  return (
    <li className="home-row" data-home-row={row.id} data-queue-ids={queueIds}>
      <HomeMark kind={mark} />
      <div className="home-row-copy">
        {row.taskId ? (
          <button
            aria-label={`Open task ${row.taskSimpleId ?? ""}: ${row.title}`}
            className="home-row-title"
            data-home-task-id={row.taskId}
            onClick={() =>
              onOpenTarget({ projectId: row.projectId, taskId: row.taskId })
            }
            type="button"
          >
            {row.title}
          </button>
        ) : (
          <span className="home-row-title">{row.title}</span>
        )}
        <p className="home-row-sentence">{sentence}</p>
        {row.requests.length > 1 && (
          <ul className="home-row-also" aria-label="Other requests">
            {row.requests.slice(1).map((request) => (
              <li key={request.id}>
                <span>Also: {requestSentence(request)}</span>
                <HomeRequestAction
                  canMutate={canMutate}
                  connected={connected}
                  item={request}
                  onOpenTarget={onOpenTarget}
                  row={row}
                  secondary
                />
              </li>
            ))}
          </ul>
        )}
        <p className="home-row-meta">
          <span>{row.projectName}</span>
          {row.taskSimpleId && (
            <span className="home-task-id">{row.taskSimpleId}</span>
          )}
          {meta && <span>{meta}</span>}
        </p>
      </div>
      {group === "needs" &&
        primary &&
        (primary.kind !== "unblock" || isThreadAction(primary)) && (
          <div className="home-row-action">
            <HomeRequestAction
              canMutate={canMutate}
              connected={connected}
              item={primary}
              onOpenTarget={onOpenTarget}
              row={row}
            />
          </div>
        )}
    </li>
  );
}

function Group({
  id,
  title,
  count,
  rows,
  group,
  empty,
  snapshot,
  connected,
  canMutate,
  now,
  onOpenTarget,
  note,
}: {
  id: string;
  title: string;
  count: number;
  rows: HomeRow[];
  group: "needs" | "progress" | "done";
  empty: string;
  snapshot: FloorSnapshot | null;
  connected: boolean;
  canMutate: boolean;
  now: number;
  onOpenTarget: Props["onOpenTarget"];
  note?: ReactNode;
}) {
  return (
    <section className="home-group" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        {title} <span>{count}</span>
      </h2>
      {note}
      {rows.length ? (
        <ol className="home-rows">
          {rows.map((row) => (
            <SummaryRow
              canMutate={canMutate}
              connected={connected}
              group={group}
              key={row.id}
              now={now}
              onOpenTarget={onOpenTarget}
              row={row}
              snapshot={snapshot}
            />
          ))}
        </ol>
      ) : (
        <p className="home-empty">{empty}</p>
      )}
    </section>
  );
}

export function Floor({
  busy = false,
  canMutate = false,
  connected,
  error,
  loading,
  onOpenTarget,
  onOpenAllTasks,
  onOpenConnections,
  focusTaskId,
  onTaskFocusRestored,
  snapshot,
}: Props) {
  const [selectedProject, setSelectedProject] = useState(readProjectFilter);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => saveProjectFilter(selectedProject), [selectedProject]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!focusTaskId) return;
    const title = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-home-task-id]"),
    ).find((button) => button.dataset.homeTaskId === focusTaskId);
    title?.focus();
    onTaskFocusRestored?.();
  }, [focusTaskId, onTaskFocusRestored]);

  const projects = snapshot?.projects ?? [];
  const validSelection =
    selectedProject === "all" ||
    projects.some((project) => project.id === selectedProject)
      ? selectedProject
      : "all";
  const allGroups = buildHomeGroups(
    projects,
    snapshot?.yourTurn.items ?? [],
    snapshot?.trackingNotes?.length ?? 0,
  );
  const visible = (row: HomeRow) =>
    validSelection === "all" || row.projectId === validSelection;
  const needsYou = allGroups.needsYou.filter(visible);
  const inProgress = allGroups.inProgress.filter(visible);
  const doneToday = allGroups.doneToday.filter(visible);
  const otherNeeds = allGroups.needsYou.length - needsYou.length;
  const selectedName = projects.find(
    (project) => project.id === validSelection,
  )?.name;
  const freshness = homeFreshness(snapshot, now);
  const { staleT3, snapshotAged, staleTime, updatedAt } = freshness;
  const freshnessLabel = !connected
    ? `Offline${updatedAt ? `, ${updatedAt}` : ""}`
    : staleT3
      ? `T3 not reporting${staleTime ? `, ${staleTime}` : ""}`
      : snapshot
        ? snapshotAged
          ? `Snapshot ${updatedAt ?? "unknown"} may be old`
          : `Live${updatedAt ? `, ${updatedAt}` : ""}`
        : "Connecting";
  const freshnessTone = !connected
    ? "offline"
    : staleT3 || snapshotAged
      ? "stale"
      : snapshot
        ? "live"
        : "quiet";
  const summary = !snapshot
    ? loading
      ? "Connecting to Factory…"
      : connected
        ? "Task information is unavailable."
        : "Factory is offline. Task information is unavailable."
    : projects.length === 0 && snapshot
      ? "No tasks yet. Start with All tasks."
      : !allGroups.projectionAvailable
        ? `${needsYou.length} ${needsYou.length === 1 ? "thing needs" : "things need"} you. Task status is unavailable.`
        : `${needsYou.length ? `${needsYou.length} ${needsYou.length === 1 ? "thing needs" : "things need"} you` : "Nothing needs you"}. ${inProgress.length} ${inProgress.length === 1 ? "task is" : "tasks are"} in progress. ${doneToday.length} finished today.`;
  const staleNote = staleT3
    ? `T3 hasn’t reported${staleTime ? ` since ${staleTime}` : ""}, so questions and approvals from agents aren’t shown here. Check T3 directly.`
    : undefined;

  return (
    <section className="simple-floor" aria-labelledby="home-summary">
      {(!connected || error) && (
        <p className="home-banner" role={error ? "alert" : "status"}>
          {error ??
            (snapshot
              ? "Factory is offline. The last available snapshot is read-only; checks and thread details are paused."
              : "Factory is offline. Home and task details are unavailable until it reconnects.")}
        </p>
      )}
      {loading && !snapshot && (
        <p className="home-banner" role="status">
          Connecting to Factory…
        </p>
      )}

      <div className="simple-home" aria-busy={loading && !snapshot}>
        <p className={`home-freshness ${freshnessTone}`} role="status">
          <span aria-hidden="true" className="home-freshness-dot" />
          {freshnessLabel}
        </p>
        <h1 className="home-summary" id="home-summary" tabIndex={-1}>
          {!connected && updatedAt ? (
            <span className="home-asof">
              As of {updatedAt}, the last available Factory snapshot.
            </span>
          ) : null}
          {summary}
        </h1>

        <div className="home-filter">
          <label htmlFor="home-project">Projects</label>
          <select
            id="home-project"
            onChange={(event) => setSelectedProject(event.target.value)}
            value={validSelection}
          >
            <option value="all">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        {!snapshot && loading ? null : !snapshot ? (
          <div className="home-empty-state" role="status">
            <p>
              {connected
                ? "Factory hasn’t provided a task snapshot yet. Check Connections or try again when it reconnects."
                : "There is no saved task snapshot to show. Home will return when Factory reconnects."}
            </p>
            {connected && (
              <button
                className="home-inline-link"
                onClick={() => onOpenConnections?.()}
                type="button"
              >
                Open Connections
              </button>
            )}
          </div>
        ) : projects.length === 0 ? (
          <p className="home-empty-state">
            No projects yet. Open{" "}
            <button
              className="home-inline-link"
              onClick={() => onOpenAllTasks?.()}
              type="button"
            >
              All tasks
            </button>{" "}
            to create the first project.
          </p>
        ) : (
          <>
            <Group
              canMutate={canMutate && !busy}
              connected={connected}
              count={needsYou.length}
              empty={`Nothing needs you${selectedName ? ` in ${selectedName}` : ""}.`}
              group="needs"
              id="needs-you"
              note={
                <>
                  {staleNote && (
                    <p className="home-group-note warning">{staleNote}</p>
                  )}
                  {otherNeeds > 0 && (
                    <p className="home-group-note">
                      {otherNeeds}{" "}
                      {otherNeeds === 1 ? "thing needs" : "things need"} you in
                      other projects.{" "}
                      <button
                        className="home-inline-link"
                        onClick={() => setSelectedProject("all")}
                        type="button"
                      >
                        Show all projects
                      </button>
                    </p>
                  )}
                </>
              }
              onOpenTarget={onOpenTarget}
              now={now}
              rows={needsYou}
              snapshot={snapshot}
              title="Needs you"
            />
            <Group
              canMutate={canMutate && !busy}
              connected={connected}
              count={inProgress.length}
              empty={`Nothing is in progress${selectedName ? ` in ${selectedName}` : ""}.`}
              group="progress"
              id="in-progress"
              onOpenTarget={onOpenTarget}
              now={now}
              rows={inProgress}
              snapshot={snapshot}
              title="In progress"
            />
            <Group
              canMutate={canMutate && !busy}
              connected={connected}
              count={doneToday.length}
              empty={`Nothing finished${selectedName ? ` in ${selectedName}` : ""} today.`}
              group="done"
              id="done-today"
              onOpenTarget={onOpenTarget}
              now={now}
              rows={doneToday}
              snapshot={snapshot}
              title="Done today"
            />
            <footer className="home-footer">
              {validSelection === "all" && (
                <p>
                  {allGroups.plannedNotStarted} planned or backlog tasks haven’t
                  started.{" "}
                  <button
                    className="home-inline-link"
                    onClick={() => onOpenAllTasks?.()}
                    type="button"
                  >
                    See all tasks
                  </button>
                </p>
              )}
              {allGroups.trackingNotes > 0 && (
                <p>
                  {allGroups.trackingNotes} tracking{" "}
                  {allGroups.trackingNotes === 1 ? "note" : "notes"} about T3
                  threads aren’t counted here.{" "}
                  <button
                    className="home-inline-link"
                    onClick={() => {
                      const firstTrackingNote = snapshot.trackingNotes?.[0];
                      if (firstTrackingNote) onOpenTarget(firstTrackingNote);
                    }}
                    type="button"
                  >
                    Review tracking notes
                  </button>
                </p>
              )}
            </footer>
          </>
        )}
      </div>
    </section>
  );
}
