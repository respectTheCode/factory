import {
  backupFactoryDatabase,
  checkFactoryDatabase,
  createFactoryApplication,
  type ArchiveState,
  type ReportedState,
  type VerificationDecision,
  type WorkState,
} from "./application";
import { createGitHubStatusReader, parseGitHubPullRequestUrl } from "./github";

const SCHEMA_VERSION = 1 as const;

type ParsedArgs = {
  command: string[];
  flags: Map<string, string>;
};

function parseArgs(args: string[]): ParsedArgs {
  const command: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value) continue;
    if (value.startsWith("--")) {
      const flag = value.slice(2);
      const next = args[index + 1];
      if (next === undefined || next.startsWith("--")) {
        if (flag === "confirm" || flag === "json" || flag === "overwrite") {
          flags.set(flag, "true");
          continue;
        }
        throw new Error(`Flag --${flag} requires a value.`);
      }
      flags.set(flag, next);
      index += 1;
      continue;
    }
    command.push(value);
  }

  return { command, flags };
}

function requiredFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name)?.trim();
  if (!value) throw new Error(`Missing required --${name}.`);
  return value;
}

function listFlag(flags: Map<string, string>, name: string): string[] {
  const value = flags.get(name);
  if (!value) return [];
  return value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function orderedIdsFlag(
  flags: Map<string, string>,
  name: "subtask-ids" | "task-ids",
): string[] {
  const value = requiredFlag(flags, name);
  const ids = value
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (ids.length === 0)
    throw new Error(`--${name} must include at least one ID.`);
  return ids;
}

function trackerSystem(flags: Map<string, string>): "linear" | "notion" {
  const value = requiredFlag(flags, "system");
  if (value !== "linear" && value !== "notion") {
    throw new Error("--system must be either linear or notion.");
  }
  return value;
}

function priorityFlag(
  flags: Map<string, string>,
): "low" | "medium" | "high" | "urgent" | undefined {
  const value = flags.get("priority")?.trim();
  if (!value) return undefined;
  if (!(["low", "medium", "high", "urgent"] as string[]).includes(value)) {
    throw new Error("--priority must be low, medium, high, or urgent.");
  }
  return value as "low" | "medium" | "high" | "urgent";
}

function reportedStateFlag(flags: Map<string, string>): ReportedState {
  const value = requiredFlag(flags, "state");
  if (
    !(
      [
        "not_started",
        "in_progress",
        "blocked",
        "complete",
        "backlog",
      ] as string[]
    ).includes(value)
  ) {
    throw new Error(
      "--state must be not_started, in_progress, blocked, complete, or backlog.",
    );
  }
  return value as ReportedState;
}

function workStateFlag(flags: Map<string, string>): WorkState {
  const value = (flags.get("state") ?? flags.get("work-state"))?.trim();
  if (!value) throw new Error("Missing required --state.");
  if (
    !(
      [
        "backlog",
        "planned",
        "active",
        "awaiting_verification",
        "blocked",
        "completed",
      ] as string[]
    ).includes(value)
  ) {
    throw new Error(
      "--state must be backlog, planned, active, awaiting_verification, blocked, or completed.",
    );
  }
  return value as WorkState;
}

function editableTaskStateFlag(
  flags: Map<string, string>,
): Exclude<WorkState, "completed"> {
  const value = (flags.get("state") ?? flags.get("work-state"))?.trim();
  if (!value) throw new Error("Missing required --state.");
  if (
    !(
      [
        "backlog",
        "planned",
        "active",
        "awaiting_verification",
        "blocked",
      ] as string[]
    ).includes(value)
  ) {
    throw new Error(
      "--state must be backlog, planned, active, awaiting_verification, or blocked; completed is set by human verification.",
    );
  }
  return value as Exclude<WorkState, "completed">;
}

function archiveStateFlag(flags: Map<string, string>): ArchiveState {
  const value = requiredFlag(flags, "state");
  if (value !== "released" && value !== "wont_do") {
    throw new Error("--state must be released or wont_do.");
  }
  return value;
}

function urlFlag(flags: Map<string, string>): string {
  const value = requiredFlag(flags, "url");
  try {
    new URL(value);
  } catch {
    throw new Error("--url must be a valid URL.");
  }
  return value;
}

function output(value: unknown): void {
  console.log(
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, ...asRecord(value) }),
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CLI output must be an object.");
  }
  return value as Record<string, unknown>;
}

