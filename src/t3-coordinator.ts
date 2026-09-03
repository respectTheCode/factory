import type {
  CodeSessionObservationInput,
  FactoryApplication,
  Project,
  ProjectT3Activity,
  ReconciliationFinding,
  SessionEvidence,
} from "./application";
import {
  DEFAULT_T3_SERVER_VERSION,
  type T3ActivityReader,
  type T3ProjectObservation,
  type T3ShellObservation,
  type T3ThreadObservation,
  type T3ThreadShellObservation,
  type T3TransportState,
} from "./t3";

export type T3RouteStatus = T3TransportState | "ok" | "unmatched" | "ambiguous";

export type T3ObservedConnection = {
  state:
    | "connected"
    | "not_configured"
    | "unreachable"
    | "authentication_failed"
    | "permission_denied"
    | "incompatible"
    | "invalid_response"
    | "unavailable";
  error?: string;
  observedAt?: string;
  lastSuccessfulFetchAt?: string;
  sourceVersion?: string;
};

export type T3ObservedTarget = {
  id: string;
  kind: "task" | "subtask";
  label: string;
};

export type T3ObservedAssociationLink = {
  linkId: string;
  target: T3ObservedTarget;
};

export type T3ObservedAssociation = {
  state: "linked" | "unmatched" | "ambiguous";
  links: T3ObservedAssociationLink[];
  candidateIds?: string[];
  candidateLabels?: string[];
};

export type T3ObservedThread = {
  threadId: string;
  title: string;
  externalProjectId: string;
  provider: "t3";
  branch?: string;
  worktreePath?: string;
  linkedPullRequestUrl?: string;
  latestSessionState?:
    | "idle"
    | "starting"
    | "ready"
    | "running"
    | "interrupted"
    | "stopped"
    | "error";
  latestTurnState?: "running" | "interrupted" | "completed" | "error";
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
  observedAt: string;
  sourceUpdatedAt: string;
  sourceSequence?: number;
  changedFileCount?: number;
  association: T3ObservedAssociation;
};

export type T3ObservedActivity = {
  status: T3RouteStatus;
  connection: T3ObservedConnection;
  projectName?: string;
  targets: T3ObservedTarget[];
  threads: T3ObservedThread[];
  findings: ReconciliationFinding[];
  counts: {
    running: number;
    needsAttention: number;
    linked: number;
    unmatched: number;
    ambiguous: number;
  };
  error?: string;
};

export type T3StatusResult = {
  status: T3RouteStatus;
  connection: T3ObservedConnection;
  projectCount?: number;
  threadCount?: number;
  recognizedProjectCount?: number;
  unmatchedProjectCount?: number;
  ambiguousProjectCount?: number;
  counts: T3ObservedActivity["counts"];
  error?: string;
};

export type T3AutoLinkResult = {
  status: "linked" | "unmatched" | "ambiguous" | T3TransportState;
  projectId: string;
  branchName: string;
  candidateThreadIds: string[];
  threadId?: string;
  associationId?: string;
  error?: string;
};

export type T3ThreadDetailResult = {
  status: T3RouteStatus;
  connection: T3ObservedConnection;
  threadId: string;
  projectId?: string;
  projectName?: string;
  thread?: Extract<T3ThreadObservation, { ok: true }>["thread"];
  observation?: CodeSessionObservationInput;
  activity?: ProjectT3Activity;
  evidence?: SessionEvidence;
  findings?: ReconciliationFinding[];
  error?: string;
};

type FactoryProject = ReturnType<FactoryApplication["listProjects"]>[number];

export type T3ProjectResolution =
  | {
      status: "matched";
      project: FactoryProject;
      basis: Array<"t3ProjectId" | "workspaceRoot" | "repositoryIdentity">;
    }
  | {
      status: "unmatched" | "ambiguous";
      candidates: FactoryProject[];
      basis: Array<"t3ProjectId" | "workspaceRoot" | "repositoryIdentity">;
      explanation: string;
    };

function normalizeRepositoryIdentity(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!trimmed.includes("://")) {
    const scpStyle = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(trimmed);
    if (scpStyle?.[1] && scpStyle[2]) {
      return `${scpStyle[1].toLowerCase()}/${scpStyle[2]
        .replace(/^\/+|\/+$/g, "")
        .replace(/\.git$/i, "")}`;
    }
  }
  try {
    const url = new URL(trimmed);
    return `${url.host.toLowerCase()}/${url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")}`;
  } catch {
    return trimmed
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")
      .toLowerCase();
  }
}

