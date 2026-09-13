import { resolve } from "node:path";
import { normalizeWorkspaceRoot, sameWorkspaceRoot } from "./workspace";

import {
  backupFactoryDatabase,
  checkFactoryDatabase,
  createFactoryApplication,
  type ArchiveState,
  type FactoryApplication,
  type ProjectHierarchy,
  type ProjectMetadata,
  type ProjectSummary,
  type ReportedState,
  type TaskDetail,
  type VerificationDecision,
  type WorkState,
} from "./application";
import { FACTORY_API_VERSION } from "./api-version";
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
import { createMachineCredentialStore } from "./machine-credential";
import {
  createRemoteFactoryClient,
  FACTORY_REQUEST_KEY_PATTERN,
  type FactoryRemoteBriefData,
  type FactoryRemoteClient,
} from "./remote-client";

const SCHEMA_VERSION = 1 as const;

type FactoryBackend = Pick<
  FactoryRemoteClient,
  | "addProjectTrackerLink"
  | "addTaskTrackerLink"
  | "archiveSubtask"
  | "archiveTask"
  | "createProject"
  | "createSubtask"
  | "createTask"
  | "getAttentionProjection"
  | "getPortfolioStatus"
  | "getProjectBriefData"
  | "getProjectContext"
  | "getProjectDetail"
  | "getProjectStatus"
  | "getSubtaskDetail"
  | "getSubtaskReportHistory"
  | "getSubtaskVerificationHistory"
  | "getTaskDetail"
  | "getTaskStatus"
  | "listProjects"
  | "removeProject"
  | "reorderSubtasks"
  | "reorderTasks"
  | "reportSubtaskStatus"
  | "restoreSubtask"
  | "restoreTask"
  | "resumeTaskRollup"
  | "setTaskWorkState"
  | "updateProject"
  | "updateSubtask"
  | "updateTask"
>;

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

function expectedRevisionFlag(flags: Map<string, string>): number | undefined {
  const configured = flags.get("expected-revision");
  if (configured === undefined) return undefined;
  const value = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error("--expected-revision must be a positive integer.");
  }
  return value;
}

