import { useEffect, useRef, useState } from "react";
import { ArrowSquareOut, CaretRight } from "@phosphor-icons/react";

import type {
  FloorClaim,
  FloorProject,
  FloorQueueAction,
  FloorQueueItem,
  FloorSnapshot as ServerFloorSnapshot,
  FloorStation,
  FloorTaskCard as ServerFloorTaskCard,
  FloorTarget as ServerFloorTarget,
  FloorWorkItem,
} from "../floor";

import "./floor.css";
import { relativeAgeLabel } from "./task-tracking";
import { statusDefinitions } from "./status-presentation";
import { StatusIcon } from "./status-icon";

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
  action?: "review" | "check" | "decide" | "unblock";
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
  kind?: FloorAction["kind"];
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
  association?: FloorStation["association"];
  relatedTargets?: ServerFloorTarget[];
};
export type FloorTaskCard = ServerFloorTaskCard;
export type FloorAction = FloorTarget & {
  id: string;
  kind: "review" | "check" | "decide" | "unblock";
  label: string;
  detail?: string;
  ageLabel: string;
  paper?: FloorPaper;
  relatedTargets?: ServerFloorTarget[];
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
  tasks?: ServerFloorTaskCard[];
  recentlyDone?: ServerFloorTaskCard[];
  unmatchedSessions?: FloorWork[];
  sessionsAvailable?: boolean;
  taskProjectionAvailable: boolean;
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
    checks: number;
    decisions: number;
  };
  shiftLog: FloorLogEntry[];
  scoreboard: {
    stampedToday: number;
    finishedToday?: number;
    reportsToday: number;
    workingNow: number;
    oldestUnstamped: string;
  };
  stale?: boolean;
  trackingNotes?: Array<FloorAction>;
};

export const FLOOR_BAY_STORAGE_KEY = "factory.floor.collapsed-bays.v1";
export const FLOOR_BAY_STORAGE_VERSION = 1;
type FloorBayStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): FloorBayStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function parseCollapsedBayIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return new Set();
    const payload = parsed as {
      collapsed?: unknown;
      version?: unknown;
    };
    if (
      payload.version !== FLOOR_BAY_STORAGE_VERSION ||
      !Array.isArray(payload.collapsed)
    ) {
      return new Set();
    }
    return new Set(
      payload.collapsed.filter(
        (id): id is string => typeof id === "string" && id.trim().length > 0,
      ),
    );
  } catch {
    return new Set();
  }
}

export function serializeCollapsedBayIds(ids: ReadonlySet<string>): string {
  return JSON.stringify({
    collapsed: Array.from(ids)
      .filter((id) => id.trim().length > 0)
      .sort(),
    version: FLOOR_BAY_STORAGE_VERSION,
  });
}

