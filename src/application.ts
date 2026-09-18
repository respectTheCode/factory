import { sameWorkspaceRoot } from "./workspace";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Database } from "bun:sqlite";

import { parseGitHubPullRequestUrl } from "./github";
import {
  backfillSimpleIds,
  matchesSimpleId,
  nextSimpleIdNumber,
  SUBTASK_SIMPLE_ID_PREFIX,
  TASK_SIMPLE_ID_PREFIX,
} from "./simple-ids";
import {
  computeReconciliationFindings,
  matchReconciliationTarget,
  type ReconciliationFindingDraft,
  type ReconciliationFindingKind,
  type ReconciliationFindingSeverity,
  type ReconciliationLink,
  type ReconciliationMatch,
  type ReconciliationSession,
  type ReconciliationSessionState,
  type ReconciliationTarget,
  type ReconciliationTurnState,
  type ReconciliationWorkState,
} from "./reconciliation";

export type FactoryClock = () => Date;
export type FactoryIdGenerator = () => string;

export type FactoryApplicationOptions = {
  clock: FactoryClock;
  idGenerator: FactoryIdGenerator;
  close?: () => void;
  refreshBeforeOperations?: boolean;
  refresh?: () => FactoryState | undefined;
  state?: FactoryState;
  persist?: (state: FactoryState) => void;
};

export type Project = {
  id: string;
  name: string;
  gitOriginUrl?: string;
  t3ProjectId?: string;
  workspaceRoot?: string;
  createdAt: Date;
};

export type WorkState =
  | "backlog"
  | "planned"
  | "active"
  | "awaiting_verification"
  | "blocked"
  | "completed";

type TaskWorkStateSource = "manual" | "rollup";

export type Task = {
  id: string;
  simpleId?: string;
  name: string;
  projectId: string;
  branchName?: string;
  pullRequestUrl?: string;
  objective?: string;
  acceptanceCriteria: string[];
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
  dependencies: string[];
  repositoryLinks: string[];
  workState?: WorkState;
  workStateSource?: TaskWorkStateSource;
  stateReason?: string;
  sortOrder?: number;
  archiveState?: ArchiveState;
  revision: number;
  createdAt: Date;
};

export type Subtask = {
  id: string;
  simpleId?: string;
  name: string;
  taskId: string;
  description?: string;
  evidence?: string;
  pullRequestUrl?: string;
  sortOrder?: number;
  archiveState?: ArchiveState;
  revision: number;
  createdAt: Date;
};

export class FactoryConflictError extends Error {
  readonly currentRevision: number;
  readonly expectedRevision: number;

  constructor(
    recordType: "Task" | "Subtask",
    recordId: string,
    currentRevision: number,
    expectedRevision: number,
  ) {
    super(
      `${recordType} ${recordId} has current revision ${currentRevision}; expected revision ${expectedRevision}.`,
    );
    this.name = "FactoryConflictError";
    this.currentRevision = currentRevision;
    this.expectedRevision = expectedRevision;
  }
}

export type ArchiveState = "released" | "wont_do";

export type ReportedState =
  | "backlog"
  | "not_started"
  | "in_progress"
  | "blocked"
  | "complete";

export type StatusReport = {
  id: string;
  subtaskId: string;
  reportedState: ReportedState;
  reporter: string;
  evidence?: string;
  reason?: string;
  machineId?: string;
  sessionRef?: {
    provider: "t3";
    externalThreadId: string;
  };
  createdAt: Date;
};

export type VerificationDecision = "accepted" | "rejected" | "deferred";

export type Verification = {
  id: string;
  reportId: string;
  decision: VerificationDecision;
  verifier: string;
  reason?: string;
  createdAt: Date;
};

export type RunState =
  | "observed"
  | "active"
  | "waiting_on_human"
  | "succeeded"
  | "failed"
  | "cancelled";

export type Run = {
  id: string;
  projectId: string;
  state: RunState;
  createdAt: Date;
  updatedAt: Date;
};

export type CodeSession = {
  id: string;
  runId: string;
  provider: "t3";
  externalThreadId: string;
  externalProjectId: string;
  title: string;
  workspaceRoot: string;
  repositoryIdentity?: string;
  branch?: string;
  worktreePath?: string;
  linkedPullRequestUrl?: string;
  latestSessionState?: ReconciliationSessionState;
  latestTurnState?: ReconciliationTurnState;
  latestTurnCompletedAt?: Date;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  observedAt: Date;
  sourceUpdatedAt: Date;
  sourceSequence?: number;
  sourceStream?: string;
  sourceDigest: string;
  sourceCurrent?: boolean;
};

export type CodeSessionAssociation = {
  id: string;
  codeSessionId: string;
  taskId: string;
  subtaskId?: string;
  createdAt: Date;
};

/**
 * A normalized current T3 observation.  It is intentionally separate from a
 * CodeSession: unlinked T3 activity must be observable before a Factory Run
 * exists, while a linked CodeSession is always attached to a Run.
 */
export type CodeSessionObservationInput = Omit<
  CodeSession,
  "id" | "runId" | "sourceCurrent"
> & {
  projectId: string;
};

export type CodeSessionObservation = CodeSessionObservationInput & {
  id: string;
  projectId: string;
  sourceCurrent?: boolean;
};

export type SessionEvidence = {
  id: string;
  provider: "t3";
  externalThreadId: string;
  sourceSequence?: number;
  sourceStream?: string;
  observedAt: Date;
  turnIds: string[];
  checkpointFiles: string[];
  changedFileCount?: number;
  linkedPullRequestUrl?: string;
  digest: string;
};

export type ReconciliationFindingStatus = "open" | "resolved" | "dismissed";

export type ReconciliationFinding = {
  id: string;
  dedupeKey: string;
  kind: ReconciliationFindingKind;
  severity: ReconciliationFindingSeverity;
  status: ReconciliationFindingStatus;
  projectId: string;
  externalThreadId?: string;
  taskId?: string;
  subtaskId?: string;
  candidateIds: string[];
  observedAt: Date;
  explanation: string;
  suggestedAction: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ProjectWorkState = WorkState | ArchiveState;

export type ProjectWorkCounts = Record<ProjectWorkState, number>;

export type AttentionItem = {
  projectId: string;
  projectName: string;
  taskId: string;
  taskSimpleId: string;
  taskName: string;
  state: Exclude<ProjectWorkState, "completed" | ArchiveState>;
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
};

export type TaskStatus = {
  taskId: string;
  taskSimpleId: string;
  taskCompleted: boolean;
  taskState: ProjectWorkState;
  stateReason?: string;
  archiveState?: ArchiveState;
  subtasks: Array<{
    reportedState?: ReportedState;
    effectiveState: WorkState;
    sortOrder?: number;
    reason?: string;
    verificationState:
      | "accepted"
      | "awaiting_verification"
      | "deferred"
      | "rejected"
      | "unreported";
    id?: string;
    subtaskId?: string;
    subtaskSimpleId?: string;
    reportId?: string;
    evidence?: string;
    reporter?: string;
    archiveState?: ArchiveState;
  }>;
};

export type TrackerLink = {
  id: string;
  system: "linear" | "notion";
  stableId: string;
  projectId?: string;
  taskId?: string;
  title?: string;
  url: string;
};

type TrackerLinkFields = Omit<TrackerLink, "id" | "projectId" | "taskId">;

// Schema-v1 snapshots may omit the additive revision field; hydration makes it
// required on the runtime Task and Subtask records.
type PersistedTask = Omit<Task, "revision"> & { revision?: number };
type PersistedSubtask = Omit<Subtask, "revision"> & { revision?: number };

export type FactoryState = {
  projects: Project[];
  tasks: PersistedTask[];
  subtasks: PersistedSubtask[];
  statusReports: StatusReport[];
  verifications: Verification[];
  trackerLinks?: TrackerLink[];
  runs?: Run[];
  codeSessions?: CodeSession[];
  codeSessionAssociations?: CodeSessionAssociation[];
  codeSessionObservations?: CodeSessionObservation[];
  sessionEvidence?: SessionEvidence[];
  reconciliationFindings?: ReconciliationFinding[];
  simpleIdCounters?: {
    nextSubtask: number;
    nextTask: number;
  };
};

type HydratedFactoryState = Omit<FactoryState, "tasks" | "subtasks"> & {
  tasks: Task[];
  subtasks: Subtask[];
};

export type ProjectT3Activity = {
  observation: CodeSessionObservation;
  codeSession?: CodeSession;
  associations: CodeSessionAssociation[];
  run?: Run;
};

export type LinkT3ThreadInput = {
  observation: CodeSessionObservationInput;
  taskId?: string;
  subtaskId?: string;
};

export type SessionEvidenceInput = Omit<SessionEvidence, "id">;

export type T3ObservationRefreshBoundary = {
  projectId: string;
  sourceSequence: number;
  sourceStream: string;
  sourceUpdatedAt: Date;
  observedAt: Date;
};

function emptyProjectWorkCounts(): ProjectWorkCounts {
  return {
    backlog: 0,
    planned: 0,
    active: 0,
    awaiting_verification: 0,
    completed: 0,
    blocked: 0,
    released: 0,
    wont_do: 0,
  };
}

function removeMatching<T>(items: T[], matches: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined && matches(item)) items.splice(index, 1);
  }
}

type LegacyTargetedRun = Run & {
  taskId?: string;
  subtaskId?: string;
};

function normalizeSimpleIdState(state: FactoryState): HydratedFactoryState {
  const tasks: Task[] = backfillSimpleIds(
    state.tasks,
    TASK_SIMPLE_ID_PREFIX,
  ).map((task) => ({
    ...task,
    revision: normalizeRevision(task.revision),
  }));
  const subtasks: Subtask[] = backfillSimpleIds(
    state.subtasks,
    SUBTASK_SIMPLE_ID_PREFIX,
  ).map((subtask) => ({
    ...subtask,
    revision: normalizeRevision(subtask.revision),
  }));
  return {
    ...state,
    tasks,
    subtasks,
    simpleIdCounters: {
      nextSubtask: Math.max(
        state.simpleIdCounters?.nextSubtask ?? 1,
        nextSimpleIdNumber(subtasks, SUBTASK_SIMPLE_ID_PREFIX),
      ),
      nextTask: Math.max(
        state.simpleIdCounters?.nextTask ?? 1,
        nextSimpleIdNumber(tasks, TASK_SIMPLE_ID_PREFIX),
      ),
    },
  };
}

function normalizeRevision(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : 1;
}

function recordRevisionFingerprint(record: Task | Subtask): string {
  const { revision: _revision, ...withoutRevision } = record;
  return JSON.stringify(withoutRevision);
}

function bumpRevisionIfChanged(
  record: Task | Subtask,
  previousFingerprint: string,
  force = false,
): void {
  if (force || recordRevisionFingerprint(record) !== previousFingerprint) {
    record.revision = normalizeRevision(record.revision) + 1;
  }
}

function requiredSimpleId(
  record: { id: string; simpleId?: string },
  kind: "Task" | "Subtask",
): string {
  if (!record.simpleId) {
    throw new Error(`${kind} ${record.id} is missing its simple ID.`);
  }
  return record.simpleId;
}

function normalizeExecutionState(state: FactoryState | undefined): {
  runs: Run[];
  codeSessions: CodeSession[];
  associations: CodeSessionAssociation[];
} {
  const legacyRuns = (state?.runs ?? []) as LegacyTargetedRun[];
  const runs = legacyRuns.map(
    ({ taskId: _taskId, subtaskId: _subtaskId, ...run }) => run,
  );
  const codeSessions = state?.codeSessions ?? [];
  const associations =
    state?.codeSessionAssociations ??
    codeSessions.flatMap((session) => {
      const run = legacyRuns.find(
        (candidate) => candidate.id === session.runId,
      );
      if (!run?.taskId) return [];
      return [
        {
          id: `legacy-${session.id}`,
          codeSessionId: session.id,
          taskId: run.taskId,
          ...(run.subtaskId === undefined ? {} : { subtaskId: run.subtaskId }),
          createdAt: run.updatedAt,
        },
      ];
    });
  return { associations, codeSessions, runs };
}

const WORK_STATE_RANK: Record<WorkState, number> = {
  backlog: 0,
  planned: 1,
  active: 2,
  awaiting_verification: 3,
  blocked: 4,
  completed: 5,
};

const WORK_STATE_DISPLAY_ORDER: Record<WorkState, number> = {
  completed: 0,
  blocked: 1,
  awaiting_verification: 2,
  active: 3,
  planned: 4,
  backlog: 5,
};

