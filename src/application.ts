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
  createdAt: Date;
};

type Subtask = {
  id: string;
  name: string;
  taskId: string;
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

type Verification = {
  id: string;
  reportId: string;
  decision: VerificationDecision;
  verifier: string;
  createdAt: Date;
};

type FactoryState = {
  projects: Project[];
  tasks: Task[];
  subtasks: Subtask[];
  statusReports: StatusReport[];
  verifications: Verification[];
};

export type ProjectHierarchy = {
  name: string;
  tasks: Array<{
    name: string;
    subtasks: Array<{
      name: string;
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

  createTask({ name, projectId }: { name: string; projectId: string }): Task {
    if (!this.projects.some((project) => project.id === projectId)) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    const task = {
      id: this.idGenerator(),
      name,
      projectId,
      createdAt: this.clock(),
    };

    this.tasks.push(task);
    this.save();
    return task;
  }

  createSubtask({ name, taskId }: { name: string; taskId: string }): Subtask {
    if (!this.tasks.some((task) => task.id === taskId)) {
      throw new Error(`Task ${taskId} does not exist.`);
    }

    const subtask = {
      id: this.idGenerator(),
      name,
      taskId,
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

  getTaskStatus(taskId: string): {
    taskCompleted: boolean;
    subtasks: Array<{
      reportedState?: ReportedState;
      verificationState:
        | "accepted"
        | "awaiting_verification"
        | "deferred"
        | "rejected"
        | "unreported";
    }>;
  } {
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
          reportedState: report.reportedState,
          verificationState:
            this.getCurrentVerification(report.id)?.decision ??
            ("awaiting_verification" as const),
        };
      });

    return {
      taskCompleted:
        subtasks.length > 0 &&
        subtasks.every(
          (subtask) =>
            subtask.reportedState === "complete" &&
            subtask.verificationState === "accepted",
        ),
      subtasks,
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

  getProjectHierarchy(projectId: string): ProjectHierarchy {
    const project = this.projects.find(
      (candidate) => candidate.id === projectId,
    );

    if (!project) {
      throw new Error(`Project ${projectId} does not exist.`);
    }

    return {
      name: project.name,
      tasks: this.tasks
        .filter((task) => task.projectId === project.id)
        .map((task) => ({
          name: task.name,
          subtasks: this.subtasks
            .filter((subtask) => subtask.taskId === task.id)
            .map((subtask) => ({ name: subtask.name })),
        })),
    };
  }

  private getCurrentStatusReport(subtaskId: string): StatusReport | undefined {
    return this.statusReports.findLast(
      (report) => report.subtaskId === subtaskId,
    );
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
      createdAt: new Date(task.createdAt),
    })),
    verifications: state.verifications.map((verification) => ({
      ...verification,
      createdAt: new Date(verification.createdAt),
    })),
  };
}
import { Database } from "bun:sqlite";
