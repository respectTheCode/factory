import { useEffect, useMemo, useRef, useState } from "react";

import type {
  FloorClaim,
  FloorProject,
  FloorQueueItem,
  FloorSnapshot as ServerFloorSnapshot,
  FloorStation,
  FloorTarget as ServerFloorTarget,
  FloorWorkItem,
} from "../floor";

import "./floor.css";

export type FloorReporter = "claude" | "codex" | "none";
export type FloorTokenState =
  | "working"
  | "idle"
  | "approval"
  | "input"
  | "blocked"
  | "done";
export type FloorTarget = {
  projectId: string;
  taskId?: string;
  subtaskId?: string;
  sessionId?: string;
  threadId?: string;
  sourceId?: string;
  findingId?: string;
};
export type FloorPaper = FloorTarget & {
  id: string;
  simpleId: string;
  name: string;
  ageLabel: string;
  ageMs?: number;
  claim?: string;
  evidence?: string;
  reason?: string;
  reporter?: string;
  reportId?: string;
};
export type FloorWork = FloorTarget & {
  id: string;
  simpleId: string;
  name: string;
  detail?: string;
  reporter?: FloorReporter;
  tokenState: FloorTokenState;
  badge?: "approve" | "input" | "error" | "done";
  empty?: boolean;
};
export type FloorAction = FloorTarget & {
  id: string;
  kind: "approve" | "input" | "stamp" | "unblock" | "review" | "reconcile";
  label: string;
  detail?: string;
  ageLabel: string;
  paper?: FloorPaper;
};
export type FloorLogEntry = {
  id: string;
  timeLabel: string;
  actor: string;
  initials: string;
  message: string;
  fresh?: boolean;
  kind?: string;
  target?: FloorTarget;
};
export type FloorBay = {
  id: string;
  name: string;
  bench: FloorWork[];
  stations: FloorWork[];
  counter: FloorPaper[];
  working: number;
  waiting: number;
  blocked: number;
  quiet: boolean;
};
export type FloorSnapshot = {
  generatedAt?: string;
  projects: FloorBay[];
  yourTurn: {
    items: FloorAction[];
    approvals: number;
    stamps: number;
    unblocks: number;
    inputs: number;
    reviews: number;
  };
  shiftLog: FloorLogEntry[];
  scoreboard: {
    stampedToday: number;
    reportsToday: number;
    workingNow: number;
    oldestUnstamped: string;
  };
  stale?: boolean;
};