export function readCollapsedBayIds(
  storage: FloorBayStorage | null | undefined = browserStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    return parseCollapsedBayIds(storage.getItem(FLOOR_BAY_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

export function writeCollapsedBayIds(
  ids: ReadonlySet<string>,
  storage: FloorBayStorage | null | undefined = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(FLOOR_BAY_STORAGE_KEY, serializeCollapsedBayIds(ids));
  } catch {
    // Private browsing and quota restrictions must not block the Floor.
  }
}

export function toggleCollapsedBayIds(
  ids: ReadonlySet<string>,
  projectId: string,
): Set<string> {
  const next = new Set(ids);
  if (next.has(projectId)) next.delete(projectId);
  else next.add(projectId);
  return next;
}

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

function logInitials(actor: string): string {
  const normalized = actor.trim().toLocaleLowerCase();
  if (normalized === "codex") return "CX";
  if (normalized === "claude") return "CL";
  return actor.slice(0, 2).toLocaleUpperCase();
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
    association: station.association,
    relatedTargets: station.relatedTargets,
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
function mapQueueItem(item: FloorQueueItem, now = Date.now()): FloorAction {
  return {
    ...mapQueueTarget(item),
    action: item.action,
    ageLabel: ageLabel(item.timestamp, now),
    detail: item.reason ?? item.projectName,
    id: item.id,
    kind: item.action,
    label: item.summary,
    relatedTargets: item.relatedTargets,
  };
}

/** Map the typed server projection to the rendering model; missing fields cannot create rows. */
export function normalizeFloorSnapshot(
  input: ServerFloorSnapshot,
): FloorSnapshot {
  const now = Date.now();
  const projects = input.projects.map((project: FloorProject) => {
    return {
      bench: project.bench.map(mapWork),
      blocked: project.counts.blocked,
      counter: input.queue
        .filter((item) => item.projectId === project.id)
        .map((item) => {
          const target = mapQueueTarget(item);
          return {
            ...target,
            action: item.action,
            id: item.id,
            simpleId:
              item.target.kind === "work"
                ? item.target.target.taskSimpleId
                : item.target.kind === "thread"
                  ? (item.target.target?.taskSimpleId ?? "T3")
                  : "",
            name: item.summary,
            ageLabel: ageLabel(item.timestamp, now),
            claim: item.reason,
            kind: item.action,
          };
        }),
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
      tasks: project.tasks,
      recentlyDone: project.recentlyDone,
      unmatchedSessions: project.unmatchedSessions?.map((station) =>
        mapStation(station, project.id),
      ),
      sessionsAvailable: project.sessionsAvailable,
      taskProjectionAvailable: Array.isArray(project.tasks),
    };
  });
  const queue = input.queue.map((item) => mapQueueItem(item, now));
  return {
    generatedAt: input.generatedAt,
    trackingNotes: input.trackingNotes?.map((item) => mapQueueItem(item, now)),
    projects,
    scoreboard: {
      oldestUnstamped: input.scoreboard.oldestPendingAt
        ? ageLabel(input.scoreboard.oldestPendingAt, now)
        : "none",
      reportsToday: input.scoreboard.reportsToday,
      stampedToday: input.scoreboard.stampedToday,
      finishedToday: input.scoreboard.finishedToday,
      workingNow: input.scoreboard.workingNow,
    },
    shiftLog: input.events.map((entry) => ({
      actor: entry.actor,
      fresh: date(entry.timestamp)
        ? now - date(entry.timestamp)!.getTime() < 10_000
        : false,
      id: entry.id,
      initials: logInitials(entry.actor),
      kind: entry.kind,
      message: entry.summary,
      target: entry.target ? mapTarget(entry.target) : undefined,
      timeLabel:
        date(entry.timestamp)?.toLocaleTimeString([], {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        }) ?? "--:--",
    })),
    stale: input.connections.some((connection) => !connection.fresh),
    yourTurn: {
      approvals: 0,
      inputs: 0,
      stamps: 0,
      items: queue,
      reviews: input.queue.filter((item) => item.action === "review").length,
      checks: input.queue.filter((item) => item.action === "check").length,
      decisions: input.queue.filter((item) => item.action === "decide").length,
      unblocks: input.queue.filter((item) => item.action === "unblock").length,
    },
  };
}

function initials(reporter: FloorReporter | undefined): string {
  return reporter === "claude" ? "CL" : reporter === "codex" ? "CX" : "—";
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

export function floorTaskCardTarget(
  task: Pick<ServerFloorTaskCard, "projectId" | "taskId">,
): FloorTarget {
  return { projectId: task.projectId, taskId: task.taskId };
}

export function needsYouCountForProject(
  projectId: string,
  items: readonly FloorAction[],
): number {
  return new Set(
    items
      .filter(
        (item) =>
          item.projectId === projectId ||
          item.relatedTargets?.some((target) => target.projectId === projectId),
      )
      .map((item) => item.id),
  ).size;
}

export function floorTaskCounts(projects: readonly FloorBay[]) {
  const cards = projects.flatMap((project) => project.tasks ?? []);
  const doneIds = new Set(
    projects.flatMap((project) =>
      (project.recentlyDone ?? []).map((task) => task.taskId),
    ),
  );
  return {
    active: cards.filter((task) => task.state === "active").length,
    blocked: cards.filter((task) => task.state === "blocked").length,
    inReview: cards.filter((task) => task.state === "awaiting_verification")
      .length,
    doneToday: doneIds.size,
  };
}

function projectTaskCards(project: FloorBay): ServerFloorTaskCard[] {
  return project.tasks ?? [];
}

function finishRuleText(task: ServerFloorTaskCard): string {
  const finish = task.finish;
  const rule =
    finish.kind === "pr_merge"
      ? finish.requiredPrCount > 0
        ? `PR merge · ${finish.mergedPrCount} of ${finish.requiredPrCount} required merged`
        : "PR merge required"
      : finish.agentReportedFinished
        ? "Agent report received"
        : "Agent report required";
  if (!finish.requireHumanCheck) return rule;
  return `${rule} · your check ${finish.humanCheckReady ? "ready" : "required"}`;
}

function repeatsFinishProgress(task: ServerFloorTaskCard): boolean {
  return (
    task.finish.kind === "pr_merge" &&
    task.finish.requiredPrCount > 0 &&
    task.stateReason ===
      `Waiting for required pull requests to merge (${task.finish.mergedPrCount} of ${task.finish.requiredPrCount}).`
  );
}

function sessionStateLabel(state: FloorStation["state"]): string {
  switch (state) {
    case "working":
      return "working";
    case "waiting_approval":
      return "waiting for approval";
    case "waiting_input":
      return "waiting for input";
    case "error":
      return "error observed";
    case "blocked":
      return "blocked session";
    case "idle":
      return "idle";
  }
}

function workSessionStateLabel(state: FloorTokenState): string {
  switch (state) {
    case "working":
      return "working";
    case "approval":
      return "waiting for approval";
    case "input":
      return "waiting for input";
    case "blocked":
      return "blocked session";
    case "done":
      return "done";
    case "idle":
      return "idle";
  }
}

function reporterLabel(identity: FloorStation["worker"]): string {
  if (identity?.identity === "claude") return "Claude";
  if (identity?.identity === "codex") return "Codex";
  return "Observed agent";
}

function FloorTaskCardView({
  task,
  planned = false,
  staleSnapshot,
  onOpen,
  now,
}: {
  task: ServerFloorTaskCard;
  planned?: boolean;
  staleSnapshot: boolean;
  onOpen: (target: FloorTarget) => void;
  now: number;
}) {
  const state = statusDefinitions[task.state];
  const isDone = task.state === "completed";
  const openSteps = task.steps
    ? Math.max(0, task.steps.total - task.steps.done)
    : 0;
  const sessions = task.sessions.map((station) => ({
    station,
    view: mapStation(station, task.projectId),
  }));
  return (
    <article
      className={`floor-task-card state-${task.state}${planned ? " planned" : ""}${task.needsYou.count ? " needs-you" : ""}`}
      style={{ "--task-state-color": state.color } as React.CSSProperties}
    >
      <div className="floor-task-card-heading">
        <p className="floor-task-reference">
          <span>{task.taskSimpleId}</span>
        </p>
        <span className="floor-task-state">
          <StatusIcon decorative state={state.dial} size={14} />
          {state.label}
        </span>
      </div>
      <h3>
        <button
          aria-label={`Open ${state.label.toLowerCase()} task ${task.taskSimpleId}: ${task.taskName}`}
          className="floor-task-title"
          onClick={() => onOpen(floorTaskCardTarget(task))}
          type="button"
        >
          <span>{task.taskName}</span>
        </button>
      </h3>
      {(task.priority ||
        task.owner ||
        (task.steps && task.steps.total > 0 && (!isDone || openSteps > 0))) && (
        <div className="floor-task-facts">
          {task.priority && (
            <span className={`floor-priority priority-${task.priority}`}>
              {task.priority} priority
            </span>
          )}
          {task.owner && <span>Recorded owner · {task.owner}</span>}
          {task.steps &&
            task.steps.total > 0 &&
            (isDone ? (
              openSteps > 0 && (
                <span className="floor-step-count">
                  Done · {openSteps} Steps left open
                </span>
              )
            ) : (
              <span className="floor-step-count">
                Steps · {task.steps.done}/{task.steps.total} done
              </span>
            ))}
        </div>
      )}
      {task.manualHold && <p className="floor-task-manual-hold">Manual hold</p>}
      {(task.stateReason || task.manualHold) &&
        !repeatsFinishProgress(task) && (
          <p
            className={`floor-task-reason${task.state === "blocked" ? " blocked" : ""}`}
          >
            {task.stateReason ?? "No reason was recorded for this manual hold."}
          </p>
        )}
      {!planned && !isDone && (
        <p className="floor-task-finish">
          <strong>Finish rule</strong>
          <span>{finishRuleText(task)}</span>
        </p>
      )}
      {task.handoff && (
        <p className="floor-task-handoff">
          <strong>
            Next · {task.handoff.nextOwner}
            {task.handoff.nextOwnerKind !== "unknown" &&
              ` (${task.handoff.nextOwnerKind})`}
          </strong>
          <span>{task.handoff.nextAction}</span>
          <small>
            Reported by {task.handoff.reporter} ·{" "}
            {relativeAgeLabel(ageLabel(task.handoff.reportedAt, now))}
            {task.handoff.additionalCount > 0 &&
              ` · +${task.handoff.additionalCount} more recorded handoffs`}
          </small>
        </p>
      )}
      {task.needsYou.count > 0 && (
        <p className="floor-task-needs-you">
          Needs you · {task.needsYou.count}
          {task.needsYou.verbs.length
            ? ` · ${task.needsYou.verbs.map((verb) => `${verb[0]!.toUpperCase()}${verb.slice(1)}`).join(", ")}`
            : " · open attention items"}
        </p>
      )}
      {isDone && task.finishProvenance && (
        <p className="floor-task-provenance">
          Finish evidence · {task.finishProvenance}
        </p>
      )}
      <div className="floor-task-sessions">
        <p className="floor-task-section-label">
          Observed sessions
          {sessions.length > 0 && <span> · {sessions.length}</span>}
        </p>
        {sessions.length ? (
          <ul>
            {sessions.map(({ station, view }) => {
              const sessionTitle =
                station.threadTitle ??
                (station.threadId
                  ? `Session ${station.threadId}`
                  : "Observed session");
              const sharedTargets = (view.relatedTargets ?? []).filter(
                (target) => target.taskId !== task.taskId,
              );
              const relatedIds = Array.from(
                new Set(sharedTargets.map((target) => target.taskSimpleId)),
              );
              return (
                <li className="floor-session-row" key={station.id}>
                  <span className={`floor-session-agent ${view.reporter}`}>
                    {initials(view.reporter)}
                  </span>
                  <span className="floor-session-copy">
                    <strong>{sessionTitle}</strong>
                    <small>
                      {reporterLabel(station.worker)}
                      {" · "}
                      {sessionStateLabel(station.state)}
                      {staleSnapshot
                        ? " · last observed; snapshot is stale"
                        : ""}
                    </small>
                    {relatedIds.length > 0 && (
                      <small>Also linked to {relatedIds.join(", ")}</small>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : !task.sessionsAvailable || staleSnapshot ? (
          <p className="floor-session-empty">
            Session status unavailable.
            <small>
              {staleSnapshot
                ? "The snapshot is stale, so session observations may be out of date."
                : "Some observed sources may not provide session data for this project."}
            </small>
          </p>
        ) : (
          <p className="floor-session-empty">No linked session observed.</p>
        )}
        {!task.sessionsAvailable && sessions.length > 0 && (
          <p className="floor-session-empty">
            Some session sources are unavailable.
          </p>
        )}
      </div>
    </article>
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
  snapshot,
}: {
  busy?: boolean;
  canMutate?: boolean;
  connected: boolean;
  error?: string | null;
  loading: boolean;
  onCreateProject: (name: string) => Promise<void>;
  onOpenTarget: (target: FloorTarget) => void;
  snapshot: FloorSnapshot | null;
}) {
  const [now, setNow] = useState(() => new Date());
  const [showAllTurn, setShowAllTurn] = useState(false);
  const [expandedPlannedIds, setExpandedPlannedIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [newProjectName, setNewProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [hiddenBayIds, setHiddenBayIds] = useState<Set<string>>(() =>
    readCollapsedBayIds(),
  );
  const observedEventIds = useRef<Set<string>>(new Set());
  const eventLogInitialized = useRef(false);
  const [freshEventIds, setFreshEventIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    writeCollapsedBayIds(hiddenBayIds);
  }, [hiddenBayIds]);
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

  const projects = snapshot?.projects ?? [];
  const hiddenCount = projects.filter((project) =>
    hiddenBayIds.has(project.id),
  ).length;
  const visibleProjects = projects.filter(
    (project) => !hiddenBayIds.has(project.id),
  );
  const projectionAvailable =
    projects.length > 0 &&
    projects.every((project) => project.taskProjectionAvailable);
  const counts = floorTaskCounts(visibleProjects);
  const turnItems = snapshot?.yourTurn.items ?? [];
  const turnCount = turnItems.length;
  const visibleTurnItems = showAllTurn ? turnItems : turnItems.slice(0, 5);
  const observed = date(snapshot?.generatedAt);
  const snapshotAged = Boolean(
    snapshot && (!observed || now.getTime() - observed.getTime() > 30_000),
  );
  const staleSnapshot = !connected || snapshotAged;
  const sourceWarning = Boolean(snapshot?.stale);
  const freshness = observed
    ? `Observed ${observed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
    : "Live projection";
  const open = (target: FloorTarget) => {
    if (target.projectId) onOpenTarget(target);
  };
  const toggleBayVisibility = (projectId: string) => {
    setHiddenBayIds((current) => toggleCollapsedBayIds(current, projectId));
  };
  const togglePlanned = (projectId: string) => {
    setExpandedPlannedIds((current) =>
      toggleCollapsedBayIds(current, projectId),
    );
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
        <div className="floor-freshness">
          <span
            className={`floor-led ${connected ? "ok" : "down"}`}
            aria-hidden="true"
          />
          <span className="floor-freshness-primary" role="status">
            {connected ? "Factory connected" : "Factory connection unavailable"}
          </span>
          {connected && (
            <span className="floor-freshness-detail">{freshness}</span>
          )}
          {snapshotAged && (
            <span className="floor-freshness-detail floor-stale">
              snapshot stale
            </span>
          )}
          {sourceWarning && (
            <span className="floor-freshness-detail floor-source-warning">
              one or more sources unavailable
            </span>
          )}
          {snapshot && !sourceWarning && !snapshotAged && connected && (
            <span className="floor-freshness-detail">
              {snapshot.scoreboard.workingNow} fresh observed{" "}
              {snapshot.scoreboard.workingNow === 1 ? "session" : "sessions"}{" "}
              working · all projects
            </span>
          )}
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
        <section className="floor-primary" aria-label="Task overview">
          <div className="floor-score" aria-label="Visible project task counts">
            <div className="floor-tile">
              <strong>{projectionAvailable ? counts.active : "—"}</strong>
              <span>Active tasks · visible projects</span>
            </div>
            <div className="floor-tile blocked-count">
              <strong>{projectionAvailable ? counts.blocked : "—"}</strong>
              <span>Blocked tasks · visible projects</span>
            </div>
            <div className="floor-tile review-count">
              <strong>{projectionAvailable ? counts.inReview : "—"}</strong>
              <span>In review tasks · visible projects</span>
            </div>
            <div className="floor-tile done-count">
              <strong>{projectionAvailable ? counts.doneToday : "—"}</strong>
              <span>Done today · visible projects</span>
            </div>
          </div>
          {projects.length > 0 && (
            <nav className="floor-project-strip" aria-label="Projects">
              {projects.map((project) => {
                const hidden = hiddenBayIds.has(project.id);
                const needsYouCount = needsYouCountForProject(
                  project.id,
                  turnItems,
                );
                const toggleLabel = `${hidden ? "Show" : "Hide"} ${project.name} on the Floor${hidden && needsYouCount ? `, ${needsYouCount} needs you` : ""}`;
                return (
                  <div
                    className={`floor-project-chip${hidden ? " hidden" : " visible"}${hidden && needsYouCount > 0 ? " needs-you" : ""}`}
                    key={project.id}
                  >
                    <button
                      aria-label={toggleLabel}
                      aria-pressed={!hidden}
                      className={`floor-project-toggle${hidden ? " hidden" : " visible"}`}
                      onClick={() => toggleBayVisibility(project.id)}
                      title={toggleLabel}
                      type="button"
                    >
                      <span className="floor-project-name">{project.name}</span>
                      {hidden && needsYouCount > 0 && (
                        <span className="floor-hidden-needs-you">
                          {needsYouCount} needs you
                        </span>
                      )}
                      <span
                        aria-hidden="true"
                        className="floor-project-visibility"
                      >
                        {hidden ? "○" : "✓"}
                      </span>
                    </button>
                    <button
                      aria-label={`Open ${project.name}`}
                      className="floor-project-open"
                      onClick={() => open({ projectId: project.id })}
                      title={`Open ${project.name}`}
                      type="button"
                    >
                      <ArrowSquareOut aria-hidden="true" size={16} />
                    </button>
                  </div>
                );
              })}
              {hiddenCount > 0 && (
                <button
                  className="floor-show-all"
                  onClick={() => setHiddenBayIds(new Set())}
                  type="button"
                >
                  Show all ({hiddenCount})
                </button>
              )}
            </nav>
          )}
          {!snapshot ? (
            <div className="floor-notice">
              {loading
                ? "Loading task overview…"
                : "Task overview is waiting for Floor data."}
            </div>
          ) : projects.length === 0 ? (
            <div className="floor-notice">
              {loading ? "Loading projects…" : "No projects are available."}
            </div>
          ) : !projectionAvailable ? (
            <div className="floor-notice floor-notice-error" role="status">
              Task overview unavailable. Refresh Factory to load the task-card
              projection.
            </div>
          ) : visibleProjects.length === 0 ? (
            <p className="floor-hidden-empty">
              All {projects.length} projects are hidden. Use Show all or select
              a project above.
            </p>
          ) : (
            <div className="floor-task-sections" aria-label="Tasks by project">
              {visibleProjects.map((project) => {
                const cards = projectTaskCards(project);
                const visibleTasks = cards.filter(
                  (task) =>
                    task.state !== "backlog" &&
                    task.state !== "completed" &&
                    task.state !== "planned",
                );
                const plannedTasks = cards.filter(
                  (task) => task.state === "planned",
                );
                const backlogCount = cards.filter(
                  (task) => task.state === "backlog",
                ).length;
                const showAllPlanned = expandedPlannedIds.has(project.id);
                const plannedVisible = showAllPlanned
                  ? plannedTasks
                  : plannedTasks.slice(0, 4);
                return (
                  <section className="floor-project-tasks" key={project.id}>
                    <header className="floor-project-heading">
                      <div>
                        <p className="eyebrow">Project</p>
                        <h2>
                          <button
                            aria-label={`Open ${project.name}`}
                            onClick={() => open({ projectId: project.id })}
                            type="button"
                          >
                            {project.name}
                          </button>
                        </h2>
                      </div>
                      <div className="floor-project-heading-meta">
                        <span>
                          {visibleTasks.length + plannedTasks.length} task cards
                        </span>
                        {backlogCount > 0 && (
                          <button
                            className="floor-backlog-link"
                            onClick={() => open({ projectId: project.id })}
                            type="button"
                          >
                            {backlogCount} backlog · open project
                          </button>
                        )}
                      </div>
                    </header>
                    {visibleTasks.length > 0 && (
                      <div className="floor-task-grid">
                        {visibleTasks.map((task) => (
                          <FloorTaskCardView
                            key={task.taskId}
                            now={now.getTime()}
                            onOpen={open}
                            staleSnapshot={staleSnapshot}
                            task={task}
                          />
                        ))}
                      </div>
                    )}
                    {plannedTasks.length > 0 && (
                      <section className="floor-planned-section">
                        <h3>Planned · {plannedTasks.length}</h3>
                        <div className="floor-task-grid planned-grid">
                          {plannedVisible.map((task) => (
                            <FloorTaskCardView
                              key={task.taskId}
                              now={now.getTime()}
                              onOpen={open}
                              planned
                              staleSnapshot={staleSnapshot}
                              task={task}
                            />
                          ))}
                        </div>
                        {plannedTasks.length > 4 && (
                          <button
                            className="floor-more floor-planned-more"
                            onClick={() => togglePlanned(project.id)}
                            type="button"
                          >
                            {showAllPlanned
                              ? "Show fewer planned tasks"
                              : `Show ${plannedTasks.length - 4} more planned tasks`}
                          </button>
                        )}
                      </section>
                    )}
                    {visibleTasks.length === 0 && plannedTasks.length === 0 && (
                      <p className="floor-project-empty">
                        No active, blocked, in-review, or planned tasks. Backlog
                        remains in project detail.
                      </p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
          {projectionAvailable && visibleProjects.length > 0 && (
            <details className="floor-recently-done">
              <summary className="floor-disclosure-summary">
                <CaretRight
                  aria-hidden="true"
                  className="floor-disclosure-caret"
                  size={16}
                />
                Done today · {counts.doneToday}
              </summary>
              {counts.doneToday > 0 ? (
                <div className="floor-task-grid">
                  {visibleProjects.flatMap((project) =>
                    (project.recentlyDone ?? []).map((task) => (
                      <FloorTaskCardView
                        key={task.taskId}
                        now={now.getTime()}
                        onOpen={open}
                        staleSnapshot={staleSnapshot}
                        task={task}
                      />
                    )),
                  )}
                </div>
              ) : (
                <p className="floor-project-empty">
                  No tasks finished today in visible projects.
                </p>
              )}
            </details>
          )}
          {projectionAvailable &&
            visibleProjects.some(
              (project) => project.unmatchedSessions?.length,
            ) && (
              <section
                className="floor-unmatched"
                aria-labelledby="floor-unmatched-title"
              >
                <div className="floor-section-heading">
                  <div>
                    <p className="eyebrow">Observation only</p>
                    <h2 id="floor-unmatched-title">Sessions without a task</h2>
                  </div>
                  <span>Not counted as tasks</span>
                </div>
                <ul className="floor-unmatched-list">
                  {visibleProjects.flatMap((project) =>
                    (project.unmatchedSessions ?? []).map((session) => (
                      <li
                        className="floor-session-row"
                        key={`${project.id}:${session.id}`}
                      >
                        <span
                          className={`floor-session-agent ${session.reporter}`}
                        >
                          {initials(session.reporter)}
                        </span>
                        <span className="floor-session-copy">
                          <strong>{session.name}</strong>
                          <small>
                            {project.name} ·{" "}
                            {workSessionStateLabel(session.tokenState)}
                            {staleSnapshot
                              ? " · last observed; snapshot is stale"
                              : ""}
                          </small>
                        </span>
                      </li>
                    )),
                  )}
                </ul>
              </section>
            )}
          <details className="floor-create-project">
            <summary className="floor-disclosure-summary">
              <CaretRight
                aria-hidden="true"
                className="floor-disclosure-caret"
                size={16}
              />
              New project
            </summary>
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
        </section>
        <aside
          className="floor-sidecar"
          aria-label="Needs you and recent changes"
        >
          <section
            className={`floor-turn${turnCount ? " attention" : ""}`}
            aria-labelledby="your-turn-title"
          >
            <p className="eyebrow" id="your-turn-title">
              Needs you · global queue
            </p>
            <div className="floor-turn-big">
              <span
                className={`floor-turn-count ${turnCount === 0 ? "empty-count" : ""}`}
              >
                {turnCount}
              </span>
              <span className="floor-turn-label">
                recorded attention items
                <small>
                  {snapshot
                    ? sourceWarning
                      ? "Some queue sources are unavailable; this breakdown may be incomplete."
                      : `${snapshot.yourTurn.reviews} review · ${snapshot.yourTurn.checks} check · ${snapshot.yourTurn.decisions} decide · ${snapshot.yourTurn.unblocks} unblock`
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
                      aria-label={`${item.kind} ${item.label}, ${relativeAgeLabel(item.ageLabel)}`}
                      onClick={() => open(item)}
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
            {snapshot?.trackingNotes?.length ? (
              <div className="floor-tracking-notes">
                {snapshot.trackingNotes.length} tracking{" "}
                {snapshot.trackingNotes.length === 1 ? "note" : "notes"} · not
                counted ·{" "}
                <button
                  type="button"
                  className="floor-more"
                  onClick={() => open(snapshot.trackingNotes![0]!)}
                >
                  Open
                </button>
              </div>
            ) : null}
          </section>
          <section className="floor-log" aria-labelledby="shift-log-title">
            <p className="eyebrow" id="shift-log-title">
              Recent changes · latest 20
            </p>
            {snapshot?.shiftLog.length ? (
              <ul>
                {snapshot.shiftLog.slice(0, 20).map((entry) => (
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
        </aside>
      </div>
    </section>
  );
}
