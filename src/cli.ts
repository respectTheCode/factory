import {
  backupFactoryDatabase,
  checkFactoryDatabase,
  createFactoryApplication,
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
        if (flag === "json" || flag === "overwrite") {
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

function projectSummary(project: { id: string; name: string }) {
  return { id: project.id, name: project.name };
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

  if (resource === "project" && action === "create") {
    const project = application.createProject({
      name: requiredFlag(parsed.flags, "name"),
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

  if (resource === "task" && action === "create") {
    const task = application.createTask({
      acceptanceCriteria: listFlag(parsed.flags, "acceptance-criteria"),
      dependencies: listFlag(parsed.flags, "dependencies"),
      name: requiredFlag(parsed.flags, "name"),
      objective: parsed.flags.get("objective")?.trim() || undefined,
      owner: parsed.flags.get("owner")?.trim() || undefined,
      priority: parsed.flags.get("priority") as
        | "low"
        | "medium"
        | "high"
        | "urgent"
        | undefined,
      projectId: requiredFlag(parsed.flags, "project-id"),
      repositoryLinks: listFlag(parsed.flags, "repository-links"),
    });
    output({ task });
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
      reportedState: requiredFlag(parsed.flags, "state") as ReportedState,
      reporter: requiredFlag(parsed.flags, "reporter"),
      subtaskId: requiredFlag(parsed.flags, "subtask-id"),
    });
    output({ report });
    return;
  }

  if (resource === "subtask" && action === "status") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    output({ status: application.getTaskStatus(taskId) });
    return;
  }

  if (resource === "subtask" && action === "verify") {
    void (requiredFlag(parsed.flags, "decision") as VerificationDecision);
    throw new Error(
      "Human verification must be performed in the Factory dashboard; the noninteractive CLI cannot verify reports.",
    );
  }

  throw new Error(
    "Usage: database backup|check, project create|list|status|portfolio, task create, subtask create|report|status|verify",
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