async function readGitHubStatus(pullRequestUrl: string | undefined) {
  if (!pullRequestUrl) {
    return {
      checkRuns: [],
      checkRunsStatus: "not_requested" as const,
      fetchedAt: new Date().toISOString(),
      status: "not_linked" as const,
      workflowRuns: [],
      workflowRunsStatus: "not_requested" as const,
    };
  }

  return createGitHubStatusReader({
    token: Bun.env.GITHUB_TOKEN ?? Bun.env.GH_TOKEN,
  }).read(parseGitHubPullRequestUrl(pullRequestUrl));
}

function projectSummary(project: {
  gitOriginUrl?: string;
  id: string;
  name: string;
}) {
  return {
    id: project.id,
    name: project.name,
    ...(project.gitOriginUrl ? { gitOriginUrl: project.gitOriginUrl } : {}),
  };
}

function gitOriginFlag(flags: Map<string, string>): string | undefined {
  const value = flags.get("git-origin-url") ?? flags.get("git-url");
  if (value === undefined) return undefined;
  if (!value.trim()) throw new Error("--git-origin-url must not be empty.");
  return value.trim();
}

function normalizeGitOriginUrl(value: string): string {
  const trimmed = value.trim();
  const normalizePath = (path: string) =>
    path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");

  if (!trimmed.includes("://")) {
    const scpStyle = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
    if (scpStyle?.[1] && scpStyle[2]) {
      return `${scpStyle[1].toLowerCase()}/${normalizePath(scpStyle[2])}`;
    }
  }

  try {
    const url = new URL(trimmed);
    if (url.protocol === "file:") {
      return `file://${url.host.toLowerCase()}/${normalizePath(url.pathname)}`;
    }
    return `${url.host.toLowerCase()}/${normalizePath(url.pathname)}`;
  } catch {
    return normalizePath(trimmed);
  }
}

function projectsMatchingGitOrigin(
  application: ReturnType<typeof createFactoryApplication>,
  gitOriginUrl: string,
) {
  const normalizedOrigin = normalizeGitOriginUrl(gitOriginUrl);
  return application
    .listProjects()
    .filter(
      (project) =>
        project.gitOriginUrl !== undefined &&
        normalizeGitOriginUrl(project.gitOriginUrl) === normalizedOrigin,
    );
}