function repositoryKey(project: T3ProjectObservation): string | undefined {
  return normalizeRepositoryIdentity(project.repositoryIdentity?.canonicalKey);
}

function projectRepositoryKey(project: FactoryProject): string | undefined {
  return normalizeRepositoryIdentity(project.gitOriginUrl);
}

function matchingBasis(
  factoryProject: FactoryProject,
  t3Project: T3ProjectObservation,
): Array<"t3ProjectId" | "workspaceRoot" | "repositoryIdentity"> {
  const basis: Array<"t3ProjectId" | "workspaceRoot" | "repositoryIdentity"> =
    [];
  if (factoryProject.t3ProjectId === t3Project.id) basis.push("t3ProjectId");
  if (factoryProject.workspaceRoot === t3Project.workspaceRoot)
    basis.push("workspaceRoot");
  if (
    projectRepositoryKey(factoryProject) !== undefined &&
    projectRepositoryKey(factoryProject) === repositoryKey(t3Project)
  ) {
    basis.push("repositoryIdentity");
  }
  return basis;
}

function contradictsExplicitMapping(
  factoryProject: FactoryProject,
  t3Project: T3ProjectObservation,
): boolean {
  if (
    factoryProject.t3ProjectId !== undefined &&
    factoryProject.t3ProjectId !== t3Project.id
  ) {
    return true;
  }
  if (
    factoryProject.workspaceRoot !== undefined &&
    factoryProject.workspaceRoot !== t3Project.workspaceRoot
  ) {
    return true;
  }
  const factoryRepository = projectRepositoryKey(factoryProject);
  const t3Repository = repositoryKey(t3Project);
  return (
    factoryRepository !== undefined &&
    t3Repository !== undefined &&
    factoryRepository !== t3Repository
  );
}

export function resolveT3Project(
  t3Project: T3ProjectObservation,
  factoryProjects: FactoryProject[],
): T3ProjectResolution {
  const matches = factoryProjects
    .map((project) => ({
      basis: matchingBasis(project, t3Project),
      project,
    }))
    .filter(
      ({ basis, project }) =>
        basis.length > 0 && !contradictsExplicitMapping(project, t3Project),
    );
  if (matches.length === 1) {
    const match = matches[0];
    if (!match) throw new Error("T3 Project resolution lost its candidate.");
    return { basis: match.basis, project: match.project, status: "matched" };
  }
  if (matches.length > 1) {
    return {
      basis: matches.flatMap((match) => match.basis),
      candidates: matches.map((match) => match.project),
      explanation:
        "The T3 Project matches multiple Factory Projects through explicit identity metadata.",
      status: "ambiguous",
    };
  }
  return {
    basis: [],
    candidates: [],
    explanation:
      "The T3 Project has no explicit T3 ID, workspace-root, or repository-identity match in Factory.",
    status: "unmatched",
  };
}

function sessionState(
  value: T3ThreadShellObservation["session"],
): CodeSessionObservationInput["latestSessionState"] {
  return value?.status;
}

function date(value: string): Date {
  return new Date(value);
}

export function mapT3ThreadObservation({
  projectId,
  project,
  thread,
  observedAt,
  sourceDigest,
  sourceSequence,
  sourceStream,
  sourceUpdatedAt,
}: {
  projectId: string;
  project: T3ProjectObservation;
  thread: T3ThreadShellObservation;
  observedAt: string;
  sourceDigest: string;
  sourceSequence: number;
  sourceStream: string;
  sourceUpdatedAt?: string;
}): CodeSessionObservationInput {
  const repositoryIdentity = project.repositoryIdentity?.canonicalKey;
  return {
    ...(thread.branch === undefined ? {} : { branch: thread.branch }),
    ...(thread.linkedPullRequestUrl === undefined
      ? {}
      : { linkedPullRequestUrl: thread.linkedPullRequestUrl }),
    ...(thread.latestTurn === undefined
      ? {}
      : { latestTurnState: thread.latestTurn.state }),
    ...(thread.latestTurn?.completedAt === undefined
      ? {}
      : { latestTurnCompletedAt: date(thread.latestTurn.completedAt) }),
    ...(sessionState(thread.session) === undefined
      ? {}
      : { latestSessionState: sessionState(thread.session) }),
    ...(repositoryIdentity === undefined ? {} : { repositoryIdentity }),
    ...(thread.worktreePath === undefined
      ? {}
      : { worktreePath: thread.worktreePath }),
    externalProjectId: project.id,
    externalThreadId: thread.id,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    observedAt: date(observedAt),
    projectId,
    provider: "t3",
    sourceDigest,
    sourceStream,
    sourceUpdatedAt: date(sourceUpdatedAt ?? thread.updatedAt),
    title: thread.title,
    workspaceRoot: project.workspaceRoot,
  };
}

