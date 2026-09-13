export const DEFAULT_BRIEF_MAX_CHARACTERS = 6000;

export type BriefTrackerLink = {
  system: string;
  stableId: string;
  url: string;
};

export type BriefSubtask = {
  id: string;
  simpleId: string;
  name: string;
  description?: string;
  effectiveState: string;
  accepted: boolean;
  awaitingVerification: boolean;
  latestReport?: {
    state: string;
    reporter: string;
    createdAt: string;
  };
};

export type BriefTask = {
  id: string;
  simpleId: string;
  name: string;
  objective?: string;
  branchName?: string;
  pullRequestUrl?: string;
  acceptanceCriteria: string[];
  dependencies: string[];
  workState: string;
  stateReason?: string;
  manualHold: boolean;
  trackerLinks: BriefTrackerLink[];
  subtasks: BriefSubtask[];
  reportSubtaskId?: string;
};

export type BriefOpenTask = {
  id: string;
  simpleId: string;
  name: string;
  workState: string;
  priority?: string;
};

export type BriefInput = {
  project: {
    id: string;
    name: string;
    trackerLinks: BriefTrackerLink[];
  };
  task?: BriefTask;
  openTasks: BriefOpenTask[];
  branchResolutionNote?: string;
  databasePath?: string;
  checkoutPath: string;
  cliCommand?: string;
  remote?: {
    url: string;
    accessTokenFile: string;
  };
  maxCharacters?: number;
};