function date(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
function ageLabel(value: string | undefined, now = Date.now()): string {
  const parsed = date(value);
  if (!parsed) return "unknown age";
  const minutes = Math.floor(Math.max(0, now - parsed.getTime()) / 60_000);
  if (minutes < 60) return minutes === 0 ? "now" : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
function mapTarget(target: ServerFloorTarget): FloorTarget {
  return {
    projectId: target.projectId,
    ...(target.taskId ? { taskId: target.taskId } : {}),
    ...(target.subtaskId ? { subtaskId: target.subtaskId } : {}),
  };
}

function mapWork(item: FloorWorkItem): FloorWork {
  const target = mapTarget(item);
  return {
    ...target,
    detail: item.stateReason ?? item.owner ?? item.state,
    id: item.subtaskId ?? item.taskId,
    name: item.subtaskName ?? item.taskName,
    reporter: "none",
    simpleId: item.subtaskSimpleId ?? item.taskSimpleId,
    tokenState: item.state === "blocked" ? "blocked" : "idle",
  };
}
function mapStation(station: FloorStation, projectId: string): FloorWork {
  const target = station.target ? mapTarget(station.target) : { projectId };
  const state: FloorTokenState =
    station.state === "working"
      ? "working"
      : station.state === "waiting_approval"
        ? "approval"
        : station.state === "waiting_input"
          ? "input"
          : station.state === "error" || station.state === "blocked"
            ? "blocked"
            : "idle";
  const reporter: FloorReporter =
    station.worker?.identity === "claude"
      ? "claude"
      : station.worker?.identity === "codex"
        ? "codex"
        : "none";
  return {
    ...target,
    ...(station.sourceId ? { sourceId: station.sourceId } : {}),
    ...(station.threadId ? { threadId: station.threadId } : {}),
    detail:
      station.threadTitle ??
      (station.association === "none" ? "no task link observed" : state),
    id: station.id,
    name:
      station.target?.subtaskName ??
      station.target?.taskName ??
      station.threadTitle ??
      "Observed session",
    reporter,
    simpleId:
      station.target?.subtaskSimpleId ??
      station.target?.taskSimpleId ??
      station.threadId ??
      station.id,
    tokenState: state,
    ...(state === "approval"
      ? { badge: "approve" as const }
      : state === "input"
        ? { badge: "input" as const }
        : state === "blocked"
          ? { badge: "error" as const }
          : {}),
  };
}
function mapClaim(claim: FloorClaim, now = Date.now()): FloorPaper {
  const parsed = date(claim.reportedAt);
  return {
    ...mapTarget(claim),
    ageLabel: ageLabel(claim.reportedAt, now),
    ageMs: parsed ? Math.max(0, now - parsed.getTime()) : undefined,
    ...(claim.reason ? { claim: claim.reason } : {}),
    evidence: claim.evidence,
    id: claim.reportId,
    name: claim.subtaskName ?? claim.taskName,
    reporter: claim.reporter,
    reportId: claim.reportId,
    ...(claim.reason ? { reason: claim.reason } : {}),
    simpleId: claim.subtaskSimpleId ?? claim.taskSimpleId,
  };
}
function mapQueueTarget(item: FloorQueueItem): FloorTarget {
  if (item.target.kind === "work") return mapTarget(item.target.target);
  if (item.target.kind === "thread")
    return {
      projectId: item.target.projectId,
      ...(item.target.target ? mapTarget(item.target.target) : {}),
      sessionId: item.target.threadId,
      sourceId: item.target.sourceId,
      threadId: item.target.threadId,
    };
  return {
    projectId: item.target.projectId,
    ...(item.target.threadId ? { threadId: item.target.threadId } : {}),
    findingId: item.target.findingId,
  };
}
function queuePaper(
  item: FloorQueueItem,
  projects: FloorBay[],
): FloorPaper | undefined {
  if (item.action !== "stamp") return undefined;
  const reportId = item.id.startsWith("stamp:") ? item.id.slice(6) : undefined;
  return projects
    .flatMap((project) => project.counter)
    .find((claim) => claim.reportId === reportId);
}
function mapQueueItem(
  item: FloorQueueItem,
  projects: FloorBay[],
  now = Date.now(),
): FloorAction {
  const kind: FloorAction["kind"] =
    item.action === "approve"
      ? "approve"
      : item.action === "stamp"
        ? "stamp"
        : "unblock";
  return {
    ...mapQueueTarget(item),
    ageLabel: ageLabel(item.timestamp, now),
    detail: item.reason ?? item.projectName,
    id: item.id,
    kind,
    label: item.summary,
    paper: queuePaper(item, projects),
  };
}

/** Map the typed server projection to the rendering model; missing fields cannot create rows. */
export function normalizeFloorSnapshot(
  input: ServerFloorSnapshot,
): FloorSnapshot {
  const now = Date.now();
  const projects = input.projects.map((project: FloorProject) => ({
    bench: project.bench.map(mapWork),
    blocked: project.counts.blocked,
    counter: project.counter.map((claim) => mapClaim(claim, now)),
    id: project.id,
    name: project.name,
    quiet:
      project.bench.length === 0 &&
      project.stations.length === 0 &&
      project.counter.length === 0 &&
      project.reviewNeeded.length === 0 &&
      project.counts.working === 0 &&
      project.counts.waiting === 0 &&
      project.counts.blocked === 0,
    stations: project.stations.map((station) =>
      mapStation(station, project.id),
    ),
    waiting: project.counts.waiting,
    working: project.counts.working,
  }));
  const queue = input.queue.map((item) => mapQueueItem(item, projects, now));
  return {
    generatedAt: input.generatedAt,
    projects,
    scoreboard: {
      oldestUnstamped: input.scoreboard.oldestPendingAt
        ? ageLabel(input.scoreboard.oldestPendingAt, now)
        : "none",
      reportsToday: input.scoreboard.reportsToday,
      stampedToday: input.scoreboard.stampedToday,
      workingNow: input.scoreboard.workingNow,
    },
    shiftLog: input.events.map((entry) => ({
      actor: entry.actor,
      fresh: date(entry.timestamp)
        ? now - date(entry.timestamp)!.getTime() < 10_000
        : false,
      id: entry.id,
      initials: entry.actor.slice(0, 2).toUpperCase(),
      kind: entry.kind,
      message: entry.summary,
      target: entry.target ? mapTarget(entry.target) : undefined,
      timeLabel:
        date(entry.timestamp)?.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }) ?? "--:--",
    })),
    stale: input.connections.some((connection) => !connection.fresh),
    yourTurn: {
      approvals: input.queue.filter((item) => item.action === "approve").length,
      inputs: input.queue.filter((item) => item.action === "input").length,
      items: queue,
      reviews: input.queue.filter(
        (item) => item.action === "review" || item.action === "reconcile",
      ).length,
      stamps: input.queue.filter((item) => item.action === "stamp").length,
      unblocks: input.queue.filter(
        (item) => item.action !== "approve" && item.action !== "stamp",
      ).length,
    },
  };
}