function threadNeedsAttention(thread: T3ObservedThread): boolean {
  return (
    thread.latestSessionState === "error" ||
    thread.latestTurnState === "error" ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput
  );
}

function threadIsRunning(thread: T3ObservedThread): boolean {
  return (
    thread.latestSessionState === "running" ||
    thread.latestTurnState === "running"
  );
}

function targetList(
  application: FactoryApplication,
  projectId: string,
): T3ObservedTarget[] {
  const hierarchy = application.getProjectHierarchy(projectId);
  return hierarchy.tasks.flatMap((task) => [
    { id: task.id, kind: "task" as const, label: task.name },
    ...task.subtasks.map((subtask) => ({
      id: subtask.id,
      kind: "subtask" as const,
      label: `${task.name} / ${subtask.name}`,
    })),
  ]);
}

function targetById(
  targets: T3ObservedTarget[],
  id: string | undefined,
): T3ObservedTarget | undefined {
  return id === undefined
    ? undefined
    : targets.find((target) => target.id === id);
}

function associationFor(
  item: ProjectT3Activity,
  findings: ReconciliationFinding[],
  targets: T3ObservedTarget[],
): T3ObservedAssociation {
  const links = item.associations
    .map((association) => {
      const target = targetById(
        targets,
        association.subtaskId ?? association.taskId,
      );
      return target ? { linkId: association.id, target } : undefined;
    })
    .filter(
      (link): link is { linkId: string; target: T3ObservedTarget } =>
        link !== undefined,
    );
  if (links.length > 0) {
    return {
      links,
      state: "linked",
    };
  }
  const finding = findings.find(
    (candidate) =>
      candidate.externalThreadId === item.observation.externalThreadId &&
      candidate.kind === "ambiguous_target",
  );
  if (finding) {
    const candidateLabels = finding.candidateIds
      .map((candidateId) => targetById(targets, candidateId))
      .filter(
        (candidate): candidate is T3ObservedTarget => candidate !== undefined,
      )
      .map((candidate) => candidate.label);
    return {
      candidateIds: [...finding.candidateIds],
      ...(candidateLabels.length === 0 ? {} : { candidateLabels }),
      links: [],
      state: "ambiguous",
    };
  }
  return { links: [], state: "unmatched" };
}

function viewThread(
  item: ProjectT3Activity,
  findings: ReconciliationFinding[],
  targets: T3ObservedTarget[],
  evidence: SessionEvidence | undefined,
): T3ObservedThread {
  const observation = item.observation;
  return {
    ...(observation.branch === undefined ? {} : { branch: observation.branch }),
    ...(evidence?.changedFileCount === undefined
      ? {}
      : { changedFileCount: evidence.changedFileCount }),
    ...(observation.linkedPullRequestUrl === undefined
      ? {}
      : { linkedPullRequestUrl: observation.linkedPullRequestUrl }),
    ...(observation.latestSessionState === undefined
      ? {}
      : { latestSessionState: observation.latestSessionState }),
    ...(observation.latestTurnState === undefined
      ? {}
      : { latestTurnState: observation.latestTurnState }),
    ...(observation.worktreePath === undefined
      ? {}
      : { worktreePath: observation.worktreePath }),
    association: associationFor(item, findings, targets),
    externalProjectId: observation.externalProjectId,
    hasPendingApprovals: observation.hasPendingApprovals,
    hasPendingUserInput: observation.hasPendingUserInput,
    observedAt: observation.observedAt.toISOString(),
    provider: observation.provider,
    sourceSequence: observation.sourceSequence,
    sourceUpdatedAt: observation.sourceUpdatedAt.toISOString(),
    threadId: observation.externalThreadId,
    title: observation.title,
  };
}

