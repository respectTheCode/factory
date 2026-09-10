import { resolve } from "node:path";
import { normalizeWorkspaceRoot, sameWorkspaceRoot } from "./workspace";

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
import {
  DEFAULT_BRIEF_MAX_CHARACTERS,
  renderBrief,
  type BriefInput,
  type BriefSubtask,
  type BriefTask,
} from "./brief";
import { createT3Coordinator } from "./t3-coordinator";
import { createT3ActivityReader, MAX_T3_THREAD_TURN_LIMIT } from "./t3";
import { resolveT3AccessToken } from "./t3-credential";

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
  t3ProjectId?: string;
  workspaceRoot?: string;
}) {
  return {
    id: project.id,
    name: project.name,
    ...(project.gitOriginUrl ? { gitOriginUrl: project.gitOriginUrl } : {}),
    ...(project.t3ProjectId ? { t3ProjectId: project.t3ProjectId } : {}),
    ...(project.workspaceRoot ? { workspaceRoot: project.workspaceRoot } : {}),
  };
}

function optionalNullableFlag(
  flags: Map<string, string>,
  name: string,
): string | null | undefined {
  if (!flags.has(name)) return undefined;
  const value = flags.get(name)?.trim();
  return value || null;
}

function turnLimitFlag(flags: Map<string, string>): number {
  const configured = flags.get("turn-limit") ?? "1";
  const value = Number(configured);
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_T3_THREAD_TURN_LIMIT ||
    String(value) !== configured
  ) {
    throw new Error(
      `--turn-limit must be an integer from 1 through ${MAX_T3_THREAD_TURN_LIMIT}.`,
    );
  }
  return value;
}

function gitOriginFlag(flags: Map<string, string>): string | undefined {
  const value = flags.get("git-origin-url") ?? flags.get("git-url");
  if (value === undefined) return undefined;
  if (!value.trim()) throw new Error("--git-origin-url must not be empty.");
  return value.trim();
}

function briefMaxCharacters(flags: Map<string, string>): number {
  const configured = flags.get("max-chars");
  if (configured === undefined) return DEFAULT_BRIEF_MAX_CHARACTERS;
  const value = Number(configured);
  if (
    !/^\d+$/.test(configured) ||
    !Number.isSafeInteger(value) ||
    value < 1000
  ) {
    throw new Error("--max-chars must be an integer of at least 1000.");
  }
  return value;
}

function firstReportLine(report: {
  evidence?: string;
  reason?: string;
}): string | undefined {
  const value = report.reason?.trim() || report.evidence?.trim();
  return value?.split(/\r?\n/, 1)[0]?.trim() || undefined;
}