function initials(reporter: FloorReporter | undefined): string {
  return reporter === "claude" ? "CL" : reporter === "codex" ? "CX" : "—";
}
function tokenLabel(item: FloorWork): string {
  return item.tokenState === "working"
    ? "working"
    : item.tokenState === "approval"
      ? "waiting for approval"
      : item.tokenState === "input"
        ? "waiting for user input"
        : item.tokenState === "blocked"
          ? "blocked"
          : item.reporter === "none"
            ? "no session observed"
            : "idle";
}
function ageClass(paper: FloorPaper): string {
  return paper.ageMs !== undefined && paper.ageMs > 3 * 24 * 60 * 60 * 1000
    ? " old"
    : "";
}

function agePhrase(label: string): string {
  return label === "now" ? "just now" : `${label} ago`;
}

export function floorPaperMatches(
  current: FloorPaper,
  reviewed: FloorPaper,
): boolean {
  return (
    current.reportId !== undefined &&
    current.reportId === reviewed.reportId &&
    current.claim === reviewed.claim &&
    current.evidence === reviewed.evidence
  );
}

export function Floor({
  busy = false,
  canMutate = false,
  connected,
  error,
  loading,
  onOpenTarget,
  onCreateProject,
  onStamp,
  snapshot,
}: {
  busy?: boolean;
  canMutate?: boolean;
  connected: boolean;
  error?: string | null;
  loading: boolean;
  onCreateProject: (name: string) => Promise<void>;
  onOpenTarget: (target: FloorTarget) => void;
  onStamp: (paper: FloorPaper) => Promise<void>;
  snapshot: FloorSnapshot | null;
}) {
  const [now, setNow] = useState(() => new Date());
  const [reviewPaper, setReviewPaper] = useState<FloorPaper | null>(null);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [showAllTurn, setShowAllTurn] = useState(false);
  const [stamped, setStamped] = useState(false);
  const [stamping, setStamping] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const observedEventIds = useRef<Set<string>>(new Set());
  const eventLogInitialized = useRef(false);
  const [freshEventIds, setFreshEventIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const entries = snapshot?.shiftLog;
    if (!entries) return;
    const newIds = entries
      .map((entry) => entry.id)
      .filter((id) => !observedEventIds.current.has(id));
    entries.forEach((entry) => observedEventIds.current.add(entry.id));
    if (!eventLogInitialized.current) {
      eventLogInitialized.current = true;
      return;
    }
    if (newIds.length) setFreshEventIds(new Set(newIds));
  }, [snapshot?.shiftLog]);
  const turnCount = snapshot?.yourTurn.items.length ?? 0;
  const visibleTurnItems = showAllTurn
    ? (snapshot?.yourTurn.items ?? [])
    : (snapshot?.yourTurn.items.slice(0, 5) ?? []);
  const freshness = useMemo(() => {
    const observed = date(snapshot?.generatedAt);
    return observed
      ? `Observed ${observed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
      : "Live projection";
  }, [snapshot?.generatedAt]);
  const stale = Boolean(
    snapshot?.stale ||
    (snapshot?.generatedAt &&
      date(snapshot.generatedAt) &&
      now.getTime() - date(snapshot.generatedAt)!.getTime() > 30_000),
  );
  const open = (target: FloorTarget) => {
    if (target.projectId) onOpenTarget(target);
  };
  const openReview = (paper: FloorPaper, trigger: HTMLElement) => {
    reviewTrigger.current = trigger;
    setReviewError(null);
    setStamped(false);
    setReviewPaper(paper);
  };
  useEffect(() => {
    if (!reviewPaper) return;
    const previous = reviewTrigger.current;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".floor-review")?.focus();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!stamping && !stamped) setReviewPaper(null);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>(".floor-review");
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], textarea, input, select",
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [reviewPaper, stamped, stamping]);
  const accept = async () => {
    if (!reviewPaper?.reportId || stamping || stamped || !canMutate) return;
    setStamping(true);
    try {
      await onStamp(reviewPaper);
      setStamped(true);
      window.setTimeout(() => {
        setReviewPaper(null);
        setStamped(false);
      }, 120);
    } catch (error) {
      setReviewError(
        error instanceof Error
          ? error.message
          : "The report could not be stamped.",
      );
    } finally {
      setStamping(false);
    }
  };
  const createProject = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name || busy || !canMutate) return;
    setProjectError(null);
    try {
      await onCreateProject(name);
      setNewProjectName("");
    } catch (error) {
      setProjectError(
        error instanceof Error
          ? error.message
          : "The project could not be created.",
      );
    }
  };
  return (
    <section className="floor-page" aria-labelledby="floor-title">
      <div className="floor-masthead">
        <div>
          <p className="eyebrow">Factory · The Floor</p>
          <h1 id="floor-title">The Floor</h1>
        </div>
        <div className="floor-clock" aria-label="Local time">
          {now.toLocaleTimeString([], { hour12: false })}
        </div>
        <div className="floor-freshness" role="status">
          <span
            className={`floor-led ${connected ? "ok" : "down"}`}
            aria-hidden="true"
          />
          {connected ? freshness : "Factory connection unavailable"}
          {stale && <span className="floor-stale"> · stale</span>}
        </div>
      </div>
      {(error || (!connected && !snapshot)) && (
        <div className="floor-notice floor-notice-error" role="alert">
          {error ?? "Floor data is unavailable until Factory reconnects."}
        </div>
      )}
      {loading && !snapshot && (
        <div className="floor-notice" role="status">
          Refreshing Floor data…
        </div>
      )}
      <div className="floor-layout">
        <aside className="floor-sidecar" aria-label="Floor sidecar">
          <section
            className={`floor-turn${turnCount ? " attention" : ""}`}
            aria-labelledby="your-turn-title"
          >
            <p className="eyebrow" id="your-turn-title">
              Your turn
            </p>
            <div className="floor-turn-big">
              <span className="floor-turn-count">{turnCount}</span>
              <span className="floor-turn-label">
                things only you can do
                <small>
                  {snapshot
                    ? `${snapshot.yourTurn.approvals} approval${snapshot.yourTurn.approvals === 1 ? "" : "s"} · ${snapshot.yourTurn.stamps} stamp${snapshot.yourTurn.stamps === 1 ? "" : "s"} · ${snapshot.yourTurn.unblocks} unblock${snapshot.yourTurn.unblocks === 1 ? "" : "s"}`
                    : "Waiting for an observed queue"}
                </small>
              </span>
            </div>
            {turnCount ? (
              <ol className="floor-turn-list">
                {visibleTurnItems.map((item) => (
                  <li key={item.id}>
                    <button
                      className={`floor-action floor-action-${item.kind}`}
                      onClick={(event) =>
                        item.kind === "stamp" && item.paper
                          ? openReview(item.paper, event.currentTarget)
                          : open(item)
                      }
                      type="button"
                    >
                      <span className="floor-kind">{item.kind}</span>
                      <span className="floor-action-copy">
                        <strong>{item.label}</strong>
                        <small>{item.detail || "waiting"}</small>
                      </span>
                      <span className="floor-action-age">{item.ageLabel}</span>
                    </button>
                  </li>
                ))}
                {turnCount > visibleTurnItems.length && (
                  <li>
                    <button
                      className="floor-more"
                      onClick={() => setShowAllTurn(true)}
                      type="button"
                    >
                      +{turnCount - visibleTurnItems.length} more waiting,
                      oldest first
                    </button>
                  </li>
                )}
                {showAllTurn && turnCount > 5 && (
                  <li>
                    <button
                      className="floor-more"
                      onClick={() => setShowAllTurn(false)}
                      type="button"
                    >
                      Show fewer
                    </button>
                  </li>
                )}
              </ol>
            ) : (
              <p className="floor-empty">Nothing needs you.</p>
            )}
          </section>
          <section className="floor-log" aria-labelledby="shift-log-title">
            <p className="eyebrow" id="shift-log-title">
              Shift log · live
            </p>
            {snapshot?.shiftLog.length ? (
              <ul>
                {snapshot.shiftLog.map((entry) => (
                  <li
                    className={
                      freshEventIds.has(entry.id) ? "fresh" : undefined
                    }
                    key={entry.id}
                  >
                    <span className="floor-log-time">{entry.timeLabel}</span>
                    <span className="floor-log-who">{entry.initials}</span>
                    <span>{entry.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="floor-empty">No observed activity yet.</p>
            )}
          </section>
          <div className="floor-score" aria-label="Floor scoreboard">
            <div className="floor-tile ok">
              <strong>{snapshot?.scoreboard.stampedToday ?? "—"}</strong>
              <span>stamped today</span>
            </div>
            <div className="floor-tile">
              <strong>{snapshot?.scoreboard.reportsToday ?? "—"}</strong>
              <span>reports today</span>
            </div>
            <div className="floor-tile">
              <strong>
                {stale ? "—" : (snapshot?.scoreboard.workingNow ?? "—")}
              </strong>
              <span>working now</span>
            </div>
            <div className="floor-tile">
              <strong>{snapshot?.scoreboard.oldestUnstamped ?? "—"}</strong>
              <span>oldest unstamped</span>
            </div>
          </div>
        </aside>
        <section className="floor-bays" aria-label="Project bays">
          {snapshot?.projects.length ? (
            snapshot.projects.map((bay) => (
              <article
                className={`floor-bay${bay.quiet ? " quiet" : ""}${bay.counter.length || bay.stations.some((entry) => entry.badge) ? " attention" : ""}`}
                key={bay.id}
              >
                <div className="floor-plate">
                  <button
                    className="floor-bay-title"
                    onClick={() => open({ projectId: bay.id })}
                    type="button"
                  >
                    <h2>{bay.name}</h2>
                  </button>
                  <div className="floor-tally" aria-label={`${bay.name} tally`}>
                    {bay.quiet ? (
                      <span>
                        <i className="floor-tally-dot faint" />
                        lights off
                      </span>
                    ) : (
                      <>
                        <span>
                          <i className="floor-tally-dot info" />
                          {bay.working} working
                        </span>
                        <span>
                          <i className="floor-tally-dot warn" />
                          {bay.waiting} waiting
                        </span>
                        <span>
                          <i className="floor-tally-dot down" />
                          {bay.blocked} blocked
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className="floor-track">
                  <FloorZone className="bench" label="Bench">
                    {bay.bench.length ? (
                      bay.bench
                        .slice(0, 3)
                        .map((entry) => (
                          <FloorWorkRow
                            entry={entry}
                            key={entry.id}
                            onOpen={open}
                            stale={stale}
                          />
                        ))
                    ) : (
                      <EmptyRow label="No planned work" />
                    )}
                    {bay.bench.length > 3 && (
                      <button
                        className="floor-more"
                        onClick={() => open({ projectId: bay.id })}
                        type="button"
                      >
                        +{bay.bench.length - 3} more planned
                      </button>
                    )}
                  </FloorZone>
                  <FloorZone className="stations" label="Stations">
                    {bay.stations.length ? (
                      bay.stations
                        .slice(0, 4)
                        .map((entry) => (
                          <FloorWorkRow
                            entry={entry}
                            key={entry.id}
                            onOpen={open}
                            stale={stale}
                          />
                        ))
                    ) : (
                      <EmptyRow label="Station open" />
                    )}
                    {bay.stations.length > 4 && (
                      <button
                        className="floor-more"
                        onClick={() => open({ projectId: bay.id })}
                        type="button"
                      >
                        +{bay.stations.length - 4} more working
                      </button>
                    )}
                  </FloorZone>
                  <FloorZone
                    className={`counter${bay.counter.length ? " hot" : ""}`}
                    label="Counter · stamp"
                  >
                    {bay.counter.slice(0, 3).map((paper) => (
                      <button
                        className={`floor-paper${ageClass(paper)}`}
                        key={paper.id}
                        onClick={(event) =>
                          openReview(paper, event.currentTarget)
                        }
                        type="button"
                      >
                        <span className="floor-slot" aria-hidden="true" />
                        <span className="floor-paper-name">
                          <span className="floor-ref">{paper.simpleId}</span>
                          {paper.name}
                        </span>
                        <span className="floor-paper-age">
                          {paper.ageLabel}
                        </span>
                      </button>
                    ))}
                    {bay.counter.length > 3 && (
                      <button
                        className="floor-more"
                        onClick={() => open(bay.counter[3]!)}
                        type="button"
                      >
                        +{bay.counter.length - 3} more waiting
                      </button>
                    )}
                    {!bay.counter.length && (
                      <p className="floor-more">Nothing waiting</p>
                    )}
                  </FloorZone>
                </div>
              </article>
            ))
          ) : (
            <div className="floor-notice">
              {loading
                ? "Loading observed project bays…"
                : "No project activity has been observed."}
            </div>
          )}
        </section>
      </div>
      <details className="floor-create-project">
        <summary>New project</summary>
        <form onSubmit={(event) => void createProject(event)}>
          <label>
            <span className="visually-hidden">Project name</span>
            <input
              disabled={!canMutate || busy}
              onChange={(event) => setNewProjectName(event.target.value)}
              placeholder="Project name"
              value={newProjectName}
            />
          </label>
          <button
            disabled={!canMutate || busy || !newProjectName.trim()}
            type="submit"
          >
            Create project
          </button>
        </form>
        {projectError && <p role="alert">{projectError}</p>}
      </details>
      {reviewPaper && (
        <div
          className="floor-review-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !stamping)
              setReviewPaper(null);
          }}
        >
          <section
            aria-labelledby="floor-review-title"
            aria-modal="true"
            className="floor-review"
            role="dialog"
            tabIndex={-1}
          >
            <p className="eyebrow">Countersign review</p>
            <h2 id="floor-review-title">
              <span className="floor-ref">{reviewPaper.simpleId}</span>{" "}
              {reviewPaper.name}
            </h2>
            <p className="floor-review-age">
              Reported {agePhrase(reviewPaper.ageLabel)} by{" "}
              {reviewPaper.reporter || "the observed worker"}.
            </p>
            <dl>
              <div>
                <dt>Claim</dt>
                <dd>{reviewPaper.claim || "No claim text was provided."}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>
                  {reviewPaper.evidence ||
                    "No evidence was recorded in this projection."}
                </dd>
              </div>
            </dl>
            <p className="floor-review-note">
              Review this specific report before accepting it. The Floor stamps
              this exact report ID.
            </p>
            <div className="floor-review-actions">
              <span
                aria-label={stamped ? "Stamped accepted" : "Awaiting stamp"}
                className={`floor-review-stamp-slot${stamped ? " stamped" : ""}`}
              >
                {stamped ? "✓" : ""}
              </span>
              <button
                className="verify"
                disabled={
                  !canMutate ||
                  busy ||
                  stamping ||
                  !reviewPaper.reportId ||
                  !reviewPaper.evidence
                }
                onClick={() => void accept()}
                type="button"
              >
                {stamping ? "Stamping…" : "Stamp accepted"}
              </button>
              <button
                className="secondary"
                disabled={stamping || stamped}
                onClick={() => setReviewPaper(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
            {!reviewPaper.evidence && (
              <p className="floor-review-error">
                No evidence was recorded, so this claim must be reviewed from
                the project page.
              </p>
            )}
            {reviewError && <p className="floor-review-error">{reviewError}</p>}
          </section>
        </div>
      )}
    </section>
  );
}

function FloorZone({
  children,
  className,
  label,
}: {
  children: React.ReactNode;
  className: string;
  label: string;
}) {
  return (
    <div className={`floor-zone ${className}`}>
      <p className="eyebrow">{label}</p>
      <div className="floor-zone-list">{children}</div>
    </div>
  );
}
function EmptyRow({ label }: { label: string }) {
  return (
    <div className="floor-work empty">
      <span className="floor-worker none">·</span>
      <span className="floor-work-copy">
        <strong>{label}</strong>
      </span>
    </div>
  );
}
function FloorWorkRow({
  entry,
  onOpen,
  stale = false,
}: {
  entry: FloorWork;
  onOpen: (target: FloorTarget) => void;
  stale?: boolean;
}) {
  const state =
    stale && entry.tokenState === "working" ? "idle" : entry.tokenState;
  const detail = stale
    ? `${entry.detail || tokenLabel(entry)} · stale observation`
    : entry.detail || tokenLabel(entry);
  return (
    <button
      className={`floor-work${entry.empty ? " empty" : ""}${state === "blocked" ? " blocked" : ""}`}
      onClick={() => onOpen(entry)}
      type="button"
    >
      <span
        aria-label={`${initials(entry.reporter)} ${stale ? "stale observation" : tokenLabel(entry)}`}
        className={`floor-worker ${entry.reporter} ${state}`}
      >
        {initials(entry.reporter)}
        {entry.badge && (
          <span className={`floor-badge ${entry.badge}`}>
            {entry.badge === "error" ? "!" : entry.badge === "done" ? "✓" : "?"}
          </span>
        )}
      </span>
      <span className="floor-work-copy">
        <strong>
          <span className="floor-ref">{entry.simpleId}</span>
          {entry.name}
        </strong>
        <small>{detail}</small>
      </span>
    </button>
  );
}