function emptyCounts(): T3ObservedActivity["counts"] {
  return {
    ambiguous: 0,
    linked: 0,
    needsAttention: 0,
    running: 0,
    unmatched: 0,
  };
}

function activityView(
  application: FactoryApplication,
  project: FactoryProject,
  connection: T3ObservedConnection,
  status: T3RouteStatus,
  error?: string,
  currentThreadIds?: Set<string>,
): T3ObservedActivity {
  const all = application.listProjectT3Activity(project.id);
  const findings = application
    .listReconciliationFindings(project.id)
    .filter((finding) => finding.status === "open");
  const targets = targetList(application, project.id);
  const items = currentThreadIds
    ? all.filter((item) =>
        currentThreadIds.has(item.observation.externalThreadId),
      )
    : all;
  const threads = items.map((item) => {
    const evidence = application
      .listSessionEvidence(item.observation.externalThreadId)
      .at(-1);
    return viewThread(item, findings, targets, evidence);
  });
  const counts = emptyCounts();
  for (const thread of threads) {
    if (threadIsRunning(thread)) counts.running += 1;
    if (threadNeedsAttention(thread)) counts.needsAttention += 1;
    if (thread.association.state === "linked") counts.linked += 1;
    if (thread.association.state === "ambiguous") counts.ambiguous += 1;
    if (thread.association.state === "unmatched") counts.unmatched += 1;
  }
  return {
    connection,
    counts,
    ...(error === undefined ? {} : { error }),
    findings,
    projectName: project.name,
    status,
    targets,
    threads,
  };
}

function failureConnection(result: {
  status: T3TransportState;
  fetchedAt: string;
  error: string;
}): T3ObservedConnection {
  return {
    error: result.error,
    observedAt: result.fetchedAt,
    state: result.status,
  };
}

function successConnection(fetchedAt: string): T3ObservedConnection {
  return {
    lastSuccessfulFetchAt: fetchedAt,
    observedAt: fetchedAt,
    sourceVersion: DEFAULT_T3_SERVER_VERSION,
    state: "connected",
  };
}

function failureStatus(
  application: FactoryApplication,
  project: FactoryProject,
  result: { status: T3TransportState; fetchedAt: string; error: string },
): T3ObservedActivity {
  application.refreshT3Observations({
    observations: [],
    sourceUnavailable: [
      {
        explanation: result.error,
        observedAt: date(result.fetchedAt),
        projectId: project.id,
      },
    ],
  });
  const lastSuccessfulFetchAt = application
    .listProjectT3Activity(project.id)
    .map((item) => item.observation.observedAt.getTime())
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)
    .at(0);
  const connection = failureConnection(result);
  if (lastSuccessfulFetchAt !== undefined) {
    connection.lastSuccessfulFetchAt = new Date(
      lastSuccessfulFetchAt,
    ).toISOString();
  }
  return activityView(
    application,
    project,
    connection,
    result.status,
    result.error,
  );
}

function unresolvedStatus(
  application: FactoryApplication,
  project: FactoryProject,
  resolution: Extract<
    T3ProjectResolution,
    { status: "unmatched" | "ambiguous" }
  >,
  fetchedAt: string,
): T3ObservedActivity {
  application.refreshT3Observations({
    observations: [],
    sourceUnavailable: [
      {
        explanation: resolution.explanation,
        observedAt: date(fetchedAt),
        projectId: project.id,
      },
    ],
  });
  return activityView(
    application,
    project,
    { error: resolution.explanation, state: "connected" },
    resolution.status,
    resolution.explanation,
  );
}

