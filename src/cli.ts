import {
  backupFactoryDatabase,
  checkFactoryDatabase,
  createFactoryApplication,
  type ArchiveState,
  type ReportedState,
  type VerificationDecision,
} from "./application";

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
      if (!next || next.startsWith("--")) {
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
      ["not_started", "in_progress", "blocked", "complete"] as string[]
    ).includes(value)
  ) {
    throw new Error(
      "--state must be not_started, in_progress, blocked, or complete.",
    );
  }
  return value as ReportedState;
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

function main(args: string[]): void {
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
    output({ projects: application.listProjects().map(projectSummary) });
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
    output({ attention: application.getAttentionProjection() });
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

  if (resource === "task" && action === "update") {
    const branchName =
      parsed.flags.get("branch-name") ?? parsed.flags.get("branch");
    if (branchName === undefined) {
      throw new Error("Missing required --branch-name.");
    }
    const task = application.updateTask({
      branchName,
      taskId: requiredFlag(parsed.flags, "task-id"),
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
      taskId: requiredFlag(parsed.flags, "task-id"),
    });
    output({ subtask });
    return;
  }

  if (resource === "subtask" && action === "report") {
    const report = application.reportSubtaskStatus({
      evidence: parsed.flags.get("evidence"),
      reportedState: reportedStateFlag(parsed.flags),
      reporter: requiredFlag(parsed.flags, "reporter"),
      subtaskId: requiredFlag(parsed.flags, "subtask-id"),
    });
    output({ report });
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
    "Usage: database backup|check, project create|update|list|remove|status|portfolio|attention|link, task create|update|detail|status|archive|restore|link, subtask create|report|status|archive|restore|history|verify",
  );
}

if (import.meta.main) {
  try {
    main(Bun.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