async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const [resource, action] = parsed.command;

  if (resource === "database" && action === "backup") {
    output({
      backup: backupFactoryDatabase({
        allowOverwrite: parsed.flags.get("overwrite") === "true",
        databasePath: parsed.flags.get("database") ?? "factory.sqlite",
        destinationPath: requiredFlag(parsed.flags, "output"),
      }),
    });
    return;
  }

  if (resource === "database" && action === "check") {
    output({
      check: checkFactoryDatabase({
        databasePath: parsed.flags.get("database") ?? "factory.sqlite",
      }),
    });
    return;
  }

  const databasePath = parsed.flags.get("database") ?? "factory.sqlite";
  const application = createFactoryApplication({ databasePath });

  if (resource === "project" && action === "remove") {
    if (parsed.flags.get("confirm") !== "true") {
      throw new Error(
        "Project removal is destructive; pass --confirm after checking the project ID.",
      );
    }
    const projectId = requiredFlag(parsed.flags, "project-id");
    application.removeProject(projectId);
    output({ removed: { projectId } });
    return;
  }

  if (resource === "project" && action === "create") {
    const project = application.createProject({
      gitOriginUrl:
        parsed.flags.get("git-origin-url") ?? parsed.flags.get("git-url"),
      name: requiredFlag(parsed.flags, "name"),
    });
    output({ project: projectSummary(project) });
    return;
  }

  if (resource === "project" && action === "update") {
    const gitOriginUrl =
      parsed.flags.get("git-origin-url") ?? parsed.flags.get("git-url");
    if (gitOriginUrl === undefined) {
      throw new Error("Missing required --git-origin-url.");
    }
    const project = application.updateProject({
      gitOriginUrl,
      projectId: requiredFlag(parsed.flags, "project-id"),
    });
    output({ project: projectSummary(project) });
    return;
  }

  if (resource === "project" && action === "list") {
    const gitOriginUrl = gitOriginFlag(parsed.flags);
    const projects = gitOriginUrl
      ? projectsMatchingGitOrigin(application, gitOriginUrl)
      : application.listProjects();
    output({ projects: projects.map(projectSummary) });
    return;
  }

  if (resource === "project" && action === "context") {
    const gitOriginUrl = gitOriginFlag(parsed.flags);
    if (!gitOriginUrl) throw new Error("Missing required --git-origin-url.");

    const projects = projectsMatchingGitOrigin(application, gitOriginUrl);
    if (projects.length === 0) {
      throw new Error(`No Factory Project matches Git origin ${gitOriginUrl}.`);
    }
    if (projects.length > 1) {
      throw new Error(
        `Git origin ${gitOriginUrl} matches multiple Factory Projects: ${projects
          .map((project) => project.id)
          .join(", ")}.`,
      );
    }

    const project = projects[0];
    if (!project) throw new Error("Factory Project resolution failed.");
    const hierarchy = application.getProjectHierarchy(project.id);
    const projectDetail = application.getProjectDetail(project.id);
    const branchFlag =
      parsed.flags.get("branch-name") ?? parsed.flags.get("branch");
    const branchName = branchFlag?.trim();
    if (branchFlag !== undefined && !branchName) {
      throw new Error("--branch-name must not be empty.");
    }

    let tasks = hierarchy.tasks.map((task) => ({
      ...application.getTaskDetail(task.id),
      subtasks: task.subtasks,
    }));
    if (branchName) {
      tasks = tasks.filter((task) => task.branchName === branchName);
      if (tasks.length === 0) {
        throw new Error(
          `No Factory Task in Project ${project.id} matches branch ${branchName}.`,
        );
      }
      if (tasks.length > 1) {
        throw new Error(
          `Branch ${branchName} matches multiple Factory Tasks in Project ${project.id}: ${tasks
            .map((task) => task.id)
            .join(", ")}.`,
        );
      }
    }

    output({
      context: {
        id: hierarchy.id,
        name: hierarchy.name,
        ...(hierarchy.gitOriginUrl
          ? { gitOriginUrl: hierarchy.gitOriginUrl }
          : {}),
        trackerLinks: projectDetail.trackerLinks,
        tasks,
      },
    });
    return;
  }

  if (resource === "project" && action === "status") {
    output({
      status: application.getProjectStatus(
        requiredFlag(parsed.flags, "project-id"),
      ),
    });
    return;
  }

  if (resource === "project" && action === "portfolio") {
    output({ portfolio: application.getPortfolioStatus() });
    return;
  }

  if (resource === "project" && action === "attention") {
    const gitOriginUrl = gitOriginFlag(parsed.flags);
    const matchingProjectIds = gitOriginUrl
      ? new Set(
          projectsMatchingGitOrigin(application, gitOriginUrl).map(
            (project) => project.id,
          ),
        )
      : undefined;
    output({
      attention: application
        .getAttentionProjection()
        .filter(
          (item) =>
            matchingProjectIds === undefined ||
            matchingProjectIds.has(item.projectId),
        ),
    });
    return;
  }

  if (resource === "project" && action === "link") {
    const link = application.addProjectTrackerLink({
      projectId: requiredFlag(parsed.flags, "project-id"),
      stableId: requiredFlag(parsed.flags, "stable-id"),
      system: trackerSystem(parsed.flags),
      title: parsed.flags.get("title")?.trim() || undefined,
      url: urlFlag(parsed.flags),
    });
    output({ link });
    return;
  }

  if (resource === "task" && action === "create") {
    const task = application.createTask({
      acceptanceCriteria: listFlag(parsed.flags, "acceptance-criteria"),
      branchName: parsed.flags.get("branch-name") ?? parsed.flags.get("branch"),
      dependencies: listFlag(parsed.flags, "dependencies"),
      name: requiredFlag(parsed.flags, "name"),
      objective: parsed.flags.get("objective")?.trim() || undefined,
      owner: parsed.flags.get("owner")?.trim() || undefined,
      pullRequestUrl:
        parsed.flags.get("pull-request-url") ?? parsed.flags.get("pr"),
      priority: priorityFlag(parsed.flags),
      projectId: requiredFlag(parsed.flags, "project-id"),
      repositoryLinks: listFlag(parsed.flags, "repository-links"),
    });
    output({ task });
    return;
  }

  if (resource === "task" && action === "detail") {
    output({
      task: application.getTaskDetail(requiredFlag(parsed.flags, "task-id")),
    });
    return;
  }

  if (resource === "task" && action === "state") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    application.setTaskWorkState({
      reason: parsed.flags.get("reason"),
      taskId,
      workState: editableTaskStateFlag(parsed.flags),
    });
    output({ status: application.getTaskStatus(taskId) });
    return;
  }

  if (resource === "task" && action === "reorder") {
    const projectId = requiredFlag(parsed.flags, "project-id");
    const workState = workStateFlag(parsed.flags);
    const taskIds = orderedIdsFlag(parsed.flags, "task-ids");
    application.reorderTasks({
      orderedTaskIds: taskIds,
      projectId,
      workState,
    });
    output({ order: { projectId, taskIds, workState } });
    return;
  }

  if (resource === "task" && action === "update") {
    const acceptanceCriteria = parsed.flags.has("acceptance-criteria")
      ? listFlag(parsed.flags, "acceptance-criteria")
      : undefined;
    const title = parsed.flags.get("title");
    const description = parsed.flags.get("description");
    const branchName =
      parsed.flags.get("branch-name") ?? parsed.flags.get("branch");
    const pullRequestUrl =
      parsed.flags.get("pull-request-url") ?? parsed.flags.get("pr");
    if (
      title === undefined &&
      description === undefined &&
      acceptanceCriteria === undefined &&
      branchName === undefined &&
      pullRequestUrl === undefined
    ) {
      throw new Error(
        "Provide at least one of --title, --description, --acceptance-criteria, --branch-name, or --pull-request-url.",
      );
    }
    const taskId = requiredFlag(parsed.flags, "task-id");
    if (acceptanceCriteria !== undefined) {
      const status = application.getTaskStatus(taskId);
      if (status.taskState !== "planned") {
        throw new Error(
          "Acceptance criteria may only be changed during the planning phase while the Task is planned.",
        );
      }
    }
    const task = application.updateTask({
      acceptanceCriteria,
      branchName,
      name: title,
      objective: description,
      pullRequestUrl,
      taskId,
    });
    output({ task });
    return;
  }

  if (resource === "task" && action === "status") {
    output({
      status: application.getTaskStatus(requiredFlag(parsed.flags, "task-id")),
    });
    return;
  }

  if (resource === "task" && action === "github-status") {
    const task = application.getTaskDetail(
      requiredFlag(parsed.flags, "task-id"),
    );
    output({ status: await readGitHubStatus(task.pullRequestUrl) });
    return;
  }

  if (resource === "task" && action === "archive") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    const archiveState = archiveStateFlag(parsed.flags);
    application.archiveTask(taskId, archiveState);
    output({ task: { archiveState, taskId } });
    return;
  }

  if (resource === "task" && action === "restore") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    application.restoreTask(taskId);
    output({ task: { archiveState: null, taskId } });
    return;
  }

  if (resource === "task" && action === "link") {
    const link = application.addTaskTrackerLink({
      stableId: requiredFlag(parsed.flags, "stable-id"),
      system: trackerSystem(parsed.flags),
      taskId: requiredFlag(parsed.flags, "task-id"),
      title: parsed.flags.get("title")?.trim() || undefined,
      url: urlFlag(parsed.flags),
    });
    output({ link });
    return;
  }

  if (resource === "subtask" && action === "create") {
    const subtask = application.createSubtask({
      description: parsed.flags.get("description")?.trim() || undefined,
      name: requiredFlag(parsed.flags, "name"),
      pullRequestUrl:
        parsed.flags.get("pull-request-url") ?? parsed.flags.get("pr"),
      taskId: requiredFlag(parsed.flags, "task-id"),
    });
    output({ subtask });
    return;
  }

  if (resource === "subtask" && action === "update") {
    const evidence = parsed.flags.get("evidence");
    const title = parsed.flags.get("title");
    const description = parsed.flags.get("description");
    const pullRequestUrl =
      parsed.flags.get("pull-request-url") ?? parsed.flags.get("pr");
    if (
      title === undefined &&
      description === undefined &&
      evidence === undefined &&
      pullRequestUrl === undefined
    ) {
      throw new Error(
        "Provide at least one of --title, --description, --evidence, or --pull-request-url.",
      );
    }
    const subtask = application.updateSubtask({
      description,
      evidence,
      name: title,
      pullRequestUrl,
      subtaskId: requiredFlag(parsed.flags, "subtask-id"),
    });
    output({ subtask });
    return;
  }

  if (resource === "subtask" && action === "report") {
    const report = application.reportSubtaskStatus({
      evidence: parsed.flags.get("evidence"),
      reportedState: reportedStateFlag(parsed.flags),
      reporter: requiredFlag(parsed.flags, "reporter"),
      reason: parsed.flags.get("reason"),
      subtaskId: requiredFlag(parsed.flags, "subtask-id"),
    });
    output({ report });
    return;
  }

  if (resource === "subtask" && action === "reorder") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    const workState = workStateFlag(parsed.flags);
    const subtaskIds = orderedIdsFlag(parsed.flags, "subtask-ids");
    application.reorderSubtasks({
      orderedSubtaskIds: subtaskIds,
      taskId,
      workState,
    });
    output({ order: { subtaskIds, taskId, workState } });
    return;
  }

  if (resource === "subtask" && action === "archive") {
    const subtaskId = requiredFlag(parsed.flags, "subtask-id");
    const archiveState = archiveStateFlag(parsed.flags);
    application.archiveSubtask(subtaskId, archiveState);
    output({ subtask: { archiveState, subtaskId } });
    return;
  }

  if (resource === "subtask" && action === "restore") {
    const subtaskId = requiredFlag(parsed.flags, "subtask-id");
    application.restoreSubtask(subtaskId);
    output({ subtask: { archiveState: null, subtaskId } });
    return;
  }

  if (resource === "subtask" && action === "status") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    output({ status: application.getTaskStatus(taskId) });
    return;
  }

  if (resource === "subtask" && action === "github-status") {
    const subtask = application.getSubtaskDetail(
      requiredFlag(parsed.flags, "subtask-id"),
    );
    output({ status: await readGitHubStatus(subtask.pullRequestUrl) });
    return;
  }

  if (resource === "subtask" && action === "history") {
    const subtaskId = requiredFlag(parsed.flags, "subtask-id");
    output({
      history: {
        reports: application.getSubtaskReportHistory(subtaskId),
        verifications: application.getSubtaskVerificationHistory(subtaskId),
      },
    });
    return;
  }

  if (resource === "subtask" && action === "verify") {
    void (requiredFlag(parsed.flags, "decision") as VerificationDecision);
    throw new Error(
      "Human verification must be performed in the Factory dashboard; the noninteractive CLI cannot verify reports.",
    );
  }

  throw new Error(
    "Usage: database backup|check, project create|update|list|context|remove|status|portfolio|attention|link, task create|update|detail|state|status|github-status|reorder|archive|restore|link, subtask create|update|report|reorder|status|github-status|archive|restore|history|verify",
  );
}

if (import.meta.main) {
  void main(Bun.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