function shellProjectResolution(
  shell: Extract<T3ShellObservation, { ok: true }>,
  project: FactoryProject,
  factoryProjects: FactoryProject[],
): T3ProjectResolution {
  const matches = shell.projects
    .map((t3Project) => ({
      resolution: resolveT3Project(t3Project, factoryProjects),
      t3Project,
    }))
    .filter(
      ({ resolution }) =>
        resolution.status === "matched" && resolution.project.id === project.id,
    );
  if (matches.length === 1) {
    const match = matches[0];
    if (!match) throw new Error("T3 Project resolution lost its candidate.");
    return match.resolution;
  }
  if (matches.length > 1) {
    return {
      basis: [],
      candidates: [project],
      explanation:
        "The selected Factory Project maps to multiple T3 Projects; refresh was rejected.",
      status: "ambiguous",
    };
  }
  const unresolved = shell.projects
    .map((t3Project) => resolveT3Project(t3Project, factoryProjects))
    .find(
      (resolution) =>
        resolution.status !== "matched" &&
        resolution.candidates.some((candidate) => candidate.id === project.id),
    );
  return (
    unresolved ?? {
      basis: [],
      candidates: [],
      explanation:
        "The selected Factory Project has no matching T3 Project in the current shell.",
      status: "unmatched",
    }
  );
}

function resultFailure(
  threadId: string,
  result: { status: T3TransportState; fetchedAt: string; error: string },
): T3ThreadDetailResult {
  return {
    connection: failureConnection(result),
    error: result.error,
    status: result.status,
    threadId,
  };
}

function sanitizeThreadDetail(
  thread: Extract<T3ThreadObservation, { ok: true }>["thread"],
): Extract<T3ThreadObservation, { ok: true }>["thread"] {
  return {
    ...(thread.archivedAt === undefined
      ? {}
      : { archivedAt: thread.archivedAt }),
    ...(thread.backgroundLiveness === undefined
      ? {}
      : { backgroundLiveness: thread.backgroundLiveness }),
    ...(thread.branch === undefined ? {} : { branch: thread.branch }),
    ...(thread.latestTurn === undefined
      ? {}
      : {
          latestTurn: {
            ...(thread.latestTurn.completedAt === undefined
              ? {}
              : { completedAt: thread.latestTurn.completedAt }),
            ...(thread.latestTurn.startedAt === undefined
              ? {}
              : { startedAt: thread.latestTurn.startedAt }),
            requestedAt: thread.latestTurn.requestedAt,
            state: thread.latestTurn.state,
            turnId: thread.latestTurn.turnId,
          },
        }),
    ...(thread.latestUserMessageAt === undefined
      ? {}
      : { latestUserMessageAt: thread.latestUserMessageAt }),
    ...(thread.linkedPullRequestUrl === undefined
      ? {}
      : { linkedPullRequestUrl: thread.linkedPullRequestUrl }),
    ...(thread.planProgress === undefined
      ? {}
      : { planProgress: { ...thread.planProgress } }),
    ...(thread.session === undefined
      ? {}
      : {
          session: {
            ...(thread.session.activeTurnId === undefined
              ? {}
              : { activeTurnId: thread.session.activeTurnId }),
            ...(thread.session.providerName === undefined
              ? {}
              : { providerName: thread.session.providerName }),
            status: thread.session.status,
            updatedAt: thread.session.updatedAt,
          },
        }),
    ...(thread.settledAt === undefined ? {} : { settledAt: thread.settledAt }),
    ...(thread.worktreePath === undefined
      ? {}
      : { worktreePath: thread.worktreePath }),
    activities: thread.activities.map((activity) => ({
      ...(activity.sequence === undefined
        ? {}
        : { sequence: activity.sequence }),
      ...(activity.turnId === undefined ? {} : { turnId: activity.turnId }),
      createdAt: activity.createdAt,
      id: activity.id,
      kind: activity.kind,
      tone: activity.tone,
    })),
    checkpoints: thread.checkpoints.map((checkpoint) => ({
      completedAt: checkpoint.completedAt,
      files: checkpoint.files.map((file) => ({
        additions: file.additions,
        deletions: file.deletions,
        kind: file.kind,
        path: file.path,
      })),
      status: checkpoint.status,
      turnId: checkpoint.turnId,
    })),
    createdAt: thread.createdAt,
    hasActionableProposedPlan: thread.hasActionableProposedPlan,
    hasPendingApprovals: thread.hasPendingApprovals,
    hasPendingUserInput: thread.hasPendingUserInput,
    id: thread.id,
    messages: thread.messages.map((message) => ({
      ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
      createdAt: message.createdAt,
      id: message.id,
      role: message.role,
      streaming: message.streaming,
      updatedAt: message.updatedAt,
    })),
    projectId: thread.projectId,
    title: thread.title,
    updatedAt: thread.updatedAt,
  };
}

