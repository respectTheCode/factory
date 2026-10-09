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
  reportedState?: string;
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
  workflowEpoch: number;
  finishRule: { kind: "pr_merge" | "agent_report"; requireHumanCheck: boolean };
  humanCheckText?: string;
  latestTaskReport?: {
    state: string;
    reporter: string;
    createdAt: string;
  };
  workState: string;
  stateReason?: string;
  manualHold: boolean;
  trackerLinks: BriefTrackerLink[];
  steps: BriefSubtask[];
  reportStepId?: string;
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
  lines.push(
    `Finish rule: ${
      task.finishRule.kind === "pr_merge"
        ? "required PRs merged to the default branch"
        : "agent report"
    }${task.finishRule.requireHumanCheck ? ` · human check: ${task.humanCheckText ?? "required"}` : ""}`,
    `Workflow epoch: ${task.workflowEpoch}`,
  );
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
  const lines = ["## Steps"];
  if (task.steps.length === 0) {
    lines.push("- None");
    return lines;
  }
  for (const step of task.steps) {
    const state =
      step.reportedState === "complete" || step.effectiveState === "completed"
        ? "Done"
        : step.reportedState === "blocked" || step.effectiveState === "blocked"
          ? "Blocked"
          : step.reportedState === "in_progress" ||
              step.effectiveState === "active"
            ? "Doing"
            : "To do";
    const detail = step.description
      ? ` · ${clip(oneLine(step.description), SUBTASK_DESCRIPTION_MAX)}`
      : "";
    lines.push(`- ${step.simpleId} — ${oneLine(step.name)}: ${state}${detail}`);
  }
  return lines;
}

function renderHowToWork(): string[] {
  return [
    "## How to work",
    "- Report Task progress with the current --workflow-epoch. At handoff, report finished with a summary; Factory applies the finish rule.",
    "- Steps are optional progress labels. Report their progress directly; do not request a Step review.",
    "- Human checks and marking a Task done are human-only. Reports are append-only claims.",
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
    lines.push(
      command(
        `task report --json --task-id ${input.task.simpleId} --state in_progress --workflow-epoch ${input.task.workflowEpoch} --reporter "$FACTORY_REPORTER" --summary "..."`,
      ),
      command(
        `task report --json --task-id ${input.task.simpleId} --state finished --workflow-epoch ${input.task.workflowEpoch} --reporter "$FACTORY_REPORTER" --summary "..."`,
      ),
    );
    if (input.task.reportStepId) {
      lines.push(
        command(
          `step report --json --step-id ${input.task.reportStepId} --state in_progress --reporter "$FACTORY_REPORTER" --evidence "..."`,
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
    if (input.task.reportStepId) {
      lines.push(
        command(`step history --step-id ${input.task.reportStepId} --json`),
      );
    }
    lines.push(
      command(`task history --task-id ${input.task.simpleId} --json`),
      command(`task detail --task-id ${input.task.simpleId} --json`),
    );
  } else {
    lines.push(
      command("task detail --task-id TASK_ID --json"),
      command(
        'task report --json --task-id TASK_ID --state in_progress --workflow-epoch EPOCH --reporter "$FACTORY_REPORTER" --summary "..."',
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
  lines.push(
    `- Task: ${task.workState} · workflow epoch ${task.workflowEpoch}${hold}${reason}`,
  );
  const report = task.latestTaskReport;
  lines.push(
    report
      ? `- Last Task report: ${report.state} by ${report.reporter} ${report.createdAt.slice(0, 10)}`
      : "- No Task report in this workflow epoch",
  );
  if (task.humanCheckText) {
    lines.push(`- Human check: ${oneLine(task.humanCheckText)}`);
  }
  for (const step of task.steps) {
    const stepReport = step.latestReport;
    lines.push(
      stepReport
        ? `- ${step.simpleId} ${step.effectiveState}; last report ${stepReport.state} by ${stepReport.reporter} ${stepReport.createdAt.slice(0, 10)}`
        : `- ${step.simpleId} ${step.effectiveState}; no report`,
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