function requestKeyFlag(
  flags: Map<string, string>,
  remote: boolean,
): string | undefined {
  if (!remote) return undefined;
  const configured = flags.get("request-key");
  if (configured !== undefined && !configured.trim()) {
    throw new Error(
      "--request-key must be 8-128 characters matching [A-Za-z0-9._-].",
    );
  }
  const requestKey = configured?.trim() ?? crypto.randomUUID();
  if (!FACTORY_REQUEST_KEY_PATTERN.test(requestKey)) {
    throw new Error(
      "--request-key must be 8-128 characters matching [A-Za-z0-9._-].",
    );
  }
  return requestKey;
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

function isoDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function makeBriefInput({
  backend,
  checkoutPath,
  databasePath,
  hierarchy,
  maxCharacters,
  project,
  projectDetail,
  selectedTask,
  branchResolutionNote,
  briefData,
  remote,
}: {
  backend: FactoryBackend;
  checkoutPath: string;
  databasePath?: string;
  hierarchy: ProjectHierarchy;
  maxCharacters: number;
  project: ProjectSummary;
  projectDetail: ProjectMetadata;
  selectedTask?: TaskDetail;
  branchResolutionNote?: string;
  briefData?: FactoryRemoteBriefData;
  remote?: { url: string; accessTokenFile: string };
}): Promise<BriefInput> {
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

    const status =
      briefData?.taskStatuses.find(
        (candidate) => candidate.taskId === selectedTask.id,
      ) ?? (await backend.getTaskStatus(selectedTask.id));
    const subtasks: BriefSubtask[] = [];
    for (const subtask of hierarchyTask.subtasks.filter(
      (candidate) => candidate.archiveState === undefined,
    )) {
      const subtaskStatus = status.subtasks.find(
        (candidate) => candidate.subtaskId === subtask.id,
      );
      const reports =
        briefData?.reports[subtask.id] ??
        (await backend.getSubtaskReportHistory(subtask.id));
      const latestReport = reports.at(-1);
      subtasks.push({
        id: subtask.id,
        simpleId: subtask.simpleId,
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
                createdAt: isoDate(latestReport.createdAt),
              },
            }
          : {}),
      });
    }
    const reportSubtaskId = subtasks.find(
      (subtask) => !subtask.accepted && !subtask.awaitingVerification,
    )?.simpleId;

    task = {
      id: selectedTask.id,
      simpleId: selectedTask.simpleId,
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
    ...(databasePath === undefined ? {} : { databasePath }),
    ...(remote === undefined ? {} : { remote }),
    maxCharacters,
    openTasks: await Promise.all(
      hierarchy.tasks
        .filter((candidate) => candidate.archiveState === undefined)
        .map(async (candidate) => {
          const taskDetail =
            briefData?.taskDetails.find(
              (detail) => detail.id === candidate.id,
            ) ?? (await backend.getTaskDetail(candidate.id));
          return {
            id: candidate.id,
            simpleId: candidate.simpleId,
            name: candidate.name,
            ...(taskDetail.priority ? { priority: taskDetail.priority } : {}),
            workState: candidate.workState ?? "planned",
          };
        }),
    ),
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

async function projectsMatchingGitOrigin(
  backend: FactoryBackend,
  gitOriginUrl: string,
) {
  const normalizedOrigin = normalizeGitOriginUrl(gitOriginUrl);
  return (await backend.listProjects()).filter(
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

async function projectsMatchingContext(
  backend: FactoryBackend,
  {
    gitOriginUrl,
    workspaceRoot,
  }: { gitOriginUrl?: string; workspaceRoot?: string },
) {
  return (await backend.listProjects()).filter((project) => {
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

function createLocalBackend(application: FactoryApplication): FactoryBackend {
  return {
    addProjectTrackerLink: async (input) =>
      application.addProjectTrackerLink(input),
    addTaskTrackerLink: async (input) => application.addTaskTrackerLink(input),
    archiveSubtask: async (subtaskId, archiveState) =>
      application.archiveSubtask(subtaskId, archiveState),
    archiveTask: async (taskId, archiveState) =>
      application.archiveTask(taskId, archiveState),
    createProject: async (input) => application.createProject(input),
    createSubtask: async (input) => application.createSubtask(input),
    createTask: async (input) => application.createTask(input),
    getAttentionProjection: async () => application.getAttentionProjection(),
    getPortfolioStatus: async () => application.getPortfolioStatus(),
    getProjectBriefData: async (projectId) => {
      const project = application
        .listProjects()
        .find(({ id }) => id === projectId);
      if (!project) throw new Error(`Project ${projectId} does not exist.`);
      const hierarchy = application.getProjectHierarchy(projectId);
      const reports = Object.fromEntries(
        hierarchy.tasks.flatMap((task) =>
          task.subtasks.map((subtask) => [
            subtask.id,
            application.getSubtaskReportHistory(subtask.id),
          ]),
        ),
      );
      return {
        hierarchy,
        project,
        projectDetail: application.getProjectDetail(projectId),
        reports,
        taskDetails: hierarchy.tasks.map((task) =>
          application.getTaskDetail(task.id),
        ),
        taskStatuses: hierarchy.tasks.map((task) =>
          application.getTaskStatus(task.id),
        ),
      } satisfies FactoryRemoteBriefData;
    },
    getProjectContext: async ({ branchName, projectId }) => {
      const hierarchy = application.getProjectHierarchy(projectId);
      const projectDetail = application.getProjectDetail(projectId);
      let tasks = hierarchy.tasks.map((task) => ({
        ...application.getTaskDetail(task.id),
        subtasks: task.subtasks,
      }));
      if (branchName) {
        tasks = tasks.filter((task) => task.branchName === branchName);
        if (tasks.length === 0) {
          throw new Error(
            `No Factory Task in Project ${projectId} matches branch ${branchName}.`,
          );
        }
        if (tasks.length > 1) {
          throw new Error(
            `Branch ${branchName} matches multiple Factory Tasks in Project ${projectId}: ${tasks
              .map((task) => task.id)
              .join(", ")}.`,
          );
        }
      }
      return {
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
      };
    },
    getProjectDetail: async (projectId) =>
      application.getProjectDetail(projectId),
    getProjectStatus: async (projectId) =>
      application.getProjectStatus(projectId),
    getSubtaskDetail: async (subtaskId) =>
      application.getSubtaskDetail(subtaskId),
    getSubtaskReportHistory: async (subtaskId) =>
      application.getSubtaskReportHistory(subtaskId),
    getSubtaskVerificationHistory: async (subtaskId) =>
      application.getSubtaskVerificationHistory(subtaskId),
    getTaskDetail: async (taskId) => application.getTaskDetail(taskId),
    getTaskStatus: async (taskId) => application.getTaskStatus(taskId),
    listProjects: async () => application.listProjects(),
    removeProject: async (projectId) => application.removeProject(projectId),
    reorderSubtasks: async (input) => application.reorderSubtasks(input),
    reorderTasks: async (input) => application.reorderTasks(input),
    reportSubtaskStatus: async (input) =>
      application.reportSubtaskStatus(input),
    restoreSubtask: async (subtaskId) => application.restoreSubtask(subtaskId),
    restoreTask: async (taskId) => application.restoreTask(taskId),
    resumeTaskRollup: async (taskId) => application.resumeTaskRollup(taskId),
    setTaskWorkState: async (input) => application.setTaskWorkState(input),
    updateProject: async (input) => application.updateProject(input),
    updateSubtask: async (input) => application.updateSubtask(input),
    updateTask: async (input) => application.updateTask(input),
  };
}

async function main(args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const [resource, action] = parsed.command;
  const factoryUrl = Bun.env.FACTORY_URL?.trim();
  const hasExplicitDatabase = parsed.flags.has("database");
  const localOnly =
    (resource === "database" && (action === "backup" || action === "check")) ||
    resource === "credential";

  if (localOnly && factoryUrl && !hasExplicitDatabase) {
    throw new Error(
      "This command is local-only; pass --database explicitly when FACTORY_URL is set.",
    );
  }

  if (localOnly && resource === "credential") {
    const databasePath = parsed.flags.get("database") ?? "factory.sqlite";
    const store = createMachineCredentialStore({ databasePath });
    try {
      if (action === "create") {
        const projectIds = listFlag(parsed.flags, "project-ids");
        if (projectIds.length === 0) {
          throw new Error(
            "Missing required --project-ids; provide one or more IDs separated by |.",
          );
        }
        output({
          credential: store.create({
            machineId: requiredFlag(parsed.flags, "machine-id"),
            projectIds,
          }),
        });
        return;
      }
      if (action === "list") {
        output({ credentials: store.list() });
        return;
      }
      if (action === "revoke") {
        const machineId = requiredFlag(parsed.flags, "machine-id");
        store.revoke(machineId);
        output({ revoked: { machineId } });
        return;
      }
    } finally {
      store.close();
    }
  }

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

  if (factoryUrl && hasExplicitDatabase) {
    throw new Error(
      "Ambiguous Factory mode: FACTORY_URL and --database name both a remote service and a local database; name only one.",
    );
  }

  const databasePath = parsed.flags.get("database") ?? "factory.sqlite";
  const remoteClient = factoryUrl
    ? createRemoteFactoryClient({
        FACTORY_ACCESS_TOKEN_FILE: Bun.env.FACTORY_ACCESS_TOKEN_FILE,
        FACTORY_URL: factoryUrl,
      })
    : undefined;
  if (remoteClient && resource !== "doctor") await remoteClient.ensureReady();

  const localApplication = remoteClient
    ? undefined
    : createFactoryApplication({ databasePath });
  const application: FactoryBackend =
    remoteClient ?? createLocalBackend(localApplication!);
  const configuredT3Timeout = Bun.env.T3_TIMEOUT_MS?.trim();
  const t3Coordinator = remoteClient
    ? {
        autoLinkThread: (input: {
          branchName: string;
          projectId: string;
          taskId?: string;
          subtaskId?: string;
          requestKey?: string;
        }) => remoteClient.sessionAutoLink(input),
        linkThread: (input: {
          projectId: string;
          taskId?: string;
          subtaskId?: string;
          threadId: string;
          requestKey?: string;
        }) => remoteClient.sessionLink(input),
        status: (projectId?: string) => remoteClient.projectT3Status(projectId),
        threadDetail: (threadId: string, turnLimit: number) =>
          remoteClient.sessionDetail(threadId, turnLimit),
        unlinkThread: (threadId: string, associationId?: string) =>
          remoteClient.sessionUnlink(threadId, associationId),
      }
    : createT3Coordinator({
        application: localApplication!,
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

  if (resource === "doctor") {
    const version = remoteClient
      ? await remoteClient.version()
      : {
          apiVersion: FACTORY_API_VERSION,
          revision: "local",
          schemaVersion: 1 as const,
        };
    const identity =
      remoteClient && version.apiVersion === FACTORY_API_VERSION
        ? await remoteClient.whoami()
        : null;
    const doctor = {
      ...(remoteClient
        ? { url: remoteClient.url }
        : { databasePath: resolve(databasePath) }),
      apiCompatibility: {
        compatible: version.apiVersion === FACTORY_API_VERSION,
        expected: FACTORY_API_VERSION,
        actual: version.apiVersion,
      },
      identity,
      mode: remoteClient ? ("remote" as const) : ("local" as const),
      ok: version.apiVersion === FACTORY_API_VERSION,
      server: { apiVersion: version.apiVersion, revision: version.revision },
    };
    if (parsed.flags.get("json") === "true") {
      output({ doctor });
    } else {
      const address = remoteClient ? remoteClient.url : resolve(databasePath);
      console.log(
        [
          `mode: ${doctor.mode}`,
          `${remoteClient ? "url" : "databasePath"}: ${address}`,
          `server: API ${doctor.server.apiVersion}, revision ${doctor.server.revision}`,
          `api compatibility: ${doctor.apiCompatibility.compatible ? "ok" : "incompatible"}`,
          ...(identity?.machine
            ? [
                `identity: ${identity.machine.machineId} (${identity.machine.projectIds.join(", ")})`,
              ]
            : identity?.human
              ? [`identity: human ${identity.human.name}`]
              : []),
          `ok: ${doctor.ok}`,
        ].join("\n"),
      );
    }
    if (!doctor.ok) process.exitCode = 1;
    return;
  }

  if (resource === "project" && action === "remove") {
    if (parsed.flags.get("confirm") !== "true") {
      throw new Error(
        "Project removal is destructive; pass --confirm after checking the project ID.",
      );
    }
    const projectId = requiredFlag(parsed.flags, "project-id");
    await application.removeProject(projectId);
    output({ removed: { projectId } });
    return;
  }

  if (resource === "project" && action === "create") {
    const project = await application.createProject({
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
    const existing = await application.getProjectDetail(projectId);
    const project = await application.updateProject({
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
      ? await projectsMatchingGitOrigin(application, gitOriginUrl)
      : await application.listProjects();
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

    const projects = await projectsMatchingContext(application, {
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
    const branchFlag =
      parsed.flags.get("branch-name") ?? parsed.flags.get("branch");
    const branchName = branchFlag?.trim();
    if (branchFlag !== undefined && !branchName) {
      throw new Error("--branch-name must not be empty.");
    }

    output({
      context: await application.getProjectContext({
        ...(branchName === undefined ? {} : { branchName }),
        projectId: project.id,
      }),
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

    const projects = await projectsMatchingContext(application, {
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
    const briefData = await application.getProjectBriefData(project.id);
    const { hierarchy, projectDetail } = briefData;
    const branchFlag = parsed.flags.get("branch-name");
    const branchName = branchFlag?.trim();
    if (branchFlag !== undefined && !branchName) {
      throw new Error("--branch-name must not be empty.");
    }

    const taskId = parsed.flags.has("task-id")
      ? requiredFlag(parsed.flags, "task-id")
      : undefined;
    let selectedTask: TaskDetail | undefined;
    let candidateTaskIds: string[] = [];
    let candidateTaskSimpleIds: string[] = [];
    let branchResolutionNote: string | undefined;
    if (taskId) {
      const taskDetail = await application.getTaskDetail(taskId);
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
        selectedTask =
          briefData.taskDetails.find((task) => task.id === matchingTask.id) ??
          (await application.getTaskDetail(matchingTask.id));
      } else if (branchMatches.length === 0) {
        branchResolutionNote = `Branch ${branchName} matches no Task.`;
      } else {
        candidateTaskIds = branchMatches.map((task) => task.id);
        candidateTaskSimpleIds = branchMatches.map((task) => task.simpleId);
        branchResolutionNote = `Branch ${branchName} matches several Tasks: ${candidateTaskSimpleIds.join(", ")}.`;
      }
    }

    const maxCharacters = briefMaxCharacters(parsed.flags);
    const rendered = renderBrief(
      await makeBriefInput({
        backend: application,
        briefData,
        branchResolutionNote,
        checkoutPath: resolve(process.cwd()),
        ...(remoteClient
          ? {
              remote: {
                accessTokenFile: Bun.env.FACTORY_ACCESS_TOKEN_FILE!.trim(),
                url: remoteClient.url,
              },
            }
          : { databasePath: resolve(databasePath) }),
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
      candidateTaskSimpleIds,
      project: { id: project.id, name: project.name },
      task: selectedTask
        ? {
            id: selectedTask.id,
            name: selectedTask.name,
            simpleId: selectedTask.simpleId,
          }
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
      status: await application.getProjectStatus(
        requiredFlag(parsed.flags, "project-id"),
      ),
    });
    return;
  }

  if (resource === "project" && action === "portfolio") {
    output({ portfolio: await application.getPortfolioStatus() });
    return;
  }

  if (resource === "project" && action === "attention") {
    const gitOriginUrl = gitOriginFlag(parsed.flags);
    const workspaceRoot = workspaceRootFlag(parsed.flags);
    const matchingProjectIds =
      gitOriginUrl || workspaceRoot
        ? new Set(
            (
              await projectsMatchingContext(application, {
                gitOriginUrl,
                workspaceRoot,
              })
            ).map((project) => project.id),
          )
        : undefined;
    output({
      attention: (await application.getAttentionProjection()).filter(
        (item) =>
          matchingProjectIds === undefined ||
          matchingProjectIds.has(item.projectId),
      ),
    });
    return;
  }

  if (resource === "project" && action === "link") {
    const link = await application.addProjectTrackerLink({
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
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
    output({
      link: await t3Coordinator.linkThread({
        ...(parsed.flags.get("subtask-id") === undefined
          ? {}
          : { subtaskId: parsed.flags.get("subtask-id") }),
        ...(parsed.flags.get("task-id") === undefined
          ? {}
          : { taskId: parsed.flags.get("task-id") }),
        projectId: requiredFlag(parsed.flags, "project-id"),
        threadId: requiredFlag(parsed.flags, "thread-id"),
        ...(requestKey === undefined ? {} : { requestKey }),
      }),
    });
    return;
  }

  if (resource === "session" && action === "auto-link") {
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
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
        ...(requestKey === undefined ? {} : { requestKey }),
      }),
    });
    return;
  }

  if (resource === "session" && action === "unlink") {
    output({
      link: await t3Coordinator.unlinkThread(
        requiredFlag(parsed.flags, "thread-id"),
        parsed.flags.get("association-id"),
      ),
    });
    return;
  }

  if (resource === "task" && action === "create") {
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
    const task = await application.createTask({
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
      ...(requestKey === undefined ? {} : { requestKey }),
    });
    output({ task });
    return;
  }

  if (resource === "task" && action === "detail") {
    output({
      task: await application.getTaskDetail(
        requiredFlag(parsed.flags, "task-id"),
      ),
    });
    return;
  }

  if (resource === "task" && action === "resume-rollup") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    await application.resumeTaskRollup(taskId);
    output({ status: await application.getTaskStatus(taskId) });
    return;
  }

  if (resource === "task" && action === "state") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
    await application.setTaskWorkState({
      reason: parsed.flags.get("reason"),
      taskId,
      workState: editableTaskStateFlag(parsed.flags),
      ...(requestKey === undefined ? {} : { requestKey }),
    });
    output({ status: await application.getTaskStatus(taskId) });
    return;
  }

  if (resource === "task" && action === "reorder") {
    const projectId = requiredFlag(parsed.flags, "project-id");
    const workState = workStateFlag(parsed.flags);
    const taskIds = orderedIdsFlag(parsed.flags, "task-ids");
    await application.reorderTasks({
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
    const expectedRevision = expectedRevisionFlag(parsed.flags);
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
    if (acceptanceCriteria !== undefined) {
      const status = await application.getTaskStatus(taskId);
      if (status.taskState !== "planned") {
        throw new Error(
          "Acceptance criteria may only be changed during the planning phase while the Task is planned.",
        );
      }
    }
    const task = await application.updateTask({
      acceptanceCriteria,
      branchName,
      name: title,
      objective: description,
      pullRequestUrl,
      taskId,
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      ...(requestKey === undefined ? {} : { requestKey }),
    });
    output({ task });
    return;
  }

  if (resource === "task" && action === "status") {
    output({
      status: await application.getTaskStatus(
        requiredFlag(parsed.flags, "task-id"),
      ),
    });
    return;
  }

  if (resource === "task" && action === "github-status") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    if (remoteClient) {
      output({ status: await remoteClient.taskGithubStatus(taskId) });
      return;
    }
    const task = await application.getTaskDetail(taskId);
    output({ status: await readGitHubStatus(task.pullRequestUrl) });
    return;
  }

  if (resource === "task" && action === "archive") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    const archiveState = archiveStateFlag(parsed.flags);
    await application.archiveTask(taskId, archiveState);
    output({ task: { archiveState, taskId } });
    return;
  }

  if (resource === "task" && action === "restore") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    await application.restoreTask(taskId);
    output({ task: { archiveState: null, taskId } });
    return;
  }

  if (resource === "task" && action === "link") {
    const link = await application.addTaskTrackerLink({
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
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
    const subtask = await application.createSubtask({
      description: parsed.flags.get("description")?.trim() || undefined,
      name: requiredFlag(parsed.flags, "name"),
      pullRequestUrl:
        parsed.flags.get("pull-request-url") ?? parsed.flags.get("pr"),
      taskId: requiredFlag(parsed.flags, "task-id"),
      ...(requestKey === undefined ? {} : { requestKey }),
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
    const expectedRevision = expectedRevisionFlag(parsed.flags);
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
    const subtask = await application.updateSubtask({
      description,
      evidence,
      name: title,
      pullRequestUrl,
      subtaskId: requiredFlag(parsed.flags, "subtask-id"),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      ...(requestKey === undefined ? {} : { requestKey }),
    });
    output({ subtask });
    return;
  }

  if (resource === "subtask" && action === "report") {
    const requestKey = requestKeyFlag(parsed.flags, remoteClient !== undefined);
    const report = await application.reportSubtaskStatus({
      evidence: parsed.flags.get("evidence"),
      reportedState: reportedStateFlag(parsed.flags),
      reporter: requiredFlag(parsed.flags, "reporter"),
      reason: parsed.flags.get("reason"),
      ...(parsed.flags.get("session-thread-id") === undefined
        ? {}
        : {
            sessionRef: {
              externalThreadId: requiredFlag(parsed.flags, "session-thread-id"),
              provider: "t3" as const,
            },
          }),
      subtaskId: requiredFlag(parsed.flags, "subtask-id"),
      ...(requestKey === undefined ? {} : { requestKey }),
    });
    output({
      report: requestKey === undefined ? report : { ...report, requestKey },
    });
    return;
  }

  if (resource === "subtask" && action === "reorder") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    const workState = workStateFlag(parsed.flags);
    const subtaskIds = orderedIdsFlag(parsed.flags, "subtask-ids");
    await application.reorderSubtasks({
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
    await application.archiveSubtask(subtaskId, archiveState);
    output({ subtask: { archiveState, subtaskId } });
    return;
  }

  if (resource === "subtask" && action === "restore") {
    const subtaskId = requiredFlag(parsed.flags, "subtask-id");
    await application.restoreSubtask(subtaskId);
    output({ subtask: { archiveState: null, subtaskId } });
    return;
  }

  if (resource === "subtask" && action === "status") {
    const taskId = requiredFlag(parsed.flags, "task-id");
    output({ status: await application.getTaskStatus(taskId) });
    return;
  }

  if (resource === "subtask" && action === "github-status") {
    const subtaskId = requiredFlag(parsed.flags, "subtask-id");
    if (remoteClient) {
      output({ status: await remoteClient.subtaskGithubStatus(subtaskId) });
      return;
    }
    const subtask = await application.getSubtaskDetail(subtaskId);
    output({ status: await readGitHubStatus(subtask.pullRequestUrl) });
    return;
  }

  if (resource === "subtask" && action === "history") {
    const subtaskId = requiredFlag(parsed.flags, "subtask-id");
    output({
      history: {
        reports: await application.getSubtaskReportHistory(subtaskId),
        verifications:
          await application.getSubtaskVerificationHistory(subtaskId),
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
    "Usage: doctor, credential create|list|revoke, database backup|check, project create|update|list|context|brief|remove|status|portfolio|attention|link|t3-status, session detail|link|auto-link|unlink, task create|update|detail|state|resume-rollup|status|github-status|reorder|archive|restore|link, subtask create|update|report|reorder|status|github-status|archive|restore|history|verify",
  );
}

if (import.meta.main) {
  void main(Bun.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
