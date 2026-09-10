export const DEFAULT_BRIEF_MAX_CHARACTERS = 8000;

export type BriefTrackerLink = {
  system: string;
  stableId: string;
  url: string;
};

export type BriefSubtask = {
  id: string;
  name: string;
  description?: string;
  effectiveState: string;
  latestReport?: {
    state: string;
    reporter: string;
    reasonOrEvidence?: string;
    createdAt: string;
  };
};

export type BriefTask = {
  id: string;
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
  name: string;
  branchName?: string;
  workState: string;
};

export type BriefAttentionItem = {
  taskId: string;
  taskName: string;
  state: string;
  priority?: string;
  owner?: string;
};

export type BriefInput = {
  project: {
    id: string;
    name: string;
    workspaceRoot?: string;
    gitOriginUrl?: string;
    trackerLinks: BriefTrackerLink[];
  };
  task?: BriefTask;
  openTasks: BriefOpenTask[];
  candidateTaskIds: string[];
  branchResolutionNote?: string;
  databasePath: string;
  checkoutPath: string;
  selector: {
    workspaceRoot?: string;
    gitOriginUrl?: string;
  };
  attention: BriefAttentionItem[];
  generatedAt: string;
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

function renderLinks(links: BriefTrackerLink[]): string[] {
  if (links.length === 0) return ["- Tracker links: none"];
  return [
    "- Tracker links:",
    ...links.map(
      (link) =>
        `  - ${oneLine(link.system)} ${oneLine(link.stableId)}: ${link.url}`,
    ),
  ];
}

function renderProjectSection(input: BriefInput): string[] {
  const lines = [
    `# Factory brief: ${oneLine(input.project.name)}`,
    `- Project id: ${input.project.id}`,
  ];
  if (input.project.workspaceRoot) {
    lines.push(`- Workspace root: ${input.project.workspaceRoot}`);
  }
  if (input.project.gitOriginUrl) {
    lines.push(`- Git origin: ${input.project.gitOriginUrl}`);
  }
  lines.push(...renderLinks(input.project.trackerLinks));
  return lines;
}

function renderTaskSection(task: BriefTask): string[] {
  const lines = [
    "## Task",
    `- Name: ${oneLine(task.name)}`,
    `- ID: ${task.id}`,
    `- Objective: ${task.objective ? oneLine(task.objective) : "(none)"}`,
    `- Branch: ${task.branchName ?? "(none)"}`,
    `- PR URL: ${task.pullRequestUrl ?? "(none)"}`,
    "- Acceptance criteria:",
  ];
  if (task.acceptanceCriteria.length === 0) {
    lines.push("  1. (none)");
  } else {
    task.acceptanceCriteria.forEach((criterion, index) => {
      lines.push(`  ${index + 1}. ${oneLine(criterion)}`);
    });
  }
  lines.push("- Dependencies:");
  if (task.dependencies.length === 0) {
    lines.push("  - (none)");
  } else {
    lines.push(
      ...task.dependencies.map((dependency) => `  - ${oneLine(dependency)}`),
    );
  }
  if (task.trackerLinks.length > 0) {
    lines.push(...renderLinks(task.trackerLinks));
  }
  return lines;
}

function renderOpenTasksSection(input: BriefInput): string[] {
  const visibleTasks = input.openTasks.slice(0, 20);
  const lines = ["## Open Tasks"];
  if (visibleTasks.length === 0) {
    lines.push("- None");
  } else {
    lines.push(
      ...visibleTasks.map(
        (task) =>
          `- ${task.id} — ${oneLine(task.name)}${
            task.branchName ? ` (branch: ${task.branchName})` : ""
          }`,
      ),
    );
    const remaining = input.openTasks.length - visibleTasks.length;
    if (remaining > 0) lines.push(`+${remaining} more`);
  }
  if (input.branchResolutionNote) lines.push(`- ${input.branchResolutionNote}`);
  return lines;
}

function renderSubtasksSection(task: BriefTask): string[] {
  const lines = ["## Subtasks"];
  if (task.subtasks.length === 0) {
    lines.push("- None");
    return lines;
  }
  for (const subtask of task.subtasks) {
    lines.push(`- ${subtask.id} — ${oneLine(subtask.name)}`);
    lines.push(
      `  Description: ${subtask.description ? oneLine(subtask.description) : "(none)"}`,
    );
  }
  return lines;
}

function renderCommands(input: BriefInput): string[] {
  const cli = "bun run src/cli.ts";
  const lines = [
    "## Commands",
    `Checkout: ${input.checkoutPath}`,
    "Full operating rules: skills/software-factory/SKILL.md",
    "",
    "```sh",
    `export FACTORY_DB=${shellQuote(input.databasePath)}`,
    "# Set FACTORY_REPORTER=claude or codex before reporting.",
  ];

  if (input.task?.reportSubtaskId) {
    lines.push(
      `${cli} subtask report --json --subtask-id ${input.task.reportSubtaskId} --state in_progress --reporter \"$FACTORY_REPORTER\" --evidence \"...\" --database \"$FACTORY_DB\"`,
    );
  } else if (input.task) {
    lines.push("# All listed Subtasks have an accepted complete report.");
  }

  if (input.task?.branchName) {
    lines.push(
      `${cli} session auto-link --project-id ${input.project.id} --task-id ${input.task.id} --branch-name ${shellQuote(input.task.branchName)} --json --database \"$FACTORY_DB\"`,
    );
  }

  if (input.task) {
    for (const subtask of input.task.subtasks) {
      lines.push(
        `${cli} subtask history --subtask-id ${subtask.id} --json --database \"$FACTORY_DB\"`,
      );
    }
    lines.push(
      `${cli} task detail --task-id ${input.task.id} --json --database \"$FACTORY_DB\"`,
    );
  }

  const selectorFlags = [
    input.selector.workspaceRoot === undefined
      ? undefined
      : `--workspace-root ${shellQuote(input.selector.workspaceRoot)}`,
    input.selector.gitOriginUrl === undefined
      ? undefined
      : `--git-origin-url ${shellQuote(input.selector.gitOriginUrl)}`,
  ].filter((flag): flag is string => flag !== undefined);
  lines.push(
    `${cli} project attention${selectorFlags.length > 0 ? ` ${selectorFlags.join(" ")}` : ""} --json --database \"$FACTORY_DB\"`,
  );
  lines.push("```");
  return lines;
}

function renderCurrentStatus(input: BriefInput): string[] {
  const lines = ["## Current status"];
  if (input.task) {
    lines.push(
      `- Task work state: ${input.task.workState}; manual hold: ${input.task.manualHold ? "yes" : "no"}${
        input.task.stateReason ? ` — ${oneLine(input.task.stateReason)}` : ""
      }`,
    );
    for (const subtask of input.task.subtasks) {
      const report = subtask.latestReport;
      lines.push(
        `- Subtask ${subtask.id} (${oneLine(subtask.name)}): effective state ${subtask.effectiveState}; ${
          report
            ? `Status Report: ${report.state} by ${report.reporter}; ${
                report.reasonOrEvidence
                  ? oneLine(report.reasonOrEvidence)
                  : "no reason or evidence"
              }; ${report.createdAt}`
            : "Status Report: none"
        }`,
      );
    }
  } else {
    lines.push("- Task work state: no Task resolved (project-only brief).");
  }

  lines.push("- Open attention items:");
  if (input.attention.length === 0) {
    lines.push("  - None");
  } else {
    lines.push(
      ...input.attention.map(
        (item) =>
          `  - ${item.taskId} — ${oneLine(item.taskName)}: ${item.state}${
            item.priority ? `; priority ${item.priority}` : ""
          }${item.owner ? `; owner ${item.owner}` : ""}`,
      ),
    );
  }
  lines.push(`Generated ${input.generatedAt}`);
  return lines;
}

export function renderBrief(input: BriefInput): BriefRenderResult {
  const maxCharacters = input.maxCharacters ?? DEFAULT_BRIEF_MAX_CHARACTERS;
  const stable = [
    ...renderProjectSection(input),
    "",
    ...(input.task
      ? [
          ...renderTaskSection(input.task),
          "",
          ...renderSubtasksSection(input.task),
        ]
      : renderOpenTasksSection(input)),
    "",
    ...renderCommands(input),
  ].join("\n");
  const currentStatus = renderCurrentStatus(input).join("\n");
  const full = `${stable}\n\n${currentStatus}`;
  if (full.length <= maxCharacters) {
    return {
      characterCount: full.length,
      markdown: full,
      maxCharacters,
      truncated: false,
    };
  }

  const continuation = input.task
    ? `bun run src/cli.ts task detail --task-id ${input.task.id} --json --database \"$FACTORY_DB\"`
    : `bun run src/cli.ts project status --project-id ${input.project.id} --json --database \"$FACTORY_DB\"`;
  const notice = `[Factory brief truncated to ${maxCharacters} of ${full.length} characters. Run: ${continuation}]`;
  const prefixBudget = Math.max(0, maxCharacters - notice.length - 1);
  let prefix: string;
  if (stable.length >= prefixBudget) {
    prefix = stable.slice(0, prefixBudget);
  } else {
    const currentBudget = Math.max(0, prefixBudget - stable.length - 1);
    prefix = `${stable}\n${currentStatus.slice(0, currentBudget)}`;
  }
  const markdown = `${prefix}\n${notice}`;
  return {
    characterCount: markdown.length,
    markdown,
    maxCharacters,
    truncated: true,
  };
}