export type BriefRenderResult = {
  markdown: string;
  characterCount: number;
  maxCharacters: number;
  truncated: boolean;
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function renderTrackerLinks(links: BriefTrackerLink[]): string[] {
  return links.map(
    (link) =>
      `- ${oneLine(link.system)} ${oneLine(link.stableId)}: ${oneLine(link.url)}`,
  );
}

function renderProjectSection(input: BriefInput): string[] {
  return [
    `# Factory brief: ${oneLine(input.project.name)} (${input.project.id})`,
    ...renderTrackerLinks(input.project.trackerLinks),
  ];
}

function renderTaskSection(task: BriefTask): string[] {
  const lines = [
    `## Task ${task.simpleId}: ${oneLine(task.name)}`,
    `Objective: ${task.objective ? oneLine(task.objective) : "(none)"}`,
    `Branch: ${task.branchName ? oneLine(task.branchName) : "none"} · PR: ${
      task.pullRequestUrl ? oneLine(task.pullRequestUrl) : "none"
    }`,
    "Acceptance criteria:",
  ];
  if (task.acceptanceCriteria.length === 0) {
    lines.push("1. (none)");
  } else {
    task.acceptanceCriteria.forEach((criterion, index) => {
      lines.push(`${index + 1}. ${oneLine(criterion)}`);
    });
  }
  if (task.dependencies.length > 0) {
    lines.push(
      `Dependencies: ${task.dependencies.map((dependency) => oneLine(dependency)).join(", ")}`,
    );
  }
  lines.push(...renderTrackerLinks(task.trackerLinks));
  return lines;
}

function renderOpenTasksSection(input: BriefInput): string[] {
  const visibleTasks = input.openTasks.slice(0, 20);
  const lines = ["## Open Tasks"];
  if (input.branchResolutionNote) lines.push(input.branchResolutionNote);
  if (visibleTasks.length === 0) {
    lines.push("- None");
  } else {
    lines.push(
      ...visibleTasks.map(
        (task) =>
          `- ${task.simpleId} — ${oneLine(task.name)} [${task.workState}${
            task.priority ? `, ${oneLine(task.priority)}` : ""
          }]`,
      ),
    );
    const remaining = input.openTasks.length - visibleTasks.length;
    if (remaining > 0) lines.push(`+${remaining} more`);
  }
  return lines;
}

// Long Subtask descriptions would otherwise consume the whole brief budget and
// push the Commands section past the truncation point.
const SUBTASK_DESCRIPTION_MAX = 240;

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

function renderSubtasksSection(task: BriefTask): string[] {
  const lines = ["## Subtasks"];
  if (task.subtasks.length === 0) {
    lines.push("- None");
    return lines;
  }
  for (const subtask of task.subtasks) {
    const detail = subtask.accepted
      ? "accepted"
      : subtask.awaitingVerification
        ? "awaiting verification"
        : subtask.description
          ? clip(oneLine(subtask.description), SUBTASK_DESCRIPTION_MAX)
          : "(none)";
    lines.push(`- ${subtask.simpleId} — ${oneLine(subtask.name)}: ${detail}`);
  }
  return lines;
}

function renderHowToWork(): string[] {
  return [
    "## How to work",
    "- Before starting a Subtask, report in_progress with --evidence. At handoff, report complete with --reason naming the human check, or blocked with the blocker.",
    "- Never verify or complete; a human does that in the dashboard. Reports are append-only claims.",
    "- Set FACTORY_REPORTER=claude or codex. Full rules: skills/software-factory/SKILL.md",
  ];
}

function resolvedCliCommand(input: BriefInput): string {
  // The compiled client sets FACTORY_CLI_COMMAND so remote briefs stay
  // usable on machines that have no Factory checkout or Bun installation.
  return (
    input.cliCommand?.trim() ||
    Bun.env.FACTORY_CLI_COMMAND?.trim() ||
    "bun run src/cli.ts"
  );
}

function renderCommands(input: BriefInput, cli: string): string[] {
  const command = (value: string) =>
    input.remote
      ? `${cli} ${value}`
      : `${cli} ${value} --database "$FACTORY_DB"`;
  const lines = [
    `## Commands (run from ${input.checkoutPath})`,
    "",
    "```sh",
    ...(input.remote
      ? [
          `export FACTORY_URL=${shellQuote(input.remote.url)}`,
          `export FACTORY_ACCESS_TOKEN_FILE=${shellQuote(input.remote.accessTokenFile)}`,
        ]
      : [`export FACTORY_DB=${shellQuote(input.databasePath ?? "")}`]),
    'export T3_BASE_URL="${T3_BASE_URL:-http://127.0.0.1:3773}"',
    'export T3_ACCESS_TOKEN_FILE="${T3_ACCESS_TOKEN_FILE:-$HOME/Library/Application Support/Factory/secrets/t3-read-token}"',
  ];

  if (input.task) {
    if (input.task.reportSubtaskId) {
      lines.push(
        command(
          `subtask report --json --subtask-id ${input.task.reportSubtaskId} --state in_progress --reporter "$FACTORY_REPORTER" --evidence "..."`,
        ),
      );
    }
    if (input.task.branchName) {
      lines.push(
        command(
          `session auto-link --project-id ${input.project.id} --task-id ${input.task.simpleId} --branch-name ${shellQuote(input.task.branchName)} --json`,
        ),
      );
    }
    if (input.task.reportSubtaskId) {
      lines.push(
        command(
          `subtask history --subtask-id ${input.task.reportSubtaskId} --json`,
        ),
      );
    }
    lines.push(command(`task detail --task-id ${input.task.simpleId} --json`));
  } else {
    lines.push(
      command("task detail --task-id TASK_ID --json"),
      command(
        'subtask report --json --subtask-id SUBTASK_ID --state in_progress --reporter "$FACTORY_REPORTER" --evidence "..."',
      ),
    );
  }

  lines.push("```");
  return lines;
}

function renderCurrentStatus(task: BriefTask): string[] {
  const lines = ["## Current status"];
  const hold = task.manualHold ? ", manual hold" : "";
  const reason = task.stateReason ? ` — ${oneLine(task.stateReason)}` : "";
  lines.push(`- Task: ${task.workState}${hold}${reason}`);
  for (const subtask of task.subtasks) {
    const report = subtask.latestReport;
    lines.push(
      report
        ? `- ${subtask.simpleId} ${subtask.effectiveState}; last report ${report.state} by ${report.reporter} ${report.createdAt.slice(0, 10)}`
        : `- ${subtask.simpleId} ${subtask.effectiveState}; no report`,
    );
  }
  return lines;
}

function truncateBrief(
  stable: string,
  volatile: string,
  input: BriefInput,
  maxCharacters: number,
  cli: string,
): BriefRenderResult {
  const full = `${stable}\n\n${volatile}`;
  if (full.length <= maxCharacters) {
    return {
      characterCount: full.length,
      markdown: full,
      maxCharacters,
      truncated: false,
    };
  }

  const continuation = input.task
    ? input.remote
      ? `${cli} task detail --task-id ${input.task.simpleId} --json`
      : `${cli} task detail --task-id ${input.task.simpleId} --json --database \"$FACTORY_DB\"`
    : `${cli} project status --project-id ${input.project.id}`;
  const notice = `[Factory brief truncated to ${maxCharacters} of ${full.length} characters. Run: ${continuation}]`;
  const prefixBudget = Math.max(0, maxCharacters - notice.length - 1);
  const prefix =
    stable.length >= prefixBudget
      ? stable.slice(0, prefixBudget)
      : `${stable}\n${volatile.slice(0, Math.max(0, prefixBudget - stable.length - 1))}`;
  const markdown = `${prefix}\n${notice}`;
  return {
    characterCount: markdown.length,
    markdown,
    maxCharacters,
    truncated: true,
  };
}

export function renderBrief(input: BriefInput): BriefRenderResult {
  const maxCharacters = input.maxCharacters ?? DEFAULT_BRIEF_MAX_CHARACTERS;
  const cli = resolvedCliCommand(input);
  const stableSections = [renderProjectSection(input)];
  if (input.task) {
    stableSections.push(
      renderTaskSection(input.task),
      renderSubtasksSection(input.task),
      renderHowToWork(),
      renderCommands(input, cli),
    );
  } else {
    stableSections.push(renderHowToWork(), renderCommands(input, cli));
  }
  const stable = stableSections
    .map((section) => section.join("\n"))
    .join("\n\n");
  const volatile = input.task
    ? renderCurrentStatus(input.task).join("\n")
    : renderOpenTasksSection(input).join("\n");
  return truncateBrief(stable, volatile, input, maxCharacters, cli);
}
