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
  archiveState?: ArchiveState;
  createdAt: Date;
};

type Subtask = {
  id: string;
  name: string;
  taskId: string;
  description?: string;
  archiveState?: ArchiveState;
  createdAt: Date;
};

export type ArchiveState = "released" | "wont_do";

export type ReportedState =
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
  createdAt: Date;
};

export type VerificationDecision = "accepted" | "rejected" | "deferred";

export type Verification = {
  id: string;
  reportId: string;
  decision: VerificationDecision;
  verifier: string;
  createdAt: Date;
};

export type ProjectWorkState =
  | "planned"
  | "active"
  | "awaiting_verification"
  | "completed"
  | "blocked"
  | ArchiveState;

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
  archiveState?: ArchiveState;
  subtasks: Array<{
    reportedState?: ReportedState;
    verificationState:
      | "accepted"
      | "awaiting_verification"
      | "deferred"
      | "rejected"
      | "unreported";
    id?: string;
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

export type ProjectHierarchy = {
  id: string;
  name: string;
  gitOriginUrl?: string;
  tasks: Array<{
    id: string;
    name: string;
    projectId: string;
    branchName?: string;
    archiveState?: ArchiveState;
    subtasks: Array<{
      id: string;
      name: string;
      taskId: string;
      description?: string;
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
  }): Task {
    this.refreshFromPersistence();
    if (!this.projects.some((project) => project.id === projectId)) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

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
    taskId,
  }: {
    acceptanceCriteria?: string[];
    branchName?: string | null;
    name?: string;
    objective?: string | null;
    taskId: string;
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
    this.save();
    return task;
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
      createdAt: this.clock(),
    };

    this.subtasks.push(subtask);
    this.save();
    return subtask;
  }

  updateSubtask({
    description,
    name,
    subtaskId,
  }: {
    description?: string | null;
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
    reporter,
    reportedState,
    subtaskId,
  }: {
    evidence?: string;
    reporter: string;
    reportedState: ReportedState;
    subtaskId: string;
  }): StatusReport {
    this.refreshFromPersistence();
    if (!this.subtasks.some((subtask) => subtask.id === subtaskId)) {
      throw new Error(`Subtask ${subtaskId} does not exist.`);
    }

    const report = {
      id: this.idGenerator(),
      subtaskId,
      reportedState,
      reporter,
      evidence,
      createdAt: this.clock(),
    };

    this.statusReports.push(report);
    this.save();
    return report;
  }

  verifyStatusReport({
    decision,
    reportId,
    verifier,
  }: {
    decision: VerificationDecision;
    reportId: string;
    verifier: string;
  }): void {
    this.refreshFromPersistence();
    if (!this.statusReports.some((report) => report.id === reportId)) {
      throw new Error(`Status Report ${reportId} does not exist.`);
    }

    this.verifications.push({
      id: this.idGenerator(),
      reportId,
      decision,
      verifier,
      createdAt: this.clock(),
    });
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
      .map((subtask) => {
        const report = this.getCurrentStatusReport(subtask.id);

        if (!report) {
          return {
            ...(subtask.archiveState
              ? { archiveState: subtask.archiveState }
              : {}),
            verificationState: "unreported" as const,
          };
        }

        return {
          ...(subtask.archiveState
            ? { archiveState: subtask.archiveState }
            : {}),
          id: report.id,
          reportId: report.id,
          reportedState: report.reportedState,
          evidence: report.evidence,
          reporter: report.reporter,
          verificationState:
            this.getCurrentVerification(report.id)?.decision ??
            ("awaiting_verification" as const),
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

    return {
      taskCompleted,
      ...(task.archiveState ? { archiveState: task.archiveState } : {}),
      taskState:
        task.archiveState ??
        this.deriveTaskWorkState(taskCompleted, activeSubtasks),
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
      planned: 0,
      active: 1,
      blocked: 2,
      awaiting_verification: 3,
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
          left.projectName.localeCompare(right.projectName) ||
          stateOrder[left.state] - stateOrder[right.state] ||
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
        .map((task) => ({
          id: task.id,
          name: task.name,
          projectId: task.projectId,
          ...(task.branchName ? { branchName: task.branchName } : {}),
          ...(task.archiveState ? { archiveState: task.archiveState } : {}),
          subtasks: this.subtasks
            .filter((subtask) => subtask.taskId === task.id)
            .map((subtask) => ({
              id: subtask.id,
              name: subtask.name,
              taskId: subtask.taskId,
              ...(subtask.archiveState
                ? { archiveState: subtask.archiveState }
                : {}),
              ...(subtask.description !== undefined
                ? { description: subtask.description }
                : {}),
            })),
        })),
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
    archiveState?: ArchiveState;
    trackerLinks: TrackerLink[];
  } {
    this.refreshFromPersistence();
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist.`);
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
      ...(task.archiveState ? { archiveState: task.archiveState } : {}),
      trackerLinks: this.trackerLinks.filter((link) => link.taskId === taskId),
    };
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

    if (
      subtasks.some(
        (subtask) =>
          subtask.reportedState === "blocked" ||
          subtask.verificationState === "rejected" ||
          subtask.verificationState === "deferred",
      )
    ) {
      return "blocked";
    }

    if (
      subtasks.some(
        (subtask) =>
          subtask.verificationState === "awaiting_verification" &&
          subtask.reportedState === "complete",
      )
    ) {
      return "awaiting_verification";
    }

    if (
      subtasks.some(
        (subtask) =>
          subtask.reportedState === "in_progress" ||
          subtask.verificationState === "accepted",
      )
    ) {
      return "active";
    }

    return "planned";
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