function detailEvidence(
  detail: Extract<T3ThreadObservation, { ok: true }>,
): Omit<SessionEvidence, "id"> {
  const turnIds = new Set<string>();
  if (detail.thread.latestTurn?.turnId)
    turnIds.add(detail.thread.latestTurn.turnId);
  for (const message of detail.thread.messages) {
    if (message.turnId) turnIds.add(message.turnId);
  }
  for (const activity of detail.thread.activities) {
    if (activity.turnId) turnIds.add(activity.turnId);
  }
  for (const checkpoint of detail.thread.checkpoints) {
    turnIds.add(checkpoint.turnId);
  }
  const checkpointFiles = new Set<string>();
  for (const checkpoint of detail.thread.checkpoints) {
    for (const file of checkpoint.files) checkpointFiles.add(file.path);
  }
  return {
    ...(detail.thread.linkedPullRequestUrl === undefined
      ? {}
      : { linkedPullRequestUrl: detail.thread.linkedPullRequestUrl }),
    ...(checkpointFiles.size === 0
      ? {}
      : { changedFileCount: checkpointFiles.size }),
    digest: detail.sourceDigest,
    externalThreadId: detail.thread.id,
    observedAt: date(detail.fetchedAt),
    provider: "t3",
    sourceSequence: detail.sourceSequence,
    sourceStream: detail.sourceStream,
    checkpointFiles: [...checkpointFiles],
    turnIds: [...turnIds],
  };
}

