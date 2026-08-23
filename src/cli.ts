import {
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
  const databasePath = parsed.flags.get("database") ?? "factory.sqlite";
  const application = createFactoryApplication({ databasePath });
  const [resource, action] = parsed.command;

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

  if (resource === "task" && action === "create") {
    const task = application.createTask({
      name: requiredFlag(parsed.flags, "name"),
      projectId: requiredFlag(parsed.flags, "project-id"),
    });
    output({ task });
    return;
  }

  if (resource === "subtask" && action === "create") {
    const subtask = application.createSubtask({
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
    "Usage: project create|list, task create, subtask create|report|status|verify",
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
