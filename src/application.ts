export type FactoryClock = () => Date;
export type FactoryIdGenerator = () => string;

export type FactoryApplicationOptions = {
  clock: FactoryClock;
  idGenerator: FactoryIdGenerator;
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
  private readonly projects: Project[] = [];
  private readonly tasks: Task[] = [];
  private readonly subtasks: Subtask[] = [];

  constructor({ clock, idGenerator }: FactoryApplicationOptions) {
    this.clock = clock;
    this.idGenerator = idGenerator;
  }

  createProject({ name }: { name: string }): Project {
    const project = {
      id: this.idGenerator(),
      name,
      createdAt: this.clock(),
    };

    this.projects.push(project);
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
    return subtask;
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
}