function requireReason(reason: string | undefined, message: string): string {
  const trimmed = reason?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function normalizePullRequestUrl(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (!value?.trim()) return null;
  return parseGitHubPullRequestUrl(value).url;
}

function compareWorkStates(left: WorkState, right: WorkState): number {
  return WORK_STATE_RANK[left] - WORK_STATE_RANK[right];
}

function normalizeRepositoryIdentity(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  if (!trimmed.includes("://")) {
    const scpStyle = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
    if (scpStyle?.[1] && scpStyle[2]) {
      return `${scpStyle[1].toLowerCase().replace(/^www\./, "")}/${scpStyle[2]
        .replace(/^\/+|\/+$/g, "")
        .replace(/\.git$/i, "")}`;
    }
  }

  try {
    const url = new URL(trimmed);
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${
      url.port ? `:${url.port}` : ""
    }/${url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "")}`;
  } catch {
    return trimmed
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  }
}

export type ProjectHierarchy = {
  id: string;
  name: string;
  gitOriginUrl?: string;
  t3ProjectId?: string;
  workspaceRoot?: string;
  tasks: Array<{
    id: string;
    simpleId: string;
    name: string;
    projectId: string;
    branchName?: string;
    pullRequestUrl?: string;
    workState?: WorkState;
    stateReason?: string;
    sortOrder?: number;
    archiveState?: ArchiveState;
    subtasks: Array<{
      id: string;
      simpleId: string;
      name: string;
      taskId: string;
      description?: string;
      evidence?: string;
      pullRequestUrl?: string;
      workState?: WorkState;
      stateReason?: string;
      sortOrder?: number;
      archiveState?: ArchiveState;
    }>;
  }>;
};

export type ProjectSummary = {
  id: string;
  name: string;
  gitOriginUrl?: string;
  t3ProjectId?: string;
  workspaceRoot?: string;
};

export type PortfolioStatus = {
  totalTasks: number;
  counts: ProjectWorkCounts;
  projects: Array<{
    projectId: string;
    projectName: string;
    totalTasks: number;
    counts: ProjectWorkCounts;
  }>;
};

export type TaskDetail = {
  id: string;
  simpleId: string;
  name: string;
  projectId: string;
  branchName?: string;
  pullRequestUrl?: string;
  objective?: string;
  acceptanceCriteria: string[];
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
  dependencies: string[];
  repositoryLinks: string[];
  workState?: WorkState;
  workStateSource?: "manual" | "rollup";
  stateReason?: string;
  sortOrder?: number;
  archiveState?: ArchiveState;
  revision: number;
  trackerLinks: TrackerLink[];
};

export type ProjectMetadata = {
  id: string;
  name: string;
  gitOriginUrl?: string;
  t3ProjectId?: string;
  workspaceRoot?: string;
  trackerLinks: TrackerLink[];
};

export type ProjectDetail = ProjectHierarchy & {
  trackerLinks: TrackerLink[];
};

export type DashboardSnapshot = {
  projects: ProjectSummary[];
  portfolioStatus: PortfolioStatus;
  attention: AttentionItem[];
  projectDetail?: ProjectDetail;
  taskDetails: TaskDetail[];
  taskStatuses: TaskStatus[];
};

export class FactoryApplication {
  private readonly clock: FactoryClock;
  private readonly idGenerator: FactoryIdGenerator;
  private readonly closePersistence?: () => void;
  private readonly persist?: (state: FactoryState) => void;
  private readonly refresh?: () => FactoryState | undefined;
  private readonly refreshBeforeOperations: boolean;
  private readonly projects: Project[];
  private readonly tasks: Task[];
  private readonly subtasks: Subtask[];
  private readonly statusReports: StatusReport[];
  private readonly verifications: Verification[];
  private readonly trackerLinks: TrackerLink[];
  private readonly runs: Run[];
  private readonly codeSessions: CodeSession[];
  private readonly codeSessionAssociations: CodeSessionAssociation[];
  private readonly codeSessionObservations: CodeSessionObservation[];
  private readonly sessionEvidence: SessionEvidence[];
  private readonly reconciliationFindings: ReconciliationFinding[];
  private nextTaskSimpleId: number;
  private nextSubtaskSimpleId: number;
  private persistenceClosed = false;

  constructor({
    clock,
    close,
    idGenerator,
    persist,
    refreshBeforeOperations = true,
    refresh,
    state,
  }: FactoryApplicationOptions) {
    const normalizedState = state ? normalizeSimpleIdState(state) : undefined;
    this.clock = clock;
    this.closePersistence = close;
    this.idGenerator = idGenerator;
    this.persist = persist;
    this.refreshBeforeOperations = refreshBeforeOperations;
    this.refresh = refresh;
    this.projects = normalizedState?.projects ?? [];
    this.tasks = normalizedState?.tasks ?? [];
    this.subtasks = normalizedState?.subtasks ?? [];
    this.statusReports = normalizedState?.statusReports ?? [];
    this.verifications = normalizedState?.verifications ?? [];
    this.trackerLinks = normalizedState?.trackerLinks ?? [];
    const executionState = normalizeExecutionState(normalizedState);
    this.runs = executionState.runs;
    this.codeSessions = executionState.codeSessions;
    this.codeSessionAssociations = executionState.associations;
    this.codeSessionObservations =
      normalizedState?.codeSessionObservations ?? [];
    this.sessionEvidence = normalizedState?.sessionEvidence ?? [];
    this.reconciliationFindings = normalizedState?.reconciliationFindings ?? [];
    this.nextTaskSimpleId =
      normalizedState?.simpleIdCounters?.nextTask ??
      nextSimpleIdNumber(this.tasks, TASK_SIMPLE_ID_PREFIX);
    this.nextSubtaskSimpleId =
      normalizedState?.simpleIdCounters?.nextSubtask ??
      nextSimpleIdNumber(this.subtasks, SUBTASK_SIMPLE_ID_PREFIX);
  }

  /** Close the backing persistence handle, if this application owns one. */
  close(): void {
    if (this.persistenceClosed) return;
    this.persistenceClosed = true;
    this.closePersistence?.();
  }

  resolveTaskId(taskId: string): string {
    this.refreshFromPersistence();
    return this.requireTask(taskId).id;
  }

  resolveSubtaskId(subtaskId: string): string {
    this.refreshFromPersistence();
    return this.requireSubtask(subtaskId).id;
  }

  createProject({
    gitOriginUrl,
    name,
    t3ProjectId,
    workspaceRoot,
  }: {
    gitOriginUrl?: string;
    name: string;
    t3ProjectId?: string;
    workspaceRoot?: string;
  }): Project {
    this.refreshFromPersistence();
    const project = {
      id: this.idGenerator(),
      name,
      ...(gitOriginUrl?.trim() ? { gitOriginUrl: gitOriginUrl.trim() } : {}),
      ...(t3ProjectId?.trim() ? { t3ProjectId: t3ProjectId.trim() } : {}),
      ...(workspaceRoot?.trim() ? { workspaceRoot: workspaceRoot.trim() } : {}),
      createdAt: this.clock(),
    };

    this.projects.push(project);
    this.save();
    return project;
  }

  updateProject({
    gitOriginUrl,
    projectId,
    t3ProjectId,
    workspaceRoot,
  }: {
    gitOriginUrl: string | null;
    projectId: string;
    t3ProjectId?: string | null;
    workspaceRoot?: string | null;
  }): Project {
    this.refreshFromPersistence();
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(`Project ${projectId} does not exist.`);

    if (gitOriginUrl?.trim()) {
      project.gitOriginUrl = gitOriginUrl.trim();
    } else {
      delete project.gitOriginUrl;
    }
    if (t3ProjectId !== undefined) {
      if (t3ProjectId?.trim()) project.t3ProjectId = t3ProjectId.trim();
      else delete project.t3ProjectId;
    }
    if (workspaceRoot !== undefined) {
      if (workspaceRoot?.trim()) project.workspaceRoot = workspaceRoot.trim();
      else delete project.workspaceRoot;
    }
    this.save();
    return project;
  }

  removeProject(projectId: string): void {
    this.refreshFromPersistence();
    const projectIndex = this.projects.findIndex(
      (project) => project.id === projectId,
    );
    if (projectIndex === -1) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    const taskIds = new Set(
      this.tasks
        .filter((task) => task.projectId === projectId)
        .map((task) => task.id),
    );
    const subtaskIds = new Set(
      this.subtasks
        .filter((subtask) => taskIds.has(subtask.taskId))
        .map((subtask) => subtask.id),
    );
    const reportIds = new Set(
      this.statusReports
        .filter((report) => subtaskIds.has(report.subtaskId))
        .map((report) => report.id),
    );
    const runIds = new Set(
      this.runs
        .filter((run) => run.projectId === projectId)
        .map((run) => run.id),
    );
    const sessionIds = new Set(
      this.codeSessions
        .filter((session) => runIds.has(session.runId))
        .map((session) => session.id),
    );
    const threadIds = new Set([
      ...this.codeSessions
        .filter((session) => runIds.has(session.runId))
        .map((session) => session.externalThreadId),
      ...this.codeSessionObservations
        .filter((observation) => observation.projectId === projectId)
        .map((observation) => observation.externalThreadId),
    ]);

    this.projects.splice(projectIndex, 1);
    removeMatching(this.tasks, (task) => taskIds.has(task.id));
    removeMatching(this.subtasks, (subtask) => subtaskIds.has(subtask.id));
    removeMatching(this.statusReports, (report) => reportIds.has(report.id));
    removeMatching(this.verifications, (verification) =>
      reportIds.has(verification.reportId),
    );
    removeMatching(
      this.trackerLinks,
      (link) =>
        link.projectId === projectId ||
        (link.taskId !== undefined && taskIds.has(link.taskId)),
    );
    removeMatching(this.runs, (run) => runIds.has(run.id));
    removeMatching(this.codeSessions, (session) => sessionIds.has(session.id));
    removeMatching(this.codeSessionAssociations, (association) =>
      sessionIds.has(association.codeSessionId),
    );
    removeMatching(
      this.codeSessionObservations,
      (observation) => observation.projectId === projectId,
    );
    removeMatching(
      this.sessionEvidence,
      (evidence) =>
        evidence.provider === "t3" && threadIds.has(evidence.externalThreadId),
    );
    removeMatching(
      this.reconciliationFindings,
      (finding) => finding.projectId === projectId,
    );
    this.save();
  }

  removeTask(taskId: string): void {
    this.refreshFromPersistence();
    const resolvedTaskId = this.requireTask(taskId).id;

    const subtaskIds = new Set(
      this.subtasks
        .filter((subtask) => subtask.taskId === resolvedTaskId)
        .map((subtask) => subtask.id),
    );
    const reportIds = new Set(
      this.statusReports
        .filter((report) => subtaskIds.has(report.subtaskId))
        .map((report) => report.id),
    );

    removeMatching(this.tasks, (task) => task.id === resolvedTaskId);
    removeMatching(this.subtasks, (subtask) => subtaskIds.has(subtask.id));
    removeMatching(this.statusReports, (report) => reportIds.has(report.id));
    removeMatching(this.verifications, (verification) =>
      reportIds.has(verification.reportId),
    );
    removeMatching(this.trackerLinks, (link) => link.taskId === resolvedTaskId);
    removeMatching(
      this.codeSessionAssociations,
      (association) =>
        association.taskId === resolvedTaskId ||
        (association.subtaskId !== undefined &&
          subtaskIds.has(association.subtaskId)),
    );
    for (const finding of this.reconciliationFindings) {
      if (finding.taskId === resolvedTaskId) delete finding.taskId;
      if (
        finding.subtaskId !== undefined &&
        subtaskIds.has(finding.subtaskId)
      ) {
        delete finding.subtaskId;
      }
      finding.candidateIds = finding.candidateIds.filter(
        (candidateId) =>
          candidateId !== resolvedTaskId && !subtaskIds.has(candidateId),
      );
    }
    this.save();
  }

  removeSubtask(subtaskId: string): void {
    this.refreshFromPersistence();
    const subtask = this.requireSubtask(subtaskId);
    const resolvedSubtaskId = subtask.id;
    const task = this.tasks.find(
      (candidate) => candidate.id === subtask.taskId,
    );
    const previousTaskFingerprint = task
      ? recordRevisionFingerprint(task)
      : undefined;

    const reportIds = new Set(
      this.statusReports
        .filter((report) => report.subtaskId === resolvedSubtaskId)
        .map((report) => report.id),
    );

    removeMatching(
      this.subtasks,
      (candidate) => candidate.id === resolvedSubtaskId,
    );
    removeMatching(this.statusReports, (report) => reportIds.has(report.id));
    removeMatching(this.verifications, (verification) =>
      reportIds.has(verification.reportId),
    );
    removeMatching(
      this.codeSessionAssociations,
      (association) => association.subtaskId === resolvedSubtaskId,
    );
    for (const finding of this.reconciliationFindings) {
      if (finding.subtaskId === resolvedSubtaskId) delete finding.subtaskId;
      finding.candidateIds = finding.candidateIds.filter(
        (candidateId) => candidateId !== resolvedSubtaskId,
      );
    }
    this.reconcileAutomaticTaskRollup(subtask.taskId);
    if (task && previousTaskFingerprint !== undefined) {
      bumpRevisionIfChanged(task, previousTaskFingerprint);
    }
    this.save();
  }

  createTask({
    branchName,
    name,
    pullRequestUrl,
    projectId,
    objective,
    acceptanceCriteria = [],
    priority,
    owner,
    dependencies = [],
    repositoryLinks = [],
    stateReason,
    workState = "planned",
  }: {
    branchName?: string;
    name: string;
    pullRequestUrl?: string | null;
    projectId: string;
    objective?: string;
    acceptanceCriteria?: string[];
    priority?: "low" | "medium" | "high" | "urgent";
    owner?: string;
    dependencies?: string[];
    repositoryLinks?: string[];
    stateReason?: string;
    workState?: WorkState;
  }): Task {
    this.refreshFromPersistence();
    if (!this.projects.some((project) => project.id === projectId)) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    if (workState === "completed") {
      throw new Error(
        "A Task cannot be created completed; complete its active Subtasks first.",
      );
    }
    const normalizedReason =
      workState === "blocked" || workState === "awaiting_verification"
        ? requireReason(stateReason, `Task ${workState} requires a reason.`)
        : undefined;

    const normalizedPullRequestUrl = normalizePullRequestUrl(pullRequestUrl);
    const task = {
      id: this.idGenerator(),
      simpleId: `${TASK_SIMPLE_ID_PREFIX}${this.nextTaskSimpleId}`,
      name,
      projectId,
      ...(branchName?.trim() ? { branchName: branchName.trim() } : {}),
      ...(normalizedPullRequestUrl
        ? { pullRequestUrl: normalizedPullRequestUrl }
        : {}),
      objective,
      acceptanceCriteria,
      priority,
      owner,
      dependencies,
      repositoryLinks,
      workState,
      ...(normalizedReason ? { stateReason: normalizedReason } : {}),
      sortOrder: this.nextTaskSortOrder(projectId, workState),
      revision: 1,
      createdAt: this.clock(),
    };

    this.nextTaskSimpleId += 1;
    this.tasks.push(task);
    this.save();
    return task;
  }

  updateTask({
    acceptanceCriteria,
    branchName,
    name,
    objective,
    pullRequestUrl,
    stateReason,
    taskId,
    workState,
    expectedRevision,
  }: {
    acceptanceCriteria?: string[];
    branchName?: string | null;
    name?: string;
    objective?: string | null;
    pullRequestUrl?: string | null;
    stateReason?: string | null;
    taskId: string;
    workState?: WorkState;
    expectedRevision?: number;
  }): Task {
    this.refreshFromPersistence();
    const task = this.requireTask(taskId);
    const currentRevision = normalizeRevision(task.revision);
    if (
      expectedRevision !== undefined &&
      currentRevision !== expectedRevision
    ) {
      throw new FactoryConflictError(
        "Task",
        task.id,
        currentRevision,
        expectedRevision,
      );
    }
    const previousFingerprint = recordRevisionFingerprint(task);

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Task title must not be empty.");
      task.name = trimmedName;
    }
    if (objective !== undefined) {
      if (objective?.trim()) {
        task.objective = objective.trim();
      } else {
        delete task.objective;
      }
    }
    if (acceptanceCriteria !== undefined) {
      task.acceptanceCriteria = acceptanceCriteria;
    }
    if (branchName !== undefined) {
      if (branchName?.trim()) {
        task.branchName = branchName.trim();
      } else {
        delete task.branchName;
      }
    }
    if (pullRequestUrl !== undefined) {
      const normalizedPullRequestUrl = normalizePullRequestUrl(pullRequestUrl);
      if (normalizedPullRequestUrl) {
        task.pullRequestUrl = normalizedPullRequestUrl;
      } else {
        delete task.pullRequestUrl;
      }
    }

    if (workState !== undefined) {
      if (workState === "completed" && !this.taskWouldBeCompleted(task.id)) {
        throw new Error(
          "A Task cannot be completed until every non-archived Subtask is complete and accepted.",
        );
      }
      const normalizedReason =
        workState === "blocked" || workState === "awaiting_verification"
          ? requireReason(
              stateReason !== undefined
                ? (stateReason ?? undefined)
                : this.getEffectiveTaskWorkState(task) === workState
                  ? task.stateReason
                  : undefined,
              `Task ${workState} requires a reason.`,
            )
          : undefined;
      const previousState = this.getEffectiveTaskWorkState(task);
      task.workState = workState;
      task.workStateSource = "manual";
      if (normalizedReason) task.stateReason = normalizedReason;
      else delete task.stateReason;
      if (previousState !== workState) {
        task.sortOrder = this.nextTaskSortOrder(
          task.projectId,
          workState,
          task.id,
        );
      }
    } else if (stateReason !== undefined) {
      const currentState = this.getEffectiveTaskWorkState(task);
      if (
        currentState !== "blocked" &&
        currentState !== "awaiting_verification"
      ) {
        throw new Error(
          "A Task state reason can only be set while the Task is blocked or awaiting verification.",
        );
      }
      task.stateReason = requireReason(
        stateReason ?? undefined,
        `Task ${currentState} requires a reason.`,
      );
    }
    bumpRevisionIfChanged(task, previousFingerprint);
    this.save();
    return task;
  }

  setTaskWorkState({
    expectedRevision,
    reason,
    taskId,
    workState,
  }: {
    expectedRevision?: number;
    reason?: string;
    taskId: string;
    workState: WorkState;
  }): Task {
    return this.updateTask({
      expectedRevision,
      stateReason: reason,
      taskId,
      workState,
    });
  }

  resumeTaskRollup(taskId: string): Task {
    this.refreshFromPersistence();
    const task = this.requireTask(taskId);
    const previousFingerprint = recordRevisionFingerprint(task);
    if (task.archiveState)
      throw new Error("Restore the Task before changing its work state.");
    const rollup = this.getTaskRollup(task.id);
    this.setTaskRollupState(task, rollup.state, rollup.reason);
    bumpRevisionIfChanged(task, previousFingerprint);
    this.save();
    return task;
  }

  createSubtask({
    description,
    name,
    pullRequestUrl,
    taskId,
  }: {
    description?: string;
    name: string;
    pullRequestUrl?: string | null;
    taskId: string;
  }): Subtask {
    this.refreshFromPersistence();
    const parentTask = this.requireTask(taskId);
    const previousTaskFingerprint = recordRevisionFingerprint(parentTask);
    const resolvedTaskId = parentTask.id;

    const normalizedPullRequestUrl = normalizePullRequestUrl(pullRequestUrl);
    const subtask = {
      id: this.idGenerator(),
      simpleId: `${SUBTASK_SIMPLE_ID_PREFIX}${this.nextSubtaskSimpleId}`,
      name,
      taskId: resolvedTaskId,
      ...(description?.trim() ? { description: description.trim() } : {}),
      ...(normalizedPullRequestUrl
        ? { pullRequestUrl: normalizedPullRequestUrl }
        : {}),
      sortOrder: this.nextSubtaskSortOrder(resolvedTaskId, "planned"),
      revision: 1,
      createdAt: this.clock(),
    };

    this.nextSubtaskSimpleId += 1;
    this.subtasks.push(subtask);
    this.reconcileAutomaticTaskRollup(resolvedTaskId);
    bumpRevisionIfChanged(parentTask, previousTaskFingerprint);
    this.save();
    return subtask;
  }

  updateSubtask({
    description,
    evidence,
    name,
    pullRequestUrl,
    subtaskId,
    expectedRevision,
  }: {
    description?: string | null;
    evidence?: string | null;
    name?: string;
    pullRequestUrl?: string | null;
    subtaskId: string;
    expectedRevision?: number;
  }): Subtask {
    this.refreshFromPersistence();
    const subtask = this.requireSubtask(subtaskId);
    const currentRevision = normalizeRevision(subtask.revision);
    if (
      expectedRevision !== undefined &&
      currentRevision !== expectedRevision
    ) {
      throw new FactoryConflictError(
        "Subtask",
        subtask.id,
        currentRevision,
        expectedRevision,
      );
    }
    const previousFingerprint = recordRevisionFingerprint(subtask);

    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error("Subtask title must not be empty.");
      subtask.name = trimmedName;
    }
    if (description !== undefined) {
      if (description?.trim()) {
        subtask.description = description.trim();
      } else {
        delete subtask.description;
      }
    }
    if (evidence !== undefined) {
      // Keep an empty value as an explicit override so legacy reports with
      // evidence do not reappear after the evidence is cleared in the editor.
      subtask.evidence = evidence?.trim() ?? "";
    }
    if (pullRequestUrl !== undefined) {
      const normalizedPullRequestUrl = normalizePullRequestUrl(pullRequestUrl);
      if (normalizedPullRequestUrl) {
        subtask.pullRequestUrl = normalizedPullRequestUrl;
      } else {
        delete subtask.pullRequestUrl;
      }
    }
    bumpRevisionIfChanged(subtask, previousFingerprint);
    this.save();
    return subtask;
  }

  archiveTask(taskId: string, archiveState: ArchiveState): void {
    this.refreshFromPersistence();
    const task = this.requireTask(taskId);
    const previousFingerprint = recordRevisionFingerprint(task);

    task.archiveState = archiveState;
    bumpRevisionIfChanged(task, previousFingerprint);
    this.save();
  }

  restoreTask(taskId: string): void {
    this.refreshFromPersistence();
    const task = this.requireTask(taskId);
    const previousFingerprint = recordRevisionFingerprint(task);

    delete task.archiveState;
    this.reconcileAutomaticTaskRollup(task.id);
    bumpRevisionIfChanged(task, previousFingerprint);
    this.save();
  }

  archiveSubtask(subtaskId: string, archiveState: ArchiveState): void {
    this.refreshFromPersistence();
    const subtask = this.requireSubtask(subtaskId);
    const previousSubtaskFingerprint = recordRevisionFingerprint(subtask);
    const task = this.tasks.find(
      (candidate) => candidate.id === subtask.taskId,
    );
    const previousTaskFingerprint = task
      ? recordRevisionFingerprint(task)
      : undefined;

    subtask.archiveState = archiveState;
    this.reconcileAutomaticTaskRollup(subtask.taskId);
    bumpRevisionIfChanged(subtask, previousSubtaskFingerprint);
    if (task && previousTaskFingerprint !== undefined) {
      bumpRevisionIfChanged(task, previousTaskFingerprint);
    }
    this.save();
  }

  restoreSubtask(subtaskId: string): void {
    this.refreshFromPersistence();
    const subtask = this.requireSubtask(subtaskId);
    const previousSubtaskFingerprint = recordRevisionFingerprint(subtask);
    const task = this.tasks.find(
      (candidate) => candidate.id === subtask.taskId,
    );
    const previousTaskFingerprint = task
      ? recordRevisionFingerprint(task)
      : undefined;

    delete subtask.archiveState;
    this.reconcileAutomaticTaskRollup(subtask.taskId);
    bumpRevisionIfChanged(subtask, previousSubtaskFingerprint);
    if (task && previousTaskFingerprint !== undefined) {
      bumpRevisionIfChanged(task, previousTaskFingerprint);
    }
    this.save();
  }

  reportSubtaskStatus({
    evidence,
    machineId,
    reason,
    reporter,
    reportedState,
    sessionRef,
    subtaskId,
  }: {
    evidence?: string;
    machineId?: string;
    reason?: string;
    reporter: string;
    reportedState: ReportedState;
    sessionRef?: StatusReport["sessionRef"];
    subtaskId: string;
  }): StatusReport {
    this.refreshFromPersistence();
    const subtask = this.requireSubtask(subtaskId);
    const task = this.tasks.find(
      (candidate) => candidate.id === subtask.taskId,
    );
    const previousSubtaskFingerprint = recordRevisionFingerprint(subtask);
    const previousTaskFingerprint = task
      ? recordRevisionFingerprint(task)
      : undefined;

    const normalizedReason =
      reportedState === "blocked" || reportedState === "complete"
        ? requireReason(
            reason,
            `Subtask reports for ${reportedState} require a reason.`,
          )
        : reason?.trim() || undefined;
    const previousState = this.getSubtaskEffectiveWorkState(subtask);

    const currentEvidence = evidence?.trim() || undefined;
    // The report remains immutable history; the subtask stores the editable
    // current evidence shown by the dashboard.
    subtask.evidence = currentEvidence ?? "";

    const report = {
      id: this.idGenerator(),
      subtaskId: subtask.id,
      reportedState,
      reporter,
      evidence: currentEvidence,
      ...(normalizedReason ? { reason: normalizedReason } : {}),
      ...(machineId ? { machineId } : {}),
      ...(sessionRef ? { sessionRef: { ...sessionRef } } : {}),
      createdAt: this.clock(),
    };

    this.statusReports.push(report);
    const nextState = this.getSubtaskEffectiveWorkState(subtask);
    this.moveSubtaskToStateIfChanged(subtask, previousState);
    this.promoteParentTask(subtask.taskId, { nextState, previousState });
    bumpRevisionIfChanged(
      subtask,
      previousSubtaskFingerprint,
      nextState !== previousState,
    );
    if (task && previousTaskFingerprint !== undefined) {
      bumpRevisionIfChanged(task, previousTaskFingerprint);
    }
    this.save();
    return report;
  }

  verifyStatusReport({
    decision,
    reason,
    reportId,
    verifier,
  }: {
    decision: VerificationDecision;
    reason?: string;
    reportId: string;
    verifier: string;
  }): void {
    this.refreshFromPersistence();
    const report = this.statusReports.find(
      (candidate) => candidate.id === reportId,
    );
    if (!report) {
      throw new Error(`Status Report ${reportId} does not exist.`);
    }

    const subtask = this.subtasks.find(
      (candidate) => candidate.id === report.subtaskId,
    );
    if (!subtask) {
      throw new Error(`Subtask ${report.subtaskId} does not exist.`);
    }
    const task = this.tasks.find(
      (candidate) => candidate.id === subtask.taskId,
    );
    const previousSubtaskFingerprint = recordRevisionFingerprint(subtask);
    const previousTaskFingerprint = task
      ? recordRevisionFingerprint(task)
      : undefined;
    const previousState = this.getSubtaskEffectiveWorkState(subtask);
    const normalizedReason =
      decision === "rejected" || decision === "deferred"
        ? requireReason(
            reason,
            `Verification decisions of ${decision} require a reason.`,
          )
        : reason?.trim() || undefined;

    this.verifications.push({
      id: this.idGenerator(),
      reportId,
      decision,
      verifier,
      ...(normalizedReason ? { reason: normalizedReason } : {}),
      createdAt: this.clock(),
    });
    const nextState = this.getSubtaskEffectiveWorkState(subtask);
    this.moveSubtaskToStateIfChanged(subtask, previousState);
    this.promoteParentTask(subtask.taskId, { nextState, previousState });
    bumpRevisionIfChanged(
      subtask,
      previousSubtaskFingerprint,
      nextState !== previousState,
    );
    if (task && previousTaskFingerprint !== undefined) {
      bumpRevisionIfChanged(task, previousTaskFingerprint);
    }
    this.save();
  }

  getTaskStatus(taskId: string): TaskStatus {
    this.refreshFromPersistence();
    return this.getTaskStatusFromCurrentState(taskId);
  }

  private getTaskStatusFromCurrentState(taskId: string): TaskStatus {
    const task = this.requireTask(taskId);

    const subtasks: TaskStatus["subtasks"] = this.subtasks
      .filter((subtask) => subtask.taskId === task.id)
      .sort((left, right) => this.compareSubtasks(left, right))
      .map((subtask) => {
        const report = this.getCurrentStatusReport(subtask.id);

        if (!report) {
          return {
            id: subtask.id,
            subtaskId: subtask.id,
            subtaskSimpleId: requiredSimpleId(subtask, "Subtask"),
            ...(subtask.archiveState
              ? { archiveState: subtask.archiveState }
              : {}),
            ...(subtask.evidence ? { evidence: subtask.evidence } : {}),
            effectiveState: "planned" as const,
            ...(subtask.sortOrder !== undefined
              ? { sortOrder: subtask.sortOrder }
              : {}),
            verificationState: "unreported" as const,
          };
        }

        const currentEvidence =
          subtask.evidence !== undefined ? subtask.evidence : report.evidence;
        const verification = this.getCurrentVerification(report.id);
        const effectiveState = this.getSubtaskEffectiveWorkState(subtask);
        const reason =
          verification?.decision === "rejected" ||
          verification?.decision === "deferred"
            ? (verification.reason ?? report.reason)
            : report.reason;

        return {
          ...(subtask.archiveState
            ? { archiveState: subtask.archiveState }
            : {}),
          id: report.id,
          subtaskId: subtask.id,
          subtaskSimpleId: requiredSimpleId(subtask, "Subtask"),
          reportId: report.id,
          reportedState: report.reportedState,
          effectiveState,
          ...(subtask.sortOrder !== undefined
            ? { sortOrder: subtask.sortOrder }
            : {}),
          ...(currentEvidence ? { evidence: currentEvidence } : {}),
          ...(reason ? { reason } : {}),
          reporter: report.reporter,
          verificationState:
            verification?.decision ?? ("awaiting_verification" as const),
        };
      });

    const activeSubtasks = subtasks.filter(
      (subtask) => subtask.archiveState === undefined,
    );

    const taskCompleted =
      activeSubtasks.length > 0 &&
      activeSubtasks.every(
        (subtask) =>
          subtask.reportedState === "complete" &&
          subtask.verificationState === "accepted",
      );

    const taskState = task.archiveState ?? this.getEffectiveTaskWorkState(task);
    const stateReason =
      taskState === "blocked" || taskState === "awaiting_verification"
        ? ((task.workStateSource === "rollup"
            ? this.getTaskRollup(task.id).reason
            : task.stateReason) ??
          activeSubtasks.find((subtask) => subtask.effectiveState === taskState)
            ?.reason)
        : undefined;

    return {
      taskId: task.id,
      taskSimpleId: requiredSimpleId(task, "Task"),
      taskCompleted,
      ...(task.archiveState ? { archiveState: task.archiveState } : {}),
      taskState,
      ...(stateReason ? { stateReason } : {}),
      subtasks,
    };
  }

  getProjectStatus(projectId: string): {
    projectId: string;
    projectName: string;
    totalTasks: number;
    counts: ProjectWorkCounts;
  } {
    this.refreshFromPersistence();
    return this.getProjectStatusFromCurrentState(projectId);
  }

  private getProjectStatusFromCurrentState(projectId: string): {
    projectId: string;
    projectName: string;
    totalTasks: number;
    counts: ProjectWorkCounts;
  } {
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    const counts = emptyProjectWorkCounts();
    const tasks = this.tasks.filter((task) => task.projectId === projectId);
    for (const task of tasks) {
      counts[this.getTaskStatusFromCurrentState(task.id).taskState] += 1;
    }

    return {
      projectId,
      projectName: project.name,
      totalTasks: tasks.length,
      counts,
    };
  }

  getPortfolioStatus(): PortfolioStatus {
    this.refreshFromPersistence();
    return this.getPortfolioStatusFromCurrentState();
  }

  private getPortfolioStatusFromCurrentState(): PortfolioStatus {
    const counts = emptyProjectWorkCounts();
    const projects = this.projects.map((project) => {
      const status = this.getProjectStatusFromCurrentState(project.id);
      for (const state of Object.keys(counts) as ProjectWorkState[]) {
        counts[state] += status.counts[state];
      }
      return status;
    });

    return {
      totalTasks: projects.reduce(
        (total, project) => total + project.totalTasks,
        0,
      ),
      counts,
      projects,
    };
  }

  getAttentionProjection(): AttentionItem[] {
    this.refreshFromPersistence();
    return this.getAttentionProjectionFromCurrentState();
  }

  private getAttentionProjectionFromCurrentState(): AttentionItem[] {
    const stateOrder: Record<AttentionItem["state"], number> = {
      blocked: 0,
      awaiting_verification: 1,
      active: 2,
      planned: 3,
      backlog: 4,
    };

    return this.tasks
      .flatMap((task) => {
        const state = this.getTaskStatusFromCurrentState(task.id).taskState;
        if (
          state === "completed" ||
          state === "released" ||
          state === "wont_do"
        ) {
          return [];
        }

        const project = this.projects.find(
          (candidate) => candidate.id === task.projectId,
        );
        if (!project) return [];

        return [
          {
            projectId: project.id,
            projectName: project.name,
            taskId: task.id,
            taskSimpleId: requiredSimpleId(task, "Task"),
            taskName: task.name,
            state,
            ...(task.priority ? { priority: task.priority } : {}),
            ...(task.owner ? { owner: task.owner } : {}),
          },
        ];
      })
      .sort(
        (left, right) =>
          stateOrder[left.state] - stateOrder[right.state] ||
          left.projectName.localeCompare(right.projectName) ||
          left.taskName.localeCompare(right.taskName),
      );
  }

  getSubtaskReportHistory(subtaskId: string): StatusReport[] {
    this.refreshFromPersistence();
    const resolvedSubtaskId = this.requireSubtask(subtaskId).id;

    return this.statusReports.filter(
      (report) => report.subtaskId === resolvedSubtaskId,
    );
  }

  getProjectIdForTask(taskId: string): string {
    this.refreshFromPersistence();
    return this.requireTask(taskId).projectId;
  }

  getProjectIdForSubtask(subtaskId: string): string {
    this.refreshFromPersistence();
    const subtask = this.requireSubtask(subtaskId);
    return this.requireTask(subtask.taskId).projectId;
  }

  getProjectIdForThread(externalThreadId: string): string {
    this.refreshFromPersistence();
    return this.requireT3Observation("t3", externalThreadId).projectId;
  }

  getStatusReportProjectId(reportId: string): string {
    this.refreshFromPersistence();
    const report = this.statusReports.find(
      (candidate) => candidate.id === reportId,
    );
    if (!report) throw new Error(`Status Report ${reportId} does not exist.`);
    const subtask = this.requireSubtask(report.subtaskId);
    return this.requireTask(subtask.taskId).projectId;
  }

  getSubtaskVerificationHistory(subtaskId: string): Verification[] {
    this.refreshFromPersistence();
    const resolvedSubtaskId = this.requireSubtask(subtaskId).id;

    const reportIds = new Set(
      this.statusReports
        .filter((report) => report.subtaskId === resolvedSubtaskId)
        .map((report) => report.id),
    );
    return this.verifications.filter((verification) =>
      reportIds.has(verification.reportId),
    );
  }

  getProjectHierarchy(projectId: string): ProjectHierarchy {
    this.refreshFromPersistence();
    return this.getProjectHierarchyFromCurrentState(projectId);
  }

  private getProjectHierarchyFromCurrentState(
    projectId: string,
  ): ProjectHierarchy {
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );

    if (!project) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    return {
      id: project.id,
      name: project.name,
      ...(project.gitOriginUrl ? { gitOriginUrl: project.gitOriginUrl } : {}),
      ...(project.t3ProjectId ? { t3ProjectId: project.t3ProjectId } : {}),
      ...(project.workspaceRoot
        ? { workspaceRoot: project.workspaceRoot }
        : {}),
      tasks: this.tasks
        .filter((task) => task.projectId === project.id)
        .sort((left, right) => this.compareTasks(left, right))
        .map((task) => {
          const taskState = this.getEffectiveTaskWorkState(task);
          const taskStateReason = this.getTaskStateReason(task, taskState);
          return {
            id: task.id,
            simpleId: requiredSimpleId(task, "Task"),
            name: task.name,
            projectId: project.id,
            ...(task.branchName ? { branchName: task.branchName } : {}),
            ...(task.pullRequestUrl
              ? { pullRequestUrl: task.pullRequestUrl }
              : {}),
            workState: taskState,
            ...(taskStateReason ? { stateReason: taskStateReason } : {}),
            ...(task.sortOrder !== undefined
              ? { sortOrder: task.sortOrder }
              : {}),
            ...(task.archiveState ? { archiveState: task.archiveState } : {}),
            subtasks: this.subtasks
              .filter((subtask) => subtask.taskId === task.id)
              .sort((left, right) => this.compareSubtasks(left, right))
              .map((subtask) => {
                const subtaskStateReason = this.getSubtaskStateReason(subtask);
                return {
                  id: subtask.id,
                  simpleId: requiredSimpleId(subtask, "Subtask"),
                  name: subtask.name,
                  taskId: subtask.taskId,
                  ...(subtask.pullRequestUrl
                    ? { pullRequestUrl: subtask.pullRequestUrl }
                    : {}),
                  workState: this.getSubtaskEffectiveWorkState(subtask),
                  ...(subtaskStateReason
                    ? { stateReason: subtaskStateReason }
                    : {}),
                  ...(subtask.sortOrder !== undefined
                    ? { sortOrder: subtask.sortOrder }
                    : {}),
                  ...(subtask.archiveState
                    ? { archiveState: subtask.archiveState }
                    : {}),
                  ...(subtask.description !== undefined
                    ? { description: subtask.description }
                    : {}),
                  ...(subtask.evidence ? { evidence: subtask.evidence } : {}),
                };
              }),
          };
        }),
    };
  }

  getDashboardSnapshot(projectId?: string): DashboardSnapshot {
    this.refreshFromPersistence();

    const projectDetail =
      projectId === undefined
        ? undefined
        : {
            ...this.getProjectHierarchyFromCurrentState(projectId),
            trackerLinks:
              this.getProjectDetailFromCurrentState(projectId).trackerLinks,
          };

    return {
      attention: this.getAttentionProjectionFromCurrentState(),
      ...(projectDetail ? { projectDetail } : {}),
      portfolioStatus: this.getPortfolioStatusFromCurrentState(),
      projects: this.listProjectsFromCurrentState(),
      taskDetails: projectDetail
        ? projectDetail.tasks.map((task) =>
            this.getTaskDetailFromCurrentState(task.id),
          )
        : [],
      taskStatuses: projectDetail
        ? projectDetail.tasks.map((task) =>
            this.getTaskStatusFromCurrentState(task.id),
          )
        : [],
    };
  }

  listProjects(): ProjectSummary[] {
    this.refreshFromPersistence();
    return this.listProjectsFromCurrentState();
  }

  private listProjectsFromCurrentState(): ProjectSummary[] {
    return this.projects.map((project) => ({
      id: project.id,
      name: project.name,
      ...(project.gitOriginUrl ? { gitOriginUrl: project.gitOriginUrl } : {}),
      ...(project.t3ProjectId ? { t3ProjectId: project.t3ProjectId } : {}),
      ...(project.workspaceRoot
        ? { workspaceRoot: project.workspaceRoot }
        : {}),
    }));
  }

  /**
   * Persist the latest bounded observation for each external T3 thread. The
   * observation is intentionally independent from CodeSession: a thread can
   * be visible before a Factory Run is explicitly linked to it.
   */
  refreshT3Observations({
    evidence = [],
    observations,
    projectUnresolved = [],
    refreshedProjects = [],
    sourceUnavailable = [],
  }: {
    evidence?: SessionEvidenceInput[];
    observations: CodeSessionObservationInput[];
    projectUnresolved?: Array<{
      projectId: string;
      observedAt: Date;
      explanation: string;
    }>;
    refreshedProjects?: T3ObservationRefreshBoundary[];
    sourceUnavailable?: Array<{
      projectId: string;
      observedAt: Date;
      explanation: string;
    }>;
  }): {
    observations: CodeSessionObservation[];
    findings: ReconciliationFinding[];
  } {
    this.refreshFromPersistence();
    const projectIds = new Set<string>();

    for (const boundary of refreshedProjects) {
      this.requireProject(boundary.projectId);
      if (!boundary.sourceStream.trim()) {
        throw new Error("T3 refresh boundary source stream must not be empty.");
      }
      if (
        !Number.isSafeInteger(boundary.sourceSequence) ||
        boundary.sourceSequence < 0
      ) {
        throw new Error(
          "T3 refresh boundary source sequence must be a non-negative integer.",
        );
      }
      if (
        Number.isNaN(boundary.observedAt.getTime()) ||
        Number.isNaN(boundary.sourceUpdatedAt.getTime())
      ) {
        throw new Error("T3 refresh boundary timestamps must be valid dates.");
      }
      projectIds.add(boundary.projectId);
    }

    for (const observation of observations) {
      this.requireProject(observation.projectId);
      projectIds.add(observation.projectId);

      const existing = this.codeSessionObservations.find(
        (candidate) =>
          candidate.provider === observation.provider &&
          candidate.externalThreadId === observation.externalThreadId,
      );
      if (existing && existing.projectId !== observation.projectId) {
        throw new Error(
          `T3 thread ${observation.externalThreadId} is already associated with another Factory Project.`,
        );
      }
      const project = this.requireProject(observation.projectId);
      if (
        project.t3ProjectId !== undefined &&
        project.t3ProjectId !== observation.externalProjectId
      ) {
        throw new Error(
          `T3 Project ${observation.externalProjectId} does not match Factory Project ${project.id}.`,
        );
      }
      if (
        project.workspaceRoot !== undefined &&
        !sameWorkspaceRoot(project.workspaceRoot, observation.workspaceRoot)
      ) {
        throw new Error(
          `T3 workspace does not match Factory Project ${project.id}.`,
        );
      }
      if (existing && !this.isNewerObservation(observation, existing)) {
        existing.sourceCurrent = true;
        const linkedSession = this.codeSessions.find(
          (candidate) =>
            candidate.provider === observation.provider &&
            candidate.externalThreadId === observation.externalThreadId,
        );
        if (linkedSession) linkedSession.sourceCurrent = true;
        continue;
      }

      if (existing) {
        Object.assign(existing, observation);
        existing.sourceCurrent = true;
      } else {
        this.codeSessionObservations.push({
          ...observation,
          id: this.idGenerator(),
          sourceCurrent: true,
        });
      }

      const linkedSession = this.codeSessions.find(
        (candidate) =>
          candidate.provider === observation.provider &&
          candidate.externalThreadId === observation.externalThreadId,
      );
      if (linkedSession)
        this.applyObservationToCodeSession(linkedSession, {
          ...observation,
          sourceCurrent: true,
        });
    }

    for (const source of sourceUnavailable) projectIds.add(source.projectId);
    for (const project of projectUnresolved) projectIds.add(project.projectId);

    for (const evidenceInput of evidence) {
      const evidence = this.appendSessionEvidence(evidenceInput);
      const observation = this.requireT3Observation(
        evidence.provider,
        evidence.externalThreadId,
      );
      projectIds.add(observation.projectId);
    }

    for (const boundary of refreshedProjects) {
      const incomingThreadIds = new Set(
        observations
          .filter((observation) => observation.projectId === boundary.projectId)
          .map(
            (observation) =>
              `${observation.provider}:${observation.externalThreadId}`,
          ),
      );
      for (const observation of this.codeSessionObservations) {
        if (observation.projectId !== boundary.projectId) continue;
        if (
          incomingThreadIds.has(
            `${observation.provider}:${observation.externalThreadId}`,
          )
        ) {
          observation.sourceCurrent = true;
          continue;
        }
        if (this.boundaryCoversObservation(boundary, observation)) {
          observation.sourceCurrent = false;
          const linkedSession = this.codeSessions.find(
            (candidate) =>
              candidate.provider === observation.provider &&
              candidate.externalThreadId === observation.externalThreadId,
          );
          if (linkedSession) linkedSession.sourceCurrent = false;
        }
      }
    }

    if (
      observations.length > 0 ||
      evidence.length > 0 ||
      refreshedProjects.length > 0 ||
      sourceUnavailable.length > 0 ||
      projectUnresolved.length > 0
    )
      this.save();

    const findings: ReconciliationFinding[] = [];
    for (const projectId of projectIds) {
      findings.push(
        ...this.reconcileT3Project({
          projectId,
          projectUnresolved: projectUnresolved.filter(
            (project) => project.projectId === projectId,
          ),
          sourceUnavailable: sourceUnavailable.filter(
            (source) => source.projectId === projectId,
          ),
        }),
      );
    }

    return {
      findings,
      observations:
        observations.length > 0
          ? observations
              .map((observation) =>
                this.codeSessionObservations.find(
                  (candidate) =>
                    candidate.provider === observation.provider &&
                    candidate.externalThreadId === observation.externalThreadId,
                ),
              )
              .filter(
                (observation): observation is CodeSessionObservation =>
                  observation !== undefined,
              )
          : [],
    };
  }

  /**
   * Explicitly associate a T3 thread with Factory work. This is the only
   * operation in this integration that creates a Run or CodeSession link.
   */
  linkT3Thread(input: LinkT3ThreadInput): {
    run: Run;
    codeSession: CodeSession;
    association: CodeSessionAssociation;
  } {
    this.refreshFromPersistence();
    this.refreshT3Observations({ observations: [input.observation] });
    const observation = this.requireT3Observation(
      input.observation.provider,
      input.observation.externalThreadId,
    );
    if (
      observation.projectId !== input.observation.projectId ||
      observation.externalProjectId !== input.observation.externalProjectId
    ) {
      throw new Error(
        "T3 thread observation does not match its stored Project.",
      );
    }

    const target = this.resolveT3LinkTarget({
      projectId: observation.projectId,
      subtaskId: input.subtaskId,
      taskId: input.taskId,
    });
    let codeSession = this.codeSessions.find(
      (candidate) =>
        candidate.provider === observation.provider &&
        candidate.externalThreadId === observation.externalThreadId,
    );
    let run: Run;
    if (codeSession) {
      run = this.requireRun(codeSession.runId);
      if (run.projectId !== observation.projectId) {
        throw new Error("T3 thread Run belongs to another Factory Project.");
      }
      this.applyObservationToCodeSession(codeSession, observation);
      run.updatedAt = this.clock();
    } else {
      const now = this.clock();
      run = {
        id: this.idGenerator(),
        projectId: observation.projectId,
        state: "observed",
        createdAt: now,
        updatedAt: now,
      };
      const { projectId: _projectId, ...sessionObservation } = observation;
      codeSession = {
        ...sessionObservation,
        id: this.idGenerator(),
        runId: run.id,
      };
      this.runs.push(run);
      this.codeSessions.push(codeSession);
    }

    const existingAssociation = this.codeSessionAssociations.find(
      (candidate) =>
        candidate.codeSessionId === codeSession.id &&
        candidate.taskId === target.taskId &&
        candidate.subtaskId === target.subtaskId,
    );
    const association =
      existingAssociation ??
      ({
        id: this.idGenerator(),
        codeSessionId: codeSession.id,
        taskId: target.taskId,
        ...(target.subtaskId === undefined
          ? {}
          : { subtaskId: target.subtaskId }),
        createdAt: this.clock(),
      } satisfies CodeSessionAssociation);
    if (!existingAssociation) this.codeSessionAssociations.push(association);
    this.save();
    this.reconcileT3Project({ projectId: observation.projectId });
    return { association, codeSession, run };
  }

  /**
   * Clear only the Factory target of a linked session. The Run, CodeSession,
   * current observation, and evidence remain available for provenance.
   */
  unlinkT3Thread({
    associationId,
    externalThreadId,
    provider = "t3",
  }: {
    associationId?: string;
    externalThreadId: string;
    provider?: "t3";
  }): {
    association: CodeSessionAssociation;
    codeSession: CodeSession;
    run: Run;
  } {
    this.refreshFromPersistence();
    const codeSession = this.codeSessions.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.externalThreadId === externalThreadId,
    );
    if (!codeSession) {
      throw new Error(`T3 thread ${externalThreadId} is not linked.`);
    }
    const run = this.requireRun(codeSession.runId);
    const associations = this.codeSessionAssociations.filter(
      (candidate) => candidate.codeSessionId === codeSession.id,
    );
    if (associations.length === 0) {
      throw new Error(`T3 thread ${externalThreadId} is not linked.`);
    }
    if (associationId === undefined && associations.length > 1) {
      throw new Error(
        `T3 thread ${externalThreadId} has multiple associations; provide an association ID.`,
      );
    }
    const association = associationId
      ? associations.find((candidate) => candidate.id === associationId)
      : associations[0];
    if (!association) {
      throw new Error(
        `T3 association ${associationId} does not belong to thread ${externalThreadId}.`,
      );
    }
    removeMatching(
      this.codeSessionAssociations,
      (candidate) => candidate.id === association.id,
    );
    run.updatedAt = this.clock();
    this.save();
    this.reconcileT3Project({ projectId: run.projectId });
    return { association, codeSession, run };
  }

  listProjectT3Activity(projectId: string): ProjectT3Activity[] {
    this.refreshFromPersistence();
    this.requireProject(projectId);
    return this.codeSessionObservations
      .filter(
        (observation) =>
          observation.projectId === projectId &&
          observation.sourceCurrent !== false,
      )
      .map((observation) => {
        const codeSession = this.codeSessions.find(
          (candidate) =>
            candidate.provider === observation.provider &&
            candidate.externalThreadId === observation.externalThreadId,
        );
        const run = codeSession
          ? this.runs.find((candidate) => candidate.id === codeSession.runId)
          : undefined;
        return {
          associations: codeSession
            ? this.codeSessionAssociations.filter(
                (association) => association.codeSessionId === codeSession.id,
              )
            : [],
          observation,
          ...(codeSession ? { codeSession } : {}),
          ...(run ? { run } : {}),
        };
      });
  }

  matchT3Observation(
    observation: CodeSessionObservationInput | CodeSessionObservation,
  ): ReconciliationMatch {
    this.refreshFromPersistence();
    const project = this.requireProject(observation.projectId);
    const session: ReconciliationSession = {
      branch: observation.branch,
      externalProjectId: observation.externalProjectId,
      externalThreadId: observation.externalThreadId,
      hasPendingApprovals: observation.hasPendingApprovals,
      hasPendingUserInput: observation.hasPendingUserInput,
      latestSessionState: observation.latestSessionState,
      latestTurnCompletedAt: observation.latestTurnCompletedAt,
      latestTurnState: observation.latestTurnState,
      observedAt: observation.observedAt,
      projectId: observation.projectId,
      provider: observation.provider,
      repositoryIdentity: observation.repositoryIdentity,
      sourceStream: observation.sourceStream,
      sourceUpdatedAt: observation.sourceUpdatedAt,
      linkedPullRequestUrl: observation.linkedPullRequestUrl,
      workspaceRoot: observation.workspaceRoot,
    };
    return matchReconciliationTarget(
      session,
      this.reconciliationTargets(project),
    );
  }

  getT3ThreadDetail(externalThreadId: string): ProjectT3Activity {
    this.refreshFromPersistence();
    const observation = this.codeSessionObservations.find(
      (candidate) =>
        candidate.provider === "t3" &&
        candidate.externalThreadId === externalThreadId,
    );
    if (!observation) {
      throw new Error(`T3 thread ${externalThreadId} does not exist.`);
    }
    const codeSession = this.codeSessions.find(
      (candidate) =>
        candidate.provider === observation.provider &&
        candidate.externalThreadId === observation.externalThreadId,
    );
    const run = codeSession
      ? this.runs.find((candidate) => candidate.id === codeSession.runId)
      : undefined;
    return {
      associations: codeSession
        ? this.codeSessionAssociations.filter(
            (association) => association.codeSessionId === codeSession.id,
          )
        : [],
      observation,
      ...(codeSession ? { codeSession } : {}),
      ...(run ? { run } : {}),
    };
  }

  recordSessionEvidence(input: SessionEvidenceInput): SessionEvidence {
    this.refreshFromPersistence();
    const evidence = this.appendSessionEvidence(input);
    this.save();
    return evidence;
  }

  private appendSessionEvidence(input: SessionEvidenceInput): SessionEvidence {
    this.requireT3Observation(input.provider, input.externalThreadId);
    if (!input.digest.trim()) {
      throw new Error("T3 evidence digest must not be empty.");
    }
    if (input.sourceStream !== undefined && !input.sourceStream.trim()) {
      throw new Error("T3 evidence source stream must not be empty.");
    }
    if (
      input.sourceSequence !== undefined &&
      (!Number.isSafeInteger(input.sourceSequence) || input.sourceSequence < 0)
    ) {
      throw new Error("T3 evidence source sequence must be non-negative.");
    }
    if (Number.isNaN(input.observedAt.getTime())) {
      throw new Error("T3 evidence timestamp must be a valid date.");
    }
    if (
      !Array.isArray(input.turnIds) ||
      !input.turnIds.every(
        (turnId) => typeof turnId === "string" && turnId.trim(),
      )
    ) {
      throw new Error("T3 evidence turn IDs must be non-empty strings.");
    }
    if (
      !Array.isArray(input.checkpointFiles) ||
      !input.checkpointFiles.every(
        (path) =>
          typeof path === "string" &&
          path.trim() &&
          !path.replaceAll("\\", "/").startsWith("/") &&
          !path.replaceAll("\\", "/").split("/").includes(".."),
      )
    ) {
      throw new Error(
        "T3 evidence checkpoint paths must be safe relative paths.",
      );
    }
    if (
      input.changedFileCount !== undefined &&
      (!Number.isSafeInteger(input.changedFileCount) ||
        input.changedFileCount < 0)
    ) {
      throw new Error("T3 evidence changed file count must be non-negative.");
    }
    const existing = this.sessionEvidence.find((candidate) => {
      if (
        candidate.provider !== input.provider ||
        candidate.externalThreadId !== input.externalThreadId
      ) {
        return false;
      }
      const sameStream =
        (candidate.sourceStream ?? "") === (input.sourceStream ?? "");
      return input.sourceSequence !== undefined
        ? sameStream && candidate.sourceSequence === input.sourceSequence
        : sameStream && candidate.digest === input.digest;
    });
    if (existing) return existing;

    const evidence: SessionEvidence = {
      ...input,
      id: this.idGenerator(),
      turnIds: [...input.turnIds],
      checkpointFiles: [...input.checkpointFiles],
    };
    this.sessionEvidence.push(evidence);
    return evidence;
  }

  listSessionEvidence(externalThreadId: string): SessionEvidence[] {
    this.refreshFromPersistence();
    return this.sessionEvidence.filter(
      (evidence) =>
        evidence.provider === "t3" &&
        evidence.externalThreadId === externalThreadId,
    );
  }

  listReconciliationFindings(projectId?: string): ReconciliationFinding[] {
    this.refreshFromPersistence();
    return this.reconciliationFindings.filter(
      (finding) => projectId === undefined || finding.projectId === projectId,
    );
  }

  reconcileT3Project({
    projectUnresolved = [],
    projectId,
    sourceUnavailable = [],
  }: {
    projectId: string;
    projectUnresolved?: Array<{
      projectId: string;
      observedAt: Date;
      explanation: string;
    }>;
    sourceUnavailable?: Array<{
      projectId: string;
      observedAt: Date;
      explanation: string;
    }>;
  }): ReconciliationFinding[] {
    this.refreshFromPersistence();
    const project = this.requireProject(projectId);
    const sessions = this.codeSessionObservations.filter(
      (observation) =>
        observation.projectId === projectId &&
        observation.sourceCurrent !== false,
    );
    const targets = this.reconciliationTargets(project);
    const sessionsById = new Map(
      this.codeSessions.map((session) => [session.id, session]),
    );
    const links = this.codeSessionAssociations.flatMap<ReconciliationLink>(
      (association) => {
        const session = sessionsById.get(association.codeSessionId);
        const run = session
          ? this.runs.find((candidate) => candidate.id === session.runId)
          : undefined;
        if (!session || !run || run.projectId !== projectId) return [];
        return [
          {
            externalThreadId: session.externalThreadId,
            provider: session.provider,
            taskId: association.taskId,
            ...(association.subtaskId
              ? { subtaskId: association.subtaskId }
              : {}),
          },
        ];
      },
    );

    const drafts = computeReconciliationFindings({
      links,
      now: this.clock(),
      projectUnresolved,
      sessions,
      sourceUnavailable,
      targets,
    });
    const byKey = new Map(drafts.map((draft) => [draft.dedupeKey, draft]));
    const existingByKey = new Map(
      this.reconciliationFindings
        .filter((finding) => finding.projectId === projectId)
        .map((finding) => [finding.dedupeKey, finding]),
    );

    for (const draft of drafts) {
      const existing = existingByKey.get(draft.dedupeKey);
      if (existing) {
        this.applyFindingDraft(existing, draft);
      } else {
        this.reconciliationFindings.push({
          ...draft,
          createdAt: this.clock(),
          id: this.idGenerator(),
          status: "open",
          updatedAt: this.clock(),
        });
      }
    }

    // Successful refreshes resolve findings that no longer describe the
    // current normalized source. An unavailable source intentionally leaves
    // existing findings open so stale data is never presented as resolved.
    if (sourceUnavailable.length === 0) {
      for (const finding of this.reconciliationFindings) {
        if (
          finding.projectId === projectId &&
          finding.status === "open" &&
          !byKey.has(finding.dedupeKey)
        ) {
          finding.status = "resolved";
          finding.updatedAt = this.clock();
        }
      }
    }

    this.save();
    return this.reconciliationFindings.filter(
      (finding) => finding.projectId === projectId,
    );
  }

  addTaskTrackerLink({
    taskId,
    ...link
  }: TrackerLinkFields & { taskId: string }): TrackerLink {
    this.refreshFromPersistence();
    const resolvedTaskId = this.requireTask(taskId).id;

    const trackerLink = {
      id: this.idGenerator(),
      taskId: resolvedTaskId,
      ...link,
    };
    this.trackerLinks.push(trackerLink);
    this.save();
    return trackerLink;
  }

  addProjectTrackerLink({
    projectId,
    ...link
  }: TrackerLinkFields & { projectId: string }): TrackerLink {
    this.refreshFromPersistence();
    if (!this.projects.some((project) => project.id === projectId)) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    const trackerLink = { id: this.idGenerator(), projectId, ...link };
    this.trackerLinks.push(trackerLink);
    this.save();
    return trackerLink;
  }

  getProjectDetail(projectId: string): ProjectMetadata {
    this.refreshFromPersistence();
    return this.getProjectDetailFromCurrentState(projectId);
  }

  private getProjectDetailFromCurrentState(projectId: string): ProjectMetadata {
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(`Project ${projectId} does not exist.`);

    return {
      id: project.id,
      name: project.name,
      ...(project.gitOriginUrl ? { gitOriginUrl: project.gitOriginUrl } : {}),
      ...(project.t3ProjectId ? { t3ProjectId: project.t3ProjectId } : {}),
      ...(project.workspaceRoot
        ? { workspaceRoot: project.workspaceRoot }
        : {}),
      trackerLinks: this.trackerLinks.filter(
        (link) => link.projectId === projectId,
      ),
    };
  }

  getTaskDetail(taskId: string): TaskDetail {
    this.refreshFromPersistence();
    return this.getTaskDetailFromCurrentState(taskId);
  }

  private getTaskDetailFromCurrentState(taskId: string): TaskDetail {
    const task = this.requireTask(taskId);
    const currentWorkState = this.getEffectiveTaskWorkState(task);
    const taskStateReason = this.getTaskStateReason(task, currentWorkState);
    return {
      id: task.id,
      simpleId: requiredSimpleId(task, "Task"),
      name: task.name,
      projectId: task.projectId,
      ...(task.branchName ? { branchName: task.branchName } : {}),
      ...(task.pullRequestUrl ? { pullRequestUrl: task.pullRequestUrl } : {}),
      objective: task.objective,
      acceptanceCriteria: task.acceptanceCriteria,
      priority: task.priority,
      owner: task.owner,
      dependencies: task.dependencies,
      repositoryLinks: task.repositoryLinks,
      ...(task.workState ? { workState: task.workState } : {}),
      ...(task.workStateSource
        ? { workStateSource: task.workStateSource }
        : {}),
      ...(taskStateReason ? { stateReason: taskStateReason } : {}),
      ...(task.sortOrder !== undefined ? { sortOrder: task.sortOrder } : {}),
      ...(task.archiveState ? { archiveState: task.archiveState } : {}),
      revision: normalizeRevision(task.revision),
      trackerLinks: this.trackerLinks.filter((link) => link.taskId === task.id),
    };
  }

  getSubtaskDetail(subtaskId: string): {
    id: string;
    simpleId: string;
    name: string;
    taskId: string;
    revision: number;
    description?: string;
    evidence?: string;
    pullRequestUrl?: string;
  } {
    this.refreshFromPersistence();
    const subtask = this.requireSubtask(subtaskId);
    return {
      id: subtask.id,
      simpleId: requiredSimpleId(subtask, "Subtask"),
      name: subtask.name,
      taskId: subtask.taskId,
      revision: normalizeRevision(subtask.revision),
      ...(subtask.description !== undefined
        ? { description: subtask.description }
        : {}),
      ...(subtask.evidence !== undefined ? { evidence: subtask.evidence } : {}),
      ...(subtask.pullRequestUrl
        ? { pullRequestUrl: subtask.pullRequestUrl }
        : {}),
    };
  }

  reorderTasks({
    orderedTaskIds,
    projectId,
    workState,
  }: {
    orderedTaskIds: string[];
    projectId: string;
    workState: WorkState;
  }): Task[] {
    this.refreshFromPersistence();
    const resolvedTaskIds = orderedTaskIds.map(
      (taskId) => this.requireTask(taskId).id,
    );
    if (!this.projects.some((project) => project.id === projectId)) {
      throw new Error(`Project ${projectId} does not exist.`);
    }
    const group = this.tasks.filter(
      (task) =>
        task.projectId === projectId &&
        task.archiveState === undefined &&
        this.getEffectiveTaskWorkState(task) === workState,
    );
    const wrongStateTask = this.tasks.find(
      (task) =>
        resolvedTaskIds.includes(task.id) &&
        task.projectId === projectId &&
        task.archiveState === undefined &&
        this.getEffectiveTaskWorkState(task) !== workState,
    );
    if (wrongStateTask) {
      throw new Error(`Tasks must belong to the same state (${workState}).`);
    }
    this.validateCompleteOrdering(
      resolvedTaskIds,
      group.map((task) => task.id),
      "Task",
      "project",
    );
    const previousFingerprints = new Map(
      group.map((task) => [task.id, recordRevisionFingerprint(task)]),
    );
    resolvedTaskIds.forEach((taskId, index) => {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (task) task.sortOrder = index;
    });
    for (const task of group) {
      const previousFingerprint = previousFingerprints.get(task.id);
      if (previousFingerprint !== undefined) {
        bumpRevisionIfChanged(task, previousFingerprint);
      }
    }
    this.save();
    return group.sort((left, right) => this.compareTasks(left, right));
  }

  reorderSubtasks({
    orderedSubtaskIds,
    taskId,
    workState,
  }: {
    orderedSubtaskIds: string[];
    taskId: string;
    workState: WorkState;
  }): Subtask[] {
    this.refreshFromPersistence();
    const resolvedTaskId = this.requireTask(taskId).id;
    const resolvedSubtaskIds = orderedSubtaskIds.map(
      (subtaskId) => this.requireSubtask(subtaskId).id,
    );
    const group = this.subtasks.filter(
      (subtask) =>
        subtask.taskId === resolvedTaskId &&
        subtask.archiveState === undefined &&
        this.getSubtaskEffectiveWorkState(subtask) === workState,
    );
    const wrongStateSubtask = this.subtasks.find(
      (subtask) =>
        resolvedSubtaskIds.includes(subtask.id) &&
        subtask.taskId === resolvedTaskId &&
        subtask.archiveState === undefined &&
        this.getSubtaskEffectiveWorkState(subtask) !== workState,
    );
    if (wrongStateSubtask) {
      throw new Error(`Subtasks must belong to the same state (${workState}).`);
    }
    this.validateCompleteOrdering(
      resolvedSubtaskIds,
      group.map((subtask) => subtask.id),
      "Subtask",
      "task",
    );
    const previousFingerprints = new Map(
      group.map((subtask) => [subtask.id, recordRevisionFingerprint(subtask)]),
    );
    resolvedSubtaskIds.forEach((subtaskId, index) => {
      const subtask = this.subtasks.find(
        (candidate) => candidate.id === subtaskId,
      );
      if (subtask) subtask.sortOrder = index;
    });
    for (const subtask of group) {
      const previousFingerprint = previousFingerprints.get(subtask.id);
      if (previousFingerprint !== undefined) {
        bumpRevisionIfChanged(subtask, previousFingerprint);
      }
    }
    this.save();
    return group.sort((left, right) => this.compareSubtasks(left, right));
  }

  private requireProject(projectId: string): Project {
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(`Project ${projectId} does not exist.`);
    return project;
  }

  private requireTask(taskId: string): Task {
    const task = this.tasks.find(
      (candidate) =>
        candidate.id === taskId ||
        matchesSimpleId(candidate, taskId, TASK_SIMPLE_ID_PREFIX),
    );
    if (!task) throw new Error(`Task ${taskId} does not exist.`);
    return task;
  }

  private requireSubtask(subtaskId: string): Subtask {
    const subtask = this.subtasks.find(
      (candidate) =>
        candidate.id === subtaskId ||
        matchesSimpleId(candidate, subtaskId, SUBTASK_SIMPLE_ID_PREFIX),
    );
    if (!subtask) throw new Error(`Subtask ${subtaskId} does not exist.`);
    return subtask;
  }

  private requireRun(runId: string): Run {
    const run = this.runs.find((candidate) => candidate.id === runId);
    if (!run) throw new Error(`Run ${runId} does not exist.`);
    return run;
  }

  private requireT3Observation(
    provider: "t3",
    externalThreadId: string,
  ): CodeSessionObservation {
    const observation = this.codeSessionObservations.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.externalThreadId === externalThreadId,
    );
    if (!observation) {
      throw new Error(`T3 thread ${externalThreadId} does not exist.`);
    }
    return observation;
  }

  private resolveT3LinkTarget({
    projectId,
    subtaskId,
    taskId,
  }: {
    projectId: string;
    subtaskId?: string;
    taskId?: string;
  }): { taskId: string; subtaskId?: string } {
    if (subtaskId !== undefined) {
      const subtask = this.requireSubtask(subtaskId);
      const parent = this.tasks.find(
        (candidate) => candidate.id === subtask.taskId,
      );
      if (!parent || parent.projectId !== projectId) {
        throw new Error(
          "T3 thread target must belong to the selected Project.",
        );
      }
      if (taskId !== undefined && this.requireTask(taskId).id !== parent.id) {
        throw new Error("The Subtask does not belong to the selected Task.");
      }
      return { subtaskId: subtask.id, taskId: parent.id };
    }

    if (taskId !== undefined) {
      const task = this.requireTask(taskId);
      if (task.projectId !== projectId) {
        throw new Error(
          "T3 thread target must belong to the selected Project.",
        );
      }
      return { taskId: task.id };
    }

    throw new Error("A T3 thread association requires a Task or Subtask.");
  }

  private applyObservationToCodeSession(
    session: CodeSession,
    observation: CodeSessionObservationInput & {
      id?: string;
      sourceCurrent?: boolean;
    },
  ): void {
    const {
      id: _observationId,
      projectId: _projectId,
      ...sessionObservation
    } = observation;
    Object.assign(session, sessionObservation);
  }

  private isNewerObservation(
    incoming: CodeSessionObservationInput,
    existing: CodeSessionObservation,
  ): boolean {
    if (
      incoming.sourceSequence !== undefined &&
      existing.sourceSequence !== undefined &&
      incoming.sourceStream !== undefined &&
      existing.sourceStream !== undefined &&
      incoming.sourceStream === existing.sourceStream &&
      incoming.sourceSequence !== existing.sourceSequence
    ) {
      return incoming.sourceSequence > existing.sourceSequence;
    }
    if (
      incoming.sourceDigest === existing.sourceDigest &&
      incoming.sourceSequence === existing.sourceSequence &&
      incoming.sourceStream === existing.sourceStream
    ) {
      return false;
    }
    return (
      incoming.sourceUpdatedAt.getTime() > existing.sourceUpdatedAt.getTime()
    );
  }

  private boundaryCoversObservation(
    boundary: T3ObservationRefreshBoundary,
    observation: CodeSessionObservation,
  ): boolean {
    if (
      boundary.sourceStream === observation.sourceStream &&
      observation.sourceSequence !== undefined
    ) {
      return boundary.sourceSequence >= observation.sourceSequence;
    }
    return (
      boundary.sourceUpdatedAt.getTime() >=
      observation.sourceUpdatedAt.getTime()
    );
  }

  private reconciliationTargets(project: Project): ReconciliationTarget[] {
    const repositoryIdentity = normalizeRepositoryIdentity(
      project.gitOriginUrl,
    );
    const targets: ReconciliationTarget[] = [];
    for (const task of this.tasks) {
      if (task.projectId !== project.id || task.archiveState !== undefined) {
        continue;
      }
      const taskState = this.getEffectiveTaskWorkState(task);
      targets.push({
        projectId: project.id,
        taskId: task.id,
        taskName: task.name,
        ...(task.branchName ? { branchName: task.branchName } : {}),
        ...(task.pullRequestUrl ? { pullRequestUrl: task.pullRequestUrl } : {}),
        ...(repositoryIdentity ? { repositoryIdentity } : {}),
        ...(project.workspaceRoot
          ? { workspaceRoot: project.workspaceRoot }
          : {}),
        workState: taskState,
      });

      for (const subtask of this.subtasks) {
        if (subtask.taskId !== task.id || subtask.archiveState !== undefined) {
          continue;
        }
        const report = this.getCurrentStatusReport(subtask.id);
        targets.push({
          projectId: project.id,
          taskId: task.id,
          taskName: task.name,
          subtaskId: subtask.id,
          subtaskName: subtask.name,
          ...(task.branchName ? { branchName: task.branchName } : {}),
          ...(subtask.pullRequestUrl
            ? { pullRequestUrl: subtask.pullRequestUrl }
            : {}),
          ...(repositoryIdentity ? { repositoryIdentity } : {}),
          ...(project.workspaceRoot
            ? { workspaceRoot: project.workspaceRoot }
            : {}),
          workState: this.getSubtaskEffectiveWorkState(subtask),
          ...(report ? { latestReportAt: report.createdAt } : {}),
        });
      }
    }
    return targets;
  }

  private applyFindingDraft(
    finding: ReconciliationFinding,
    draft: ReconciliationFindingDraft,
  ): void {
    finding.kind = draft.kind;
    finding.severity = draft.severity;
    finding.projectId = draft.projectId;
    finding.externalThreadId = draft.externalThreadId;
    finding.taskId = draft.taskId;
    finding.subtaskId = draft.subtaskId;
    finding.candidateIds = [...draft.candidateIds];
    finding.observedAt = draft.observedAt;
    finding.explanation = draft.explanation;
    finding.suggestedAction = draft.suggestedAction;
    if (finding.status === "resolved") finding.status = "open";
    finding.updatedAt = this.clock();
  }

  private validateCompleteOrdering(
    orderedIds: string[],
    expectedIds: string[],
    itemName: string,
    parentName: string,
  ): void {
    if (new Set(orderedIds).size !== orderedIds.length) {
      throw new Error(`${itemName} ordering must not contain duplicate IDs.`);
    }
    const expected = new Set(expectedIds);
    const actual = new Set(orderedIds);
    const foreignId = orderedIds.find((id) => !expected.has(id));
    if (foreignId) {
      const item =
        itemName === "Task"
          ? this.tasks.find((candidate) => candidate.id === foreignId)
          : this.subtasks.find((candidate) => candidate.id === foreignId);
      if (item) {
        throw new Error(`${itemName}s must belong to the same ${parentName}.`);
      }
      throw new Error(`${itemName} ${foreignId} does not exist.`);
    }
    if (actual.size !== expected.size) {
      throw new Error(
        `${itemName} ordering must include every item in the requested state.`,
      );
    }
  }

  private taskWouldBeCompleted(taskId: string): boolean {
    const activeSubtasks = this.subtasks.filter(
      (subtask) =>
        subtask.taskId === taskId && subtask.archiveState === undefined,
    );
    return (
      activeSubtasks.length > 0 &&
      activeSubtasks.every(
        (subtask) => this.getSubtaskEffectiveWorkState(subtask) === "completed",
      )
    );
  }

  private getEffectiveTaskWorkState(task: Task): WorkState {
    const activeSubtasks = this.subtasks
      .filter(
        (subtask) =>
          subtask.taskId === task.id && subtask.archiveState === undefined,
      )
      .map((subtask) => this.getSubtaskEffectiveWorkState(subtask));
    if (task.workState && task.workStateSource === "manual") {
      return task.workState;
    }
    if (task.workStateSource === "rollup")
      return this.getTaskRollup(task.id).state;
    if (this.taskWouldBeCompleted(task.id)) return "completed";
    if (task.workState) return task.workState;
    if (activeSubtasks.length === 0) return "planned";
    return this.deriveStateFromEffectiveSubtasks(activeSubtasks);
  }

  private getSubtaskEffectiveWorkState(subtask: Subtask): WorkState {
    const report = this.getCurrentStatusReport(subtask.id);
    if (!report) return "planned";

    const verification = this.getCurrentVerification(report.id);
    if (
      verification?.decision === "rejected" ||
      verification?.decision === "deferred"
    ) {
      return "blocked";
    }
    if (report.reportedState === "backlog") return "backlog";
    if (report.reportedState === "not_started") return "planned";
    if (report.reportedState === "in_progress") return "active";
    if (report.reportedState === "blocked") return "blocked";
    return verification?.decision === "accepted"
      ? "completed"
      : "awaiting_verification";
  }

  private deriveStateFromEffectiveSubtasks(states: WorkState[]): WorkState {
    if (states.length === 0) return "planned";
    if (states.every((state) => state === "completed")) return "completed";
    if (states.includes("blocked")) return "blocked";
    if (
      states.every(
        (state) => state === "completed" || state === "awaiting_verification",
      )
    ) {
      return "awaiting_verification";
    }
    if (
      states.some(
        (state) =>
          state === "active" ||
          state === "completed" ||
          state === "awaiting_verification",
      )
    ) {
      return "active";
    }
    return states.includes("planned") ? "planned" : "backlog";
  }

  private getTaskRollup(taskId: string): { state: WorkState; reason?: string } {
    const children = this.subtasks.filter(
      (subtask) => subtask.taskId === taskId && !subtask.archiveState,
    );
    const state = this.deriveStateFromEffectiveSubtasks(
      children.map((child) => this.getSubtaskEffectiveWorkState(child)),
    );
    if (state !== "blocked" && state !== "awaiting_verification")
      return { state };
    const child = children.find(
      (candidate) => this.getSubtaskEffectiveWorkState(candidate) === state,
    );
    const reason = child && this.getSubtaskStateReason(child);
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    return {
      state,
      reason:
        reason ||
        (task?.workState === state ? task.stateReason : undefined) ||
        `Review Subtask ${child?.id}: its historical report has no recorded ${state === "blocked" ? "unblocker" : "verification check"}.`,
    };
  }

  private reconcileAutomaticTaskRollup(taskId: string): void {
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.archiveState || task.workStateSource !== "rollup") return;
    const rollup = this.getTaskRollup(taskId);
    this.setTaskRollupState(task, rollup.state, rollup.reason);
  }

  private promoteParentTask(
    taskId: string,
    childTransition: { nextState: WorkState; previousState: WorkState },
  ): void {
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.archiveState !== undefined) return;

    const activeSubtasks = this.subtasks.filter(
      (subtask) =>
        subtask.taskId === taskId && subtask.archiveState === undefined,
    );
    if (!activeSubtasks.length) return;

    const taskCompleted = this.taskWouldBeCompleted(taskId);
    const currentState = this.getEffectiveTaskWorkState(task);
    const isManual = task.workStateSource === "manual";
    const isRollup = task.workStateSource === "rollup";

    if (taskCompleted) {
      if (!isManual) {
        this.setTaskRollupState(task, "completed");
      } else {
        this.clearTaskStateReasonUnlessNeeded(task, currentState);
      }
      return;
    }

    const childMovedHigher =
      childTransition.nextState !== "completed" &&
      compareWorkStates(
        childTransition.nextState,
        childTransition.previousState,
      ) > 0;
    if (isManual && !childMovedHigher) {
      this.clearTaskStateReasonUnlessNeeded(task, currentState);
      return;
    }

    const candidateSubtask = this.getTaskRollup(taskId);

    if (
      !isRollup &&
      compareWorkStates(candidateSubtask.state, currentState) <= 0
    ) {
      this.clearTaskStateReasonUnlessNeeded(task, currentState);
      return;
    }

    this.setTaskRollupState(
      task,
      candidateSubtask.state,
      candidateSubtask.reason,
    );
  }

  private setTaskRollupState(
    task: Task,
    workState: WorkState,
    reason?: string,
  ): void {
    const previousState =
      task.workState ?? this.getEffectiveTaskWorkState(task);
    task.workState = workState;
    task.workStateSource = "rollup";
    if (workState === "blocked" || workState === "awaiting_verification") {
      task.stateReason = requireReason(
        reason,
        `Task ${workState} requires a reason.`,
      );
    } else {
      delete task.stateReason;
    }
    if (previousState !== workState) {
      task.sortOrder = this.nextTaskSortOrder(
        task.projectId,
        workState,
        task.id,
      );
    }
  }

  private clearTaskStateReasonUnlessNeeded(
    task: Task,
    workState: ProjectWorkState,
  ): void {
    if (workState !== "blocked" && workState !== "awaiting_verification") {
      delete task.stateReason;
    }
  }

  private getSubtaskStateReason(subtask: Subtask): string | undefined {
    const report = this.getCurrentStatusReport(subtask.id);
    if (!report) return undefined;
    const verification = this.getCurrentVerification(report.id);
    if (
      verification?.decision === "rejected" ||
      verification?.decision === "deferred"
    ) {
      return verification.reason ?? report.reason;
    }
    return report.reason;
  }

  private getTaskStateReason(
    task: Task,
    workState = this.getEffectiveTaskWorkState(task),
  ): string | undefined {
    if (workState !== "blocked" && workState !== "awaiting_verification") {
      return undefined;
    }
    if (task.workStateSource === "rollup")
      return this.getTaskRollup(task.id).reason;
    if (task.stateReason) return task.stateReason;
    return this.subtasks
      .filter(
        (subtask) =>
          subtask.taskId === task.id && subtask.archiveState === undefined,
      )
      .map((subtask) => ({
        reason: this.getSubtaskStateReason(subtask),
        state: this.getSubtaskEffectiveWorkState(subtask),
      }))
      .find((candidate) => candidate.state === workState)?.reason;
  }

  private moveSubtaskToStateIfChanged(
    subtask: Subtask,
    previousState: WorkState,
  ): void {
    const nextState = this.getSubtaskEffectiveWorkState(subtask);
    if (subtask.archiveState === undefined && previousState !== nextState) {
      subtask.sortOrder = this.nextSubtaskSortOrder(
        subtask.taskId,
        nextState,
        subtask.id,
      );
    }
  }

  private nextTaskSortOrder(
    projectId: string,
    workState: WorkState,
    excludingTaskId?: string,
  ): number {
    const tasks = this.tasks.filter(
      (task) =>
        task.projectId === projectId &&
        task.id !== excludingTaskId &&
        task.archiveState === undefined &&
        this.getEffectiveTaskWorkState(task) === workState,
    );
    return (
      tasks.reduce(
        (highest, task, index) => Math.max(highest, task.sortOrder ?? index),
        -1,
      ) + 1
    );
  }

  private nextSubtaskSortOrder(
    taskId: string,
    workState: WorkState,
    excludingSubtaskId?: string,
  ): number {
    const subtasks = this.subtasks.filter(
      (subtask) =>
        subtask.taskId === taskId &&
        subtask.id !== excludingSubtaskId &&
        subtask.archiveState === undefined &&
        this.getSubtaskEffectiveWorkState(subtask) === workState,
    );
    return (
      subtasks.reduce(
        (highest, subtask, index) =>
          Math.max(highest, subtask.sortOrder ?? index),
        -1,
      ) + 1
    );
  }

  private compareTasks(left: Task, right: Task): number {
    const leftState = left.archiveState
      ? 99
      : WORK_STATE_DISPLAY_ORDER[this.getEffectiveTaskWorkState(left)];
    const rightState = right.archiveState
      ? 99
      : WORK_STATE_DISPLAY_ORDER[this.getEffectiveTaskWorkState(right)];
    return (
      leftState - rightState ||
      (left.sortOrder ?? this.tasks.indexOf(left)) -
        (right.sortOrder ?? this.tasks.indexOf(right))
    );
  }

  private compareSubtasks(left: Subtask, right: Subtask): number {
    const leftState = left.archiveState
      ? 99
      : WORK_STATE_DISPLAY_ORDER[this.getSubtaskEffectiveWorkState(left)];
    const rightState = right.archiveState
      ? 99
      : WORK_STATE_DISPLAY_ORDER[this.getSubtaskEffectiveWorkState(right)];
    return (
      leftState - rightState ||
      (left.sortOrder ?? this.subtasks.indexOf(left)) -
        (right.sortOrder ?? this.subtasks.indexOf(right))
    );
  }

  private getCurrentStatusReport(subtaskId: string): StatusReport | undefined {
    return this.statusReports.findLast(
      (report) => report.subtaskId === subtaskId,
    );
  }

  private getTaskWorkState(taskId: string): ProjectWorkState {
    const status = this.getTaskStatus(taskId);
    return status.taskState;
  }

  private getCurrentVerification(reportId: string): Verification | undefined {
    return this.verifications.findLast(
      (verification) => verification.reportId === reportId,
    );
  }

  private refreshFromPersistence(): void {
    if (!this.refreshBeforeOperations) return;
    const state = this.refresh?.();
    if (!state) return;
    const normalizedState = normalizeSimpleIdState(state);

    this.projects.splice(0, this.projects.length, ...normalizedState.projects);
    this.tasks.splice(0, this.tasks.length, ...normalizedState.tasks);
    this.subtasks.splice(0, this.subtasks.length, ...normalizedState.subtasks);
    this.statusReports.splice(
      0,
      this.statusReports.length,
      ...normalizedState.statusReports,
    );
    this.verifications.splice(
      0,
      this.verifications.length,
      ...normalizedState.verifications,
    );
    this.trackerLinks.splice(
      0,
      this.trackerLinks.length,
      ...(normalizedState.trackerLinks ?? []),
    );
    const executionState = normalizeExecutionState(normalizedState);
    this.runs.splice(0, this.runs.length, ...executionState.runs);
    this.codeSessions.splice(
      0,
      this.codeSessions.length,
      ...executionState.codeSessions,
    );
    this.codeSessionAssociations.splice(
      0,
      this.codeSessionAssociations.length,
      ...executionState.associations,
    );
    this.codeSessionObservations.splice(
      0,
      this.codeSessionObservations.length,
      ...(normalizedState.codeSessionObservations ?? []),
    );
    this.sessionEvidence.splice(
      0,
      this.sessionEvidence.length,
      ...(normalizedState.sessionEvidence ?? []),
    );
    this.reconciliationFindings.splice(
      0,
      this.reconciliationFindings.length,
      ...(normalizedState.reconciliationFindings ?? []),
    );
    this.nextTaskSimpleId =
      normalizedState.simpleIdCounters?.nextTask ??
      nextSimpleIdNumber(this.tasks, TASK_SIMPLE_ID_PREFIX);
    this.nextSubtaskSimpleId =
      normalizedState.simpleIdCounters?.nextSubtask ??
      nextSimpleIdNumber(this.subtasks, SUBTASK_SIMPLE_ID_PREFIX);
  }

  private save(): void {
    this.persist?.({
      projects: this.projects,
      statusReports: this.statusReports,
      subtasks: this.subtasks,
      tasks: this.tasks,
      verifications: this.verifications,
      trackerLinks: this.trackerLinks,
      runs: this.runs,
      codeSessions: this.codeSessions,
      codeSessionAssociations: this.codeSessionAssociations,
      codeSessionObservations: this.codeSessionObservations,
      sessionEvidence: this.sessionEvidence,
      reconciliationFindings: this.reconciliationFindings,
      simpleIdCounters: {
        nextSubtask: this.nextSubtaskSimpleId,
        nextTask: this.nextTaskSimpleId,
      },
    });
  }
}

export function createFactoryApplication({
  databasePath,
  refreshBeforeOperations = true,
}: {
  databasePath: string;
  refreshBeforeOperations?: boolean;
}): FactoryApplication {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS factory_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state TEXT NOT NULL
    )
  `);

  const row = database
    .query("SELECT state FROM factory_state WHERE id = 1")
    .get() as { state: string } | null;
  const state = row
    ? hydrateState(JSON.parse(row.state) as FactoryState)
    : undefined;

  return new FactoryApplication({
    clock: () => new Date(),
    close() {
      database.close();
    },
    idGenerator: () => crypto.randomUUID(),
    refreshBeforeOperations,
    persist(nextState) {
      database
        .query(
          "INSERT INTO factory_state (id, state) VALUES (1, $state) ON CONFLICT(id) DO UPDATE SET state = excluded.state",
        )
        .run({ $state: JSON.stringify(nextState) });
    },
    refresh() {
      const currentRow = database
        .query("SELECT state FROM factory_state WHERE id = 1")
        .get() as { state: string } | null;
      return currentRow
        ? hydrateState(JSON.parse(currentRow.state) as FactoryState)
        : undefined;
    },
    state,
  });
}

