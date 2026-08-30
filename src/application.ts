import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Database } from "bun:sqlite";

export type FactoryClock = () => Date;
export type FactoryIdGenerator = () => string;

export type FactoryApplicationOptions = {
  clock: FactoryClock;
  idGenerator: FactoryIdGenerator;
  refresh?: () => FactoryState | undefined;
  state?: FactoryState;
  persist?: (state: FactoryState) => void;
};

type Project = {
  id: string;
  name: string;
  gitOriginUrl?: string;
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

type Task = {
  id: string;
  name: string;
  projectId: string;
  branchName?: string;
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
  createdAt: Date;
};

type Subtask = {
  id: string;
  name: string;
  taskId: string;
  description?: string;
  evidence?: string;
  sortOrder?: number;
  archiveState?: ArchiveState;
  createdAt: Date;
};

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

export type ProjectWorkState = WorkState | ArchiveState;

export type ProjectWorkCounts = Record<ProjectWorkState, number>;

export type AttentionItem = {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  state: Exclude<ProjectWorkState, "completed" | ArchiveState>;
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
};

export type TaskStatus = {
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

type FactoryState = {
  projects: Project[];
  tasks: Task[];
  subtasks: Subtask[];
  statusReports: StatusReport[];
  verifications: Verification[];
  trackerLinks?: TrackerLink[];
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

function compareWorkStates(left: WorkState, right: WorkState): number {
  return WORK_STATE_RANK[left] - WORK_STATE_RANK[right];
}

export type ProjectHierarchy = {
  id: string;
  name: string;
  gitOriginUrl?: string;
  tasks: Array<{
    id: string;
    name: string;
    projectId: string;
    branchName?: string;
    workState?: WorkState;
    stateReason?: string;
    sortOrder?: number;
    archiveState?: ArchiveState;
    subtasks: Array<{
      id: string;
      name: string;
      taskId: string;
      description?: string;
      evidence?: string;
      workState?: WorkState;
      stateReason?: string;
      sortOrder?: number;
      archiveState?: ArchiveState;
    }>;
  }>;
};

export class FactoryApplication {
  private readonly clock: FactoryClock;
  private readonly idGenerator: FactoryIdGenerator;
  private readonly persist?: (state: FactoryState) => void;
  private readonly refresh?: () => FactoryState | undefined;
  private readonly projects: Project[];
  private readonly tasks: Task[];
  private readonly subtasks: Subtask[];
  private readonly statusReports: StatusReport[];
  private readonly verifications: Verification[];
  private readonly trackerLinks: TrackerLink[];

  constructor({
    clock,
    idGenerator,
    persist,
    refresh,
    state,
  }: FactoryApplicationOptions) {
    this.clock = clock;
    this.idGenerator = idGenerator;
    this.persist = persist;
    this.refresh = refresh;
    this.projects = state?.projects ?? [];
    this.tasks = state?.tasks ?? [];
    this.subtasks = state?.subtasks ?? [];
    this.statusReports = state?.statusReports ?? [];
    this.verifications = state?.verifications ?? [];
    this.trackerLinks = state?.trackerLinks ?? [];
  }

  createProject({
    gitOriginUrl,
    name,
  }: {
    gitOriginUrl?: string;
    name: string;
  }): Project {
    this.refreshFromPersistence();
    const project = {
      id: this.idGenerator(),
      name,
      ...(gitOriginUrl?.trim() ? { gitOriginUrl: gitOriginUrl.trim() } : {}),
      createdAt: this.clock(),
    };

    this.projects.push(project);
    this.save();
    return project;
  }

  updateProject({
    gitOriginUrl,
    projectId,
  }: {
    gitOriginUrl: string | null;
    projectId: string;
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
    this.save();
  }

  removeTask(taskId: string): void {
    this.refreshFromPersistence();
    if (!this.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task ${taskId} does not exist.`);
    }

    const subtaskIds = new Set(
      this.subtasks
        .filter((subtask) => subtask.taskId === taskId)
        .map((subtask) => subtask.id),
    );
    const reportIds = new Set(
      this.statusReports
        .filter((report) => subtaskIds.has(report.subtaskId))
        .map((report) => report.id),
    );

    removeMatching(this.tasks, (task) => task.id === taskId);
    removeMatching(this.subtasks, (subtask) => subtaskIds.has(subtask.id));
    removeMatching(this.statusReports, (report) => reportIds.has(report.id));
    removeMatching(this.verifications, (verification) =>
      reportIds.has(verification.reportId),
    );
    removeMatching(this.trackerLinks, (link) => link.taskId === taskId);
    this.save();
  }

  removeSubtask(subtaskId: string): void {
    this.refreshFromPersistence();
    if (!this.subtasks.some((subtask) => subtask.id === subtaskId)) {
      throw new Error(`Subtask ${subtaskId} does not exist.`);
    }

    const reportIds = new Set(
      this.statusReports
        .filter((report) => report.subtaskId === subtaskId)
        .map((report) => report.id),
    );

    removeMatching(this.subtasks, (subtask) => subtask.id === subtaskId);
    removeMatching(this.statusReports, (report) => reportIds.has(report.id));
    removeMatching(this.verifications, (verification) =>
      reportIds.has(verification.reportId),
    );
    this.save();
  }

  createTask({
    branchName,
    name,
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

    const task = {
      id: this.idGenerator(),
      name,
      projectId,
      ...(branchName?.trim() ? { branchName: branchName.trim() } : {}),
      objective,
      acceptanceCriteria,
      priority,
      owner,
      dependencies,
      repositoryLinks,
      workState,
      ...(normalizedReason ? { stateReason: normalizedReason } : {}),
      sortOrder: this.nextTaskSortOrder(projectId, workState),
      createdAt: this.clock(),
    };

    this.tasks.push(task);
    this.save();
    return task;
  }

  updateTask({
    acceptanceCriteria,
    branchName,
    name,
    objective,
    stateReason,
    taskId,
    workState,
  }: {
    acceptanceCriteria?: string[];
    branchName?: string | null;
    name?: string;
    objective?: string | null;
    stateReason?: string | null;
    taskId: string;
    workState?: WorkState;
  }): Task {
    this.refreshFromPersistence();
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist.`);

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
    this.save();
    return task;
  }

  setTaskWorkState({
    reason,
    taskId,
    workState,
  }: {
    reason?: string;
    taskId: string;
    workState: WorkState;
  }): Task {
    return this.updateTask({ stateReason: reason, taskId, workState });
  }

  createSubtask({
    description,
    name,
    taskId,
  }: {
    description?: string;
    name: string;
    taskId: string;
  }): Subtask {
    this.refreshFromPersistence();
    if (!this.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task ${taskId} does not exist.`);
    }

    const subtask = {
      id: this.idGenerator(),
      name,
      taskId,
      ...(description?.trim() ? { description: description.trim() } : {}),
      sortOrder: this.nextSubtaskSortOrder(taskId, "planned"),
      createdAt: this.clock(),
    };

    this.subtasks.push(subtask);
    this.save();
    return subtask;
  }

  updateSubtask({
    description,
    evidence,
    name,
    subtaskId,
  }: {
    description?: string | null;
    evidence?: string | null;
    name?: string;
    subtaskId: string;
  }): Subtask {
    this.refreshFromPersistence();
    const subtask = this.subtasks.find(
      (candidate) => candidate.id === subtaskId,
    );
    if (!subtask) throw new Error(`Subtask ${subtaskId} does not exist.`);

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
    this.save();
    return subtask;
  }

  archiveTask(taskId: string, archiveState: ArchiveState): void {
    this.refreshFromPersistence();
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist.`);

    task.archiveState = archiveState;
    this.save();
  }

  restoreTask(taskId: string): void {
    this.refreshFromPersistence();
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist.`);

    delete task.archiveState;
    this.save();
  }

  archiveSubtask(subtaskId: string, archiveState: ArchiveState): void {
    this.refreshFromPersistence();
    const subtask = this.subtasks.find(
      (candidate) => candidate.id === subtaskId,
    );
    if (!subtask) throw new Error(`Subtask ${subtaskId} does not exist.`);

    subtask.archiveState = archiveState;
    this.save();
  }

  restoreSubtask(subtaskId: string): void {
    this.refreshFromPersistence();
    const subtask = this.subtasks.find(
      (candidate) => candidate.id === subtaskId,
    );
    if (!subtask) throw new Error(`Subtask ${subtaskId} does not exist.`);

    delete subtask.archiveState;
    this.save();
  }

  reportSubtaskStatus({
    evidence,
    reason,
    reporter,
    reportedState,
    subtaskId,
  }: {
    evidence?: string;
    reason?: string;
    reporter: string;
    reportedState: ReportedState;
    subtaskId: string;
  }): StatusReport {
    this.refreshFromPersistence();
    const subtask = this.subtasks.find(
      (candidate) => candidate.id === subtaskId,
    );
    if (!subtask) {
      throw new Error(`Subtask ${subtaskId} does not exist.`);
    }

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
      subtaskId,
      reportedState,
      reporter,
      evidence: currentEvidence,
      ...(normalizedReason ? { reason: normalizedReason } : {}),
      createdAt: this.clock(),
    };

    this.statusReports.push(report);
    const nextState = this.getSubtaskEffectiveWorkState(subtask);
    this.moveSubtaskToStateIfChanged(subtask, previousState);
    this.promoteParentTask(subtask.taskId, { nextState, previousState });
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
    this.save();
  }

  getTaskStatus(taskId: string): TaskStatus {
    this.refreshFromPersistence();
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      throw new Error(`Task ${taskId} does not exist.`);
    }

    const subtasks: TaskStatus["subtasks"] = this.subtasks
      .filter((subtask) => subtask.taskId === taskId)
      .sort((left, right) => this.compareSubtasks(left, right))
      .map((subtask) => {
        const report = this.getCurrentStatusReport(subtask.id);

        if (!report) {
          return {
            id: subtask.id,
            subtaskId: subtask.id,
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

    const taskState = task.archiveState
      ? task.archiveState
      : task.workStateSource === "manual" && task.workState
        ? task.workState
        : task.workStateSource === "rollup" && task.workState
          ? task.workState
          : taskCompleted
            ? "completed"
            : (task.workState ??
              this.deriveTaskWorkState(taskCompleted, activeSubtasks));
    const stateReason =
      taskState === "blocked" || taskState === "awaiting_verification"
        ? (task.stateReason ??
          activeSubtasks.find((subtask) => subtask.effectiveState === taskState)
            ?.reason)
        : undefined;

    return {
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
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    const counts = emptyProjectWorkCounts();
    const tasks = this.tasks.filter((task) => task.projectId === projectId);
    for (const task of tasks) {
      counts[this.getTaskWorkState(task.id)] += 1;
    }

    return {
      projectId,
      projectName: project.name,
      totalTasks: tasks.length,
      counts,
    };
  }

  getPortfolioStatus(): {
    totalTasks: number;
    counts: ProjectWorkCounts;
    projects: Array<{
      projectId: string;
      projectName: string;
      totalTasks: number;
      counts: ProjectWorkCounts;
    }>;
  } {
    this.refreshFromPersistence();
    const counts = emptyProjectWorkCounts();
    const projects = this.projects.map((project) => {
      const status = this.getProjectStatus(project.id);
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
    const stateOrder: Record<AttentionItem["state"], number> = {
      blocked: 0,
      awaiting_verification: 1,
      active: 2,
      planned: 3,
      backlog: 4,
    };

    return this.tasks
      .flatMap((task) => {
        const state = this.getTaskStatus(task.id).taskState;
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
    if (!this.subtasks.some((subtask) => subtask.id === subtaskId)) {
      throw new Error(`Subtask ${subtaskId} does not exist.`);
    }

    return this.statusReports.filter(
      (report) => report.subtaskId === subtaskId,
    );
  }

  getSubtaskVerificationHistory(subtaskId: string): Verification[] {
    this.refreshFromPersistence();
    if (!this.subtasks.some((subtask) => subtask.id === subtaskId)) {
      throw new Error(`Subtask ${subtaskId} does not exist.`);
    }

    const reportIds = new Set(
      this.statusReports
        .filter((report) => report.subtaskId === subtaskId)
        .map((report) => report.id),
    );
    return this.verifications.filter((verification) =>
      reportIds.has(verification.reportId),
    );
  }

  getProjectHierarchy(projectId: string): ProjectHierarchy {
    this.refreshFromPersistence();
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
      tasks: this.tasks
        .filter((task) => task.projectId === project.id)
        .sort((left, right) => this.compareTasks(left, right))
        .map((task) => {
          const taskState = this.getEffectiveTaskWorkState(task);
          const taskStateReason = this.getTaskStateReason(task, taskState);
          return {
            id: task.id,
            name: task.name,
            projectId: project.id,
            ...(task.branchName ? { branchName: task.branchName } : {}),
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
                  name: subtask.name,
                  taskId: subtask.taskId,
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

  listProjects(): Array<{ id: string; name: string; gitOriginUrl?: string }> {
    this.refreshFromPersistence();
    return this.projects.map((project) => ({
      id: project.id,
      name: project.name,
      ...(project.gitOriginUrl ? { gitOriginUrl: project.gitOriginUrl } : {}),
    }));
  }

  addTaskTrackerLink({
    taskId,
    ...link
  }: TrackerLinkFields & { taskId: string }): TrackerLink {
    this.refreshFromPersistence();
    if (!this.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task ${taskId} does not exist.`);
    }

    const trackerLink = { id: this.idGenerator(), taskId, ...link };
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

  getProjectDetail(projectId: string): {
    id: string;
    name: string;
    gitOriginUrl?: string;
    trackerLinks: TrackerLink[];
  } {
    this.refreshFromPersistence();
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(`Project ${projectId} does not exist.`);

    return {
      id: project.id,
      name: project.name,
      ...(project.gitOriginUrl ? { gitOriginUrl: project.gitOriginUrl } : {}),
      trackerLinks: this.trackerLinks.filter(
        (link) => link.projectId === projectId,
      ),
    };
  }

  getTaskDetail(taskId: string): {
    id: string;
    name: string;
    projectId: string;
    branchName?: string;
    objective?: string;
    acceptanceCriteria: string[];
    priority?: "low" | "medium" | "high" | "urgent";
    owner?: string;
    dependencies: string[];
    repositoryLinks: string[];
    workState?: WorkState;
    stateReason?: string;
    sortOrder?: number;
    archiveState?: ArchiveState;
    trackerLinks: TrackerLink[];
  } {
    this.refreshFromPersistence();
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist.`);
    const currentWorkState = this.getEffectiveTaskWorkState(task);
    const taskStateReason = this.getTaskStateReason(task, currentWorkState);
    return {
      id: task.id,
      name: task.name,
      projectId: task.projectId,
      ...(task.branchName ? { branchName: task.branchName } : {}),
      objective: task.objective,
      acceptanceCriteria: task.acceptanceCriteria,
      priority: task.priority,
      owner: task.owner,
      dependencies: task.dependencies,
      repositoryLinks: task.repositoryLinks,
      ...(task.workState ? { workState: task.workState } : {}),
      ...(taskStateReason ? { stateReason: taskStateReason } : {}),
      ...(task.sortOrder !== undefined ? { sortOrder: task.sortOrder } : {}),
      ...(task.archiveState ? { archiveState: task.archiveState } : {}),
      trackerLinks: this.trackerLinks.filter((link) => link.taskId === taskId),
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
        orderedTaskIds.includes(task.id) &&
        task.projectId === projectId &&
        task.archiveState === undefined &&
        this.getEffectiveTaskWorkState(task) !== workState,
    );
    if (wrongStateTask) {
      throw new Error(`Tasks must belong to the same state (${workState}).`);
    }
    this.validateCompleteOrdering(
      orderedTaskIds,
      group.map((task) => task.id),
      "Task",
      "project",
    );
    orderedTaskIds.forEach((taskId, index) => {
      const task = this.tasks.find((candidate) => candidate.id === taskId);
      if (task) task.sortOrder = index;
    });
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
    if (!this.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task ${taskId} does not exist.`);
    }
    const group = this.subtasks.filter(
      (subtask) =>
        subtask.taskId === taskId &&
        subtask.archiveState === undefined &&
        this.getSubtaskEffectiveWorkState(subtask) === workState,
    );
    const wrongStateSubtask = this.subtasks.find(
      (subtask) =>
        orderedSubtaskIds.includes(subtask.id) &&
        subtask.taskId === taskId &&
        subtask.archiveState === undefined &&
        this.getSubtaskEffectiveWorkState(subtask) !== workState,
    );
    if (wrongStateSubtask) {
      throw new Error(`Subtasks must belong to the same state (${workState}).`);
    }
    this.validateCompleteOrdering(
      orderedSubtaskIds,
      group.map((subtask) => subtask.id),
      "Subtask",
      "task",
    );
    orderedSubtaskIds.forEach((subtaskId, index) => {
      const subtask = this.subtasks.find(
        (candidate) => candidate.id === subtaskId,
      );
      if (subtask) subtask.sortOrder = index;
    });
    this.save();
    return group.sort((left, right) => this.compareSubtasks(left, right));
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
    if (
      task.workState &&
      (task.workStateSource === "manual" || task.workStateSource === "rollup")
    ) {
      return task.workState;
    }
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
    return states.reduce(
      (highest, state) =>
        state === "completed" || compareWorkStates(state, highest) <= 0
          ? highest
          : state,
      "backlog" as WorkState,
    );
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

    const candidateSubtask = activeSubtasks
      .map((subtask) => ({
        reason: this.getSubtaskStateReason(subtask),
        state: this.getSubtaskEffectiveWorkState(subtask),
      }))
      .filter(({ state }) => state !== "completed")
      .sort((left, right) => compareWorkStates(right.state, left.state))[0];
    if (!candidateSubtask) {
      return;
    }

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
    const previousState = this.getEffectiveTaskWorkState(task);
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

  private deriveTaskWorkState(
    taskCompleted: boolean,
    subtasks: TaskStatus["subtasks"],
  ): ProjectWorkState {
    if (taskCompleted) return "completed";

    if (subtasks.some((subtask) => subtask.effectiveState === "blocked")) {
      return "blocked";
    }

    if (
      subtasks.some(
        (subtask) => subtask.effectiveState === "awaiting_verification",
      )
    ) {
      return "awaiting_verification";
    }

    if (subtasks.some((subtask) => subtask.effectiveState === "active")) {
      return "active";
    }

    if (subtasks.some((subtask) => subtask.effectiveState === "planned")) {
      return "planned";
    }

    return "backlog";
  }

  private getCurrentVerification(reportId: string): Verification | undefined {
    return this.verifications.findLast(
      (verification) => verification.reportId === reportId,
    );
  }

  private refreshFromPersistence(): void {
    const state = this.refresh?.();
    if (!state) return;

    this.projects.splice(0, this.projects.length, ...state.projects);
    this.tasks.splice(0, this.tasks.length, ...state.tasks);
    this.subtasks.splice(0, this.subtasks.length, ...state.subtasks);
    this.statusReports.splice(
      0,
      this.statusReports.length,
      ...state.statusReports,
    );
    this.verifications.splice(
      0,
      this.verifications.length,
      ...state.verifications,
    );
    this.trackerLinks.splice(
      0,
      this.trackerLinks.length,
      ...(state.trackerLinks ?? []),
    );
  }

  private save(): void {
    this.persist?.({
      projects: this.projects,
      statusReports: this.statusReports,
      subtasks: this.subtasks,
      tasks: this.tasks,
      verifications: this.verifications,
      trackerLinks: this.trackerLinks,
    });
  }
}

export function createFactoryApplication({
  databasePath,
}: {
  databasePath: string;
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
    idGenerator: () => crypto.randomUUID(),
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
}: {
  databasePath: string;
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
    const state = row ? (JSON.parse(row.state) as FactoryState) : undefined;
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

function hydrateState(state: FactoryState): FactoryState {
  return {
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
  };
}