export function createT3Coordinator({
  application,
  reader,
}: {
  application: FactoryApplication;
  reader: T3ActivityReader;
}) {
  const projects = () => application.listProjects();

  return {
    async status(projectId?: string): Promise<T3StatusResult> {
      const factoryProjects = projects();
      const selected = projectId
        ? factoryProjects.find((project) => project.id === projectId)
        : undefined;
      if (projectId && !selected)
        throw new Error(`Project ${projectId} does not exist.`);
      const shell = await reader.readShell();
      if (!shell.ok) {
        return {
          connection: failureConnection(shell),
          counts: emptyCounts(),
          error: shell.error,
          status: shell.status,
        };
      }
      const resolutions = shell.projects.map((project) => ({
        project,
        resolution: resolveT3Project(project, factoryProjects),
      }));
      const counts = emptyCounts();
      let threadCount = 0;
      for (const { project, resolution } of resolutions) {
        if (
          selected &&
          (resolution.status !== "matched" ||
            resolution.project.id !== selected.id)
        )
          continue;
        for (const thread of shell.threads.filter(
          (candidate) => candidate.projectId === project.id,
        )) {
          threadCount += 1;
          const mapped: T3ObservedThread = {
            ...(thread.branch === undefined ? {} : { branch: thread.branch }),
            ...(thread.linkedPullRequestUrl === undefined
              ? {}
              : { linkedPullRequestUrl: thread.linkedPullRequestUrl }),
            ...(thread.latestTurn === undefined
              ? {}
              : { latestTurnState: thread.latestTurn.state }),
            ...(sessionState(thread.session) === undefined
              ? {}
              : { latestSessionState: sessionState(thread.session) }),
            ...(thread.worktreePath === undefined
              ? {}
              : { worktreePath: thread.worktreePath }),
            association:
              resolution.status === "ambiguous"
                ? { links: [], state: "ambiguous" }
                : resolution.status === "unmatched"
                  ? { links: [], state: "unmatched" }
                  : { links: [], state: "unmatched" },
            externalProjectId: project.id,
            hasPendingApprovals: thread.hasPendingApprovals,
            hasPendingUserInput: thread.hasPendingUserInput,
            observedAt: shell.fetchedAt,
            provider: "t3",
            sourceUpdatedAt: thread.updatedAt,
            threadId: thread.id,
            title: thread.title,
          };
          if (threadIsRunning(mapped)) counts.running += 1;
          if (threadNeedsAttention(mapped)) counts.needsAttention += 1;
          if (resolution.status === "ambiguous") counts.ambiguous += 1;
          else if (resolution.status === "unmatched") counts.unmatched += 1;
          else {
            try {
              const existing = application.getT3ThreadDetail(thread.id);
              if (existing.associations.length > 0) counts.linked += 1;
              else counts.unmatched += 1;
            } catch {
              counts.unmatched += 1;
            }
          }
        }
      }
      const selectedResolution = selected
        ? shellProjectResolution(shell, selected, factoryProjects)
        : undefined;
      const routeStatus =
        selectedResolution && selectedResolution.status !== "matched"
          ? selectedResolution.status
          : "ok";
      const connection = successConnection(shell.fetchedAt);
      const error =
        selectedResolution && selectedResolution.status !== "matched"
          ? selectedResolution.explanation
          : undefined;
      return {
        ambiguousProjectCount: resolutions.filter(
          ({ resolution }) => resolution.status === "ambiguous",
        ).length,
        connection,
        counts,
        ...(error === undefined ? {} : { error }),
        projectCount: shell.projects.length,
        recognizedProjectCount: resolutions.filter(
          ({ resolution }) => resolution.status === "matched",
        ).length,
        status: routeStatus,
        threadCount,
        unmatchedProjectCount: resolutions.filter(
          ({ resolution }) => resolution.status === "unmatched",
        ).length,
      };
    },

    async projectActivity(projectId: string): Promise<T3ObservedActivity> {
      const factoryProject = projects().find(
        (project) => project.id === projectId,
      );
      if (!factoryProject)
        throw new Error(`Project ${projectId} does not exist.`);
      const shell = await reader.readShell();
      if (!shell.ok) return failureStatus(application, factoryProject, shell);
      const resolution = shellProjectResolution(
        shell,
        factoryProject,
        projects(),
      );
      if (resolution.status !== "matched")
        return unresolvedStatus(
          application,
          factoryProject,
          resolution,
          shell.fetchedAt,
        );
      const t3Project = shell.projects.find((candidate) => {
        const candidateResolution = resolveT3Project(candidate, projects());
        return (
          candidateResolution.status === "matched" &&
          candidateResolution.project.id === factoryProject.id
        );
      });
      if (!t3Project) {
        return unresolvedStatus(
          application,
          factoryProject,
          {
            basis: [],
            candidates: [],
            explanation:
              "The selected Factory Project has no matching T3 Project.",
            status: "unmatched",
          },
          shell.fetchedAt,
        );
      }
      const observations = shell.threads
        .filter((thread) => thread.projectId === t3Project.id)
        .map((thread) =>
          mapT3ThreadObservation({
            observedAt: shell.fetchedAt,
            project: t3Project,
            projectId: factoryProject.id,
            sourceDigest: shell.sourceDigest,
            sourceSequence: shell.sourceSequence,
            sourceStream: shell.sourceStream,
            thread,
          }),
        );
      application.refreshT3Observations({
        observations,
        refreshedProjects: [
          {
            observedAt: date(shell.fetchedAt),
            projectId: factoryProject.id,
            sourceSequence: shell.sourceSequence,
            sourceStream: shell.sourceStream,
            sourceUpdatedAt: date(shell.sourceUpdatedAt),
          },
        ],
      });
      return activityView(
        application,
        factoryProject,
        successConnection(shell.fetchedAt),
        "ok",
        undefined,
        new Set(
          observations.map((observation) => observation.externalThreadId),
        ),
      );
    },

    async threadDetail(
      threadId: string,
      turnLimit: number,
    ): Promise<T3ThreadDetailResult> {
      const shell = await reader.readShell();
      if (!shell.ok) return resultFailure(threadId, shell);
      const shellThread = shell.threads.find(
        (thread) => thread.id === threadId,
      );
      if (!shellThread) {
        return {
          connection: successConnection(shell.fetchedAt),
          error: `T3 thread ${threadId} was not found in the current shell.`,
          status: "unavailable",
          threadId,
        };
      }
      const factoryProjects = projects();
      const t3Project = shell.projects.find(
        (project) => project.id === shellThread.projectId,
      );
      if (!t3Project) {
        return {
          connection: successConnection(shell.fetchedAt),
          error:
            "The T3 thread references a project absent from the current shell.",
          status: "invalid_response",
          threadId,
        };
      }
      const resolution = resolveT3Project(t3Project, factoryProjects);
      if (resolution.status !== "matched") {
        return {
          connection: successConnection(shell.fetchedAt),
          error: resolution.explanation,
          status: resolution.status,
          threadId,
        };
      }
      const detail = await reader.readThread({ threadId, turnLimit });
      if (!detail.ok) return resultFailure(threadId, detail);
      if (
        detail.thread.id !== shellThread.id ||
        detail.thread.projectId !== t3Project.id
      ) {
        return {
          connection: successConnection(detail.fetchedAt),
          error:
            "T3 returned a thread that does not match the requested shell entry.",
          status: "invalid_response",
          threadId,
        };
      }
      const sanitizedThread = sanitizeThreadDetail({
        ...detail.thread,
        ...(shellThread.backgroundLiveness === undefined
          ? {}
          : { backgroundLiveness: shellThread.backgroundLiveness }),
        ...(shellThread.latestUserMessageAt === undefined
          ? {}
          : { latestUserMessageAt: shellThread.latestUserMessageAt }),
        ...(shellThread.planProgress === undefined
          ? {}
          : { planProgress: shellThread.planProgress }),
        hasActionableProposedPlan: shellThread.hasActionableProposedPlan,
        hasPendingApprovals: shellThread.hasPendingApprovals,
        hasPendingUserInput: shellThread.hasPendingUserInput,
      });
      const observation = mapT3ThreadObservation({
        observedAt: detail.fetchedAt,
        project: t3Project,
        projectId: resolution.project.id,
        sourceDigest: detail.sourceDigest,
        sourceSequence: detail.sourceSequence,
        sourceStream: detail.sourceStream,
        sourceUpdatedAt: detail.sourceUpdatedAt,
        thread: sanitizedThread,
      });
      application.refreshT3Observations({ observations: [observation] });
      const evidence = application.recordSessionEvidence(
        detailEvidence(detail),
      );
      const activity = application.getT3ThreadDetail(threadId);
      return {
        activity,
        connection: successConnection(detail.fetchedAt),
        evidence,
        findings: application.listReconciliationFindings(resolution.project.id),
        observation,
        projectId: resolution.project.id,
        projectName: resolution.project.name,
        status: "ok",
        thread: sanitizedThread,
        threadId,
      };
    },

    linkThread({
      projectId,
      threadId,
      taskId,
      subtaskId,
    }: {
      projectId: string;
      threadId: string;
      taskId?: string;
      subtaskId?: string;
    }) {
      const detail = application.getT3ThreadDetail(threadId);
      if (detail.observation.projectId !== projectId) {
        throw new Error(
          "T3 thread does not belong to the selected Factory Project.",
        );
      }
      return application.linkT3Thread({
        observation: detail.observation,
        ...(subtaskId === undefined ? {} : { subtaskId }),
        ...(taskId === undefined ? {} : { taskId }),
      });
    },

    async autoLinkThread({
      branchName,
      projectId,
      taskId,
      subtaskId,
    }: {
      branchName: string;
      projectId: string;
      taskId?: string;
      subtaskId?: string;
    }): Promise<T3AutoLinkResult> {
      const normalizedBranch = branchName.trim();
      if (!normalizedBranch) {
        throw new Error("Automatic T3 association requires a branch name.");
      }
      const activity = await this.projectActivity(projectId);
      if (activity.status !== "ok") {
        return {
          branchName: normalizedBranch,
          candidateThreadIds: [],
          ...(activity.error === undefined ? {} : { error: activity.error }),
          projectId,
          status: activity.status,
        };
      }
      const candidates = activity.threads.filter(
        (thread) =>
          thread.branch === normalizedBranch && threadIsRunning(thread),
      );
      if (candidates.length !== 1) {
        return {
          branchName: normalizedBranch,
          candidateThreadIds: candidates.map((thread) => thread.threadId),
          projectId,
          status: candidates.length === 0 ? "unmatched" : "ambiguous",
        };
      }
      const thread = candidates[0];
      if (!thread) throw new Error("Automatic T3 association lost its match.");
      const linked = this.linkThread({
        projectId,
        threadId: thread.threadId,
        ...(subtaskId === undefined ? {} : { subtaskId }),
        ...(taskId === undefined ? {} : { taskId }),
      });
      return {
        associationId: linked.association.id,
        branchName: normalizedBranch,
        candidateThreadIds: [thread.threadId],
        projectId,
        status: "linked",
        threadId: thread.threadId,
      };
    },

    unlinkThread(threadId: string, associationId?: string) {
      return application.unlinkT3Thread({
        ...(associationId === undefined ? {} : { associationId }),
        externalThreadId: threadId,
      });
    },
  };
}