export type FactoryDatabaseBackup = {
  sourcePath: string;
  destinationPath: string;
  sizeBytes: number;
};

export type FactoryDatabaseCheck = {
  databasePath: string;
  integrity: "ok";
  counts: {
    projects: number;
    tasks: number;
    subtasks: number;
    statusReports: number;
    verifications: number;
    trackerLinks: number;
  };
};

export function checkFactoryDatabase({
  databasePath,
  requireSnapshot = false,
}: {
  databasePath: string;
  /** Require the canonical row when checking a production database. */
  requireSnapshot?: boolean;
}): FactoryDatabaseCheck {
  const resolvedDatabasePath = resolve(databasePath);
  if (!existsSync(resolvedDatabasePath)) {
    throw new Error(`Database does not exist: ${resolvedDatabasePath}`);
  }

  const database = new Database(resolvedDatabasePath, { readonly: true });
  try {
    const factoryStateTable = database
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factory_state'",
      )
      .get();
    if (!factoryStateTable) {
      throw new Error(`Not a Factory database: ${resolvedDatabasePath}`);
    }

    const integrityResult = database.query("PRAGMA integrity_check").get() as {
      integrity_check: string;
    } | null;
    if (integrityResult?.integrity_check !== "ok") {
      throw new Error(
        `SQLite integrity check failed: ${integrityResult?.integrity_check ?? "no result"}`,
      );
    }

    const row = database
      .query("SELECT state FROM factory_state WHERE id = 1")
      .get() as { state: string } | null;
    if (!row && requireSnapshot) {
      throw new Error(
        `Factory database has no persisted factory_state snapshot: ${resolvedDatabasePath}`,
      );
    }

    let state: FactoryState | undefined;
    if (row) {
      try {
        const parsed = JSON.parse(row.state) as unknown;
        assertFactoryStateSnapshot(parsed);
        // Hydration is the existing application-level compatibility check. It
        // also catches malformed nested records and invalid legacy shapes.
        state = hydrateState(parsed);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Factory state snapshot is corrupt or incompatible: ${detail}`,
        );
      }
    }
    return {
      counts: {
        projects: state?.projects.length ?? 0,
        statusReports: state?.statusReports.length ?? 0,
        subtasks: state?.subtasks.length ?? 0,
        tasks: state?.tasks.length ?? 0,
        trackerLinks: state?.trackerLinks?.length ?? 0,
        verifications: state?.verifications.length ?? 0,
      },
      databasePath: resolvedDatabasePath,
      integrity: "ok",
    };
  } finally {
    database.close();
  }
}

/**
 * Create a consistent SQLite snapshot without changing the live Factory database.
 *
 * The destination is intentionally write-once by default. An operator must opt in
 * to replacement so a mistyped backup path cannot silently destroy an older copy.
 */
export function backupFactoryDatabase({
  allowOverwrite = false,
  databasePath,
  destinationPath,
}: {
  allowOverwrite?: boolean;
  databasePath: string;
  destinationPath: string;
}): FactoryDatabaseBackup {
  const sourcePath = resolve(databasePath);
  const resolvedDestinationPath = resolve(destinationPath);

  if (sourcePath === resolvedDestinationPath) {
    throw new Error(
      "Backup destination must be different from the source database.",
    );
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`Source database does not exist: ${sourcePath}`);
  }
  if (existsSync(resolvedDestinationPath) && !allowOverwrite) {
    throw new Error(
      `Backup destination already exists; pass --overwrite to replace it: ${resolvedDestinationPath}`,
    );
  }

  const database = new Database(sourcePath, { readonly: true });
  try {
    const factoryStateTable = database
      .query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factory_state'",
      )
      .get();
    if (!factoryStateTable) {
      throw new Error(`Not a Factory database: ${sourcePath}`);
    }

    const serialized = database.serialize();
    mkdirSync(dirname(resolvedDestinationPath), { recursive: true });
    writeFileSync(resolvedDestinationPath, serialized, {
      flag: allowOverwrite ? "w" : "wx",
    });
    return {
      destinationPath: resolvedDestinationPath,
      sizeBytes: statSync(resolvedDestinationPath).size,
      sourcePath,
    };
  } finally {
    database.close();
  }
}

function assertFactoryStateSnapshot(
  value: unknown,
): asserts value is FactoryState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("snapshot must be a JSON object");
  }

  const record = value as Record<string, unknown>;
  if ("schemaVersion" in record && record.schemaVersion !== 1) {
    throw new Error("snapshot schemaVersion must be 1");
  }
  for (const field of [
    "projects",
    "tasks",
    "subtasks",
    "statusReports",
    "verifications",
  ]) {
    if (!Array.isArray(record[field])) {
      throw new Error(`snapshot field ${field} must be an array`);
    }
  }
  const projects = record.projects as unknown[];
  const tasks = record.tasks as unknown[];
  const subtasks = record.subtasks as unknown[];
  const statusReports = record.statusReports as unknown[];
  const verifications = record.verifications as unknown[];

  const requireRecord = (
    field: string,
    item: unknown,
  ): Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`snapshot ${field} entries must be objects`);
    }
    return item as Record<string, unknown>;
  };
  const requireString = (field: string, item: unknown): void => {
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`snapshot ${field} must be a non-empty string`);
    }
  };
  const requireDate = (field: string, item: unknown): void => {
    if (
      !(item instanceof Date) &&
      (typeof item !== "string" || !Number.isFinite(Date.parse(item)))
    ) {
      throw new Error(`snapshot ${field} must be an ISO date`);
    }
  };
  const requireArray = (field: string, item: unknown): void => {
    if (!Array.isArray(item))
      throw new Error(`snapshot ${field} must be an array`);
  };
  const requireStringArray = (field: string, item: unknown): void => {
    requireArray(field, item);
    for (const entry of item as unknown[]) requireString(field, entry);
  };
  const requireOneOf = (
    field: string,
    item: unknown,
    values: readonly string[],
  ): void => {
    requireString(field, item);
    if (!values.includes(item as string)) {
      throw new Error(`snapshot ${field} has an unsupported value`);
    }
  };

  for (const field of [
    "trackerLinks",
    "runs",
    "codeSessions",
    "codeSessionAssociations",
    "codeSessionObservations",
    "sessionEvidence",
    "reconciliationFindings",
  ]) {
    if (
      field in record &&
      record[field] !== null &&
      record[field] !== undefined
    ) {
      requireArray(`snapshot ${field}`, record[field]);
    }
  }

  for (const item of projects) {
    const project = requireRecord("projects", item);
    requireString("project.id", project.id);
    requireString("project.name", project.name);
    requireDate("project.createdAt", project.createdAt);
  }
  for (const item of tasks) {
    const task = requireRecord("tasks", item);
    requireString("task.id", task.id);
    requireString("task.name", task.name);
    requireString("task.projectId", task.projectId);
    requireDate("task.createdAt", task.createdAt);
    if (task.acceptanceCriteria != null) {
      requireStringArray("task.acceptanceCriteria", task.acceptanceCriteria);
    }
    if (task.dependencies != null) {
      requireStringArray("task.dependencies", task.dependencies);
    }
    if (task.repositoryLinks != null) {
      requireStringArray("task.repositoryLinks", task.repositoryLinks);
    }
  }
  for (const item of subtasks) {
    const subtask = requireRecord("subtasks", item);
    requireString("subtask.id", subtask.id);
    requireString("subtask.name", subtask.name);
    requireString("subtask.taskId", subtask.taskId);
    requireDate("subtask.createdAt", subtask.createdAt);
  }
  for (const item of statusReports) {
    const report = requireRecord("statusReports", item);
    requireString("statusReport.id", report.id);
    requireString("statusReport.subtaskId", report.subtaskId);
    requireOneOf("statusReport.reportedState", report.reportedState, [
      "backlog",
      "not_started",
      "in_progress",
      "blocked",
      "complete",
    ]);
    requireString("statusReport.reporter", report.reporter);
    requireDate("statusReport.createdAt", report.createdAt);
  }
  for (const item of verifications) {
    const verification = requireRecord("verifications", item);
    requireString("verification.id", verification.id);
    requireString("verification.reportId", verification.reportId);
    requireOneOf("verification.decision", verification.decision, [
      "accepted",
      "rejected",
      "deferred",
    ]);
    requireString("verification.verifier", verification.verifier);
    requireDate("verification.createdAt", verification.createdAt);
  }
}

function hydrateState(state: FactoryState): FactoryState {
  return normalizeSimpleIdState({
    projects: state.projects.map((project) => ({
      ...project,
      createdAt: new Date(project.createdAt),
    })),
    statusReports: state.statusReports.map((report) => ({
      ...report,
      createdAt: new Date(report.createdAt),
    })),
    subtasks: state.subtasks.map((subtask) => ({
      ...subtask,
      createdAt: new Date(subtask.createdAt),
    })),
    tasks: state.tasks.map((task) => ({
      ...task,
      acceptanceCriteria: task.acceptanceCriteria ?? [],
      dependencies: task.dependencies ?? [],
      repositoryLinks: task.repositoryLinks ?? [],
      createdAt: new Date(task.createdAt),
    })),
    verifications: state.verifications.map((verification) => ({
      ...verification,
      createdAt: new Date(verification.createdAt),
    })),
    trackerLinks: state.trackerLinks ?? [],
    runs: (state.runs ?? []).map((run) => ({
      ...run,
      createdAt: new Date(run.createdAt),
      updatedAt: new Date(run.updatedAt),
    })),
    codeSessions: (state.codeSessions ?? []).map((session) => ({
      ...session,
      ...(session.latestTurnCompletedAt
        ? { latestTurnCompletedAt: new Date(session.latestTurnCompletedAt) }
        : {}),
      observedAt: new Date(session.observedAt),
      sourceUpdatedAt: new Date(session.sourceUpdatedAt),
    })),
    ...(state.codeSessionAssociations === undefined
      ? {}
      : {
          codeSessionAssociations: state.codeSessionAssociations.map(
            (association) => ({
              ...association,
              createdAt: new Date(association.createdAt),
            }),
          ),
        }),
    codeSessionObservations: (state.codeSessionObservations ?? []).map(
      (observation) => ({
        ...observation,
        ...(observation.latestTurnCompletedAt
          ? {
              latestTurnCompletedAt: new Date(
                observation.latestTurnCompletedAt,
              ),
            }
          : {}),
        observedAt: new Date(observation.observedAt),
        sourceUpdatedAt: new Date(observation.sourceUpdatedAt),
      }),
    ),
    sessionEvidence: (state.sessionEvidence ?? []).map((evidence) => ({
      ...evidence,
      observedAt: new Date(evidence.observedAt),
      turnIds: evidence.turnIds ?? [],
      checkpointFiles: evidence.checkpointFiles ?? [],
    })),
    reconciliationFindings: (state.reconciliationFindings ?? []).map(
      (finding) => ({
        ...finding,
        candidateIds: finding.candidateIds ?? [],
        createdAt: new Date(finding.createdAt),
        observedAt: new Date(finding.observedAt),
        updatedAt: new Date(finding.updatedAt),
      }),
    ),
  });
}
