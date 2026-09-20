import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { DashboardSnapshot } from "../application";
import type { FactoryRouter } from "../server";
import type { GitHubStatusSnapshot } from "../github";
import type {
  T3ObservedActivity,
  T3StatusResult,
  T3ThreadDetailResult,
} from "../t3-coordinator";
import { ConnectionState, type ConnectionSnapshot } from "./connection-state";
import { BackupsPage } from "./backups";
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
  editProjectView,
  homeView,
  projectView,
  type DashboardView,
} from "./navigation";
import {
  filterAttention,
  filterArchivedTasks,
  groupSubtasksByStatus,
  groupTasksByStatus,
  reorderIds,
  summarizeTaskProgress,
  type AttentionFilter,
} from "./task-summary";
import {
  archiveStatusOrder,
  dispositionStatusOptions,
  liveWorkStatusOrder,
  reportStatusOptions,
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
import { ScreenshotProof } from "./screenshot-proof";
import { ThreadDots } from "./thread-dots";
import "./styles.css";

type ProjectSummary = { id: string; name: string };
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
type AttentionItem = {
  projectId: string;
  projectName: string;
  taskId: string;
  taskSimpleId: string;
  taskName: string;
  state: "backlog" | "planned" | "active" | "awaiting_verification" | "blocked";
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
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
type TaskStatus = {
  taskId: string;
  taskSimpleId: string;
  taskCompleted: boolean;
  taskState:
    | "backlog"
    | "planned"
    | "active"
    | "awaiting_verification"
    | "completed"
    | "blocked"
    | "released"
    | "wont_do";
  stateReason?: string;
  archiveState?: "released" | "wont_do";
  subtasks: Array<{
    reportedState?:
      | "backlog"
      | "not_started"
      | "in_progress"
      | "blocked"
      | "complete";
    effectiveState: WorkStatus;
    subtaskSimpleId?: string;
    reason?: string;
    verificationState:
      | "accepted"
      | "awaiting_verification"
      | "deferred"
      | "rejected"
      | "unreported";
    reportId?: string;
    evidence?: string;
    reporter?: string;
    sortOrder?: number;
    archiveState?: "released" | "wont_do";
  }>;
};
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
type SubtaskEditValues = {
  title: string;
  description: string;
  evidence: string;
};
type SubtaskHistory = {
  reports: Array<{
    id: string;
    reportedState: string;
    reporter: string;
    machineId?: string;
    evidence?: string;
  }>;
  verifications: Array<{
    id: string;
    reportId: string;
    decision: string;
    verifier: string;
  }>;
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
  const [connection] = useState(() => new ConnectionState());
  const [deploymentEnvironment, setDeploymentEnvironment] =
    useState<DeploymentEnvironment | null>(null);
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(
    connection.snapshot(),
  );
  const [projectName, setProjectName] = useState("");
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
  const [portfolioStatus, setPortfolioStatus] =
    useState<PortfolioStatus | null>(null);
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  const [attentionFilter, setAttentionFilter] =
    useState<AttentionFilter>("all");
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
  const [subtaskEdits, setSubtaskEdits] = useState<
    Record<string, SubtaskEditValues>
  >({});
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>(
    {},
  );
  const [subtaskHistories, setSubtaskHistories] = useState<
    Record<string, SubtaskHistory>
  >({});
  const [githubStatuses, setGithubStatuses] = useState<
    Record<string, GitHubStatusSnapshot>
  >({});
  const [t3Activity, setT3Activity] =
    useState<ObservedActivityViewModel | null>(null);
  const [t3Status, setT3Status] = useState<T3StatusResult | undefined>(
    undefined,
  );
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
  const [busy, setBusy] = useState(false);
  const [human, setHuman] = useState<{ name: string } | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionSecret, setSessionSecret] = useState("");
  const [sessionBusy, setSessionBusy] = useState(false);
  const [webSocketGeneration, setWebSocketGeneration] = useState(0);
  const trpc = useRef<TRPCClient | null>(null);
  const subscriptionCleanup = useRef<(() => void) | null>(null);
  const t3RefreshGeneration = useRef(0);
  const t3StatusGeneration = useRef(0);
  const t3StatusRequest = useRef<symbol | null>(null);
  const webSocketGenerationRef = useRef(webSocketGeneration);
  webSocketGenerationRef.current = webSocketGeneration;

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
        connection.markDisconnected();
        setProjects(null);
        setPortfolioStatus(null);
        setAttention(null);
        setProjectDetail(null);
        setTaskDetails({});
        setTaskEdits({});
        setSubtaskEdits({});
        setTaskStatuses({});
        setSubtaskHistories({});
        setGithubStatuses({});
        setT3Activity(null);
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
        const client = trpc.current;
        if (client) void refreshT3Status(client);
        void Promise.all([
          trpc.current?.projects.list.query(),
          trpc.current?.projects.portfolio.query(),
          trpc.current?.projects.attention.query(),
        ]).then(([nextProjects, nextPortfolio, nextAttention]) => {
          if (!nextProjects || !nextPortfolio || !nextAttention) return;
          setProjects(nextProjects);
          setPortfolioStatus(nextPortfolio);
          setAttention(nextAttention);
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
      void client.close();
    };
  }, [connection, human, sessionLoading, webSocketGeneration]);

  useEffect(() => {
    if (sessionLoading || !human) return;
    let active = true;
    const pollT3Status = () => {
      if (!active || connection.snapshot().state !== "connected") return;
      const client = trpc.current;
      if (client) void refreshT3Status(client);
    };
    const interval = window.setInterval(
      pollT3Status,
      T3_STATUS_POLL_INTERVAL_MS,
    );
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [connection, human, sessionLoading, webSocketGeneration]);

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
    setAttention(dashboard.attention);
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

  const reportSubtask = async (
    subtaskId: string,
    reportedState: ReportedStatus,
    evidence?: string,
    reason?: string,
  ) => {
    const client = trpc.current;
    if (!client) return;
    await mutateAndRefresh(() =>
      client.subtasks.report.mutate({
        ...(evidence ? { evidence } : {}),
        ...(reason ? { reason } : {}),
        reportedState,
        reporter: reportedState === "complete" ? "codex" : "kevin",
        subtaskId,
      }),
    );
  };

  const verifySubtask = async (
    reportId: string,
    decision: "accepted" | "rejected" | "deferred",
    reason?: string,
  ) => {
    const client = trpc.current;
    if (!client) return;
    await mutateAndRefresh(() =>
      client.subtasks.verify.mutate({
        decision,
        ...(reason ? { reason } : {}),
        reportId,
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

  const openBackups = () => {
    stopProjectSubscription();
    navigateToView(backupsView());
  };

  const openProjectEditor = (projectId: string) => {
    navigateToView(editProjectView(projectId));
  };

  useEffect(() => {
    const handlePopState = () => {
      const nextView = dashboardViewFromPath(window.location.pathname);
      setView(nextView);
      if (nextView.screen === "home" || nextView.screen === "backups") {
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

  const visibleAttention = attention
    ? filterAttention(attention, attentionFilter)
    : null;
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

  const loadSubtaskHistory = async (subtaskId: string) => {
    const client = trpc.current;
    if (!client) return;
    const [reports, verifications] = await Promise.all([
      client.subtasks.history.query({ subtaskId }),
      client.subtasks.verifications.query({ subtaskId }),
    ]);
    setSubtaskHistories((current) => ({
      ...current,
      [subtaskId]: { reports, verifications },
    }));
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

  const startSubtaskEdit = (
    subtask: ProjectDetail["tasks"][number]["subtasks"][number],
    status?: TaskStatus["subtasks"][number],
  ) => {
    setSubtaskEdits((current) => ({
      ...current,
      [subtask.id]: {
        description: subtask.description ?? "",
        evidence: subtask.evidence ?? status?.evidence ?? "",
        title: subtask.name,
      },
    }));
  };

  const cancelSubtaskEdit = (subtaskId: string) => {
    setSubtaskEdits((current) => {
      const next = { ...current };
      delete next[subtaskId];
      return next;
    });
  };

  const saveSubtaskEdit = async (event: React.FormEvent, subtaskId: string) => {
    event.preventDefault();
    const edit = subtaskEdits[subtaskId];
    if (!edit?.title.trim() || !trpc.current) return;
    await mutateAndRefresh(async () => {
      const result = await trpc.current!.subtasks.update.mutate({
        description: edit.description.trim() || null,
        evidence: edit.evidence.trim() || null,
        name: edit.title.trim(),
        subtaskId,
      });
      cancelSubtaskEdit(subtaskId);
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
    if (sessionBusy) return;
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
    <main>
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
            Dashboard
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
              <button
                className="secondary"
                disabled={sessionBusy}
                onClick={() => void signOut()}
                type="button"
              >
                Sign out
              </button>
            </div>
          ) : null}
          <ConnectionIndicator
            snapshot={snapshot}
            t3Status={snapshot.state === "connected" ? t3Status : undefined}
          />
        </div>
      </header>

      {view.screen === "home" && (
        <>
          <section className="hero" aria-labelledby="portfolio-title">
            <p className="eyebrow">Portfolio</p>
            <h2 id="portfolio-title">Your project work, in one clear place.</h2>
            <p>
              Factory keeps native work, agent reports, and Kevin’s verification
              visible without replacing Notion or Linear.
            </p>
          </section>

          <section
            className="panel attention-panel"
            aria-labelledby="attention-title"
          >
            <div className="attention-header">
              <div>
                <p className="eyebrow">Attention</p>
                <h2 id="attention-title">
                  {attention === null
                    ? "Loading work…"
                    : attention.length === 0
                      ? "Nothing needs attention"
                      : `${attention.length} open tasks`}
                </h2>
                <p className="attention-summary">
                  Start with blocked or awaiting-verification work, then pick
                  the next planned task.
                </p>
              </div>
              <div
                aria-label="Attention filters"
                className="attention-filters"
                role="group"
              >
                {(
                  [
                    ["all", "All"],
                    ["backlog", "Backlog"],
                    ["blocked", "Blocked"],
                    ["awaiting_verification", "Awaiting"],
                    ["active", "Active"],
                    ["planned", "Planned"],
                  ] as const
                ).map(([filter, label]) => (
                  <button
                    aria-pressed={attentionFilter === filter}
                    className={
                      attentionFilter === filter
                        ? "filter-selected"
                        : "secondary"
                    }
                    key={filter}
                    onClick={() => setAttentionFilter(filter)}
                    type="button"
                  >
                    {label}
                    {attention && (
                      <span>
                        {filter === "all"
                          ? attention.length
                          : attention.filter((item) => item.state === filter)
                              .length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            {visibleAttention && visibleAttention.length > 0 && (
              <div className="attention-list">
                {visibleAttention.map((item) => (
                  <article className="attention-item" key={item.taskId}>
                    <div>
                      <strong>
                        <span className="row-reference">
                          {item.taskSimpleId}
                        </span>{" "}
                        {item.taskName}
                      </strong>
                      <p>
                        {item.projectName}
                        {item.owner ? ` · ${item.owner}` : ""}
                      </p>
                    </div>
                    <div className="attention-item-meta">
                      <StatusIcon state={item.state} />
                      <span className="status-twin">
                        {statusDefinitions[item.state].label}
                      </span>
                      {item.priority && (
                        <small>{formatWorkState(item.priority)} priority</small>
                      )}
                      <button
                        className="secondary"
                        disabled={snapshot.state !== "connected"}
                        onClick={() => void openProject(item.projectId)}
                        type="button"
                      >
                        Open
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {attention &&
              attention.length > 0 &&
              visibleAttention &&
              visibleAttention.length === 0 && (
                <p className="empty attention-empty">
                  No tasks match this filter.
                </p>
              )}
          </section>

          <section className="panel projects-panel" aria-live="polite">
            <div>
              <p className="eyebrow">Projects</p>
              <h2>
                {projects === null
                  ? "Loading projects…"
                  : `${projects.length} projects`}
              </h2>
              {portfolioStatus && (
                <p className="portfolio-summary">
                  {portfolioStatus.totalTasks} tasks ·{" "}
                  {portfolioStatus.counts.backlog} backlog ·{" "}
                  {portfolioStatus.counts.planned} planned ·{" "}
                  {portfolioStatus.counts.active} active ·{" "}
                  {portfolioStatus.counts.awaiting_verification} awaiting
                  verification · {portfolioStatus.counts.completed} completed ·{" "}
                  {portfolioStatus.counts.blocked} blocked ·{" "}
                  {portfolioStatus.counts.released} released ·{" "}
                  {portfolioStatus.counts.wont_do} won&apos;t do
                </p>
              )}
            </div>
            {projects && projects.length > 0 && (
              <div aria-label="Project links" className="project-links">
                {projects.map((project) => (
                  <button
                    className="project-link"
                    disabled={snapshot.state !== "connected"}
                    key={project.id}
                    onClick={() => void openProject(project.id)}
                    type="button"
                  >
                    <span>{project.name}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!projectName.trim() || !trpc.current || !snapshot.canMutate)
                  return;
                setBusy(true);
                void trpc.current.projects.create
                  .mutate({ name: projectName.trim() })
                  .then((result) => {
                    applyDashboardSnapshot(result.dashboard);
                    setProjectName("");
                  })
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                <span className="visually-hidden">Project name</span>
                <input
                  disabled={!snapshot.canMutate || busy}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="New project name"
                  value={projectName}
                />
              </label>
              <button
                disabled={!snapshot.canMutate || busy || !projectName.trim()}
                type="submit"
              >
                New project
              </button>
            </form>
          </section>
        </>
      )}

      {view.screen === "backups" && (
        <BackupsPage client={trpc.current} connection={snapshot} />
      )}

      {projects &&
        projects.length > 0 &&
        view.screen !== "home" &&
        view.screen !== "backups" && (
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
                <button className="secondary" onClick={openHome} type="button">
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
                    onChange={(event) => setTaskBranchName(event.target.value)}
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
                        {status.counts.awaiting_verification} awaiting
                        verification · {status.counts.completed} completed ·{" "}
                        {status.counts.blocked} blocked ·{" "}
                        {status.counts.released} released ·{" "}
                        {status.counts.wont_do} won&apos;t do
                      </p>
                    ) : null;
                  })()}
              </div>
              <div className="detail-actions">
                <button className="secondary" onClick={openHome} type="button">
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
                      <span>Tasks complete</span>
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
                        <span aria-hidden="true" className="task-group-chevron">
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
                          const currentTaskState = taskWorkState(task, status);
                          const taskStateReason =
                            status?.stateReason ?? task.stateReason;
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
                          const progress = summarizeTaskProgress(task, status);
                          const taskHistoryThreads = historyThreadsForTarget(
                            t3Activity,
                            task.id,
                          );
                          const subtaskGroups = groupSubtasksByStatus(
                            task.subtasks.map((subtask, index) => ({
                              ...subtask,
                              sortOrder:
                                subtask.sortOrder ??
                                status?.subtasks[index]?.sortOrder,
                              state: subtaskWorkState(
                                subtask,
                                status?.subtasks[index],
                              ),
                              stateReason:
                                status?.subtasks[index]?.reason ??
                                subtask.stateReason,
                              statusIndex: index,
                            })),
                          );
                          return (
                            <article
                              aria-labelledby={`task-${task.id}-title`}
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
                                        tasks.map((candidate) => candidate.id),
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
                                        onResumeRollup={
                                          task.archiveState
                                            ? undefined
                                            : () =>
                                                void mutateAndRefresh(() =>
                                                  trpc.current!.tasks.resumeRollup.mutate(
                                                    { taskId: task.id },
                                                  ),
                                                )
                                        }
                                        onDisposition={(archiveState) =>
                                          void mutateAndRefresh(() =>
                                            trpc.current!.tasks.archive.mutate({
                                              archiveState,
                                              taskId: task.id,
                                            }),
                                          )
                                        }
                                        onState={(nextState, reason) =>
                                          void setTaskWorkState(
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
                                  {taskStateReason &&
                                    (currentTaskState === "blocked" ||
                                      currentTaskState ===
                                        "awaiting_verification") && (
                                      <p className="state-reason">
                                        <strong>
                                          {currentTaskState === "blocked"
                                            ? "Why blocked"
                                            : "What to verify"}
                                          :
                                        </strong>{" "}
                                        {taskStateReason}
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
                                        ? `${progress.completedSubtasks}/${progress.totalSubtasks} subtasks done`
                                        : "No subtasks yet"}
                                    </span>
                                    {task.pullRequestUrl && (
                                      <GitHubStatusBadge
                                        pullRequestUrl={task.pullRequestUrl}
                                        status={
                                          githubStatuses[`task:${task.id}`]
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
                                        " subtasks complete"
                                      }
                                      className="task-progress"
                                      max={progress.totalSubtasks}
                                      value={progress.completedSubtasks}
                                    />
                                  )}
                                  {progress.nextSubtaskName && (
                                    <p className="task-next">
                                      <strong>Next:</strong>{" "}
                                      {progress.nextSubtaskName}
                                    </p>
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
                                          disabled={!snapshot.canMutate || busy}
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
                                            trpc.current!.tasks.remove.mutate({
                                              confirm: true,
                                              taskId: task.id,
                                            }),
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
                                        await trpc.current!.tasks.link.mutate({
                                          ...linkInput,
                                          stableId: linkInput.stableId.trim(),
                                          title:
                                            linkInput.title.trim() || undefined,
                                          taskId: task.id,
                                          url: linkInput.url.trim(),
                                        });
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
                                taskDetail.acceptanceCriteria.length > 0 ||
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
                                    {taskDetail.acceptanceCriteria.length >
                                      0 && (
                                      <p>
                                        <strong>Acceptance:</strong>{" "}
                                        {taskDetail.acceptanceCriteria.join(
                                          " · ",
                                        )}
                                      </p>
                                    )}
                                    {taskDetail.dependencies.length > 0 && (
                                      <p>
                                        <strong>Dependencies:</strong>{" "}
                                        {taskDetail.dependencies.join(" · ")}
                                      </p>
                                    )}
                                    {taskDetail.repositoryLinks.length > 0 && (
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

                              {taskRowExpanded && (
                                <>
                                  {taskHistoryThreads.length > 0 && (
                                    <details className="task-details task-history">
                                      <summary>History</summary>
                                      <HistoryThreadLinks
                                        onOpenThreadDetail={openT3ThreadDetail}
                                        threads={taskHistoryThreads}
                                      />
                                    </details>
                                  )}
                                  {taskDetail && (
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
                                      screenshots={taskDetail.screenshots ?? []}
                                    />
                                  )}
                                  <div className="subtask-list">
                                    {subtaskGroups.map((subtaskGroup) => (
                                      <section
                                        aria-labelledby={`subtask-group-${task.id}-${subtaskGroup.state}`}
                                        className={`subtask-group subtask-group-${subtaskGroup.state}`}
                                        key={subtaskGroup.state}
                                      >
                                        <div className="subtask-group-heading">
                                          <StatusIcon
                                            size={16}
                                            state={subtaskGroup.state}
                                          />
                                          <h4
                                            id={`subtask-group-${task.id}-${subtaskGroup.state}`}
                                          >
                                            {
                                              statusDefinitions[
                                                subtaskGroup.state
                                              ].label
                                            }
                                          </h4>
                                          <span>
                                            {subtaskGroup.subtasks.length}
                                          </span>
                                        </div>
                                        <div className="subtask-group-items">
                                          {subtaskGroup.subtasks.map(
                                            (subtask) => {
                                              const index = subtask.statusIndex;
                                              const liveSubtaskState =
                                                isLiveWorkState(
                                                  subtaskGroup.state,
                                                )
                                                  ? subtaskGroup.state
                                                  : null;
                                              const subtaskStatus =
                                                status?.subtasks[index];
                                              const history =
                                                subtaskHistories[subtask.id];
                                              const subtaskEdit =
                                                subtaskEdits[subtask.id];
                                              const subtaskArchived = Boolean(
                                                subtaskStatus?.archiveState,
                                              );
                                              const subtaskWorkStatus: WorkStatus =
                                                subtaskWorkState(
                                                  subtask,
                                                  subtaskStatus,
                                                );
                                              const subtaskStateReason =
                                                subtaskStatus?.reason ??
                                                subtask.stateReason;
                                              const subtaskRowKey = `subtask:${subtask.id}`;
                                              const subtaskRowExpanded =
                                                Boolean(
                                                  expandedRows[subtaskRowKey],
                                                );
                                              const subtaskActionsSummary =
                                                summarizeGitHubActions([
                                                  githubStatuses[
                                                    `subtask:${subtask.id}`
                                                  ],
                                                ]);
                                              return (
                                                <div
                                                  className={`subtask ${
                                                    subtaskRowExpanded
                                                      ? "row-expanded"
                                                      : "row-collapsed"
                                                  } ${
                                                    dragTarget?.kind ===
                                                      "subtask" &&
                                                    dragTarget.id === subtask.id
                                                      ? "is-dragging"
                                                      : ""
                                                  } ${
                                                    dragTarget?.overId ===
                                                    subtask.id
                                                      ? "is-drag-over"
                                                      : ""
                                                  }`}
                                                  data-reorder-id={subtask.id}
                                                  data-reorder-kind="subtask"
                                                  data-work-state={
                                                    subtaskGroup.state
                                                  }
                                                  key={subtask.id}
                                                >
                                                  <div className="subtask-content">
                                                    <div className="subtask-title-row">
                                                      {liveSubtaskState && (
                                                        <ReorderHandle
                                                          disabled={
                                                            !snapshot.canMutate ||
                                                            busy ||
                                                            subtaskArchived
                                                          }
                                                          itemId={subtask.id}
                                                          kind="subtask"
                                                          onKeyDown={(event) =>
                                                            keyboardReorder(
                                                              event,
                                                              {
                                                                id: subtask.id,
                                                                kind: "subtask",
                                                                state:
                                                                  liveSubtaskState,
                                                              },
                                                              subtaskGroup.subtasks.map(
                                                                (candidate) =>
                                                                  candidate.id,
                                                              ),
                                                            )
                                                          }
                                                          onPointerDown={(
                                                            event,
                                                          ) =>
                                                            beginDrag(event, {
                                                              id: subtask.id,
                                                              kind: "subtask",
                                                              state:
                                                                liveSubtaskState,
                                                            })
                                                          }
                                                          onPointerMove={
                                                            updateDrag
                                                          }
                                                          onPointerUp={
                                                            finishDrag
                                                          }
                                                          state={
                                                            liveSubtaskState
                                                          }
                                                        />
                                                      )}
                                                      <div className="status-with-thread-dots">
                                                        <ReportStatusMenu
                                                          disabled={
                                                            !snapshot.canMutate ||
                                                            busy ||
                                                            subtaskArchived
                                                          }
                                                          onSelect={(
                                                            reportedState,
                                                          ) =>
                                                            void reportSubtask(
                                                              subtask.id,
                                                              reportedState,
                                                              subtask.evidence ??
                                                                subtaskStatus?.evidence,
                                                            )
                                                          }
                                                          onSelectWithReason={(
                                                            reportedState,
                                                            reason,
                                                          ) =>
                                                            void reportSubtask(
                                                              subtask.id,
                                                              reportedState,
                                                              subtask.evidence ??
                                                                subtaskStatus?.evidence,
                                                              reason,
                                                            )
                                                          }
                                                          state={
                                                            subtaskWorkStatus
                                                          }
                                                          onDisposition={(
                                                            archiveState,
                                                          ) =>
                                                            void mutateAndRefresh(
                                                              () =>
                                                                trpc.current!.subtasks.archive.mutate(
                                                                  {
                                                                    archiveState,
                                                                    subtaskId:
                                                                      subtask.id,
                                                                  },
                                                                ),
                                                            )
                                                          }
                                                        />
                                                        <ThreadDots
                                                          activity={t3Activity}
                                                          onOpenThread={
                                                            openT3ThreadDetail
                                                          }
                                                          target={{
                                                            id: subtask.id,
                                                            kind: "subtask",
                                                            label: `${task.name} / ${subtask.name}`,
                                                          }}
                                                        />
                                                      </div>
                                                      {subtaskEdit ? (
                                                        <form
                                                          className="subtask-edit-form"
                                                          onSubmit={(event) =>
                                                            void saveSubtaskEdit(
                                                              event,
                                                              subtask.id,
                                                            )
                                                          }
                                                        >
                                                          {/* <span>Evidence</span> is kept as the stable field label contract. */}
                                                          <label>
                                                            <span>
                                                              Subtask title
                                                            </span>
                                                            <input
                                                              autoFocus
                                                              disabled={
                                                                !snapshot.canMutate ||
                                                                busy
                                                              }
                                                              onChange={(
                                                                event,
                                                              ) =>
                                                                setSubtaskEdits(
                                                                  (
                                                                    current,
                                                                  ) => ({
                                                                    ...current,
                                                                    [subtask.id]:
                                                                      {
                                                                        ...subtaskEdit,
                                                                        title:
                                                                          event
                                                                            .target
                                                                            .value,
                                                                      },
                                                                  }),
                                                                )
                                                              }
                                                              value={
                                                                subtaskEdit.title
                                                              }
                                                            />
                                                          </label>
                                                          <label>
                                                            <span>
                                                              Description
                                                            </span>
                                                            <textarea
                                                              disabled={
                                                                !snapshot.canMutate ||
                                                                busy
                                                              }
                                                              onChange={(
                                                                event,
                                                              ) =>
                                                                setSubtaskEdits(
                                                                  (
                                                                    current,
                                                                  ) => ({
                                                                    ...current,
                                                                    [subtask.id]:
                                                                      {
                                                                        ...subtaskEdit,
                                                                        description:
                                                                          event
                                                                            .target
                                                                            .value,
                                                                      },
                                                                  }),
                                                                )
                                                              }
                                                              value={
                                                                subtaskEdit.description
                                                              }
                                                            />
                                                          </label>
                                                          <label>
                                                            <span>
                                                              Evidence
                                                            </span>
                                                            <textarea
                                                              disabled={
                                                                !snapshot.canMutate ||
                                                                busy
                                                              }
                                                              onChange={(
                                                                event,
                                                              ) =>
                                                                setSubtaskEdits(
                                                                  (
                                                                    current,
                                                                  ) => ({
                                                                    ...current,
                                                                    [subtask.id]:
                                                                      {
                                                                        ...subtaskEdit,
                                                                        evidence:
                                                                          event
                                                                            .target
                                                                            .value,
                                                                      },
                                                                  }),
                                                                )
                                                              }
                                                              placeholder="Evidence (optional)"
                                                              value={
                                                                subtaskEdit.evidence
                                                              }
                                                            />
                                                          </label>
                                                          <div className="edit-actions">
                                                            <button
                                                              disabled={
                                                                !snapshot.canMutate ||
                                                                busy ||
                                                                !subtaskEdit.title.trim()
                                                              }
                                                              type="submit"
                                                            >
                                                              Save subtask
                                                            </button>
                                                            <button
                                                              className="secondary"
                                                              disabled={busy}
                                                              onClick={() =>
                                                                cancelSubtaskEdit(
                                                                  subtask.id,
                                                                )
                                                              }
                                                              type="button"
                                                            >
                                                              Cancel
                                                            </button>
                                                          </div>
                                                        </form>
                                                      ) : (
                                                        <RowToggle
                                                          expanded={
                                                            subtaskRowExpanded
                                                          }
                                                          kind="subtask"
                                                          name={subtask.name}
                                                          simpleId={
                                                            subtask.simpleId
                                                          }
                                                          onToggle={() =>
                                                            toggleRow(
                                                              subtaskRowKey,
                                                            )
                                                          }
                                                          actionsSummary={
                                                            subtaskActionsSummary
                                                          }
                                                        />
                                                      )}
                                                    </div>
                                                    {!subtaskEdit && (
                                                      <div className="subtask-copy">
                                                        {subtask.description && (
                                                          <p className="subtask-description">
                                                            {
                                                              subtask.description
                                                            }
                                                          </p>
                                                        )}
                                                        {(subtask.evidence ??
                                                          subtaskStatus?.evidence) && (
                                                          <p className="evidence">
                                                            {subtask.evidence ??
                                                              subtaskStatus?.evidence}
                                                          </p>
                                                        )}
                                                        {subtaskStateReason &&
                                                          (subtaskWorkStatus ===
                                                            "blocked" ||
                                                            subtaskWorkStatus ===
                                                              "awaiting_verification") && (
                                                            <p className="state-reason">
                                                              <strong>
                                                                {subtaskWorkStatus ===
                                                                "blocked"
                                                                  ? "Why blocked"
                                                                  : "What to verify"}
                                                                :
                                                              </strong>{" "}
                                                              {
                                                                subtaskStateReason
                                                              }
                                                            </p>
                                                          )}
                                                        {subtask.pullRequestUrl && (
                                                          <GitHubStatusBadge
                                                            pullRequestUrl={
                                                              subtask.pullRequestUrl
                                                            }
                                                            status={
                                                              githubStatuses[
                                                                `subtask:${subtask.id}`
                                                              ]
                                                            }
                                                          />
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                  {subtaskRowExpanded && (
                                                    <ScreenshotProof
                                                      busy={busy}
                                                      canMutate={
                                                        snapshot.canMutate
                                                      }
                                                      onGet={getScreenshot}
                                                      onUpload={(input) =>
                                                        uploadScreenshot(
                                                          {
                                                            subtaskId:
                                                              subtask.id,
                                                          },
                                                          input,
                                                        )
                                                      }
                                                      ownerLabel={`Subtask ${subtask.simpleId}`}
                                                      screenshots={
                                                        subtask.screenshots ??
                                                        []
                                                      }
                                                    />
                                                  )}
                                                  <div className="subtask-actions">
                                                    <button
                                                      aria-label="Edit subtask"
                                                      className="icon-button secondary"
                                                      disabled={
                                                        !snapshot.canMutate ||
                                                        busy
                                                      }
                                                      onClick={() =>
                                                        startSubtaskEdit(
                                                          subtask,
                                                          subtaskStatus,
                                                        )
                                                      }
                                                      type="button"
                                                      title="Edit subtask"
                                                    >
                                                      <SubtaskActionIcon action="edit" />
                                                    </button>
                                                    {subtaskArchived && (
                                                      <button
                                                        className="secondary"
                                                        disabled={
                                                          !snapshot.canMutate ||
                                                          busy
                                                        }
                                                        onClick={() =>
                                                          void mutateAndRefresh(
                                                            () =>
                                                              trpc.current!.subtasks.restore.mutate(
                                                                {
                                                                  subtaskId:
                                                                    subtask.id,
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
                                                      className="secondary"
                                                      onClick={() =>
                                                        void loadSubtaskHistory(
                                                          subtask.id,
                                                        )
                                                      }
                                                      type="button"
                                                    >
                                                      History
                                                    </button>
                                                    {subtaskStatus?.reportId &&
                                                      subtaskStatus.verificationState ===
                                                        "awaiting_verification" &&
                                                      (human ? (
                                                        <VerificationActions
                                                          disabled={
                                                            !snapshot.canMutate ||
                                                            busy ||
                                                            subtaskArchived
                                                          }
                                                          onVerify={(
                                                            decision,
                                                            reason,
                                                          ) =>
                                                            void verifySubtask(
                                                              subtaskStatus.reportId!,
                                                              decision,
                                                              reason,
                                                            )
                                                          }
                                                        />
                                                      ) : (
                                                        <span className="verify-hint">
                                                          Sign in to verify
                                                        </span>
                                                      ))}
                                                    <button
                                                      aria-label={`Delete subtask “${subtask.name}”`}
                                                      className="icon-button danger"
                                                      disabled={
                                                        !snapshot.canMutate ||
                                                        busy
                                                      }
                                                      onClick={() => {
                                                        if (
                                                          !window.confirm(
                                                            `Delete subtask “${subtask.name}”? This cannot be undone.`,
                                                          )
                                                        )
                                                          return;
                                                        void mutateAndRefresh(
                                                          () =>
                                                            trpc.current!.subtasks.remove.mutate(
                                                              {
                                                                confirm: true,
                                                                subtaskId:
                                                                  subtask.id,
                                                              },
                                                            ),
                                                        );
                                                      }}
                                                      type="button"
                                                      title="Delete subtask"
                                                    >
                                                      <SubtaskActionIcon action="delete" />
                                                    </button>
                                                  </div>
                                                  {history && (
                                                    <div className="history">
                                                      <strong>History</strong>
                                                      <HistoryThreadLinks
                                                        onOpenThreadDetail={
                                                          openT3ThreadDetail
                                                        }
                                                        threads={historyThreadsForTarget(
                                                          t3Activity,
                                                          subtask.id,
                                                        )}
                                                      />
                                                      {history.reports.map(
                                                        (report) => (
                                                          <p key={report.id}>
                                                            {
                                                              report.reportedState
                                                            }{" "}
                                                            by{" "}
                                                            {formatHistoryReportAttribution(
                                                              report,
                                                            )}
                                                            {report.evidence
                                                              ? " · " +
                                                                report.evidence
                                                              : ""}
                                                          </p>
                                                        ),
                                                      )}
                                                      {history.verifications.map(
                                                        (verification) => (
                                                          <p
                                                            key={
                                                              verification.id
                                                            }
                                                          >
                                                            {
                                                              verification.decision
                                                            }{" "}
                                                            by{" "}
                                                            {
                                                              verification.verifier
                                                            }
                                                          </p>
                                                        ),
                                                      )}
                                                    </div>
                                                  )}
                                                </div>
                                              );
                                            },
                                          )}
                                          {isLiveWorkState(
                                            subtaskGroup.state,
                                          ) && (
                                            <div
                                              aria-label={`Drop at end of ${statusDefinitions[subtaskGroup.state].label} subtasks`}
                                              className={`reorder-tail ${
                                                dragTarget?.kind ===
                                                  "subtask" &&
                                                dragTarget.overId ===
                                                  DRAG_TAIL &&
                                                dragTarget.state ===
                                                  subtaskGroup.state
                                                  ? "is-drag-over"
                                                  : ""
                                              }`}
                                              data-reorder-kind="subtask"
                                              data-reorder-tail="true"
                                              data-work-state={
                                                subtaskGroup.state
                                              }
                                              role="presentation"
                                            />
                                          )}
                                        </div>
                                      </section>
                                    ))}
                                  </div>

                                  <form
                                    className="subtask-create"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      const name =
                                        subtaskNames[task.id]?.trim();
                                      if (!name || !trpc.current) return;
                                      void mutateAndRefresh(async () => {
                                        const result =
                                          await trpc.current!.subtasks.create.mutate(
                                            {
                                              description:
                                                subtaskDescriptions[
                                                  task.id
                                                ]?.trim() || undefined,
                                              name,
                                              taskId: task.id,
                                            },
                                          );
                                        setSubtaskNames((current) => ({
                                          ...current,
                                          [task.id]: "",
                                        }));
                                        setSubtaskDescriptions((current) => ({
                                          ...current,
                                          [task.id]: "",
                                        }));
                                        return result;
                                      });
                                    }}
                                  >
                                    <input
                                      aria-label={`New subtask for ${task.name}`}
                                      disabled={!snapshot.canMutate || busy}
                                      onChange={(event) =>
                                        setSubtaskNames((current) => ({
                                          ...current,
                                          [task.id]: event.target.value,
                                        }))
                                      }
                                      placeholder="New subtask"
                                      value={subtaskNames[task.id] ?? ""}
                                    />
                                    <input
                                      aria-label={`Description for new subtask of ${task.name}`}
                                      disabled={!snapshot.canMutate || busy}
                                      onChange={(event) =>
                                        setSubtaskDescriptions((current) => ({
                                          ...current,
                                          [task.id]: event.target.value,
                                        }))
                                      }
                                      placeholder="Description (optional)"
                                      value={subtaskDescriptions[task.id] ?? ""}
                                    />
                                    <button
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        !subtaskNames[task.id]?.trim()
                                      }
                                      type="submit"
                                    >
                                      Add subtask
                                    </button>
                                  </form>
                                </>
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
  );
}

function ConnectionIndicator({
  snapshot,
  t3Status,
}: {
  snapshot: ConnectionSnapshot;
  t3Status: T3StatusResult | undefined;
}) {
  const lastConnected = snapshot.lastSuccessfulConnection?.toLocaleTimeString();
  const websocketState = snapshot.state;
  const lastConnectedLabel =
    lastConnected && snapshot.state !== "connected"
      ? `last connected ${lastConnected}`
      : undefined;
  const t3Summary = summarizeT3Connections(t3Status);
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
  return (
    <div
      aria-label={`${t3Label} · WebSocket ${websocketState}${lastConnectedLabel ? ` · ${lastConnectedLabel}` : ""}`}
      aria-live="polite"
      className={`connection ${snapshot.state}`}
      data-t3-connection-state={t3Summary.state}
      data-t3-health={t3Health}
      data-t3-total={
        t3Summary.state === "ready" ? String(t3Summary.total) : undefined
      }
      data-websocket-state={websocketState}
      title={`${t3Label} · WebSocket ${websocketState}${lastConnectedLabel ? ` · ${lastConnectedLabel}` : ""}`}
    >
      <span className="connection-service">
        <span aria-hidden="true" className="connection-dot t3-dot" />
        <span>{t3Label}</span>
      </span>
      <span className="connection-service">
        <span aria-hidden="true" className="connection-dot websocket-dot" />
        <span>WS</span>
      </span>
    </div>
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
  onDisposition,
  onResumeRollup,
  onState,
  state,
  taskName,
}: {
  onDisposition?: (state: "released" | "wont_do") => void;
  onResumeRollup?: () => void;
  onState: (state: TaskEditableWorkState, reason?: string) => void;
  state: WorkStatus;
  taskName: string;
}) {
  const current = statusDefinitions[state];
  const [pendingState, setPendingState] =
    useState<TaskEditableWorkState | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const reasonLabel =
    pendingState === "blocked"
      ? "Why blocked / what unblocks it"
      : "What to verify";
  const closeMenu = (event: React.SyntheticEvent) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
  };
  const chooseState = (
    event: React.MouseEvent<HTMLButtonElement>,
    candidateState: TaskEditableWorkState,
  ) => {
    if (requiresStateReason(candidateState)) {
      setPendingState(candidateState);
      setReason("");
      setReasonError(false);
      return;
    }
    onState(candidateState);
    closeMenu(event);
  };
  return (
    <details className="status-menu task-status-menu">
      <summary
        aria-label={`${current.label} status for ${taskName}`}
        className={`status-trigger ${state}`}
        title={current.label}
      >
        <StatusIcon state={state} size={22} />
      </summary>
      <div
        aria-label={`Status options for ${taskName}`}
        className="status-menu-options"
        role="listbox"
      >
        <p className="status-menu-heading">Task status</p>
        {onResumeRollup && (
          <button
            className="status-option"
            role="option"
            aria-selected={false}
            type="button"
            onClick={(event) => {
              onResumeRollup();
              closeMenu(event);
            }}
          >
            <span>Use subtask status</span>
          </button>
        )}
        {taskStatusOrder.map((candidateState) => {
          const definition = statusDefinitions[candidateState];
          const selected = candidateState === state;
          const content = (
            <>
              <StatusIcon state={candidateState} size={19} />
              <span>{definition.label}</span>
              {selected && (
                <span aria-hidden="true" className="status-selected">
                  ✓
                </span>
              )}
            </>
          );

          return (
            <button
              aria-selected={selected}
              className={`status-option ${selected ? "selected" : ""}`}
              key={candidateState}
              onClick={(event) => chooseState(event, candidateState)}
              role="option"
              type="button"
            >
              {content}
            </button>
          );
        })}
        {onDisposition && (
          <>
            <div className="status-menu-divider" />
            {archiveStatusOrder.map((candidateState) => {
              const selected = candidateState === state;
              const definition = statusDefinitions[candidateState];
              return (
                <button
                  aria-selected={selected}
                  className={`status-option ${selected ? "selected" : ""}`}
                  key={candidateState}
                  onClick={(event) => {
                    onDisposition(candidateState);
                    closeMenu(event);
                  }}
                  role="option"
                  type="button"
                >
                  <StatusIcon state={candidateState} size={19} />
                  <span>{definition.label}</span>
                  {selected && (
                    <span aria-hidden="true" className="status-selected">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </>
        )}
        {pendingState && (
          <form
            className="status-reason-form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmedReason = reason.trim();
              if (!trimmedReason) {
                setReasonError(true);
                return;
              }
              onState(pendingState, trimmedReason);
              setPendingState(null);
              setReason("");
              setReasonError(false);
              closeMenu(event);
            }}
          >
            <label>
              <span>{reasonLabel}</span>
              <textarea
                aria-invalid={reasonError}
                autoFocus
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(false);
                }}
                placeholder={reasonLabel}
                required
                value={reason}
              />
            </label>
            {reasonError && (
              <p className="field-error">A reason is required.</p>
            )}
            <div className="edit-actions">
              <button type="submit">
                Set {statusDefinitions[pendingState].label}
              </button>
              <button
                className="secondary"
                onClick={() => setPendingState(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <p className="status-menu-note">
          Task status is directly editable; child reports may advance it.
        </p>
      </div>
    </details>
  );
}

function ReportStatusMenu({
  disabled,
  onDisposition,
  onSelect,
  onSelectWithReason,
  state,
}: {
  disabled: boolean;
  onDisposition: (state: "released" | "wont_do") => void;
  onSelect: (state: ReportedStatus) => void;
  onSelectWithReason?: (state: ReportedStatus, reason: string) => void;
  state: WorkStatus;
}) {
  const current = statusDefinitions[state];
  const [pendingState, setPendingState] = useState<ReportedStatus | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const reasonLabel =
    pendingState === "blocked"
      ? "Why blocked / what unblocks it"
      : "What to verify";
  const closeMenu = (event: React.SyntheticEvent) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
  };
  return (
    <details className="status-menu subtask-status-menu">
      <summary
        aria-disabled={disabled}
        aria-label={`Change status, currently ${current.label}`}
        className={`status-trigger ${state}`}
        title={current.label}
      >
        <StatusIcon state={state} size={20} />
      </summary>
      <div
        aria-label="Subtask status options"
        className="status-menu-options"
        role="listbox"
      >
        {reportStatusOptions.map((option) => {
          const requiresReason =
            option.reportedState === "blocked" ||
            option.reportedState === "complete";
          return (
            <button
              aria-selected={option.workStatus === state}
              className={`status-option ${
                option.workStatus === state ? "selected" : ""
              }`}
              disabled={disabled}
              key={option.reportedState}
              onClick={(event) => {
                if (requiresReason && onSelectWithReason) {
                  setPendingState(option.reportedState);
                  setReason("");
                  setReasonError(false);
                  return;
                }
                onSelect(option.reportedState);
                closeMenu(event);
              }}
              role="option"
              type="button"
            >
              <StatusIcon state={option.workStatus} size={19} />
              <span>{option.label}</span>
              {option.workStatus === state && (
                <span aria-hidden="true" className="status-selected">
                  ✓
                </span>
              )}
            </button>
          );
        })}
        {pendingState && onSelectWithReason && (
          <form
            className="status-reason-form"
            onSubmit={(event) => {
              event.preventDefault();
              const trimmedReason = reason.trim();
              if (!trimmedReason) {
                setReasonError(true);
                return;
              }
              onSelectWithReason(pendingState, trimmedReason);
              setPendingState(null);
              setReason("");
              setReasonError(false);
              closeMenu(event);
            }}
          >
            <label>
              <span>{reasonLabel}</span>
              <textarea
                aria-invalid={reasonError}
                autoFocus
                onChange={(event) => {
                  setReason(event.target.value);
                  setReasonError(false);
                }}
                placeholder={reasonLabel}
                required
                value={reason}
              />
            </label>
            {reasonError && (
              <p className="field-error">A reason is required.</p>
            )}
            <div className="edit-actions">
              <button type="submit">
                Report{" "}
                {
                  statusDefinitions[workStatusForReportedState(pendingState)]
                    ?.label
                }
              </button>
              <button
                className="secondary"
                onClick={() => setPendingState(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <div className="status-menu-divider" />
        {dispositionStatusOptions.map(({ workStatus: candidateState }) => {
          const selected = candidateState === state;
          const definition = statusDefinitions[candidateState];
          return (
            <button
              aria-selected={selected}
              className={`status-option ${selected ? "selected" : ""}`}
              disabled={disabled}
              key={candidateState}
              onClick={() => onDisposition(candidateState)}
              role="option"
              type="button"
            >
              <StatusIcon state={candidateState} size={19} />
              <span>{definition.label}</span>
              {selected && (
                <span aria-hidden="true" className="status-selected">
                  ✓
                </span>
              )}
            </button>
          );
        })}
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
  pullRequestUrl,
  status,
}: {
  pullRequestUrl: string;
  status?: GitHubStatusSnapshot;
}) {
  const label = githubStatusLabel(status);
  return (
    <span
      className={`github-status github-status-${status?.status ?? "loading"}`}
    >
      <a href={pullRequestUrl} rel="noreferrer" target="_blank">
        {status?.pullRequest ? `PR #${status.pullRequest.number}` : "GitHub PR"}
      </a>
      <span>{label}</span>
    </span>
  );
}

function githubStatusLabel(status?: GitHubStatusSnapshot): string {
  if (!status) return "checking…";
  if (status.status === "not_configured") return "GitHub not configured";
  if (status.status === "permission_denied") return "access denied";
  if (status.status === "not_found") return "not found";
  if (status.status === "unavailable") return "unavailable";
  if (status.status !== "ok" || !status.pullRequest) return "not linked";
  if (status.pullRequest.state === "closed") {
    return status.pullRequest.mergedAt ? "merged" : "closed";
  }
  const pullRequestState = status.pullRequest.draft ? "draft" : "open";
  if (status.workflowRunsStatus === "unavailable") {
    return `${pullRequestState} · Actions unavailable`;
  }
  if (status.workflowRuns.length === 0) {
    return `${pullRequestState} · no Actions runs`;
  }
  if (
    status.workflowRuns.some((run) =>
      ["queued", "in_progress", "waiting", "requested", "pending"].includes(
        run.status,
      ),
    )
  ) {
    return `${pullRequestState} · Actions running`;
  }
  if (
    status.workflowRuns.some((run) =>
      ["failure", "timed_out", "cancelled", "action_required"].includes(
        run.conclusion ?? "",
      ),
    )
  ) {
    return `${pullRequestState} · Actions failing`;
  }
  if (status.workflowRuns.every((run) => run.conclusion === "success")) {
    return `${pullRequestState} · Actions passing`;
  }
  return `${pullRequestState} · Actions pending`;
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

function VerificationActions({
  disabled,
  onVerify,
}: {
  disabled: boolean;
  onVerify: (
    decision: "accepted" | "rejected" | "deferred",
    reason?: string,
  ) => void;
}) {
  const [pendingDecision, setPendingDecision] = useState<
    "rejected" | "deferred" | null
  >(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  if (pendingDecision) {
    const label = pendingDecision === "rejected" ? "Why reject" : "Why defer";
    return (
      <form
        className="verification-reason-form"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmedReason = reason.trim();
          if (!trimmedReason) {
            setReasonError(true);
            return;
          }
          onVerify(pendingDecision, trimmedReason);
          setPendingDecision(null);
          setReason("");
          setReasonError(false);
        }}
      >
        <label>
          <span>{label}</span>
          <textarea
            aria-invalid={reasonError}
            autoFocus
            onChange={(event) => {
              setReason(event.target.value);
              setReasonError(false);
            }}
            placeholder={label}
            required
            value={reason}
          />
        </label>
        {reasonError && <p className="field-error">A reason is required.</p>}
        <div className="edit-actions">
          <button type="submit">
            {pendingDecision === "rejected" ? "Reject" : "Defer"}
          </button>
          <button
            className="secondary"
            onClick={() => setPendingDecision(null)}
            type="button"
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <button
        className="verify"
        disabled={disabled}
        onClick={() => onVerify("accepted")}
        type="button"
      >
        Accept
      </button>
      <button
        className="secondary"
        disabled={disabled}
        onClick={() => setPendingDecision("deferred")}
        type="button"
      >
        Defer
      </button>
      <button
        className="danger"
        disabled={disabled}
        onClick={() => setPendingDecision("rejected")}
        type="button"
      >
        Reject
      </button>
    </>
  );
}

function formatWorkState(state: string): string {
  return state
    .replaceAll("_", " ")
    .replace(/(^| )\w/g, (character) => character.toUpperCase());
}

createRoot(document.getElementById("root")!).render(<Dashboard />);

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
