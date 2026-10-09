import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  TaskStatus as ApplicationTaskStatus,
  TaskActivityItem,
} from "../application";
import { workflowActivityText } from "./workflow-activity";
import { TaskWorkflow } from "./task-workflow";
import { requiredPullRequestSummary, taskPRWaitingCopy } from "./workflow-pr";
import type { RequiredPullRequest } from "./workflow-panel";
import { TaskProvenance } from "./workflow-panel";
import type { DashboardSnapshot as ApplicationDashboardSnapshot } from "../application";
import type { FloorSnapshot as ServerFloorSnapshot } from "../floor";
import type { FactoryRouter } from "../server";
import type { GitHubStatusSnapshot } from "../github";
import type {
  T3ObservedActivity,
  T3StatusResult,
  T3ThreadDetailResult,
} from "../t3-coordinator";
import { ConnectionState, type ConnectionSnapshot } from "./connection-state";
import { BackupsPage } from "./backups";
import { ConnectionsPage } from "./connections";
import {
  AgentTokenBanner,
  AgentTokenProvider,
  useAgentTokenHandoff,
} from "./agent-token-handoff";
import { Floor, normalizeFloorSnapshot, type FloorTarget } from "./floor";
import {
  formatHistoryReportAttribution,
  historyThreadsForTarget,
} from "./history";
import { HistoryThreadLinks } from "./history-thread-links";
import {
  githubActionsSummaryLabel,
  summarizeGitHubActions,
  type GitHubActionsSummary,
} from "./github-status";
import {
  dashboardPath,
  dashboardViewFromPath,
  backupsView,
  connectionsView,
  editProjectView,
  homeView,
  projectView,
  type DashboardView,
} from "./navigation";
import {
  filterArchivedTasks,
  groupSubtasksByStatus,
  groupTasksByStatus,
  reorderIds,
  summarizeTaskProgress,
} from "./task-summary";
import {
  archiveStatusOrder,
  dispositionStatusOptions,
  liveWorkStatusOrder,
  requiresStateReason,
  statusDefinitions,
  taskStatusOrder,
  workStatusForReportedState,
  type ReportedStatus,
  type WorkStatus,
} from "./status-presentation";
import {
  ObservedActivitySection,
  observedThreadKey,
  type ObservedActivityViewModel,
  type ObservedTarget,
  type ObservedThreadDetail,
} from "./observed-activity";
import { summarizeT3Connections, t3ConnectionLabel } from "./t3-connection";
import { ScreenshotProof, screenshotAnchorId } from "./screenshot-proof";
import { ThreadDots } from "./thread-dots";
import { TaskTracking, type TrackingReportInput } from "./task-tracking-panel";
import { verificationAttribution } from "./reviewer-presentation";
import "./styles.css";

type Wire<T> = T extends Date
  ? Date | string
  : T extends Array<infer U>
    ? Array<Wire<U>>
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;
type DashboardSnapshot = Wire<ApplicationDashboardSnapshot>;
type ProjectSummary = { id: string; name: string };
type FloorViewSnapshot = ReturnType<typeof normalizeFloorSnapshot>;
type FloorConnections = ServerFloorSnapshot["connections"];
type WorkCounts = {
  backlog: number;
  planned: number;
  active: number;
  awaiting_verification: number;
  completed: number;
  blocked: number;
  released: number;
  wont_do: number;
};
type PortfolioStatus = {
  totalTasks: number;
  counts: WorkCounts;
  projects: Array<{
    projectId: string;
    projectName: string;
    totalTasks: number;
    counts: WorkCounts;
  }>;
};
type ProjectDetail = {
  gitOriginUrl?: string;
  id: string;
  name: string;
  trackerLinks: Array<{
    id: string;
    system: "linear" | "notion";
    stableId: string;
    title?: string;
    url: string;
  }>;
  tasks: Array<{
    id: string;
    simpleId: string;
    name: string;
    projectId: string;
    humanCheckText?: string;
    pullRequestRequired?: boolean;
    branchName?: string;
    pullRequestUrl?: string;
    workState?: WorkStatus;
    stateReason?: string;
    sortOrder?: number;
    archiveState?: "released" | "wont_do";
    subtasks: Array<{
      id: string;
      simpleId: string;
      name: string;
      taskId: string;
      description?: string;
      evidence?: string;
      screenshots?: Array<{
        id: string;
        projectId: string;
        subtaskId?: string;
        contentType: "image/png" | "image/jpeg" | "image/webp";
        sizeBytes: number;
        caption: string;
        uploader: string;
        uploaderKind: "human" | "machine";
        uploadedAt: string | Date;
        capturedAt?: string | Date;
        captureContext?: string;
        testedRevision?: string;
        pairId?: string;
        label?: "before" | "after";
      }>;
      pullRequestUrl?: string;
      sortOrder?: number;
      workState?: WorkStatus;
      stateReason?: string;
      archiveState?: "released" | "wont_do";
    }>;
  }>;
};
type TaskStatus = Wire<ApplicationTaskStatus>;
type TaskDetail = {
  branchName?: string;
  pullRequestUrl?: string;
  id: string;
  simpleId: string;
  name: string;
  projectId: string;
  objective?: string;
  acceptanceCriteria: string[];
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
  dependencies: string[];
  repositoryLinks: string[];
  archiveState?: "released" | "wont_do";
  trackerLinks: Array<{
    id: string;
    system: "linear" | "notion";
    stableId: string;
    title?: string;
    url: string;
  }>;
  screenshots?: ProjectDetail["tasks"][number]["subtasks"][number]["screenshots"];
};
type TaskEditValues = {
  title: string;
  description: string;
  acceptanceCriteria: string;
};
type HumanSessionResponse = {
  human: { name: string } | null;
  error?: string;
};

type LiveWorkState = (typeof liveWorkStatusOrder)[number];
type TaskEditableWorkState = (typeof taskStatusOrder)[number];

type DragTarget = {
  id: string;
  kind: "task" | "subtask";
  overId?: string;
  state: LiveWorkState;
};

const DRAG_TAIL = "__factory_reorder_tail__";

function isLiveWorkState(state: WorkStatus): state is LiveWorkState {
  return (liveWorkStatusOrder as readonly string[]).includes(state);
}

function summarizeFloorConnections(
  connections: FloorConnections | undefined,
): ReturnType<typeof summarizeT3Connections> {
  if (!connections) return { state: "unknown" };
  const configured = connections.filter(
    (connection) => connection.state !== "not_configured",
  );
  return {
    connected: configured.filter(
      (connection) => connection.state === "connected",
    ).length,
    state: "ready",
    total: configured.length,
  };
}

type TRPCClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;

type DeploymentEnvironment = "pilot" | "production" | "development";

const DEFAULT_DOCUMENT_TITLE = "Software Factory";
const PILOT_DOCUMENT_TITLE = "PILOT — Software Factory";
const T3_STATUS_POLL_INTERVAL_MS = 30_000;

function isDeploymentEnvironment(
  value: unknown,
): value is DeploymentEnvironment {
  return value === "pilot" || value === "production" || value === "development";
}

function PilotBanner({
  environment,
}: {
  environment: DeploymentEnvironment | null;
}) {
  if (environment !== "pilot") return null;
  return (
    <aside
      aria-label="Pilot environment"
      className="deployment-banner"
      data-deployment-environment="pilot"
      role="status"
    >
      PILOT — isolated test data
    </aside>
  );
}

