import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Database } from "bun:sqlite";

export type FactoryClock = () => Date;
export type FactoryIdGenerator = () => string;

export type FactoryApplicationOptions = {
  clock: FactoryClock;
  idGenerator: FactoryIdGenerator;
  state?: FactoryState;
  persist?: (state: FactoryState) => void;
};

type Project = {
  id: string;
  name: string;
  createdAt: Date;
};

type Task = {
  id: string;
  name: string;
  projectId: string;
  objective?: string;
  acceptanceCriteria: string[];
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
  dependencies: string[];
  repositoryLinks: string[];
  createdAt: Date;
};

type Subtask = {
  id: string;
  name: string;
  taskId: string;
  description?: string;
  createdAt: Date;
};

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
  | "blocked";

export type ProjectWorkCounts = Record<ProjectWorkState, number>;

export type TaskStatus = {
  taskCompleted: boolean;
  taskState: ProjectWorkState;
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
  };
}

export type ProjectHierarchy = {
  id: string;
  name: string;
  tasks: Array<{
    id: string;
    name: string;
    projectId: string;
    subtasks: Array<{
      id: string;
      name: string;
      taskId: string;
      description?: string;
    }>;
  }>;
};

export class FactoryApplication {
  private readonly clock: FactoryClock;
  private readonly idGenerator: FactoryIdGenerator;
  private readonly persist?: (state: FactoryState) => void;
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
    state,
  }: FactoryApplicationOptions) {
    this.clock = clock;
    this.idGenerator = idGenerator;
    this.persist = persist;
    this.projects = state?.projects ?? [];
    this.tasks = state?.tasks ?? [];
    this.subtasks = state?.subtasks ?? [];
    this.statusReports = state?.statusReports ?? [];
    this.verifications = state?.verifications ?? [];
    this.trackerLinks = state?.trackerLinks ?? [];
  }

  createProject({ name }: { name: string }): Project {
    const project = {
      id: this.idGenerator(),
      name,
      createdAt: this.clock(),
    };

    this.projects.push(project);
    this.save();
    return project;
  }

  createTask({
    name,
    projectId,
    objective,
    acceptanceCriteria = [],
    priority,
    owner,
    dependencies = [],
    repositoryLinks = [],
  }: {
    name: string;
    projectId: string;
    objective?: string;
    acceptanceCriteria?: string[];
    priority?: "low" | "medium" | "high" | "urgent";
    owner?: string;
    dependencies?: string[];
    repositoryLinks?: string[];
  }): Task {
    if (!this.projects.some((project) => project.id === projectId)) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    const task = {
      id: this.idGenerator(),
      name,
      projectId,
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

  createSubtask({
    description,
    name,
    taskId,
  }: {
    description?: string;
    name: string;
    taskId: string;
  }): Subtask {
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
    if (!this.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task ${taskId} does not exist.`);
    }

    const subtasks = this.subtasks
      .filter((subtask) => subtask.taskId === taskId)
      .map((subtask) => {
        const report = this.getCurrentStatusReport(subtask.id);

        if (!report) {
          return { verificationState: "unreported" as const };
        }

        return {
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

    const taskCompleted =
      subtasks.length > 0 &&
      subtasks.every(
        (subtask) =>
          subtask.reportedState === "complete" &&
          subtask.verificationState === "accepted",
      );

    return {
      taskCompleted,
      taskState: this.deriveTaskWorkState(taskCompleted, subtasks),
      subtasks,
    };
  }

  getProjectStatus(projectId: string): {
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

  getSubtaskReportHistory(subtaskId: string): StatusReport[] {
    if (!this.subtasks.some((subtask) => subtask.id === subtaskId)) {
      throw new Error(`Subtask ${subtaskId} does not exist.`);
    }

    return this.statusReports.filter(
      (report) => report.subtaskId === subtaskId,
    );
  }

  getSubtaskVerificationHistory(subtaskId: string): Verification[] {
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
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );

    if (!project) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    return {
      id: project.id,
      name: project.name,
      tasks: this.tasks
        .filter((task) => task.projectId === project.id)
        .map((task) => ({
          id: task.id,
          name: task.name,
          projectId: task.projectId,
          subtasks: this.subtasks
            .filter((subtask) => subtask.taskId === task.id)
            .map((subtask) => ({
              id: subtask.id,
              name: subtask.name,
              taskId: subtask.taskId,
              ...(subtask.description !== undefined
                ? { description: subtask.description }
                : {}),
            })),
        })),
    };
  }

  listProjects(): Array<{ id: string; name: string }> {
    return this.projects.map(({ id, name }) => ({ id, name }));
  }

  addTaskTrackerLink({
    taskId,
    ...link
  }: TrackerLinkFields & { taskId: string }): TrackerLink {
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
    trackerLinks: TrackerLink[];
  } {
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );
    if (!project) throw new Error(`Project ${projectId} does not exist.`);

    return {
      id: project.id,
      name: project.name,
      trackerLinks: this.trackerLinks.filter(
        (link) => link.projectId === projectId,
      ),
    };
  }

  getTaskDetail(taskId: string): {
    id: string;
    name: string;
    projectId: string;
    objective?: string;
    acceptanceCriteria: string[];
    priority?: "low" | "medium" | "high" | "urgent";
    owner?: string;
    dependencies: string[];
    repositoryLinks: string[];
    trackerLinks: TrackerLink[];
  } {
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new Error(`Task ${taskId} does not exist.`);
    return {
      id: task.id,
      name: task.name,
      projectId: task.projectId,
      objective: task.objective,
      acceptanceCriteria: task.acceptanceCriteria,
      priority: task.priority,
      owner: task.owner,
      dependencies: task.dependencies,
      repositoryLinks: task.repositoryLinks,
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
