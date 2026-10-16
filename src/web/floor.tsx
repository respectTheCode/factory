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
  projectName: string;
  timestamp: string;
  reason?: string;
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
  connections: ServerFloorSnapshot["connections"];
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
    projectName: item.projectName,
    ...(item.reason ? { reason: item.reason } : {}),
    relatedTargets: item.relatedTargets,
    timestamp: item.timestamp,
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
    connections: input.connections,
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

export { Floor } from "./simple-floor";