function observedDate(value: unknown): string | undefined {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : undefined;
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function observedActivityView(
  result: T3ObservedActivity,
): ObservedActivityViewModel {
  const targets = result.targets.map((target) => ({ ...target }));
  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const targetForId = (id: string | undefined): ObservedTarget | undefined =>
    id ? targetsById.get(id) : undefined;
  return {
    connection: {
      ...result.connection,
      ...(observedDate(result.connection.observedAt)
        ? { observedAt: observedDate(result.connection.observedAt) }
        : {}),
      ...(observedDate(result.connection.lastSuccessfulFetchAt)
        ? {
            lastSuccessfulFetchAt: observedDate(
              result.connection.lastSuccessfulFetchAt,
            ),
          }
        : {}),
      ...(result.status === "ok"
        ? {}
        : {
            warning:
              result.error ??
              "T3 project matching is " +
                result.status +
                "; review the explicit project identity.",
          }),
    },
    counts: result.counts,
    findings: result.findings.map((finding) => ({
      candidateLabels: finding.candidateIds
        .map((candidateId) => targetForId(candidateId)?.label)
        .filter((label): label is string => label !== undefined),
      explanation: finding.explanation,
      id: finding.id,
      kind: finding.kind,
      observedAt: observedDate(finding.observedAt),
      severity: finding.severity,
      suggestedAction: finding.suggestedAction,
      targetLabel: targetForId(finding.subtaskId ?? finding.taskId)?.label,
      threadId: finding.externalThreadId,
    })),
    projectName: result.projectName,
    sources: result.sources?.map((source) => ({
      connection: {
        ...source.connection,
        ...(observedDate(source.connection.observedAt)
          ? { observedAt: observedDate(source.connection.observedAt) }
          : {}),
        ...(observedDate(source.connection.lastSuccessfulFetchAt)
          ? {
              lastSuccessfulFetchAt: observedDate(
                source.connection.lastSuccessfulFetchAt,
              ),
            }
          : {}),
      },
      counts: source.counts,
      error: source.error,
      label: source.label,
      machineId: source.machineId,
      sourceId: source.sourceId,
      status: source.status,
    })),
    targets,
    threads: result.threads.map((thread) => ({
      association: {
        ...(thread.association.candidateIds
          ? { candidateIds: [...thread.association.candidateIds] }
          : {}),
        links: thread.association.links.map((link) => ({
          linkId: link.linkId,
          target: targetForId(link.target.id) ?? link.target,
        })),
        state: thread.association.state,
        ...(thread.association.candidateLabels
          ? { candidateLabels: thread.association.candidateLabels }
          : thread.association.candidateIds
            ? {
                candidateLabels: thread.association.candidateIds
                  .map((candidateId) => targetForId(candidateId)?.label)
                  .filter((label): label is string => label !== undefined),
              }
            : {}),
      },
      branch: thread.branch,
      changedFileCount: thread.changedFileCount,
      agent: thread.agent,
      codeSessionId: thread.codeSessionId,
      runId: thread.runId,
      sourceCurrent: thread.sourceCurrent,
      externalProjectId: thread.externalProjectId,
      hasPendingApprovals: thread.hasPendingApprovals,
      hasPendingUserInput: thread.hasPendingUserInput,
      machineId: thread.machineId,
      latestSessionState: thread.latestSessionState,
      latestTurnState: thread.latestTurnState,
      linkedPullRequestUrl: thread.linkedPullRequestUrl,
      observedAt: observedDate(thread.observedAt),
      provider: thread.provider,
      sourceId: thread.sourceId,
      sourceUpdatedAt: observedDate(thread.sourceUpdatedAt),
      threadId: thread.threadId,
      title: thread.title,
      worktreePath: thread.worktreePath,
    })),
  };
}

function observedThreadDetailView(
  result: T3ThreadDetailResult,
): ObservedThreadDetail {
  const detail = result.thread;
  const checkpointFiles = detail
    ? [
        ...new Set(
          detail.checkpoints.flatMap((checkpoint) =>
            checkpoint.files.map((file) => file.path),
          ),
        ),
      ]
    : undefined;
  const turnIds = detail
    ? new Set([
        ...(result.evidence?.turnIds ?? []),
        ...detail.messages.flatMap((message) =>
          message.turnId ? [message.turnId] : [],
        ),
        ...detail.activities.flatMap((activity) =>
          activity.turnId ? [activity.turnId] : [],
        ),
        ...detail.checkpoints.map((checkpoint) => checkpoint.turnId),
      ])
    : undefined;
  return {
    activityCount: detail?.activities.length,
    checkpointCount: detail?.checkpoints.length,
    ...(checkpointFiles && checkpointFiles.length > 0
      ? { checkpointFiles }
      : {}),
    error: result.error,
    observedAt: observedDate(result.connection.observedAt),
    sourceSequence: result.observation?.sourceSequence,
    sourceUpdatedAt: observedDate(result.observation?.sourceUpdatedAt),
    turnCount: turnIds?.size,
  };
}

function unavailableObservedActivity(
  result: T3StatusResult | undefined,
  error: unknown,
): ObservedActivityViewModel {
  const message =
    error instanceof Error
      ? error.message
      : "T3 observations could not be refreshed.";
  return {
    connection: {
      ...(result?.connection ?? {}),
      error: message,
      state: result?.connection.state ?? "unavailable",
      ...(result?.status && result.status !== "ok" ? { warning: message } : {}),
    },
    counts: result?.counts ?? {
      ambiguous: 0,
      linked: 0,
      needsAttention: 0,
      running: 0,
      suggested: 0,
      unmatched: 0,
    },
    findings: [],
    targets: [],
    threads: [],
  };
}

function Dashboard() {
  const agentTokenHandoff = useAgentTokenHandoff();
  const [connection] = useState(() => new ConnectionState());
  const [deploymentEnvironment, setDeploymentEnvironment] =
    useState<DeploymentEnvironment | null>(null);
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(
    connection.snapshot(),
  );
  const [view, setView] = useState<DashboardView>(() =>
    dashboardViewFromPath(window.location.pathname),
  );
  const [taskName, setTaskName] = useState("");
  const [taskBranchName, setTaskBranchName] = useState("");
  const [taskObjective, setTaskObjective] = useState("");
  const [taskAcceptanceCriteria, setTaskAcceptanceCriteria] = useState("");
  const [taskPriority, setTaskPriority] = useState<
    "low" | "medium" | "high" | "urgent"
  >("medium");
  const [taskOwner, setTaskOwner] = useState("");
  const [taskDependencies, setTaskDependencies] = useState("");
  const [taskRepositoryLinks, setTaskRepositoryLinks] = useState("");
  const [subtaskNames, setSubtaskNames] = useState<Record<string, string>>({});
  const [subtaskDescriptions, setSubtaskDescriptions] = useState<
    Record<string, string>
  >({});
  const [projectLinkInputs, setProjectLinkInputs] = useState<
    Record<
      string,
      {
        system: "linear" | "notion";
        stableId: string;
        title: string;
        url: string;
      }
    >
  >({});
  const [projectTrackerInput, setProjectTrackerInput] = useState({
    system: "linear" as "linear" | "notion",
    stableId: "",
    title: "",
    url: "",
  });
  const [projectGitOriginInput, setProjectGitOriginInput] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [floorSnapshot, setFloorSnapshot] = useState<ReturnType<
    typeof normalizeFloorSnapshot
  > | null>(null);
  const [floorAuthoritative, setFloorAuthoritative] = useState(false);
  const [floorError, setFloorError] = useState<string | null>(null);
  const [floorLoading, setFloorLoading] = useState(false);
  const [portfolioStatus, setPortfolioStatus] =
    useState<PortfolioStatus | null>(null);
  const [showArchivedTasks, setShowArchivedTasks] = useState(false);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(
    null,
  );
  const [taskDetails, setTaskDetails] = useState<Record<string, TaskDetail>>(
    {},
  );
  const [taskEdits, setTaskEdits] = useState<Record<string, TaskEditValues>>(
    {},
  );
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>(
    {},
  );
  const [githubStatuses, setGithubStatuses] = useState<
    Record<string, GitHubStatusSnapshot>
  >({});
  const [t3Activity, setT3Activity] =
    useState<ObservedActivityViewModel | null>(null);
  const [t3Status, setT3Status] = useState<T3StatusResult | undefined>(
    undefined,
  );
  const [floorConnections, setFloorConnections] = useState<
    FloorConnections | undefined
  >(undefined);
  const [t3Busy, setT3Busy] = useState(false);
  const [t3ThreadDetails, setT3ThreadDetails] = useState<
    Record<string, ObservedThreadDetail>
  >({});
  const [t3ThreadDetailLoadingIds, setT3ThreadDetailLoadingIds] = useState<
    Set<string>
  >(() => new Set());
  const [collapsedTaskGroups, setCollapsedTaskGroups] = useState<
    Partial<Record<WorkStatus, boolean>>
  >({});
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);
  const [pendingFloorTarget, setPendingFloorTarget] =
    useState<FloorTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [human, setHuman] = useState<{ name: string } | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionSecret, setSessionSecret] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [webSocketGeneration, setWebSocketGeneration] = useState(0);
  const trpc = useRef<TRPCClient | null>(null);
  const subscriptionCleanup = useRef<(() => void) | null>(null);
  const floorSubscriptionCleanup = useRef<(() => void) | null>(null);
  const floorSubscriptionGeneration = useRef(0);
  const floorSubscriptionRetry = useRef<number | null>(null);
  const t3RefreshGeneration = useRef(0);
  const t3StatusGeneration = useRef(0);
  const t3StatusRequest = useRef<symbol | null>(null);
  const floorRefreshGeneration = useRef(0);
  const floorRequest = useRef<symbol | null>(null);
  const floorRequestPromise = useRef<Promise<
    ReturnType<typeof normalizeFloorSnapshot> | undefined
  > | null>(null);
  const floorSnapshotRef = useRef<FloorViewSnapshot | null>(null);
  const floorAuthoritativeRef = useRef(false);
  const webSocketGenerationRef = useRef(webSocketGeneration);
  webSocketGenerationRef.current = webSocketGeneration;

  const updateFloorAuthority = (value: boolean) => {
    floorAuthoritativeRef.current = value;
    setFloorAuthoritative(value);
  };

  useEffect(() => {
    const dismissOpenMenus = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      const openMenus = document.querySelectorAll<HTMLDetailsElement>(
        "details.task-menu[open], details.status-menu[open]",
      );
      for (const menu of openMenus) {
        if (!menu.contains(event.target)) {
          menu.removeAttribute("open");
        }
      }
    };

    document.addEventListener("pointerdown", dismissOpenMenus);
    return () => {
      document.removeEventListener("pointerdown", dismissOpenMenus);
    };
  }, []);

  useEffect(() => {
    document.title =
      deploymentEnvironment === "pilot"
        ? PILOT_DOCUMENT_TITLE
        : DEFAULT_DOCUMENT_TITLE;
  }, [deploymentEnvironment]);

  useEffect(() => {
    let active = true;
    void fetch("/deployment.json", {
      cache: "no-store",
      credentials: "omit",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { environment?: unknown };
        if (active && isDeploymentEnvironment(result.environment)) {
          setDeploymentEnvironment(result.environment);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const refreshFloor = async (
    client: TRPCClient,
  ): Promise<ReturnType<typeof normalizeFloorSnapshot> | undefined> => {
    if (floorRequestPromise.current) return floorRequestPromise.current;
    const request = Symbol("floor");
    floorRequest.current = request;
    const generation = ++floorRefreshGeneration.current;
    setFloorLoading(true);
    const requestPromise = (async () => {
      try {
        const result = await client.projects.floor.query({});
        if (
          trpc.current !== client ||
          floorRefreshGeneration.current !== generation
        )
          return floorSnapshotRef.current ?? undefined;
        const next = normalizeFloorSnapshot(result);
        floorSnapshotRef.current = next;
        setFloorSnapshot(next);
        setFloorError(null);
        return next;
      } catch (error: unknown) {
        if (
          trpc.current !== client ||
          floorRefreshGeneration.current !== generation
        )
          return floorSnapshotRef.current ?? undefined;
        setFloorError(
          error instanceof Error
            ? error.message
            : "Floor data could not be refreshed.",
        );
        setFloorSnapshot((current) =>
          current ? { ...current, stale: true } : current,
        );
        return undefined;
      } finally {
        if (floorRequest.current === request) {
          floorRequest.current = null;
          setFloorLoading(false);
        }
      }
    })();
    floorRequestPromise.current = requestPromise;
    try {
      return await requestPromise;
    } finally {
      if (floorRequestPromise.current === requestPromise) {
        floorRequestPromise.current = null;
      }
    }
  };

  const clearFloorState = (error?: string | null) => {
    floorRefreshGeneration.current += 1;
    floorRequest.current = null;
    floorRequestPromise.current = null;
    floorSnapshotRef.current = null;
    setFloorConnections(undefined);
    setFloorSnapshot(null);
    updateFloorAuthority(false);
    if (error !== undefined) setFloorError(error);
    setFloorLoading(false);
  };

  const stopFloorSubscription = (
    options: {
      clear?: boolean;
      error?: string;
    } = {},
  ) => {
    floorSubscriptionGeneration.current += 1;
    if (floorSubscriptionRetry.current !== null) {
      window.clearTimeout(floorSubscriptionRetry.current);
      floorSubscriptionRetry.current = null;
    }
    const cleanup = floorSubscriptionCleanup.current;
    floorSubscriptionCleanup.current = null;
    cleanup?.();
    if (options.clear) clearFloorState(options.error);
  };

  const scheduleFloorSubscriptionRetry = (
    client: TRPCClient,
    generation: number,
  ) => {
    if (floorSubscriptionRetry.current !== null) return;
    floorSubscriptionRetry.current = window.setTimeout(() => {
      floorSubscriptionRetry.current = null;
      if (
        trpc.current !== client ||
        floorSubscriptionGeneration.current !== generation ||
        connection.snapshot().state !== "connected"
      )
        return;
      const cleanup = floorSubscriptionCleanup.current;
      floorSubscriptionCleanup.current = null;
      cleanup?.();
      startFloorSubscription(client);
    }, 1_000);
  };

  const startFloorSubscription = (client: TRPCClient) => {
    const generation = ++floorSubscriptionGeneration.current;
    const isCurrent = () =>
      trpc.current === client &&
      floorSubscriptionGeneration.current === generation;
    const subscription = client.projects.floorUpdates.subscribe(
      {},
      {
        onConnectionStateChange: (state) => {
          if (!isCurrent()) return;
          if (state.state !== "idle") {
            floorRefreshGeneration.current += 1;
            updateFloorAuthority(false);
            setFloorConnections(undefined);
            setFloorLoading(true);
          }
        },
        onData: (result) => {
          if (!isCurrent()) return;
          // A pushed snapshot is newer authority than any outstanding query.
          floorRefreshGeneration.current += 1;
          const next = normalizeFloorSnapshot(result);
          floorSnapshotRef.current = next;
          setFloorConnections(result.connections);
          setFloorSnapshot(next);
          updateFloorAuthority(true);
          setFloorError(null);
          setFloorLoading(false);
          connection.markAuthoritativeRefresh();
          setSnapshot(connection.snapshot());
        },
        onError: (error) => {
          if (!isCurrent()) return;
          floorRefreshGeneration.current += 1;
          updateFloorAuthority(false);
          setFloorConnections(undefined);
          setFloorError(
            error instanceof Error
              ? error.message
              : "Floor data stream could not be refreshed.",
          );
          setFloorSnapshot((current) => {
            if (!current) return current;
            const next = { ...current, stale: true };
            floorSnapshotRef.current = next;
            return next;
          });
          setFloorLoading(false);
          scheduleFloorSubscriptionRetry(client, generation);
        },
        onComplete: () => {
          if (!isCurrent()) return;
          floorRefreshGeneration.current += 1;
          updateFloorAuthority(false);
          setFloorConnections(undefined);
          setFloorError("Floor data stream closed; reconnecting.");
          setFloorSnapshot((current) => {
            if (!current) return current;
            const next = { ...current, stale: true };
            floorSnapshotRef.current = next;
            return next;
          });
          setFloorLoading(false);
          scheduleFloorSubscriptionRetry(client, generation);
        },
        onStarted: () => {
          if (!isCurrent()) return;
          setFloorLoading(true);
        },
      },
    );
    floorSubscriptionCleanup.current = () => subscription.unsubscribe();
  };

  const refreshT3Status = async (client: TRPCClient) => {
    if (t3StatusRequest.current) return;
    const request = Symbol("t3-status");
    t3StatusRequest.current = request;
    const generation = ++t3StatusGeneration.current;
    try {
      const result = await client.t3.status.query({});
      if (trpc.current !== client || t3StatusGeneration.current !== generation)
        return;
      setT3Status(result);
    } catch {
      if (trpc.current !== client || t3StatusGeneration.current !== generation)
        return;
      setT3Status(undefined);
    } finally {
      if (t3StatusRequest.current === request) {
        t3StatusRequest.current = null;
      }
    }
  };

  useEffect(() => {
    let active = true;
    void fetch("/session", { credentials: "same-origin" })
      .then(async (response) => {
        const result = (await response.json()) as HumanSessionResponse;
        if (!response.ok) {
          throw new Error(
            result.error ?? "Session status could not be loaded.",
          );
        }
        if (!active) return;
        setHuman(result.human);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setSessionError(
          error instanceof Error
            ? error.message
            : "Session status could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setSessionLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (sessionLoading || !human) return;
    const generation = webSocketGeneration;
    const client = createWSClient({
      onClose: () => {
        if (webSocketGenerationRef.current !== generation) return;
        t3RefreshGeneration.current += 1;
        t3StatusGeneration.current += 1;
        t3StatusRequest.current = null;
        subscriptionCleanup.current?.();
        subscriptionCleanup.current = null;
        stopFloorSubscription({
          clear: true,
          error: "Factory connection closed; Floor data is unavailable.",
        });
        connection.markDisconnected();
        setProjects(null);
        setPortfolioStatus(null);
        setProjectDetail(null);
        setTaskDetails({});
        setTaskEdits({});
        setTaskStatuses({});
        setGithubStatuses({});
        setT3Activity(null);
        setFloorConnections(undefined);
        setT3Status(undefined);
        setT3Busy(false);
        setT3ThreadDetails({});
        setT3ThreadDetailLoadingIds(new Set());
        setSnapshot(connection.snapshot());
      },
      onOpen: () => {
        if (webSocketGenerationRef.current !== generation) return;
        connection.markConnected(new Date());
        setSnapshot(connection.snapshot());
        void Promise.all([
          trpc.current?.projects.list.query(),
          trpc.current?.projects.portfolio.query(),
        ]).then(([nextProjects, nextPortfolio]) => {
          if (!nextProjects || !nextPortfolio) return;
          setProjects(nextProjects);
          setPortfolioStatus(nextPortfolio);
          connection.markAuthoritativeRefresh();
          setSnapshot(connection.snapshot());
        });
      },
      url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/trpc`,
    });
    trpc.current = createTRPCProxyClient<FactoryRouter>({
      links: [wsLink({ client })],
    });

    return () => {
      t3StatusGeneration.current += 1;
      t3StatusRequest.current = null;
      setT3Status(undefined);
      subscriptionCleanup.current?.();
      subscriptionCleanup.current = null;
      stopFloorSubscription({ clear: true });
      void client.close();
    };
  }, [connection, human, sessionLoading, webSocketGeneration]);

  useEffect(() => {
    if (sessionLoading || !human || snapshot.state !== "connected") return;
    const client = trpc.current;
    if (!client) return;
    stopFloorSubscription();
    updateFloorAuthority(false);
    setFloorConnections(undefined);
    setFloorError(null);
    setFloorLoading(true);
    startFloorSubscription(client);
    return () => stopFloorSubscription({ clear: true });
  }, [connection, human, sessionLoading, snapshot.state, webSocketGeneration]);

  useEffect(() => {
    if (sessionLoading || !human || view.screen === "home") return;
    let active = true;
    const pollT3Status = () => {
      if (!active || connection.snapshot().state !== "connected") return;
      const client = trpc.current;
      if (client) void refreshT3Status(client);
    };
    // Floor owns live T3 freshness on home; keep this query for the shared
    // header on project, connection, and backup screens where Floor is absent.
    pollT3Status();
    const interval = window.setInterval(
      pollT3Status,
      T3_STATUS_POLL_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [connection, human, sessionLoading, view.screen, webSocketGeneration]);

  useEffect(() => {
    if (view.screen === "home") setT3Status(undefined);
  }, [view.screen]);

  const refreshGitHubStatuses = async (detail: ProjectDetail) => {
    const client = trpc.current;
    if (!client) return;
    const resources = detail.tasks.flatMap((task) => [
      ...(task.pullRequestUrl
        ? [{ key: `task:${task.id}`, kind: "task" as const, id: task.id }]
        : []),
      ...task.subtasks.flatMap((subtask) =>
        subtask.pullRequestUrl
          ? [
              {
                key: `subtask:${subtask.id}`,
                kind: "subtask" as const,
                id: subtask.id,
              },
            ]
          : [],
      ),
    ]);
    const entries = await Promise.all(
      resources.map(
        async (resource) =>
          [
            resource.key,
            resource.kind === "task"
              ? await client.tasks.githubStatus.query({ taskId: resource.id })
              : await client.subtasks.githubStatus.query({
                  subtaskId: resource.id,
                }),
          ] as const,
      ),
    );
    if (trpc.current !== client) return;
    setGithubStatuses(Object.fromEntries(entries));
  };

  const applyDashboardSnapshot = (dashboard: DashboardSnapshot) => {
    setProjects(dashboard.projects);
    setPortfolioStatus(dashboard.portfolioStatus);
    if (dashboard.projectDetail) {
      const detail = dashboard.projectDetail as ProjectDetail;
      setProjectDetail(detail);
      setTaskDetails(
        Object.fromEntries(
          dashboard.taskDetails.map((task) => [task.id, task as TaskDetail]),
        ),
      );
      setTaskStatuses(
        Object.fromEntries(
          dashboard.taskStatuses.map((status) => [
            status.taskId,
            status as TaskStatus,
          ]),
        ),
      );
      void refreshGitHubStatuses(detail);
    }
  };

  const refreshProject = async (projectId: string) => {
    const client = trpc.current;
    if (!client) return;
    const dashboard = (await client.projects.snapshot.query({
      projectId,
    })) as DashboardSnapshot;
    if (trpc.current !== client) return;
    applyDashboardSnapshot(dashboard);
  };

  const refreshT3Project = async (projectId: string) => {
    const client = trpc.current;
    if (!client) return;
    const generation = ++t3RefreshGeneration.current;
    setT3Busy(true);
    let nextStatus: T3StatusResult | undefined;
    try {
      const [statusResult, activityResult] = await Promise.allSettled([
        client.t3.status.query({ projectId }),
        client.t3.projectActivity.query({ projectId }),
      ]);
      if (trpc.current !== client || t3RefreshGeneration.current !== generation)
        return;
      nextStatus =
        statusResult.status === "fulfilled" ? statusResult.value : undefined;
      if (activityResult.status === "rejected") {
        throw activityResult.reason;
      }
      // The websocket transformer returns persisted Date fields as ISO
      // strings; the adapter normalizes them before presentation.
      setT3Activity(
        observedActivityView(
          activityResult.value as unknown as T3ObservedActivity,
        ),
      );
    } catch (error) {
      if (trpc.current !== client || t3RefreshGeneration.current !== generation)
        return;
      setT3Activity((current) => {
        const unavailable = unavailableObservedActivity(nextStatus, error);
        return current
          ? {
              ...unavailable,
              findings: current.findings,
              projectName: current.projectName,
              sources: current.sources,
              targets: current.targets,
              threads: current.threads,
            }
          : unavailable;
      });
    } finally {
      if (trpc.current === client && t3RefreshGeneration.current === generation)
        setT3Busy(false);
    }
  };

  const openT3ThreadDetail = async (threadId: string, sourceId?: string) => {
    const client = trpc.current;
    if (!client) return;
    const key = observedThreadKey(threadId, sourceId);
    const observedPanel = document.querySelector<HTMLDetailsElement>(
      '[data-observed-activity="true"]',
    );
    if (observedPanel) {
      observedPanel.open = true;
      window.requestAnimationFrame(() => {
        const observedThread = Array.from(
          observedPanel.querySelectorAll<HTMLElement>(
            "[data-observed-thread-key]",
          ),
        ).find((candidate) => candidate.dataset.observedThreadKey === key);
        observedThread?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
      });
    }
    setT3ThreadDetailLoadingIds((current) => {
      const next = new Set(current);
      next.add(key);
      return next;
    });
    try {
      const detail = await client.t3.threadDetail.query({
        ...(sourceId === undefined ? {} : { sourceId }),
        threadId,
        turnLimit: 1,
      });
      if (trpc.current !== client) return;
      setT3ThreadDetails((current) => ({
        ...current,
        [key]: observedThreadDetailView(
          detail as unknown as T3ThreadDetailResult,
        ),
      }));
    } catch (error) {
      if (trpc.current !== client) return;
      setT3ThreadDetails((current) => ({
        ...current,
        [key]: {
          error:
            error instanceof Error
              ? error.message
              : "T3 thread detail could not be loaded.",
        },
      }));
    } finally {
      if (trpc.current === client) {
        setT3ThreadDetailLoadingIds((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    }
  };

  const linkT3Thread = async (
    threadId: string,
    target: ObservedTarget,
    sourceId?: string,
  ) => {
    const client = trpc.current;
    const projectId = projectDetail?.id;
    if (!client || !projectId || !snapshot.canMutate || busy) return;
    setBusy(true);
    try {
      const result = await client.t3.linkThread.mutate({
        projectId,
        ...(sourceId === undefined ? {} : { sourceId }),
        threadId,
        ...(target.kind === "task"
          ? { taskId: target.id }
          : { subtaskId: target.id }),
      });
      applyDashboardSnapshot(result.dashboard);
      await refreshT3Project(projectId);
    } finally {
      setBusy(false);
    }
  };

  const unlinkT3Thread = async (
    threadId: string,
    associationId?: string,
    sourceId?: string,
  ) => {
    const client = trpc.current;
    const projectId = projectDetail?.id;
    if (!client || !projectId || !snapshot.canMutate || busy) return;
    setBusy(true);
    try {
      const result = await client.t3.unlinkThread.mutate({
        threadId,
        ...(sourceId === undefined ? {} : { sourceId }),
        ...(associationId === undefined ? {} : { associationId }),
      });
      applyDashboardSnapshot(result.dashboard);
      await refreshT3Project(projectId);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!projectDetail) return;
    const projectId = projectDetail.id;
    const refreshInterval = setInterval(() => {
      void refreshProject(projectId);
      void refreshT3Project(projectId);
    }, 60_000);
    return () => clearInterval(refreshInterval);
  }, [projectDetail?.id]);

  useEffect(() => {
    setProjectGitOriginInput(projectDetail?.gitOriginUrl ?? "");
  }, [projectDetail?.gitOriginUrl, projectDetail?.id]);

  useEffect(() => {
    setShowArchivedTasks(false);
    setExpandedRows({});
  }, [projectDetail?.id]);

  useEffect(() => {
    const target = pendingFloorTarget;
    if (!target || !projectDetail || target.projectId !== projectDetail.id)
      return;

    const hasWorkTarget = Boolean(target.taskId || target.subtaskId);
    if ((target.threadId || target.findingId) && !t3Activity) return;
    if (target.threadId && t3Activity) {
      void openT3ThreadDetail(target.threadId, target.sourceId);
    }
    if (target.findingId && t3Activity) {
      const panel = document.querySelector<HTMLDetailsElement>(
        '[data-observed-activity="true"]',
      );
      if (panel) {
        panel.open = true;
        window.requestAnimationFrame(() =>
          panel
            .querySelector<HTMLElement>(".observed-findings")
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        );
      }
      setPendingFloorTarget(null);
      return;
    }
    if (!hasWorkTarget) {
      setPendingFloorTarget(null);
      return;
    }
    // Floor targets can live in any work-state group. Open all groups
    // before expanding the exact row so a planned/blocked subtask is reachable.
    setCollapsedTaskGroups({});
    setExpandedRows((current) => ({
      ...current,
      ...(target.taskId ? { [`task:${target.taskId}`]: true } : {}),
      ...(target.subtaskId ? { [`subtask:${target.subtaskId}`]: true } : {}),
    }));
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const element = document.getElementById(
          target.subtaskId
            ? `floor-subtask-${target.subtaskId}`
            : target.taskId
              ? `floor-task-${target.taskId}`
              : "",
        );
        if (target.threadId && t3Activity) {
          // openT3ThreadDetail owns the observed-thread scroll; do not let the
          // project row scroll steal focus from the pending session.
          setPendingFloorTarget(null);
          return;
        }
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
        if (element) setPendingFloorTarget(null);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pendingFloorTarget, projectDetail, t3Activity]);

  const toggleRow = (rowKey: string) => {
    setExpandedRows((current) => ({
      ...current,
      [rowKey]: !current[rowKey],
    }));
  };

  const stopProjectSubscription = () => {
    subscriptionCleanup.current?.();
    subscriptionCleanup.current = null;
  };

  const navigateToView = (nextView: DashboardView) => {
    const nextPath = dashboardPath(nextView);
    if (window.location.pathname !== nextPath || window.location.search) {
      window.history.pushState({}, "", nextPath);
    }
    setView(nextView);
  };

  const mutateAndRefresh = async (
    action: () => Promise<{ dashboard: DashboardSnapshot }>,
  ) => {
    if (!snapshot.canMutate || !projectDetail) return;
    setBusy(true);
    try {
      const result = await action();
      applyDashboardSnapshot(result.dashboard);
      await refreshFloor(trpc.current!);
    } finally {
      setBusy(false);
    }
  };

  const uploadScreenshot = async (
    target: { taskId?: string; subtaskId?: string },
    input: Parameters<
      NonNullable<React.ComponentProps<typeof ScreenshotProof>["onUpload"]>
    >[0],
  ): Promise<void> => {
    if (!trpc.current) return;
    await mutateAndRefresh(() =>
      trpc.current!.screenshots.upload.mutate({ ...target, ...input }),
    );
  };

  const getScreenshot = async (screenshotId: string) => {
    if (!trpc.current) throw new Error("Factory connection is unavailable.");
    return trpc.current.screenshots.get.query({ screenshotId });
  };

  const taskWorkState = (
    task: ProjectDetail["tasks"][number],
    status: TaskStatus | undefined,
  ): WorkStatus =>
    task.archiveState ??
    status?.archiveState ??
    status?.taskState ??
    task.workState ??
    "planned";

  const subtaskWorkState = (
    subtask: ProjectDetail["tasks"][number]["subtasks"][number],
    status: TaskStatus["subtasks"][number] | undefined,
  ): WorkStatus =>
    subtask.archiveState ??
    status?.archiveState ??
    status?.effectiveState ??
    workStatusForReportedState(
      status?.reportedState ?? "not_started",
      status?.verificationState,
    );

  const setTaskWorkState = async (
    taskId: string,
    workState: TaskEditableWorkState,
    stateReason?: string,
  ) => {
    const client = trpc.current;
    if (!client) return;
    await mutateAndRefresh(() =>
      client.tasks.setState.mutate({
        ...(stateReason ? { reason: stateReason } : {}),
        taskId,
        workState,
      }),
    );
  };

  const reorderTask = async (
    projectId: string,
    taskIds: string[],
    workState: LiveWorkState,
  ) => {
    const client = trpc.current;
    if (!client || taskIds.length === 0) return;
    await mutateAndRefresh(() =>
      client.tasks.reorder.mutate({
        orderedTaskIds: taskIds,
        projectId,
        workState,
      }),
    );
  };

  const reorderSubtasks = async (
    taskId: string,
    subtaskIds: string[],
    workState: LiveWorkState,
  ) => {
    const client = trpc.current;
    if (!client || subtaskIds.length === 0) return;
    await mutateAndRefresh(() =>
      client.subtasks.reorder.mutate({
        orderedSubtaskIds: subtaskIds,
        taskId,
        workState,
      }),
    );
  };

  const beginDrag = (
    event: React.PointerEvent<HTMLButtonElement>,
    target: Omit<DragTarget, "overId">,
  ) => {
    if (!snapshot.canMutate || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragTarget(target);
  };

  const findDragTarget = (
    event: React.PointerEvent<HTMLButtonElement>,
    current: DragTarget,
  ): string | undefined => {
    const hovered = document.elementFromPoint(event.clientX, event.clientY);
    const tail = hovered?.closest<HTMLElement>('[data-reorder-tail="true"]');
    if (
      tail?.dataset.reorderKind === current.kind &&
      tail.dataset.workState === current.state
    ) {
      return DRAG_TAIL;
    }
    const candidate = hovered?.closest<HTMLElement>(
      `[data-reorder-kind="${current.kind}"]`,
    );
    if (
      !candidate ||
      candidate.dataset.workState !== current.state ||
      candidate.dataset.reorderId === current.id
    ) {
      return undefined;
    }
    return candidate.dataset.reorderId;
  };

  const updateDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    setDragTarget((current) =>
      current
        ? { ...current, overId: findDragTarget(event, current) }
        : current,
    );
  };

  const finishDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const current = dragTarget;
    if (!current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const overId = findDragTarget(event, current) ?? current.overId;
    setDragTarget(null);
    if (!overId || overId === current.id || !projectDetail) return;
    const beforeId = overId === DRAG_TAIL ? undefined : overId;

    if (current.kind === "task") {
      const group = groupedProjectTasks.find(
        (candidate) => candidate.state === current.state,
      );
      if (!group) return;
      void reorderTask(
        projectDetail.id,
        reorderIds(
          group.tasks.map((task) => task.id),
          current.id,
          beforeId,
        ),
        current.state,
      );
      return;
    }

    const task = projectDetail.tasks.find((candidate) =>
      candidate.subtasks.some((subtask) => subtask.id === current.id),
    );
    if (!task) return;
    const status = taskStatuses[task.id];
    const groups = groupSubtasksByStatus(
      task.subtasks.map((subtask, index) => ({
        ...subtask,
        state: subtaskWorkState(subtask, status?.subtasks[index]),
      })),
    );
    const group = groups.find((candidate) => candidate.state === current.state);
    if (!group) return;
    void reorderSubtasks(
      task.id,
      reorderIds(
        group.subtasks.map((subtask) => subtask.id),
        current.id,
        beforeId,
      ),
      current.state,
    );
  };

  const keyboardReorder = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    target: Omit<DragTarget, "overId">,
    ids: string[],
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    const index = ids.indexOf(target.id);
    if (index < 0) return;
    if (
      (event.key === "ArrowUp" && index === 0) ||
      (event.key === "ArrowDown" && index === ids.length - 1)
    ) {
      return;
    }
    const beforeId = event.key === "ArrowUp" ? ids[index - 1] : ids[index + 2];
    const next = reorderIds(ids, target.id, beforeId);
    if (next.join("|") === ids.join("|")) return;
    if (target.kind === "task" && projectDetail) {
      void reorderTask(projectDetail.id, next, target.state);
      return;
    }
    if (target.kind === "subtask" && projectDetail) {
      const task = projectDetail.tasks.find((candidate) =>
        candidate.subtasks.some((subtask) => subtask.id === target.id),
      );
      if (task) void reorderSubtasks(task.id, next, target.state);
    }
  };

  const loadProject = async (projectId: string) => {
    stopProjectSubscription();
    t3RefreshGeneration.current += 1;
    setT3Activity(null);
    setT3ThreadDetails({});
    await refreshProject(projectId);
    void refreshT3Project(projectId);
    const subscription = trpc.current?.projects.updates.subscribe(
      { projectId },
      {
        onData: (dashboard) => {
          if (!dashboard.projectDetail) {
            applyDashboardSnapshot(dashboard);
            if (projectDetail?.id === projectId) openHome();
            return;
          }
          if (dashboard.projectDetail.id !== projectId) return;
          applyDashboardSnapshot(dashboard);
          void refreshT3Project(projectId);
        },
      },
    );
    subscriptionCleanup.current = subscription
      ? () => subscription.unsubscribe()
      : null;
  };

  const openProject = (projectId: string) => {
    navigateToView(projectView(projectId));
    void loadProject(projectId);
  };

  const openHome = () => {
    stopProjectSubscription();
    navigateToView(homeView());
  };

  const [checkTaskId, setCheckTaskId] = useState<string | null>(null);
  const openFloorTarget = (target: FloorTarget) => {
    if (target.action === "check" && target.taskId)
      setCheckTaskId(target.taskId);
    if (!target.projectId) return;
    setPendingFloorTarget(target);
    openProject(target.projectId);
  };

  const openBackups = () => {
    stopProjectSubscription();
    navigateToView(backupsView());
  };

  const openConnections = () => {
    stopProjectSubscription();
    navigateToView(connectionsView());
  };

  const openProjectEditor = (projectId: string) => {
    navigateToView(editProjectView(projectId));
  };

  useEffect(() => {
    const handlePopState = () => {
      const nextView = dashboardViewFromPath(window.location.pathname);
      setView(nextView);
      if (
        nextView.screen === "home" ||
        nextView.screen === "backups" ||
        nextView.screen === "connections"
      ) {
        stopProjectSubscription();
        return;
      }
      void loadProject(nextView.projectId);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (snapshot.state !== "connected") return;
    const nextView = dashboardViewFromPath(window.location.pathname);
    setView(nextView);
    if (nextView.screen === "project" || nextView.screen === "edit_project") {
      void loadProject(nextView.projectId);
    }
  }, [snapshot.state]);

  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const visibleProjectTasks = projectDetail
    ? filterArchivedTasks(projectDetail.tasks, showArchivedTasks)
    : [];
  const groupedProjectTasks = groupTasksByStatus(
    visibleProjectTasks,
    taskStatuses,
  );
  const archivedTaskCount = projectDetail
    ? projectDetail.tasks.filter((task) => task.archiveState !== undefined)
        .length
    : 0;

  const createProject = async (name: string) => {
    const client = trpc.current;
    if (!client || !snapshot.canMutate || busy) return;
    setBusy(true);
    try {
      const result = await client.projects.create.mutate({ name });
      applyDashboardSnapshot(result.dashboard);
      await refreshFloor(client);
    } finally {
      setBusy(false);
    }
  };

  const createTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taskName.trim() || !projectDetail || !trpc.current) return;
    await mutateAndRefresh(async () => {
      const result = await trpc.current!.tasks.create.mutate({
        acceptanceCriteria: lines(taskAcceptanceCriteria),
        branchName: taskBranchName.trim() || undefined,
        dependencies: lines(taskDependencies),
        name: taskName.trim(),
        objective: taskObjective.trim() || undefined,
        owner: taskOwner.trim() || undefined,
        priority: taskPriority,
        projectId: projectDetail.id,
        repositoryLinks: lines(taskRepositoryLinks),
      });
      setTaskName("");
      setTaskBranchName("");
      setTaskObjective("");
      setTaskAcceptanceCriteria("");
      setTaskPriority("medium");
      setTaskOwner("");
      setTaskDependencies("");
      setTaskRepositoryLinks("");
      return result;
    });
  };

  const startTaskEdit = (taskId: string) => {
    const detail = taskDetails[taskId];
    if (!detail) return;
    setTaskEdits((current) => ({
      ...current,
      [taskId]: {
        acceptanceCriteria: detail.acceptanceCriteria.join("\n"),
        description: detail.objective ?? "",
        title: detail.name,
      },
    }));
  };

  const cancelTaskEdit = (taskId: string) => {
    setTaskEdits((current) => {
      const next = { ...current };
      delete next[taskId];
      return next;
    });
  };

  const saveTaskEdit = async (event: React.FormEvent, taskId: string) => {
    event.preventDefault();
    const edit = taskEdits[taskId];
    if (!edit?.title.trim() || !trpc.current) return;
    await mutateAndRefresh(async () => {
      const result = await trpc.current!.tasks.update.mutate({
        acceptanceCriteria: lines(edit.acceptanceCriteria),
        name: edit.title.trim(),
        objective: edit.description.trim() || null,
        taskId,
      });
      cancelTaskEdit(taskId);
      return result;
    });
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!sessionSecret || sessionBusy) return;
    setSessionBusy(true);
    setSessionError(null);
    try {
      const response = await fetch("/session/login", {
        body: JSON.stringify({ secret: sessionSecret }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const result = (await response.json()) as HumanSessionResponse;
      if (!response.ok || !result.human) {
        setSessionError(result.error ?? "Sign in failed.");
        return;
      }
      setHuman(result.human);
      setSessionSecret("");
      setWebSocketGeneration((current) => current + 1);
    } catch (error: unknown) {
      setSessionError(
        error instanceof Error ? error.message : "Sign in failed.",
      );
    } finally {
      setSessionBusy(false);
    }
  };

  const signOut = async () => {
    if (sessionBusy || agentTokenHandoff.pending || agentTokenHandoff.notice)
      return;
    setSessionBusy(true);
    setSessionError(null);
    try {
      const response = await fetch("/session/logout", {
        credentials: "same-origin",
        method: "POST",
      });
      if (!response.ok) {
        const result = (await response.json()) as HumanSessionResponse;
        setSessionError(result.error ?? "Sign out failed.");
        return;
      }
      clearFloorState();
      stopFloorSubscription();
      setHuman(null);
      setWebSocketGeneration((current) => current + 1);
    } catch (error: unknown) {
      setSessionError(
        error instanceof Error ? error.message : "Sign out failed.",
      );
    } finally {
      setSessionBusy(false);
    }
  };

  const signInForm = (
    <form className="session-form" onSubmit={signIn}>
      <label>
        <span className="visually-hidden">Operator secret</span>
        <input
          aria-label="Operator secret"
          disabled={sessionBusy}
          onChange={(event) => setSessionSecret(event.target.value)}
          placeholder="Operator secret"
          type="password"
          value={sessionSecret}
        />
      </label>
      <button disabled={sessionBusy || !sessionSecret} type="submit">
        Sign in
      </button>
      {sessionError && (
        <span className="session-error" role="alert">
          {sessionError}
        </span>
      )}
    </form>
  );

  if (sessionLoading) {
    return (
      <main>
        <PilotBanner environment={deploymentEnvironment} />
        <p className="status-twin">Checking session…</p>
      </main>
    );
  }

  if (!human) {
    return (
      <main>
        <PilotBanner environment={deploymentEnvironment} />
        <section className="panel" aria-labelledby="sign-in-title">
          <p className="eyebrow">Factory</p>
          <h1 id="sign-in-title">Sign in to continue</h1>
          {signInForm}
        </section>
      </main>
    );
  }

  return (
    <>
      <div
        className={`app-shell ${view.screen === "home" ? "app-shell-home" : "app-shell-constrained"}`}
      >
        <PilotBanner environment={deploymentEnvironment} />
        <header>
          <a
            aria-label="Factory dashboard"
            className="brand-link"
            href="/"
            onClick={(event) => {
              event.preventDefault();
              window.location.assign("/");
            }}
          >
            <div className="brand-lockup">
              <img alt="Factory" className="brand-mark" src="/icon.svg" />
              <div>
                <div className="wordmark">FACTORY</div>
                <p className="eyebrow">Project operations</p>
              </div>
            </div>
          </a>
          <nav aria-label="Primary" className="global-nav">
            <a
              aria-current={view.screen === "home" ? "page" : undefined}
              className={
                view.screen === "home"
                  ? "global-nav-link selected"
                  : "global-nav-link"
              }
              href="/"
              onClick={(event) => {
                event.preventDefault();
                openHome();
              }}
            >
              Floor
            </a>
            <a
              aria-current={view.screen === "backups" ? "page" : undefined}
              className={
                view.screen === "backups"
                  ? "global-nav-link selected"
                  : "global-nav-link"
              }
              href="/backups"
              onClick={(event) => {
                event.preventDefault();
                openBackups();
              }}
            >
              Backups
            </a>
          </nav>
          <div className="header-status">
            {sessionLoading ? (
              <span className="status-twin">Checking session…</span>
            ) : human ? (
              <div className="session-controls">
                <span className="status-twin">Signed in as {human.name}</span>
                {(agentTokenHandoff.pending || agentTokenHandoff.notice) && (
                  <span
                    className="session-handoff-hint"
                    id="session-handoff-hint"
                  >
                    {agentTokenHandoff.notice
                      ? "Save the one-time token, then choose “I’ve saved it” before signing out."
                      : "Keep this tab open while the one-time token is being issued."}
                  </span>
                )}
                <button
                  aria-describedby={
                    agentTokenHandoff.pending || agentTokenHandoff.notice
                      ? "session-handoff-hint"
                      : undefined
                  }
                  className="secondary"
                  disabled={
                    sessionBusy ||
                    agentTokenHandoff.pending ||
                    !!agentTokenHandoff.notice
                  }
                  onClick={() => void signOut()}
                  type="button"
                >
                  Sign out
                </button>
              </div>
            ) : null}
            <ConnectionIndicator
              snapshot={snapshot}
              onOpenConnections={openConnections}
              floorConnections={
                view.screen === "home" ? floorConnections : undefined
              }
              t3Status={
                view.screen !== "home" && snapshot.state === "connected"
                  ? t3Status
                  : undefined
              }
            />
          </div>
        </header>
      </div>

      <main className={view.screen === "home" ? "floor-main" : "app-main"}>
        <AgentTokenBanner />
        {view.screen === "home" && (
          <Floor
            busy={busy}
            canMutate={
              snapshot.canMutate &&
              snapshot.state === "connected" &&
              floorAuthoritative
            }
            connected={snapshot.state === "connected"}
            error={floorError}
            loading={floorLoading}
            onCreateProject={createProject}
            onOpenTarget={openFloorTarget}
            snapshot={floorSnapshot}
          />
        )}

        {view.screen === "backups" && (
          <BackupsPage client={trpc.current} connection={snapshot} />
        )}

        {view.screen === "connections" && (
          <ConnectionsPage
            canManage={snapshot.canMutate && snapshot.state === "connected"}
            client={trpc.current}
          />
        )}

        {projects &&
          projects.length > 0 &&
          (view.screen === "project" || view.screen === "edit_project") && (
            <nav aria-label="Projects" className="project-tabs">
              {projects.map((project) => (
                <button
                  className={
                    project.id === view.projectId ? "selected" : "secondary"
                  }
                  disabled={snapshot.state !== "connected"}
                  key={project.id}
                  onClick={() => void openProject(project.id)}
                  type="button"
                >
                  {project.name}
                </button>
              ))}
            </nav>
          )}

        {projectDetail &&
          view.screen === "edit_project" &&
          projectDetail.id === view.projectId && (
            <section className="detail" aria-labelledby="project-edit-title">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">Project settings</p>
                  <h2 id="project-edit-title">Edit {projectDetail.name}</h2>
                  <p className="project-summary">
                    Keep planning metadata and external project links together.
                  </p>
                </div>
                <div className="detail-actions">
                  <button
                    className="secondary"
                    onClick={() => openProject(projectDetail.id)}
                    type="button"
                  >
                    Back to tasks
                  </button>
                  <button
                    className="secondary"
                    onClick={openHome}
                    type="button"
                  >
                    Home
                  </button>
                </div>
              </div>

              <form
                className="project-link-form project-context-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!trpc.current) return;
                  void mutateAndRefresh(() =>
                    trpc.current!.projects.update.mutate({
                      gitOriginUrl: projectGitOriginInput.trim() || null,
                      projectId: projectDetail.id,
                    }),
                  );
                }}
              >
                <input
                  aria-label="Git origin URL"
                  disabled={!snapshot.canMutate || busy}
                  onChange={(event) =>
                    setProjectGitOriginInput(event.target.value)
                  }
                  placeholder="Git origin URL (SSH or HTTPS)"
                  value={projectGitOriginInput}
                />
                <button disabled={!snapshot.canMutate || busy} type="submit">
                  Save Git URL
                </button>
              </form>

              <form
                className="project-link-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (
                    !projectTrackerInput.stableId.trim() ||
                    !projectTrackerInput.url.trim() ||
                    !trpc.current
                  )
                    return;
                  void mutateAndRefresh(async () => {
                    const result = await trpc.current!.projects.link.mutate({
                      ...projectTrackerInput,
                      projectId: projectDetail.id,
                      stableId: projectTrackerInput.stableId.trim(),
                      title: projectTrackerInput.title.trim() || undefined,
                      url: projectTrackerInput.url.trim(),
                    });
                    setProjectTrackerInput({
                      system: projectTrackerInput.system,
                      stableId: "",
                      title: "",
                      url: "",
                    });
                    return result;
                  });
                }}
              >
                <select
                  aria-label="Project tracker system"
                  disabled={!snapshot.canMutate || busy}
                  onChange={(event) =>
                    setProjectTrackerInput((current) => ({
                      ...current,
                      system: event.target.value as "linear" | "notion",
                    }))
                  }
                  value={projectTrackerInput.system}
                >
                  <option value="linear">Linear project</option>
                  <option value="notion">Notion project</option>
                </select>
                <input
                  aria-label="Project tracker ID"
                  disabled={!snapshot.canMutate || busy}
                  onChange={(event) =>
                    setProjectTrackerInput((current) => ({
                      ...current,
                      stableId: event.target.value,
                    }))
                  }
                  placeholder="Project ID"
                  value={projectTrackerInput.stableId}
                />
                <input
                  aria-label="Project tracker URL"
                  disabled={!snapshot.canMutate || busy}
                  onChange={(event) =>
                    setProjectTrackerInput((current) => ({
                      ...current,
                      url: event.target.value,
                    }))
                  }
                  placeholder="https://…"
                  value={projectTrackerInput.url}
                />
                <input
                  aria-label="Project tracker title"
                  disabled={!snapshot.canMutate || busy}
                  onChange={(event) =>
                    setProjectTrackerInput((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="Display title (optional)"
                  value={projectTrackerInput.title}
                />
                <button
                  disabled={
                    !snapshot.canMutate ||
                    busy ||
                    !projectTrackerInput.stableId.trim() ||
                    !projectTrackerInput.url.trim()
                  }
                  type="submit"
                >
                  Link project
                </button>
              </form>

              {projectDetail.trackerLinks.length > 0 && (
                <div className="links" aria-label="Project tracker links">
                  {projectDetail.trackerLinks.map((link) => (
                    <a
                      href={link.url}
                      key={link.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {link.system}: {link.title ?? link.stableId}
                    </a>
                  ))}
                </div>
              )}

              <form className="task-editor" onSubmit={createTask}>
                <div>
                  <p className="eyebrow">New task</p>
                  <h3>Plan the next piece of work</h3>
                </div>
                <div className="task-create-main">
                  <label>
                    <span className="visually-hidden">Task name</span>
                    <input
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) => setTaskName(event.target.value)}
                      placeholder="Task name"
                      value={taskName}
                    />
                  </label>
                  <button
                    disabled={!snapshot.canMutate || busy || !taskName.trim()}
                    type="submit"
                  >
                    Add task
                  </button>
                </div>
                <details className="task-planning" open>
                  <summary>Planning metadata</summary>
                  <div className="planning-grid">
                    <textarea
                      aria-label="Task objective"
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) => setTaskObjective(event.target.value)}
                      placeholder="Objective"
                      value={taskObjective}
                    />
                    <textarea
                      aria-label="Acceptance criteria"
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) =>
                        setTaskAcceptanceCriteria(event.target.value)
                      }
                      placeholder="Acceptance criteria (one per line)"
                      value={taskAcceptanceCriteria}
                    />
                    <input
                      aria-label="Task branch name"
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) =>
                        setTaskBranchName(event.target.value)
                      }
                      placeholder="Branch name (optional)"
                      value={taskBranchName}
                    />
                    <select
                      aria-label="Task priority"
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) =>
                        setTaskPriority(
                          event.target.value as
                            | "low"
                            | "medium"
                            | "high"
                            | "urgent",
                        )
                      }
                      value={taskPriority}
                    >
                      <option value="low">Low priority</option>
                      <option value="medium">Medium priority</option>
                      <option value="high">High priority</option>
                      <option value="urgent">Urgent priority</option>
                    </select>
                    <input
                      aria-label="Task owner"
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) => setTaskOwner(event.target.value)}
                      placeholder="Owner"
                      value={taskOwner}
                    />
                    <textarea
                      aria-label="Task dependencies"
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) =>
                        setTaskDependencies(event.target.value)
                      }
                      placeholder="Dependencies (one per line)"
                      value={taskDependencies}
                    />
                    <textarea
                      aria-label="Repository links"
                      disabled={!snapshot.canMutate || busy}
                      onChange={(event) =>
                        setTaskRepositoryLinks(event.target.value)
                      }
                      placeholder="Repository links (one URL per line)"
                      value={taskRepositoryLinks}
                    />
                  </div>
                </details>
              </form>
            </section>
          )}

        {projectDetail &&
          view.screen === "project" &&
          projectDetail.id === view.projectId && (
            <section className="detail" aria-labelledby="project-detail-title">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">Project tasks</p>
                  <h2 id="project-detail-title">{projectDetail.name}</h2>
                  {portfolioStatus &&
                    (() => {
                      const status = portfolioStatus.projects.find(
                        (candidate) => candidate.projectId === projectDetail.id,
                      );
                      return status ? (
                        <p className="project-summary">
                          {status.totalTasks} tasks · {status.counts.backlog}{" "}
                          backlog · {status.counts.planned} planned ·{" "}
                          {status.counts.active} active ·{" "}
                          {status.counts.awaiting_verification} in review ·{" "}
                          {status.counts.completed} done ·{" "}
                          {status.counts.blocked} blocked ·{" "}
                          {status.counts.released} released ·{" "}
                          {status.counts.wont_do} won&apos;t do
                        </p>
                      ) : null;
                    })()}
                </div>
                <div className="detail-actions">
                  <button
                    className="secondary"
                    onClick={openHome}
                    type="button"
                  >
                    Home
                  </button>
                  <button
                    className="secondary"
                    onClick={() => openProjectEditor(projectDetail.id)}
                    type="button"
                  >
                    Edit project
                  </button>
                  <button
                    aria-label={`${showArchivedTasks ? "Hide" : "Show"} archived tasks`}
                    aria-pressed={showArchivedTasks}
                    className="secondary"
                    onClick={() => setShowArchivedTasks((current) => !current)}
                    type="button"
                  >
                    {showArchivedTasks
                      ? "Hide archived"
                      : `Show archived (${archivedTaskCount})`}
                  </button>
                </div>
              </div>

              {portfolioStatus &&
                (() => {
                  const status = portfolioStatus.projects.find(
                    (candidate) => candidate.projectId === projectDetail.id,
                  );
                  if (!status) return null;
                  return (
                    <div className="project-stats" aria-label="Project summary">
                      <div className="project-stat">
                        <strong>{status.totalTasks}</strong>
                        <span>Total tasks</span>
                      </div>
                      <div className="project-stat">
                        <strong>
                          {status.counts.completed}/{status.totalTasks}
                        </strong>
                        <span>Tasks done</span>
                      </div>
                      <div className="project-stat">
                        <strong>{status.counts.active}</strong>
                        <span>Active</span>
                      </div>
                      <div className="project-stat">
                        <strong>{status.counts.blocked}</strong>
                        <span>Blocked</span>
                      </div>
                    </div>
                  );
                })()}

              <ObservedActivitySection
                activity={t3Activity}
                busy={t3Busy || busy}
                canMutate={snapshot.canMutate && !busy}
                onLinkThread={linkT3Thread}
                onOpenThreadDetail={openT3ThreadDetail}
                onRefresh={() => refreshT3Project(projectDetail.id)}
                onUnlinkThread={unlinkT3Thread}
                threadDetails={t3ThreadDetails}
                threadDetailLoadingIds={t3ThreadDetailLoadingIds}
              />

              {projectDetail.tasks.length === 0 ? (
                <div className="empty">
                  <p>
                    No tasks yet. Add the first piece of work from project
                    settings.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => openProjectEditor(projectDetail.id)}
                    type="button"
                  >
                    Add a task
                  </button>
                </div>
              ) : visibleProjectTasks.length === 0 ? (
                <div className="empty">
                  <p>
                    All tasks are archived. Show archived tasks to review or
                    restore them.
                  </p>
                  <button
                    className="secondary"
                    onClick={() => setShowArchivedTasks(true)}
                    type="button"
                  >
                    Show archived tasks
                  </button>
                </div>
              ) : (
                <div className="task-list">
                  {groupedProjectTasks.map(({ state, tasks }) => (
                    <section
                      aria-labelledby={`task-group-${state}`}
                      className={`task-group task-group-${state}`}
                      key={state}
                    >
                      <div className="task-group-heading">
                        <button
                          aria-expanded={!collapsedTaskGroups[state]}
                          aria-label={`${statusDefinitions[state].label} task group`}
                          className="task-group-toggle"
                          onClick={() =>
                            setCollapsedTaskGroups((current) => ({
                              ...current,
                              [state]: !current[state],
                            }))
                          }
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className="task-group-chevron"
                          >
                            {collapsedTaskGroups[state] ? "▸" : "▾"}
                          </span>
                          <StatusIcon size={20} state={state} />
                          <h3 id={`task-group-${state}`}>
                            {statusDefinitions[state].label}
                          </h3>
                          <span>{tasks.length}</span>
                        </button>
                      </div>
                      {!collapsedTaskGroups[state] && (
                        <div className="task-group-items">
                          {tasks.map((task) => {
                            const status = taskStatuses[task.id];
                            const taskDetail = taskDetails[task.id];
                            const currentTaskState = taskWorkState(
                              task,
                              status,
                            );
                            const taskStateReason =
                              status?.stateReason ?? task.stateReason;
                            const taskNeed = floorAuthoritative
                              ? floorSnapshot?.yourTurn.items.find(
                                  (item) =>
                                    item.taskId === task.id ||
                                    task.subtasks.some(
                                      (step) => step.id === item.subtaskId,
                                    ),
                                )
                              : undefined;
                            const waitingCopy = status
                              ? taskPRWaitingCopy(
                                  status.requiredPullRequests,
                                  githubStatuses,
                                  status.latestTaskReport?.testedRevision,
                                )
                              : undefined;
                            const doingStep = task.subtasks.find(
                              (step) =>
                                status?.subtasks.find(
                                  (row) => row.subtaskId === step.id,
                                )?.reportedState === "in_progress",
                            );
                            const taskEdit = taskEdits[task.id];
                            const linkInput = projectLinkInputs[task.id] ?? {
                              system: "linear" as const,
                              stableId: "",
                              title: "",
                              url: "",
                            };
                            const taskRowKey = `task:${task.id}`;
                            const taskRowExpanded = Boolean(
                              expandedRows[taskRowKey],
                            );
                            const taskActionsSummary = summarizeGitHubActions([
                              githubStatuses[`task:${task.id}`],
                              ...task.subtasks.map(
                                (subtask) =>
                                  githubStatuses[`subtask:${subtask.id}`],
                              ),
                            ]);
                            const progress = summarizeTaskProgress(
                              task,
                              status,
                            );
                            const taskHistoryThreads = historyThreadsForTarget(
                              t3Activity,
                              task.id,
                            );
                            const taskReviewScreenshotIds = new Set(
                              status?.taskVerification?.screenshotIds ?? [],
                            );
                            const taskReviewScreenshots = [
                              ...(taskDetail?.screenshots ?? []),
                              ...task.subtasks
                                .flatMap((subtask) => subtask.screenshots ?? [])
                                .filter((screenshot) =>
                                  taskReviewScreenshotIds.has(screenshot.id),
                                ),
                            ].filter(
                              (screenshot, index, screenshots) =>
                                screenshots.findIndex(
                                  (candidate) => candidate.id === screenshot.id,
                                ) === index,
                            );
                            const taskReviewScreenshotAnchors =
                              Object.fromEntries(
                                taskReviewScreenshots.map((screenshot) => [
                                  screenshot.id,
                                  screenshotAnchorId(
                                    screenshot.id,
                                    `task-${task.id}`,
                                  ),
                                ]),
                              );
                            return (
                              <article
                                aria-labelledby={`task-${task.id}-title`}
                                id={`floor-task-${task.id}`}
                                className={`task-row ${
                                  taskRowExpanded
                                    ? "row-expanded"
                                    : "row-collapsed"
                                } ${
                                  dragTarget?.kind === "task" &&
                                  dragTarget.id === task.id
                                    ? "is-dragging"
                                    : ""
                                } ${
                                  dragTarget?.overId === task.id
                                    ? "is-drag-over"
                                    : ""
                                }`}
                                data-reorder-id={task.id}
                                data-reorder-kind="task"
                                data-work-state={state}
                                key={task.id}
                              >
                                <div className="task-card-header">
                                  {isLiveWorkState(state) && (
                                    <ReorderHandle
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        Boolean(task.archiveState)
                                      }
                                      kind="task"
                                      itemId={task.id}
                                      onKeyDown={(event) =>
                                        keyboardReorder(
                                          event,
                                          {
                                            id: task.id,
                                            kind: "task",
                                            state,
                                          },
                                          tasks.map(
                                            (candidate) => candidate.id,
                                          ),
                                        )
                                      }
                                      onPointerDown={(event) =>
                                        beginDrag(event, {
                                          id: task.id,
                                          kind: "task",
                                          state,
                                        })
                                      }
                                      onPointerMove={updateDrag}
                                      onPointerUp={finishDrag}
                                      state={state}
                                    />
                                  )}
                                  <div className="task-summary">
                                    <div className="task-summary-heading">
                                      <div className="status-with-thread-dots">
                                        <TaskStatusMenu
                                          disabled={
                                            !snapshot.canMutate ||
                                            busy ||
                                            !status
                                          }
                                          onMarkDone={(reason) =>
                                            mutateAndRefresh(() =>
                                              trpc.current!.tasks.markDone.mutate(
                                                {
                                                  taskId: task.id,
                                                  reason,
                                                  expectedRevision:
                                                    status!.taskRevision,
                                                },
                                              ),
                                            )
                                          }
                                          onReopen={(reason) =>
                                            mutateAndRefresh(() =>
                                              trpc.current!.tasks.reopen.mutate(
                                                {
                                                  taskId: task.id,
                                                  reason,
                                                  expectedRevision:
                                                    status!.taskRevision,
                                                },
                                              ),
                                            )
                                          }
                                          onDisposition={(archiveState) =>
                                            mutateAndRefresh(() =>
                                              trpc.current!.tasks.archive.mutate(
                                                {
                                                  archiveState,
                                                  taskId: task.id,
                                                },
                                              ),
                                            )
                                          }
                                          onState={(nextState, reason) =>
                                            setTaskWorkState(
                                              task.id,
                                              nextState,
                                              reason,
                                            )
                                          }
                                          state={currentTaskState}
                                          taskName={task.name}
                                        />
                                        <ThreadDots
                                          activity={t3Activity}
                                          onOpenThread={openT3ThreadDetail}
                                          target={{
                                            id: task.id,
                                            kind: "task",
                                            label: task.name,
                                          }}
                                        />
                                      </div>
                                      <h3
                                        className="visually-hidden"
                                        id={`task-${task.id}-title`}
                                      >
                                        {task.name}
                                      </h3>
                                      <RowToggle
                                        expanded={taskRowExpanded}
                                        kind="task"
                                        name={task.name}
                                        simpleId={task.simpleId}
                                        onToggle={() => toggleRow(taskRowKey)}
                                        actionsSummary={taskActionsSummary}
                                      />
                                    </div>
                                    {(taskStateReason || waitingCopy) &&
                                      (currentTaskState === "blocked" ||
                                        currentTaskState ===
                                          "awaiting_verification") && (
                                        <p className="state-reason">
                                          <strong>
                                            {currentTaskState === "blocked"
                                              ? "Why blocked"
                                              : status?.humanCheckReady
                                                ? "What to check"
                                                : "Finish rule"}
                                            :
                                          </strong>{" "}
                                          {status?.humanCheckReady
                                            ? task.humanCheckText
                                            : currentTaskState ===
                                                "awaiting_verification"
                                              ? waitingCopy ||
                                                taskStateReason?.replace(
                                                  /^Waiting:\s*/i,
                                                  "",
                                                )
                                              : taskStateReason}
                                        </p>
                                      )}
                                    {taskDetail?.objective && (
                                      <p className="task-objective">
                                        {taskDetail.objective}
                                      </p>
                                    )}
                                    <div className="task-preview-meta">
                                      {taskDetail?.owner && (
                                        <span>Owner: {taskDetail.owner}</span>
                                      )}
                                      {taskDetail?.priority && (
                                        <span>
                                          Priority:{" "}
                                          {formatWorkState(taskDetail.priority)}
                                        </span>
                                      )}
                                      <span>
                                        {progress.totalSubtasks > 0
                                          ? `${progress.completedSubtasks} of ${progress.totalSubtasks} steps done`
                                          : "No steps"}
                                      </span>
                                      {status?.finishRule.kind ===
                                        "pr_merge" && (
                                        <GitHubStatusBadge
                                          rows={status.requiredPullRequests}
                                          statuses={githubStatuses}
                                          completed={status.taskCompleted}
                                          testedRevision={
                                            status.latestTaskReport
                                              ?.testedRevision
                                          }
                                        />
                                      )}
                                    </div>
                                    {progress.totalSubtasks > 0 && (
                                      <progress
                                        aria-label={
                                          String(progress.completedSubtasks) +
                                          " of " +
                                          String(progress.totalSubtasks) +
                                          " steps done"
                                        }
                                        className="task-progress"
                                        max={progress.totalSubtasks}
                                        value={progress.completedSubtasks}
                                      />
                                    )}
                                    {status?.taskCompleted ? (
                                      <TaskProvenance
                                        metadata={status.finishMetadata}
                                      />
                                    ) : (
                                      <p className="task-next">
                                        <strong>Now</strong>{" "}
                                        {taskNeed
                                          ? `${taskNeed.kind.toUpperCase()} ${taskNeed.label}`
                                          : currentTaskState === "blocked"
                                            ? `Blocked: ${taskStateReason || "reason not recorded"}`
                                            : (status?.latestTaskReport
                                                ?.summary ??
                                              status?.latestTaskReport
                                                ?.reason ??
                                              (doingStep
                                                ? `Doing: ${doingStep.name}`
                                                : "No updates yet."))}
                                      </p>
                                    )}
                                    {status?.finishRule && (
                                      <span className="workflow-chip">
                                        {status.finishRule.kind === "pr_merge"
                                          ? "ON MERGE"
                                          : "AGENT FINISHES"}
                                        {status.finishRule.requireHumanCheck
                                          ? " + YOUR CHECK"
                                          : ""}
                                      </span>
                                    )}
                                  </div>
                                  <div
                                    aria-label={`Quick status for ${task.name}`}
                                    className="task-actions"
                                  >
                                    <details className="task-menu">
                                      <summary>More</summary>
                                      <div className="task-menu-options">
                                        <button
                                          className="secondary"
                                          disabled={
                                            !snapshot.canMutate ||
                                            busy ||
                                            !taskDetail
                                          }
                                          onClick={() => startTaskEdit(task.id)}
                                          type="button"
                                        >
                                          Edit task
                                        </button>
                                        {status?.archiveState && (
                                          <button
                                            className="secondary"
                                            disabled={
                                              !snapshot.canMutate || busy
                                            }
                                            onClick={() =>
                                              void mutateAndRefresh(() =>
                                                trpc.current!.tasks.restore.mutate(
                                                  {
                                                    taskId: task.id,
                                                  },
                                                ),
                                              )
                                            }
                                            type="button"
                                          >
                                            Restore
                                          </button>
                                        )}
                                        <button
                                          className="danger"
                                          disabled={!snapshot.canMutate || busy}
                                          onClick={() => {
                                            if (
                                              !window.confirm(
                                                `Delete task “${task.name}” and all of its subtasks? This cannot be undone.`,
                                              )
                                            )
                                              return;
                                            void mutateAndRefresh(() =>
                                              trpc.current!.tasks.remove.mutate(
                                                {
                                                  confirm: true,
                                                  taskId: task.id,
                                                },
                                              ),
                                            );
                                          }}
                                          type="button"
                                        >
                                          Delete task
                                        </button>
                                      </div>
                                    </details>
                                  </div>
                                </div>
                                {taskEdit && (
                                  <form
                                    className="task-edit-form"
                                    onSubmit={(event) =>
                                      void saveTaskEdit(event, task.id)
                                    }
                                  >
                                    <p className="eyebrow">Edit task</p>
                                    <label>
                                      <span>Task title</span>
                                      <input
                                        autoFocus
                                        disabled={!snapshot.canMutate || busy}
                                        onChange={(event) =>
                                          setTaskEdits((current) => ({
                                            ...current,
                                            [task.id]: {
                                              ...taskEdit,
                                              title: event.target.value,
                                            },
                                          }))
                                        }
                                        value={taskEdit.title}
                                      />
                                    </label>
                                    <label>
                                      <span>Description</span>
                                      <textarea
                                        disabled={!snapshot.canMutate || busy}
                                        onChange={(event) =>
                                          setTaskEdits((current) => ({
                                            ...current,
                                            [task.id]: {
                                              ...taskEdit,
                                              description: event.target.value,
                                            },
                                          }))
                                        }
                                        value={taskEdit.description}
                                      />
                                    </label>
                                    <label>
                                      <span>Acceptance criteria</span>
                                      <textarea
                                        disabled={!snapshot.canMutate || busy}
                                        onChange={(event) =>
                                          setTaskEdits((current) => ({
                                            ...current,
                                            [task.id]: {
                                              ...taskEdit,
                                              acceptanceCriteria:
                                                event.target.value,
                                            },
                                          }))
                                        }
                                        placeholder="One criterion per line"
                                        value={taskEdit.acceptanceCriteria}
                                      />
                                    </label>
                                    <div className="edit-actions">
                                      <button
                                        disabled={
                                          !snapshot.canMutate ||
                                          busy ||
                                          !taskEdit.title.trim()
                                        }
                                        type="submit"
                                      >
                                        Save task
                                      </button>
                                      <button
                                        className="secondary"
                                        disabled={busy}
                                        onClick={() => cancelTaskEdit(task.id)}
                                        type="button"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </form>
                                )}
                                {taskRowExpanded && (
                                  <TaskWorkflow
                                    task={task}
                                    openCheck={checkTaskId === task.id}
                                    onCheckClose={() => setCheckTaskId(null)}
                                    status={status}
                                    disabled={
                                      !snapshot.canMutate ||
                                      snapshot.state !== "connected" ||
                                      busy ||
                                      !status
                                    }
                                    operator={human?.name}
                                    githubStatuses={githubStatuses}
                                    needs={
                                      floorAuthoritative
                                        ? floorSnapshot?.yourTurn.items.filter(
                                            (item) =>
                                              item.taskId === task.id ||
                                              task.subtasks.some(
                                                (step) =>
                                                  step.id === item.subtaskId,
                                              ),
                                          )
                                        : undefined
                                    }
                                    onOpenNeed={(item) => {
                                      const needPR =
                                        status?.requiredPullRequests.find(
                                          (row) =>
                                            item.id.endsWith(
                                              row.pullRequestUrl,
                                            ),
                                        );
                                      if (item.kind === "review" && needPR)
                                        window.open(
                                          needPR.pullRequestUrl,
                                          "_blank",
                                          "noopener,noreferrer",
                                        );
                                      else if (
                                        item.id.startsWith("decide:github:")
                                      )
                                        openConnections();
                                      else
                                        openFloorTarget({
                                          ...item,
                                          projectId: task.projectId,
                                        });
                                    }}
                                    onSaveRule={(
                                      finishRule,
                                      humanCheckText,
                                      pullRequestRequirements,
                                      expectedRevision,
                                      expectedWorkflowEpoch,
                                    ) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.tasks.updateFinishRule.mutate(
                                          {
                                            taskId: task.id,
                                            finishRule,
                                            humanCheckText,
                                            pullRequestRequirements,
                                            expectedRevision,
                                            expectedWorkflowEpoch,
                                          },
                                        ),
                                      )
                                    }
                                    onCheck={(reason) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.tasks.check.mutate({
                                          taskId: task.id,
                                          reason,
                                          expectedRevision:
                                            status!.taskRevision,
                                        }),
                                      )
                                    }
                                    onSendBack={(reason) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.tasks.reopen.mutate({
                                          taskId: task.id,
                                          reason,
                                          expectedRevision:
                                            status!.taskRevision,
                                        }),
                                      )
                                    }
                                    onStep={(
                                      subtaskId,
                                      reportedState,
                                      evidence,
                                      reason,
                                      handoff,
                                    ) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.subtasks.report.mutate({
                                          subtaskId,
                                          reportedState,
                                          evidence,
                                          reason,
                                          handoff,
                                          reporter: human!.name,
                                        }),
                                      )
                                    }
                                    onAdd={(name) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.subtasks.create.mutate({
                                          taskId: task.id,
                                          name,
                                        }),
                                      )
                                    }
                                    onEditStep={(step, patch) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.subtasks.update.mutate({
                                          subtaskId: step.id,
                                          ...patch,
                                        }),
                                      )
                                    }
                                    onSkipStep={(subtaskId) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.subtasks.archive.mutate({
                                          subtaskId,
                                          archiveState: "wont_do",
                                        }),
                                      )
                                    }
                                    onRemoveStep={(subtaskId) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.subtasks.remove.mutate({
                                          subtaskId,
                                          confirm: true,
                                        }),
                                      )
                                    }
                                    onReorder={(orderedSubtaskIds) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.subtasks.reorder.mutate({
                                          taskId: task.id,
                                          orderedSubtaskIds,
                                        }),
                                      )
                                    }
                                    onLink={(
                                      pullRequestUrl,
                                      expectedRevision,
                                    ) =>
                                      mutateAndRefresh(() =>
                                        trpc.current!.tasks.update.mutate({
                                          taskId: task.id,
                                          pullRequestUrl,
                                          expectedRevision,
                                        }),
                                      )
                                    }
                                    onRefresh={() =>
                                      void refreshGitHubStatuses(projectDetail)
                                    }
                                    onHistory={async (cursor) => {
                                      const page =
                                        await trpc.current!.tasks.history.query(
                                          { taskId: task.id, limit: 6, cursor },
                                        );
                                      return {
                                        items: page.events.map(
                                          (item: Wire<TaskActivityItem>) => ({
                                            id: item.id,
                                            actor: item.actor,
                                            at: item.createdAt,
                                            text: workflowActivityText(
                                              item,
                                              task.subtasks,
                                              status?.finishRule.kind ===
                                                "agent_report" &&
                                                status.taskCompleted,
                                            ),
                                            earlierReview:
                                              item.kind === "verification",
                                            subtaskId: item.subtaskId,
                                          }),
                                        ),
                                        totalCount: page.totalCount,
                                        nextCursor:
                                          page.nextCursor ?? undefined,
                                      };
                                    }}
                                    onStepHistory={async (subtaskId) => {
                                      const [reports, verifications] =
                                        await Promise.all([
                                          trpc.current!.subtasks.history.query({
                                            subtaskId,
                                          }),
                                          trpc.current!.subtasks.verifications.query(
                                            { subtaskId },
                                          ),
                                        ]);
                                      return [
                                        ...reports.map((report) => ({
                                          id: report.id,
                                          actor: report.reporter,
                                          at: report.createdAt,
                                          text: `${report.reporter} set “${task.subtasks.find((step) => step.id === subtaskId)?.name ?? "earlier Step"}” to ${report.reportedState === "complete" ? "Done" : report.reportedState === "in_progress" ? "Doing" : report.reportedState === "blocked" ? "Blocked" : "To do"}${report.evidence ? `: ${report.evidence}` : ""} · ${formatHistoryReportAttribution(report)}`,
                                        })),
                                        ...verifications.map(
                                          (verification) => ({
                                            id: verification.id,
                                            actor: verification.verifier,
                                            at: verification.createdAt,
                                            text: verificationAttribution(
                                              verification,
                                            ),
                                            earlierReview: true,
                                          }),
                                        ),
                                      ];
                                    }}
                                    stepEvidence={(step) => (
                                      <ScreenshotProof
                                        busy={busy}
                                        canMutate={snapshot.canMutate}
                                        onGet={getScreenshot}
                                        onUpload={(input) =>
                                          uploadScreenshot(
                                            { subtaskId: step.id },
                                            input,
                                          )
                                        }
                                        ownerLabel={`Step ${step.simpleId}`}
                                        anchorPrefix={`step-${step.id}`}
                                        screenshots={
                                          task.subtasks.find(
                                            (row) => row.id === step.id,
                                          )?.screenshots ?? []
                                        }
                                      />
                                    )}
                                  >
                                    <TaskTracking
                                      activity={t3Activity}
                                      canMutate={snapshot.canMutate}
                                      connected={snapshot.state === "connected"}
                                      busy={busy}
                                      githubStatuses={githubStatuses}
                                      operatorName={human?.name}
                                      onRefreshPullRequests={() =>
                                        refreshGitHubStatuses(projectDetail)
                                      }
                                      onReport={async (
                                        input: TrackingReportInput,
                                      ) => {
                                        const client = trpc.current;
                                        if (!client) {
                                          throw new Error(
                                            "Factory connection is unavailable.",
                                          );
                                        }
                                        await mutateAndRefresh(() =>
                                          input.taskId
                                            ? client.tasks.report.mutate({
                                                ...input,
                                                taskId: input.taskId,
                                                reportedState:
                                                  input.reportedState ===
                                                  "complete"
                                                    ? "finished"
                                                    : input.reportedState ===
                                                        "blocked"
                                                      ? "blocked"
                                                      : "in_progress",
                                                workflowEpoch:
                                                  status!.workflowEpoch,
                                              })
                                            : client.subtasks.report.mutate({
                                                ...input,
                                                subtaskId: input.subtaskId!,
                                              }),
                                        );
                                      }}
                                      status={status}
                                      task={{
                                        ...task,
                                        acceptanceCriteria:
                                          taskDetail?.acceptanceCriteria ?? [],
                                        screenshots: (
                                          taskDetail?.screenshots ?? []
                                        ).map((screenshot) => ({
                                          id: screenshot.id,
                                          caption: screenshot.caption,
                                          testedRevision:
                                            screenshot.testedRevision,
                                          uploadedAt: screenshot.uploadedAt,
                                        })),
                                        subtasks: task.subtasks.map(
                                          (subtask) => ({
                                            ...subtask,
                                            screenshots: (
                                              subtask.screenshots ?? []
                                            ).map((screenshot) => ({
                                              id: screenshot.id,
                                              subtaskId: screenshot.subtaskId,
                                              caption: screenshot.caption,
                                              testedRevision:
                                                screenshot.testedRevision,
                                              uploadedAt: screenshot.uploadedAt,
                                            })),
                                          }),
                                        ),
                                      }}
                                    />
                                    {taskHistoryThreads.length > 0 && (
                                      <details className="task-details task-history">
                                        <summary>History</summary>
                                        <HistoryThreadLinks
                                          onOpenThreadDetail={
                                            openT3ThreadDetail
                                          }
                                          threads={taskHistoryThreads}
                                        />
                                      </details>
                                    )}
                                    {(taskDetail ||
                                      taskReviewScreenshots.length > 0) && (
                                      <ScreenshotProof
                                        busy={busy}
                                        canMutate={snapshot.canMutate}
                                        onGet={getScreenshot}
                                        onUpload={(input) =>
                                          uploadScreenshot(
                                            { taskId: task.id },
                                            input,
                                          )
                                        }
                                        ownerLabel={`Task ${task.simpleId}`}
                                        anchorPrefix={`task-${task.id}`}
                                        screenshots={taskReviewScreenshots}
                                      />
                                    )}
                                    <details className="task-tracker">
                                      <summary>Link external tracker</summary>
                                      <form
                                        className="inline-form"
                                        onSubmit={(event) => {
                                          event.preventDefault();
                                          if (
                                            !linkInput.stableId.trim() ||
                                            !linkInput.url.trim() ||
                                            !trpc.current
                                          )
                                            return;
                                          void mutateAndRefresh(async () => {
                                            const result =
                                              await trpc.current!.tasks.link.mutate(
                                                {
                                                  ...linkInput,
                                                  stableId:
                                                    linkInput.stableId.trim(),
                                                  title:
                                                    linkInput.title.trim() ||
                                                    undefined,
                                                  taskId: task.id,
                                                  url: linkInput.url.trim(),
                                                },
                                              );
                                            setProjectLinkInputs((current) => ({
                                              ...current,
                                              [task.id]: {
                                                ...linkInput,
                                                stableId: "",
                                                title: "",
                                                url: "",
                                              },
                                            }));
                                            return result;
                                          });
                                        }}
                                      >
                                        <select
                                          aria-label="Tracker system"
                                          disabled={!snapshot.canMutate || busy}
                                          onChange={(event) =>
                                            setProjectLinkInputs((current) => ({
                                              ...current,
                                              [task.id]: {
                                                ...linkInput,
                                                system: event.target.value as
                                                  | "linear"
                                                  | "notion",
                                              },
                                            }))
                                          }
                                          value={linkInput.system}
                                        >
                                          <option value="linear">Linear</option>
                                          <option value="notion">Notion</option>
                                        </select>
                                        <input
                                          aria-label="Tracker ID"
                                          disabled={!snapshot.canMutate || busy}
                                          onChange={(event) =>
                                            setProjectLinkInputs((current) => ({
                                              ...current,
                                              [task.id]: {
                                                ...linkInput,
                                                stableId: event.target.value,
                                              },
                                            }))
                                          }
                                          placeholder="GRA-123"
                                          value={linkInput.stableId}
                                        />
                                        <input
                                          aria-label="Tracker URL"
                                          disabled={!snapshot.canMutate || busy}
                                          onChange={(event) =>
                                            setProjectLinkInputs((current) => ({
                                              ...current,
                                              [task.id]: {
                                                ...linkInput,
                                                url: event.target.value,
                                              },
                                            }))
                                          }
                                          placeholder="https://…"
                                          value={linkInput.url}
                                        />
                                        <button
                                          disabled={
                                            !snapshot.canMutate ||
                                            busy ||
                                            !linkInput.stableId.trim() ||
                                            !linkInput.url.trim()
                                          }
                                          type="submit"
                                        >
                                          Link
                                        </button>
                                      </form>
                                    </details>

                                    {taskDetail?.trackerLinks.length ? (
                                      <div
                                        className="links"
                                        aria-label="Tracker links"
                                      >
                                        {taskDetail.trackerLinks.map((link) => (
                                          <a
                                            href={link.url}
                                            key={link.id}
                                            rel="noreferrer"
                                            target="_blank"
                                          >
                                            {link.system}: {link.stableId}
                                          </a>
                                        ))}
                                      </div>
                                    ) : null}

                                    {taskDetail &&
                                    (taskDetail.objective ||
                                      taskDetail.acceptanceCriteria.length >
                                        0 ||
                                      taskDetail.priority ||
                                      taskDetail.owner ||
                                      taskDetail.dependencies.length > 0 ||
                                      taskDetail.repositoryLinks.length > 0 ||
                                      taskDetail.branchName) ? (
                                      <details className="task-details">
                                        <summary>
                                          Details and planning metadata
                                        </summary>
                                        <div className="task-metadata">
                                          {taskDetail.objective && (
                                            <p>
                                              <strong>Objective:</strong>{" "}
                                              {taskDetail.objective}
                                            </p>
                                          )}
                                          {taskDetail.branchName && (
                                            <p>
                                              <strong>Branch:</strong>{" "}
                                              {taskDetail.branchName}
                                            </p>
                                          )}
                                          {taskDetail.owner && (
                                            <p>
                                              <strong>Owner:</strong>{" "}
                                              {taskDetail.owner}
                                            </p>
                                          )}
                                          {taskDetail.priority && (
                                            <p>
                                              <strong>Priority:</strong>{" "}
                                              {taskDetail.priority}
                                            </p>
                                          )}
                                          {taskDetail.acceptanceCriteria
                                            .length > 0 && (
                                            <p>
                                              <strong>Acceptance:</strong>{" "}
                                              {taskDetail.acceptanceCriteria.join(
                                                " · ",
                                              )}
                                            </p>
                                          )}
                                          {taskDetail.dependencies.length >
                                            0 && (
                                            <p>
                                              <strong>Dependencies:</strong>{" "}
                                              {taskDetail.dependencies.join(
                                                " · ",
                                              )}
                                            </p>
                                          )}
                                          {taskDetail.repositoryLinks.length >
                                            0 && (
                                            <p>
                                              <strong>Repositories:</strong>{" "}
                                              {taskDetail.repositoryLinks.map(
                                                (link) => (
                                                  <a
                                                    href={link}
                                                    key={link}
                                                    rel="noreferrer"
                                                    target="_blank"
                                                  >
                                                    {link}
                                                  </a>
                                                ),
                                              )}
                                            </p>
                                          )}
                                        </div>
                                      </details>
                                    ) : null}
                                  </TaskWorkflow>
                                )}
                              </article>
                            );
                          })}
                          {isLiveWorkState(state) && (
                            <div
                              aria-label={`Drop at end of ${statusDefinitions[state].label} tasks`}
                              className={`reorder-tail ${
                                dragTarget?.kind === "task" &&
                                dragTarget.overId === DRAG_TAIL &&
                                dragTarget.state === state
                                  ? "is-drag-over"
                                  : ""
                              }`}
                              data-reorder-kind="task"
                              data-reorder-tail="true"
                              data-work-state={state}
                              role="presentation"
                            />
                          )}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )}
            </section>
          )}
      </main>
    </>
  );
}

function ConnectionIndicator({
  floorConnections,
  onOpenConnections,
  snapshot,
  t3Status,
}: {
  floorConnections?: FloorConnections;
  onOpenConnections: () => void;
  snapshot: ConnectionSnapshot;
  t3Status: T3StatusResult | undefined;
}) {
  const lastConnected = snapshot.lastSuccessfulConnection?.toLocaleTimeString();
  const websocketState = snapshot.state;
  const lastConnectedLabel =
    lastConnected && snapshot.state !== "connected"
      ? `last connected ${lastConnected}`
      : undefined;
  const t3Summary = floorConnections
    ? summarizeFloorConnections(floorConnections)
    : summarizeT3Connections(t3Status);
  const t3Label = t3ConnectionLabel(t3Summary);
  const t3Health =
    t3Summary.state === "unknown"
      ? "unknown"
      : t3Summary.total === 0
        ? "empty"
        : t3Summary.connected === 0
          ? "down"
          : t3Summary.connected === t3Summary.total
            ? "healthy"
            : "partial";
  const connectionLabel = `Connections and agent access · ${t3Label} · WebSocket ${websocketState}${lastConnectedLabel ? ` · ${lastConnectedLabel}` : ""}`;
  return (
    <a
      aria-label={connectionLabel}
      aria-live="polite"
      className={`connection ${snapshot.state}`}
      data-t3-connection-state={t3Summary.state}
      data-t3-health={t3Health}
      data-t3-total={
        t3Summary.state === "ready" ? String(t3Summary.total) : undefined
      }
      data-websocket-state={websocketState}
      href="/connections"
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onOpenConnections();
      }}
      title={connectionLabel}
    >
      <span className="connection-service">
        <span aria-hidden="true" className="connection-dot t3-dot" />
        <span>{t3Label}</span>
      </span>
      <span className="connection-service">
        <span aria-hidden="true" className="connection-dot websocket-dot" />
        <span>WS</span>
      </span>
    </a>
  );
}

function StatusIcon({
  state,
  size = 20,
}: {
  state: WorkStatus;
  size?: number;
}) {
  const definition = statusDefinitions[state];
  const label = definition.label;
  const glow = [
    "active",
    "awaiting_verification",
    "blocked",
    "completed",
    "released",
  ].includes(state)
    ? `glow-${state === "active" ? "info" : state === "awaiting_verification" ? "warn" : state === "blocked" ? "down" : "ok"}`
    : "";
  return (
    <svg
      aria-label={label}
      className={`status-icon status-icon-${state} ${glow}`}
      fill="none"
      height={size}
      role="img"
      viewBox="0 0 16 16"
      width={size}
    >
      <title>{label}</title>
      {state === "planned" && (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke={definition.color}
          strokeWidth="1.6"
          strokeDasharray="2.5 2.6"
        />
      )}
      {state === "backlog" && (
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke={definition.color}
          strokeWidth="1.6"
          strokeDasharray="1.2 2.2"
        />
      )}
      {state === "active" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <path d="M8 8V3.6A4.4 4.4 0 0 1 12.4 8Z" fill={definition.color} />
        </>
      )}
      {state === "awaiting_verification" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
            strokeDasharray="2.5 2.6"
          />
          <circle cx="8" cy="8" r="3" fill={definition.color} />
        </>
      )}
      {state === "blocked" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <rect
            x="4.8"
            y="7.1"
            width="6.4"
            height="1.8"
            rx="0.4"
            fill={definition.color}
          />
        </>
      )}
      {state === "completed" && (
        <>
          <circle cx="8" cy="8" r="6.3" fill={definition.color} />
          <path
            d="m5.2 8.2 1.9 1.9 3.8-4"
            stroke="var(--canvas)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {state === "released" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <path
            d="m5.4 8.2 1.8 1.8 3.5-3.7"
            stroke={definition.color}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {state === "wont_do" && (
        <>
          <circle
            cx="8"
            cy="8"
            r="5.5"
            stroke={definition.color}
            strokeWidth="1.6"
          />
          <path
            d="m4.8 11.2 6.4-6.4"
            stroke={definition.color}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

function SubtaskActionIcon({ action }: { action: "edit" | "delete" }) {
  return (
    <svg
      aria-hidden="true"
      className="subtask-action-icon"
      fill="none"
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      {action === "edit" ? (
        <>
          <path
            d="m4 16.5-.9 3.4 3.4-.9L18.8 6.7a2.4 2.4 0 0 0-3.4-3.4L4 16.5Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="m13.8 5.2 3.4 3.4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </>
      ) : (
        <>
          <path
            d="M4 7h16M10 11v6M14 11v6M6 7l.7 13h10.6L18 7M9 7V4h6v3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </>
      )}
    </svg>
  );
}

function TaskStatusMenu({
  disabled,
  onMarkDone,
  onReopen,
  onDisposition,
  onState,
  state,
  taskName,
}: {
  disabled: boolean;
  onMarkDone: (reason: string) => void | Promise<unknown>;
  onReopen: (reason: string) => void | Promise<unknown>;
  onDisposition?: (state: "released" | "wont_do") => void | Promise<unknown>;
  onState: (
    state: TaskEditableWorkState,
    reason?: string,
  ) => void | Promise<unknown>;
  state: WorkStatus;
  taskName: string;
}) {
  const [pending, setPending] = useState<"done" | "reopen" | "blocked" | null>(
      null,
    ),
    [reason, setReason] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const close = (event: React.SyntheticEvent) =>
    event.currentTarget.closest("details")?.removeAttribute("open");
  const run = async (
    action: () => void | Promise<unknown>,
    event: React.SyntheticEvent,
  ) => {
    const menu = event.currentTarget.closest("details");
    setSaving(true);
    setError("");
    try {
      await action();
      setPending(null);
      menu?.removeAttribute("open");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't update the task. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <details className="status-menu task-status-menu">
      <summary
        aria-label={`${statusDefinitions[state].label} status for ${taskName}`}
        className={`status-trigger ${state}`}
      >
        <StatusIcon state={state} size={22} />
      </summary>
      <div className="status-menu-options">
        <p className="status-menu-heading">Task status</p>
        <button
          type="button"
          className="status-option"
          aria-label={state === "completed" ? "Reopen…" : "Mark done…"}
          disabled={disabled || saving}
          onClick={() => {
            setPending(state === "completed" ? "reopen" : "done");
            setReason("");
          }}
        >
          <StatusIcon
            state={state === "completed" ? "active" : "completed"}
            size={19}
          />
          {state === "completed" ? "Reopen…" : "Mark done…"}
        </button>
        {taskStatusOrder
          .filter((candidate) => candidate !== "awaiting_verification")
          .map((candidate) => (
            <button
              type="button"
              className="status-option"
              aria-label={statusDefinitions[candidate].label}
              disabled={disabled || saving || state === "completed"}
              key={candidate}
              onClick={(event) => {
                if (candidate === "blocked") {
                  setPending("blocked");
                  setReason("");
                } else {
                  void run(() => onState(candidate), event);
                }
              }}
            >
              <StatusIcon state={candidate} size={19} />
              {statusDefinitions[candidate].label}
            </button>
          ))}
        {onDisposition &&
          archiveStatusOrder.map((candidate) => (
            <button
              type="button"
              className="status-option"
              aria-label={statusDefinitions[candidate].label}
              disabled={disabled || saving}
              key={candidate}
              onClick={(event) => {
                void run(() => onDisposition(candidate), event);
              }}
            >
              <StatusIcon state={candidate} size={19} />
              {statusDefinitions[candidate].label}
            </button>
          ))}
        {pending && (
          <form
            className="status-reason-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!reason.trim()) return;
              void run(
                () =>
                  pending === "done"
                    ? onMarkDone(reason.trim())
                    : pending === "reopen"
                      ? onReopen(reason.trim())
                      : onState("blocked", reason.trim()),
                event,
              );
            }}
          >
            <label>
              {pending === "done"
                ? "Why is this done without its finish rule?"
                : pending === "reopen"
                  ? "Why reopen this task?"
                  : "Why blocked / what unblocks it"}
              <textarea
                autoFocus
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={disabled || saving || !reason.trim()}
            >
              {pending === "done"
                ? "Mark done"
                : pending === "reopen"
                  ? "Reopen"
                  : "Set blocked"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setPending(null)}
            >
              Cancel
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="workflow-error">
            {error}
          </p>
        )}
        <p className="status-menu-note">
          Steps track progress. Task completion follows its finish rule.
        </p>
      </div>
    </details>
  );
}

function RowToggle({
  actionsSummary,
  expanded,
  kind,
  name,
  onToggle,
  simpleId,
}: {
  actionsSummary?: GitHubActionsSummary;
  expanded: boolean;
  kind: "task" | "subtask";
  name: string;
  onToggle: () => void;
  simpleId: string;
}) {
  const rowLabel = `${expanded ? "Collapse" : "Expand"} ${kind} ${name}`;
  return (
    <button
      aria-expanded={expanded}
      aria-label={`${rowLabel}${actionsSummary ? `; Actions: ${githubActionsSummaryLabel(actionsSummary)}` : ""}`}
      className="row-toggle"
      onClick={onToggle}
      type="button"
    >
      <span className="row-title">
        <span className="row-reference">{simpleId}</span>
        <span className="row-title-text">{name}</span>
        {actionsSummary && (
          <GitHubActionsSummaryBadge summary={actionsSummary} />
        )}
      </span>
      <span aria-hidden="true" className="row-chevron">
        {expanded ? "▾" : "▸"}
      </span>
    </button>
  );
}

function GitHubActionsSummaryBadge({
  summary,
}: {
  summary: GitHubActionsSummary;
}) {
  return (
    <span
      aria-label={`Actions: ${githubActionsSummaryLabel(summary)}`}
      className="github-actions-summary"
    >
      <span className="github-actions-label">Actions</span>
      {summary.running > 0 && (
        <span className="github-actions-count github-actions-running">
          {summary.running} running
        </span>
      )}
      <span className="github-actions-count github-actions-passing">
        {summary.passing} passing
      </span>
      <span className="github-actions-count github-actions-failing">
        {summary.failing} failing
      </span>
      <span className="github-actions-count github-actions-skipped">
        {summary.skipped} skipped
      </span>
    </span>
  );
}

function GitHubStatusBadge({
  rows,
  statuses,
  completed,
  testedRevision,
}: {
  rows: RequiredPullRequest[];
  statuses: Record<string, GitHubStatusSnapshot | undefined>;
  completed: boolean;
  testedRevision?: string;
}) {
  const view = requiredPullRequestSummary(
    rows,
    statuses,
    completed,
    testedRevision,
  );
  return (
    <span className={`github-status github-status-${view.tone}`}>
      <span>{view.text}</span>
    </span>
  );
}

function ReorderHandle({
  disabled,
  itemId,
  kind,
  onKeyDown,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  state,
}: {
  disabled: boolean;
  itemId: string;
  kind: "task" | "subtask";
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  state: LiveWorkState;
}) {
  return (
    <button
      aria-keyshortcuts="ArrowUp ArrowDown"
      aria-label={`Reorder ${kind} ${itemId}`}
      aria-roledescription="sortable"
      className="reorder-handle"
      data-reorder-kind={kind}
      data-reorder-id={itemId}
      data-work-state={state}
      disabled={disabled}
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title={`Reorder ${kind}`}
      type="button"
    >
      <span aria-hidden="true">⋮⋮</span>
    </button>
  );
}

function formatWorkState(state: string): string {
  return state
    .replaceAll("_", " ")
    .replace(/(^| )\w/g, (character) => character.toUpperCase());
}

createRoot(document.getElementById("root")!).render(
  <AgentTokenProvider>
    <Dashboard />
  </AgentTokenProvider>,
);

if ("serviceWorker" in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  void navigator.serviceWorker
    .register("/service-worker.js")
    .then((registration) => registration.update())
    .catch(() => undefined);
}