function makeBriefInput({
  application,
  checkoutPath,
  databasePath,
  hierarchy,
  maxCharacters,
  project,
  projectDetail,
  selectedTask,
  branchResolutionNote,
}: {
  application: ReturnType<typeof createFactoryApplication>;
  checkoutPath: string;
  databasePath: string;
  hierarchy: ReturnType<
    ReturnType<typeof createFactoryApplication>["getProjectHierarchy"]
  >;
  maxCharacters: number;
  project: ReturnType<
    ReturnType<typeof createFactoryApplication>["listProjects"]
  >[number];
  projectDetail: ReturnType<
    ReturnType<typeof createFactoryApplication>["getProjectDetail"]
  >;
  selectedTask?: ReturnType<
    ReturnType<typeof createFactoryApplication>["getTaskDetail"]
  >;
  branchResolutionNote?: string;
}): BriefInput {
  let task: BriefTask | undefined;
  if (selectedTask) {
    const hierarchyTask = hierarchy.tasks.find(
      (candidate) => candidate.id === selectedTask.id,
    );
    if (!hierarchyTask) {
      throw new Error(
        `Factory Task ${selectedTask.id} is not present in Project ${project.id}.`,
      );
    }

    const status = application.getTaskStatus(selectedTask.id);
    const subtasks: BriefSubtask[] = hierarchyTask.subtasks
      .filter((subtask) => subtask.archiveState === undefined)
      .map((subtask) => {
        const subtaskStatus = status.subtasks.find(
          (candidate) => candidate.subtaskId === subtask.id,
        );
        const reports = application.getSubtaskReportHistory(subtask.id);
        const latestReport = reports.at(-1);
        return {
          id: subtask.id,
          name: subtask.name,
          ...(subtask.description === undefined
            ? {}
            : { description: subtask.description }),
          effectiveState: subtaskStatus?.effectiveState ?? "planned",
          accepted:
            subtaskStatus?.reportedState === "complete" &&
            subtaskStatus.verificationState === "accepted",
          awaitingVerification:
            subtaskStatus?.effectiveState === "awaiting_verification" &&
            subtaskStatus.verificationState !== "accepted",
          ...(latestReport
            ? {
                latestReport: {
                  state: latestReport.reportedState,
                  reporter: latestReport.reporter,
                  createdAt: latestReport.createdAt.toISOString(),
                },
              }
            : {}),
        };
      });
    const reportSubtaskId = subtasks.find(
      (subtask) => !subtask.accepted && !subtask.awaitingVerification,
    )?.id;

    task = {
      id: selectedTask.id,
      name: selectedTask.name,
      ...(selectedTask.objective === undefined
        ? {}
        : { objective: selectedTask.objective }),
      ...(selectedTask.branchName === undefined
        ? {}
        : { branchName: selectedTask.branchName }),
      ...(selectedTask.pullRequestUrl === undefined
        ? {}
        : { pullRequestUrl: selectedTask.pullRequestUrl }),
      acceptanceCriteria: selectedTask.acceptanceCriteria,
      dependencies: selectedTask.dependencies,
      workState: selectedTask.archiveState ?? status.taskState,
      ...(status.stateReason === undefined
        ? {}
        : { stateReason: status.stateReason }),
      manualHold: selectedTask.workStateSource === "manual",
      trackerLinks: selectedTask.trackerLinks.map((link) => ({
        stableId: link.stableId,
        system: link.system,
        url: link.url,
      })),
      subtasks,
      ...(reportSubtaskId ? { reportSubtaskId } : {}),
    };
  }

  return {
    branchResolutionNote,
    checkoutPath,
    databasePath,
    maxCharacters,
    openTasks: hierarchy.tasks
      .filter((candidate) => candidate.archiveState === undefined)
      .map((candidate) => {
        const taskDetail = application.getTaskDetail(candidate.id);
        return {
          id: candidate.id,
          name: candidate.name,
          ...(taskDetail.priority ? { priority: taskDetail.priority } : {}),
          workState: candidate.workState ?? "planned",
        };
      }),
    project: {
      id: project.id,
      name: project.name,
      trackerLinks: projectDetail.trackerLinks.map((link) => ({
        stableId: link.stableId,
        system: link.system,
        url: link.url,
      })),
    },
    ...(task ? { task } : {}),
  };
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

function workspaceRootFlag(flags: Map<string, string>): string | undefined {
  const value = flags.get("workspace-root");
  if (value === undefined) return undefined;
  if (!value.trim()) throw new Error("--workspace-root must not be empty.");
  return normalizeWorkspaceRoot(resolve(value.trim()));
}

function projectsMatchingContext(
  application: ReturnType<typeof createFactoryApplication>,
  {
    gitOriginUrl,
    workspaceRoot,
  }: { gitOriginUrl?: string; workspaceRoot?: string },
) {
  return application.listProjects().filter((project) => {
    if (
      gitOriginUrl !== undefined &&
      (project.gitOriginUrl === undefined ||
        normalizeGitOriginUrl(project.gitOriginUrl) !==
          normalizeGitOriginUrl(gitOriginUrl))
    ) {
      return false;
    }
    if (
      workspaceRoot !== undefined &&
      !sameWorkspaceRoot(project.workspaceRoot, workspaceRoot)
    ) {
      return false;
    }
    return true;
  });
}

function contextSelectorDescription({
  gitOriginUrl,
  workspaceRoot,
}: {
  gitOriginUrl?: string;
  workspaceRoot?: string;
}): string {
  return [
    ...(gitOriginUrl ? [`Git origin ${gitOriginUrl}`] : []),
    ...(workspaceRoot ? [`workspace root ${workspaceRoot}`] : []),
  ].join(" and ");
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
  const configuredT3Timeout = Bun.env.T3_TIMEOUT_MS?.trim();
  const t3Coordinator = createT3Coordinator({
    application,
    reader: createT3ActivityReader({
      baseUrl: Bun.env.T3_BASE_URL,
      timeoutMs:
        configuredT3Timeout === undefined
          ? undefined
          : Number(configuredT3Timeout),
      token: resolveT3AccessToken({
        T3_ACCESS_TOKEN: Bun.env.T3_ACCESS_TOKEN,
        T3_ACCESS_TOKEN_FILE: Bun.env.T3_ACCESS_TOKEN_FILE,
      }),
    }),
  });

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
      t3ProjectId: parsed.flags.get("t3-project-id"),
      workspaceRoot: parsed.flags.get("workspace-root"),
    });
    output({ project: projectSummary(project) });
    return;
  }

  if (resource === "project" && action === "update") {
    const gitOriginUrl =
      parsed.flags.get("git-origin-url") ?? parsed.flags.get("git-url");
    const projectId = requiredFlag(parsed.flags, "project-id");
    const t3ProjectId = optionalNullableFlag(parsed.flags, "t3-project-id");
    const workspaceRoot = optionalNullableFlag(parsed.flags, "workspace-root");
    if (
      gitOriginUrl === undefined &&
      t3ProjectId === undefined &&
      workspaceRoot === undefined
    ) {
      throw new Error(
        "Provide at least one of --git-origin-url, --t3-project-id, or --workspace-root.",
      );
    }
    const existing = application.getProjectDetail(projectId);
    const project = application.updateProject({
      gitOriginUrl: gitOriginUrl ?? existing.gitOriginUrl ?? null,
      projectId,
      ...(t3ProjectId === undefined ? {} : { t3ProjectId }),
      ...(workspaceRoot === undefined ? {} : { workspaceRoot }),
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
    const workspaceRoot = workspaceRootFlag(parsed.flags);
    if (!gitOriginUrl && !workspaceRoot) {
      throw new Error(
        "Provide at least one of --git-origin-url or --workspace-root.",
      );
    }

    const projects = projectsMatchingContext(application, {
      gitOriginUrl,
      workspaceRoot,
    });
    const selector = contextSelectorDescription({
      gitOriginUrl,
      workspaceRoot,
    });
    if (projects.length === 0) {
      throw new Error(`No Factory Project matches ${selector}.`);
    }
    if (projects.length > 1) {
      throw new Error(
        `${selector} matches multiple Factory Projects: ${projects
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
        ...(hierarchy.workspaceRoot
          ? { workspaceRoot: hierarchy.workspaceRoot }
          : {}),
        trackerLinks: projectDetail.trackerLinks,
        tasks,
      },
    });
    return;
  }

  if (resource === "project" && action === "brief") {
    const gitOriginUrl = gitOriginFlag(parsed.flags);
    const workspaceRoot = workspaceRootFlag(parsed.flags);
    if (!gitOriginUrl && !workspaceRoot) {
      throw new Error(
        "Provide at least one of --git-origin-url or --workspace-root.",
      );
    }

    const projects = projectsMatchingContext(application, {
      gitOriginUrl,
      workspaceRoot,
    });
    const selector = contextSelectorDescription({
      gitOriginUrl,
      workspaceRoot,
    });
    if (projects.length === 0) {
      throw new Error(`No Factory Project matches ${selector}.`);
    }
    if (projects.length > 1) {
      throw new Error(
        `${selector} matches multiple Factory Projects: ${projects
          .map((project) => project.id)
          .join(", ")}.`,
      );
    }

    const project = projects[0];
    if (!project) throw new Error("Factory Project resolution failed.");
    const hierarchy = application.getProjectHierarchy(project.id);
    const projectDetail = application.getProjectDetail(project.id);
    const branchFlag = parsed.flags.get("branch-name");
    const branchName = branchFlag?.trim();
    if (branchFlag !== undefined && !branchName) {
      throw new Error("--branch-name must not be empty.");
    }

    const taskId = parsed.flags.has("task-id")
      ? requiredFlag(parsed.flags, "task-id")
      : undefined;
    let selectedTask:
      | ReturnType<ReturnType<typeof createFactoryApplication>["getTaskDetail"]>
      | undefined;
    let candidateTaskIds: string[] = [];
    let branchResolutionNote: string | undefined;
    if (taskId) {
      const taskDetail = application.getTaskDetail(taskId);
      if (taskDetail.projectId !== project.id) {
        throw new Error(
          `Factory Task ${taskId} does not belong to Project ${project.id}.`,
        );
      }
      selectedTask = taskDetail;
    } else if (branchName) {
      const branchMatches = hierarchy.tasks.filter(
        (task) =>
          task.archiveState === undefined && task.branchName === branchName,
      );
      if (branchMatches.length === 1) {
        const matchingTask = branchMatches[0];
        if (!matchingTask) throw new Error("Factory Task resolution failed.");
        selectedTask = application.getTaskDetail(matchingTask.id);
      } else if (branchMatches.length === 0) {
        branchResolutionNote = `Branch ${branchName} matches no Task.`;
      } else {
        candidateTaskIds = branchMatches.map((task) => task.id);
        branchResolutionNote = `Branch ${branchName} matches several Tasks: ${candidateTaskIds.join(", ")}.`;
      }
    }

    const maxCharacters = briefMaxCharacters(parsed.flags);
    const rendered = renderBrief(
      makeBriefInput({
        application,
        branchResolutionNote,
        checkoutPath: resolve(process.cwd()),
        databasePath: resolve(databasePath),
        hierarchy,
        maxCharacters,
        project,
        projectDetail,
        selectedTask,
      }),
    );
    const brief = {
      ...rendered,
      candidateTaskIds,
      project: { id: project.id, name: project.name },
      task: selectedTask
        ? { id: selectedTask.id, name: selectedTask.name }
        : null,
    };
    if (parsed.flags.get("json") === "true") {
      output({ brief });
    } else {
      console.log(rendered.markdown);
    }
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
    const workspaceRoot = workspaceRootFlag(parsed.flags);
    const matchingProjectIds =
      gitOriginUrl || workspaceRoot
        ? new Set(
            projectsMatchingContext(application, {
              gitOriginUrl,
              workspaceRoot,
            }).map((project) => project.id),
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

  if (resource === "project" && action === "t3-status") {
    output({
      status: await t3Coordinator.status(
        requiredFlag(parsed.flags, "project-id"),
      ),
    });
    return;
  }

  if (resource === "session" && action === "detail") {
    output({
      session: await t3Coordinator.threadDetail(
        requiredFlag(parsed.flags, "thread-id"),
        turnLimitFlag(parsed.flags),
      ),
    });
    return;
  }

  if (resource === "session" && action === "link") {
    output({
      link: t3Coordinator.linkThread({
        ...(parsed.flags.get("subtask-id") === undefined
          ? {}
          : { subtaskId: parsed.flags.get("subtask-id") }),
        ...(parsed.flags.get("task-id") === undefined
          ? {}
          : { taskId: parsed.flags.get("task-id") }),
        projectId: requiredFlag(parsed.flags, "project-id"),
        threadId: requiredFlag(parsed.flags, "thread-id"),
      }),
    });
    return;
  }

  if (resource === "session" && action === "auto-link") {
    output({
      link: await t3Coordinator.autoLinkThread({
        branchName: requiredFlag(parsed.flags, "branch-name"),
        ...(parsed.flags.get("subtask-id") === undefined
          ? {}
          : { subtaskId: parsed.flags.get("subtask-id") }),
        ...(parsed.flags.get("task-id") === undefined
          ? {}
          : { taskId: parsed.flags.get("task-id") }),
        projectId: requiredFlag(parsed.flags, "project-id"),
      }),
    });
    return;
  }

  if (resource === "session" && action === "unlink") {
    output({
      link: t3Coordinator.unlinkThread(
        requiredFlag(parsed.flags, "thread-id"),
        parsed.flags.get("association-id"),
      ),
    });
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

  if (resource === "task" && action === "resume-rollup") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    application.resumeTaskRollup(taskId);
    output({ status: application.getTaskStatus(taskId) });
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
    "Usage: database backup|check, project create|update|list|context|brief|remove|status|portfolio|attention|link|t3-status, session detail|link|auto-link|unlink, task create|update|detail|state|resume-rollup|status|github-status|reorder|archive|restore|link, subtask create|update|report|reorder|status|github-status|archive|restore|history|verify",
  );
}

if (import.meta.main) {
  void main(Bun.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
