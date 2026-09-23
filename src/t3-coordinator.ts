import { sameWorkspaceRoot } from "./workspace";
import {
  LEGACY_T3_SOURCE_ID,
  normalizeT3SourceId,
  type T3ProjectMapping,
} from "./t3-source-identity";
import type {
  CodeSessionObservationInput,
  FactoryApplication,
  ProjectT3Activity,
  ReconciliationFinding,
  SessionEvidence,
} from "./application";
import {
  DEFAULT_T3_SERVER_VERSION,
  type T3ActivityReader,
  type T3ObservationFailure,
  type T3ProjectObservation,
  type T3ShellObservation,
  type T3ThreadObservation,
  type T3ThreadShellObservation,
  type T3TransportState,
} from "./t3";

type T3Failure = T3ObservationFailure;

function isT3Failure(value: { ok: boolean }): value is T3Failure {
  return value.ok === false;
}

export type T3RouteStatus = T3TransportState | "ok" | "unmatched" | "ambiguous";

export type T3ObservedConnection = {
  sourceId: string;
  machineId: string;
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
  state: "linked" | "suggested" | "unmatched" | "ambiguous";
  links: T3ObservedAssociationLink[];
  candidateIds?: string[];
  candidateLabels?: string[];
};

export type T3ObservedThread = {
  sourceId: string;
  machineId: string;
  threadId: string;
  title: string;
  agent?: string;
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
  latestTurnCompletedAt?: string;
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
    suggested: number;
    unmatched: number;
    ambiguous: number;
  };
  error?: string;
  sourceId: string;
  machineId: string;
  sources: T3ObservedActivitySource[];
};

export type T3ObservedActivitySource = {
  sourceId: string;
  machineId: string;
  label?: string;
  status: T3RouteStatus;
  connection: T3ObservedConnection;
  projectName?: string;
  targets: T3ObservedTarget[];
  threads: T3ObservedThread[];
  findings: ReconciliationFinding[];
  counts: T3ObservedActivity["counts"];
  error?: string;
};

export type T3StatusResult = {
  sourceId: string;
  machineId: string;
  status: T3RouteStatus;
  connection: T3ObservedConnection;
  projectCount?: number;
  threadCount?: number;
  recognizedProjectCount?: number;
  unmatchedProjectCount?: number;
  ambiguousProjectCount?: number;
  counts: T3ObservedActivity["counts"];
  sources: T3StatusSource[];
  error?: string;
};

export type T3StatusSource = {
  sourceId: string;
  machineId: string;
  label?: string;
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
  sourceId?: string;
  machineId?: string;
};

export type T3ThreadDetailResult = {
  sourceId: string;
  machineId: string;
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

export type T3CoordinatorSource = {
  sourceId: string;
  machineId: string;
  label?: string;
  reader: T3ActivityReader;
};

type SourceRuntime = T3CoordinatorSource & {
  lastSuccessfulFetchAt?: string;
};

const LEGACY_T3_MACHINE_ID = "legacy";

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
        .replace(/\.git$/i, "")}`.toLowerCase();
    }
  }
  try {
    const url = new URL(trimmed);
    return `${url.host.toLowerCase()}/${url.pathname
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "")}`.toLowerCase();
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

function projectMappings(project: FactoryProject): T3ProjectMapping[] {
  return project.t3Mappings ?? [];
}

function mappingFor(
  project: FactoryProject,
  sourceId: string,
): T3ProjectMapping | undefined {
  const normalized = normalizeT3SourceId(sourceId);
  return projectMappings(project).find(
    (mapping) => normalizeT3SourceId(mapping.sourceId) === normalized,
  );
}

function matchingBasis(
  factoryProject: FactoryProject,
  t3Project: T3ProjectObservation,
  sourceId = LEGACY_T3_SOURCE_ID,
): Array<"t3ProjectId" | "workspaceRoot" | "repositoryIdentity"> {
  const basis: Array<"t3ProjectId" | "workspaceRoot" | "repositoryIdentity"> =
    [];
  const mapping = mappingFor(factoryProject, sourceId);
  const isLegacy = normalizeT3SourceId(sourceId) === LEGACY_T3_SOURCE_ID;
  const explicitT3ProjectId =
    mapping?.t3ProjectId ?? (isLegacy ? factoryProject.t3ProjectId : undefined);
  const explicitWorkspaceRoot =
    mapping?.workspaceRoot ??
    (isLegacy ? factoryProject.workspaceRoot : undefined);
  if (explicitT3ProjectId === t3Project.id) basis.push("t3ProjectId");
  if (sameWorkspaceRoot(explicitWorkspaceRoot, t3Project.workspaceRoot))
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
  sourceId = LEGACY_T3_SOURCE_ID,
): boolean {
  const mapping = mappingFor(factoryProject, sourceId);
  const isLegacy = normalizeT3SourceId(sourceId) === LEGACY_T3_SOURCE_ID;
  const explicitT3ProjectId =
    mapping?.t3ProjectId ?? (isLegacy ? factoryProject.t3ProjectId : undefined);
  const explicitWorkspaceRoot =
    mapping?.workspaceRoot ??
    (isLegacy ? factoryProject.workspaceRoot : undefined);
  if (
    explicitT3ProjectId !== undefined &&
    explicitT3ProjectId !== t3Project.id
  ) {
    return true;
  }
  // A source-specific mapping is an explicit constraint, including its
  // workspace root. The global legacy root remains machine-local and is
  // therefore superseded by a portable repository match.
  if (
    mapping?.workspaceRoot !== undefined &&
    !sameWorkspaceRoot(mapping.workspaceRoot, t3Project.workspaceRoot)
  ) {
    return true;
  }
  // Repository identity is portable across machines. Once it matches, a
  // global legacy workspace root is not a contradiction.
  const factoryRepository = projectRepositoryKey(factoryProject);
  const t3Repository = repositoryKey(t3Project);
  if (factoryRepository !== undefined && factoryRepository === t3Repository)
    return false;
  if (
    explicitWorkspaceRoot !== undefined &&
    !sameWorkspaceRoot(explicitWorkspaceRoot, t3Project.workspaceRoot)
  ) {
    return true;
  }
  if (
    mapping !== undefined ||
    (isLegacy &&
      (factoryProject.t3ProjectId !== undefined ||
        factoryProject.workspaceRoot !== undefined))
  ) {
    return false;
  }
  return (
    factoryRepository !== undefined &&
    t3Repository !== undefined &&
    factoryRepository !== t3Repository
  );
}

export function resolveT3Project(
  t3Project: T3ProjectObservation,
  factoryProjects: FactoryProject[],
  sourceId = LEGACY_T3_SOURCE_ID,
): T3ProjectResolution {
  const matches = factoryProjects
    .map((project) => ({
      basis: matchingBasis(project, t3Project, sourceId),
      project,
    }))
    .filter(
      ({ basis, project }) =>
        basis.length > 0 &&
        !contradictsExplicitMapping(project, t3Project, sourceId),
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
  sourceId = LEGACY_T3_SOURCE_ID,
  machineId = LEGACY_T3_MACHINE_ID,
}: {
  projectId: string;
  project: T3ProjectObservation;
  thread: T3ThreadShellObservation;
  observedAt: string;
  sourceDigest: string;
  sourceSequence: number;
  sourceStream: string;
  sourceUpdatedAt?: string;
  sourceId?: string;
  machineId?: string;
}): CodeSessionObservationInput {
  const repositoryIdentity = project.repositoryIdentity?.canonicalKey;
  return {
    ...(thread.session?.providerName === undefined
      ? {}
      : { agent: thread.session.providerName }),
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
    sourceId: normalizeT3SourceId(sourceId),
    machineId,
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

function observationSourceId(observation: CodeSessionObservationInput): string {
  return normalizeT3SourceId(observation.sourceId);
}

function observationMachineId(
  observation: CodeSessionObservationInput,
): string {
  return observation.machineId?.trim() || LEGACY_T3_MACHINE_ID;
}

function listProjectActivity(
  application: FactoryApplication,
  projectId: string,
  sourceId: string,
): ProjectT3Activity[] {
  return application.listProjectT3Activity(
    projectId,
    normalizeT3SourceId(sourceId),
  );
}

function getThreadActivity(
  application: FactoryApplication,
  threadId: string,
  sourceId: string,
): ProjectT3Activity {
  return application.getT3ThreadDetail(threadId, normalizeT3SourceId(sourceId));
}

function listEvidence(
  application: FactoryApplication,
  threadId: string,
  sourceId: string,
): SessionEvidence[] {
  return application.listSessionEvidence(
    threadId,
    normalizeT3SourceId(sourceId),
  );
}

function refreshObservations(
  application: FactoryApplication,
  input: Parameters<FactoryApplication["refreshT3Observations"]>[0],
): void {
  application.refreshT3Observations(input);
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
  application: FactoryApplication,
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
  const match = application.matchT3Observation(item.observation);
  if (match.status === "ambiguous") {
    const candidateIds = match.candidates.map(
      (candidate) => candidate.subtaskId ?? candidate.taskId,
    );
    const candidateLabels = candidateIds
      .map((candidateId) => targetById(targets, candidateId))
      .filter(
        (candidate): candidate is T3ObservedTarget => candidate !== undefined,
      )
      .map((candidate) => candidate.label);
    return {
      candidateIds,
      ...(candidateLabels.length === 0 ? {} : { candidateLabels }),
      links: [],
      state: "ambiguous",
    };
  }
  if (match.status === "matched") {
    const candidateId = match.candidate.subtaskId ?? match.candidate.taskId;
    const candidate = targetById(targets, candidateId);
    return {
      candidateIds: [candidateId],
      ...(candidate ? { candidateLabels: [candidate.label] } : {}),
      links: [],
      state: "suggested",
    };
  }
  return { links: [], state: "unmatched" };
}

function viewThread(
  item: ProjectT3Activity,
  application: FactoryApplication,
  targets: T3ObservedTarget[],
  evidence: SessionEvidence | undefined,
): T3ObservedThread {
  const observation = item.observation;
  const sourceId = observationSourceId(observation);
  const machineId = observationMachineId(observation);
  return {
    ...(observation.agent === undefined ? {} : { agent: observation.agent }),
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
    ...(observation.latestTurnCompletedAt === undefined
      ? {}
      : {
          latestTurnCompletedAt:
            observation.latestTurnCompletedAt.toISOString(),
        }),
    ...(observation.worktreePath === undefined
      ? {}
      : { worktreePath: observation.worktreePath }),
    association: associationFor(item, application, targets),
    externalProjectId: observation.externalProjectId,
    hasPendingApprovals: observation.hasPendingApprovals,
    hasPendingUserInput: observation.hasPendingUserInput,
    observedAt: observation.observedAt.toISOString(),
    provider: observation.provider,
    sourceSequence: observation.sourceSequence,
    sourceUpdatedAt: observation.sourceUpdatedAt.toISOString(),
    threadId: observation.externalThreadId,
    title: observation.title,
    sourceId,
    machineId,
  };
}

function emptyCounts(): T3ObservedActivity["counts"] {
  return {
    ambiguous: 0,
    linked: 0,
    needsAttention: 0,
    running: 0,
    suggested: 0,
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
  source?: Pick<T3CoordinatorSource, "sourceId" | "machineId" | "label">,
): T3ObservedActivity {
  const sourceId = normalizeT3SourceId(source?.sourceId ?? connection.sourceId);
  const machineId =
    source?.machineId ?? connection.machineId ?? LEGACY_T3_MACHINE_ID;
  const all = listProjectActivity(application, project.id, sourceId);
  const findings = application
    .listReconciliationFindings(project.id, sourceId)
    .filter((finding) => finding.status === "open");
  const targets = targetList(application, project.id);
  const items = currentThreadIds
    ? all.filter((item) =>
        currentThreadIds.has(item.observation.externalThreadId),
      )
    : all;
  const threads = items.map((item) => {
    const evidence = listEvidence(
      application,
      item.observation.externalThreadId,
      sourceId,
    ).at(-1);
    return viewThread(item, application, targets, evidence);
  });
  const counts = emptyCounts();
  for (const thread of threads) {
    if (threadIsRunning(thread)) counts.running += 1;
    if (threadNeedsAttention(thread)) counts.needsAttention += 1;
    if (thread.association.state === "linked") counts.linked += 1;
    if (thread.association.state === "ambiguous") counts.ambiguous += 1;
    if (thread.association.state === "suggested") counts.suggested += 1;
    if (thread.association.state === "unmatched") counts.unmatched += 1;
  }
  const sourceView: T3ObservedActivitySource = {
    connection,
    counts,
    ...(error === undefined ? {} : { error }),
    findings,
    ...(source?.label === undefined ? {} : { label: source.label }),
    machineId,
    projectName: project.name,
    sourceId,
    status,
    targets,
    threads,
  };
  return {
    connection,
    counts,
    ...(error === undefined ? {} : { error }),
    findings,
    projectName: project.name,
    status,
    targets,
    threads,
    machineId,
    sourceId,
    sources: [sourceView],
  };
}

function failureConnection(
  result: {
    status: T3TransportState;
    fetchedAt: string;
    error: string;
  },
  source: Pick<T3CoordinatorSource, "sourceId" | "machineId"> = {
    sourceId: LEGACY_T3_SOURCE_ID,
    machineId: LEGACY_T3_MACHINE_ID,
  },
): T3ObservedConnection {
  return {
    error: result.error,
    machineId: source.machineId,
    observedAt: result.fetchedAt,
    sourceId: normalizeT3SourceId(source.sourceId),
    state: result.status,
  };
}

function successConnection(
  fetchedAt: string,
  source: Pick<T3CoordinatorSource, "sourceId" | "machineId"> = {
    sourceId: LEGACY_T3_SOURCE_ID,
    machineId: LEGACY_T3_MACHINE_ID,
  },
): T3ObservedConnection {
  return {
    lastSuccessfulFetchAt: fetchedAt,
    machineId: source.machineId,
    observedAt: fetchedAt,
    sourceVersion: DEFAULT_T3_SERVER_VERSION,
    sourceId: normalizeT3SourceId(source.sourceId),
    state: "connected",
  };
}

function failureStatus(
  application: FactoryApplication,
  project: FactoryProject,
  result: { status: T3TransportState; fetchedAt: string; error: string },
  source: SourceRuntime = {
    sourceId: LEGACY_T3_SOURCE_ID,
    machineId: LEGACY_T3_MACHINE_ID,
    reader: {
      readShell: async () => result as never,
      readThread: async () => result as never,
    },
  },
): T3ObservedActivity {
  refreshObservations(application, {
    observations: [],
    sourceUnavailable: [
      {
        explanation: result.error,
        observedAt: date(result.fetchedAt),
        projectId: project.id,
        sourceId: source.sourceId,
        machineId: source.machineId,
      },
    ],
  });
  const observedLastSuccessful = listProjectActivity(
    application,
    project.id,
    source.sourceId,
  )
    .map((item) => item.observation.observedAt.getTime())
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)
    .at(0);
  const connection = failureConnection(result, source);
  const lastSuccessfulFetchAt =
    source.lastSuccessfulFetchAt ??
    (observedLastSuccessful === undefined
      ? undefined
      : new Date(observedLastSuccessful).toISOString());
  if (lastSuccessfulFetchAt !== undefined) {
    connection.lastSuccessfulFetchAt = lastSuccessfulFetchAt;
  }
  return activityView(
    application,
    project,
    connection,
    result.status,
    result.error,
    undefined,
    source,
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
  source: SourceRuntime = {
    sourceId: LEGACY_T3_SOURCE_ID,
    machineId: LEGACY_T3_MACHINE_ID,
    reader: {
      readShell: async () => ({}) as never,
      readThread: async () => ({}) as never,
    },
  },
): T3ObservedActivity {
  refreshObservations(application, {
    observations: [],
    projectUnresolved: [
      {
        explanation: resolution.explanation,
        observedAt: date(fetchedAt),
        projectId: project.id,
        sourceId: source.sourceId,
        machineId: source.machineId,
      },
    ],
  });
  return activityView(
    application,
    project,
    { ...successConnection(fetchedAt, source), error: resolution.explanation },
    resolution.status,
    resolution.explanation,
    undefined,
    source,
  );
}

function shellProjectResolution(
  shell: Extract<T3ShellObservation, { ok: true }>,
  project: FactoryProject,
  factoryProjects: FactoryProject[],
  sourceId = LEGACY_T3_SOURCE_ID,
): T3ProjectResolution {
  const matches = shell.projects
    .map((t3Project) => ({
      resolution: resolveT3Project(t3Project, factoryProjects, sourceId),
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
    .map((t3Project) => resolveT3Project(t3Project, factoryProjects, sourceId))
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
  source: Pick<T3CoordinatorSource, "sourceId" | "machineId"> & {
    lastSuccessfulFetchAt?: string;
  } = {
    sourceId: LEGACY_T3_SOURCE_ID,
    machineId: LEGACY_T3_MACHINE_ID,
  },
): T3ThreadDetailResult {
  const connection = failureConnection(result, source);
  if (source.lastSuccessfulFetchAt !== undefined)
    connection.lastSuccessfulFetchAt = source.lastSuccessfulFetchAt;
  return {
    connection,
    error: result.error,
    status: result.status,
    sourceId: normalizeT3SourceId(source.sourceId),
    machineId: source.machineId,
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
  sourceId = LEGACY_T3_SOURCE_ID,
  machineId = LEGACY_T3_MACHINE_ID,
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
    machineId,
    observedAt: date(detail.fetchedAt),
    provider: "t3",
    sourceId: normalizeT3SourceId(sourceId),
    sourceSequence: detail.sourceSequence,
    sourceStream: detail.sourceStream,
    checkpointFiles: [...checkpointFiles],
    turnIds: [...turnIds],
  };
}

export function createT3Coordinator(input: {
  application: FactoryApplication;
  reader?: T3ActivityReader;
  sources?: T3CoordinatorSource[];
}) {
  const { application } = input;
  const configured: T3CoordinatorSource[] = input.sources?.length
    ? input.sources
    : input.reader
      ? [
          {
            machineId: LEGACY_T3_MACHINE_ID,
            reader: input.reader,
            sourceId: LEGACY_T3_SOURCE_ID,
          },
        ]
      : [];
  if (configured.length === 0)
    throw new Error("T3 coordinator requires a reader or at least one source.");

  const seenSourceIds = new Set<string>();
  const sources: SourceRuntime[] = configured.map((source) => {
    const sourceId = normalizeT3SourceId(source.sourceId);
    const machineId = source.machineId.trim();
    if (!machineId)
      throw new Error(`T3 source ${sourceId} requires a machine ID.`);
    if (seenSourceIds.has(sourceId))
      throw new Error(`T3 source ${sourceId} is configured more than once.`);
    seenSourceIds.add(sourceId);
    return { ...source, machineId, sourceId };
  });
  const projects = () => application.listProjects();
  const sourceById = (sourceId?: string): SourceRuntime | undefined =>
    sourceId === undefined
      ? undefined
      : sources.find(
          (source) => source.sourceId === normalizeT3SourceId(sourceId),
        );
  const sourcesByMachine = (machineId?: string): SourceRuntime[] =>
    machineId === undefined
      ? []
      : sources.filter((source) => source.machineId === machineId.trim());
  const requireProject = (projectId: string): FactoryProject => {
    const project = projects().find((candidate) => candidate.id === projectId);
    if (!project) throw new Error(`Project ${projectId} does not exist.`);
    return project;
  };
  const checkSourceScope = (
    sourceId?: string,
    machineId?: string,
  ): SourceRuntime | undefined => {
    const byId = sourceById(sourceId);
    const machineMatches = sourcesByMachine(machineId);
    if (machineId !== undefined && machineMatches.length === 0)
      throw new Error(`T3 machine ${machineId} is not configured.`);
    if (
      machineId !== undefined &&
      machineMatches.length > 1 &&
      sourceId === undefined
    )
      throw new Error(
        `T3 machine ${machineId} identifies multiple T3 sources; provide sourceId.`,
      );
    const byMachine =
      (byId &&
        machineMatches.find((source) => source.sourceId === byId.sourceId)) ??
      machineMatches[0];
    if (sourceId !== undefined && !byId)
      throw new Error(
        `T3 source ${normalizeT3SourceId(sourceId)} is not configured.`,
      );
    if (byId && byMachine && byId.sourceId !== byMachine.sourceId)
      throw new Error(
        "T3 source and machine ID do not refer to the same source.",
      );
    return byId ?? byMachine;
  };
  const sourceForSingle = (sourceId?: string): SourceRuntime => {
    const scoped = checkSourceScope(sourceId);
    if (scoped) return scoped;
    if (sources.length === 1) {
      const only = sources[0];
      if (!only) throw new Error("T3 coordinator has no sources.");
      return only;
    }
    throw new Error(
      "T3 source scope is required when multiple sources are configured.",
    );
  };

  const makeStatusForSource = async (
    source: SourceRuntime,
    selected?: FactoryProject,
  ): Promise<T3StatusSource> => {
    const shell = await source.reader.readShell();
    if (isT3Failure(shell)) {
      const connection = failureConnection(shell, source);
      const observedLastSuccessful = (selected ? [selected] : projects())
        .flatMap((project) =>
          listProjectActivity(application, project.id, source.sourceId),
        )
        .map((item) => item.observation.observedAt.getTime())
        .filter((value) => Number.isFinite(value))
        .sort((left, right) => right - left)
        .at(0);
      const lastSuccessfulFetchAt =
        source.lastSuccessfulFetchAt ??
        (observedLastSuccessful === undefined
          ? undefined
          : new Date(observedLastSuccessful).toISOString());
      if (lastSuccessfulFetchAt !== undefined)
        connection.lastSuccessfulFetchAt = lastSuccessfulFetchAt;
      return {
        counts: emptyCounts(),
        connection,
        ...(source.label === undefined ? {} : { label: source.label }),
        machineId: source.machineId,
        sourceId: source.sourceId,
        status: shell.status,
        error: shell.error,
      };
    }
    source.lastSuccessfulFetchAt = shell.fetchedAt;
    const factoryProjects = projects();
    const resolutions = shell.projects.map((project) => ({
      project,
      resolution: resolveT3Project(project, factoryProjects, source.sourceId),
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
        const mapped = {
          ...(thread.branch === undefined ? {} : { branch: thread.branch }),
          ...(thread.linkedPullRequestUrl === undefined
            ? {}
            : { linkedPullRequestUrl: thread.linkedPullRequestUrl }),
          ...(thread.latestTurn === undefined
            ? {}
            : { latestTurnState: thread.latestTurn.state }),
          ...(thread.latestTurn?.completedAt === undefined
            ? {}
            : { latestTurnCompletedAt: thread.latestTurn.completedAt }),
          ...(thread.session?.providerName === undefined
            ? {}
            : { agent: thread.session.providerName }),
          ...(sessionState(thread.session) === undefined
            ? {}
            : { latestSessionState: sessionState(thread.session) }),
          ...(thread.worktreePath === undefined
            ? {}
            : { worktreePath: thread.worktreePath }),
          association:
            resolution.status === "ambiguous"
              ? { links: [], state: "ambiguous" as const }
              : { links: [], state: "unmatched" as const },
          externalProjectId: project.id,
          hasPendingApprovals: thread.hasPendingApprovals,
          hasPendingUserInput: thread.hasPendingUserInput,
          observedAt: shell.fetchedAt,
          provider: "t3" as const,
          sourceUpdatedAt: thread.updatedAt,
          sourceId: source.sourceId,
          machineId: source.machineId,
          threadId: thread.id,
          title: thread.title,
        } as T3ObservedThread;
        if (threadIsRunning(mapped)) counts.running += 1;
        if (threadNeedsAttention(mapped)) counts.needsAttention += 1;
        if (resolution.status !== "matched") {
          if (resolution.status === "ambiguous") counts.ambiguous += 1;
          else counts.unmatched += 1;
          continue;
        }
        const currentObservation = mapT3ThreadObservation({
          machineId: source.machineId,
          observedAt: shell.fetchedAt,
          project,
          projectId: resolution.project.id,
          sourceDigest: shell.sourceDigest,
          sourceId: source.sourceId,
          sourceSequence: shell.sourceSequence,
          sourceStream: shell.sourceStream,
          sourceUpdatedAt: thread.updatedAt,
          thread,
        });
        try {
          const existing = getThreadActivity(
            application,
            thread.id,
            source.sourceId,
          ).associations;
          if (existing.length > 0) counts.linked += 1;
          else {
            const match = application.matchT3Observation(currentObservation);
            if (match.status === "ambiguous") counts.ambiguous += 1;
            else if (match.status === "matched") counts.suggested += 1;
            else counts.unmatched += 1;
          }
        } catch {
          const match = application.matchT3Observation(currentObservation);
          if (match.status === "ambiguous") counts.ambiguous += 1;
          else if (match.status === "matched") counts.suggested += 1;
          else counts.unmatched += 1;
        }
      }
    }
    const selectedResolution = selected
      ? shellProjectResolution(
          shell,
          selected,
          factoryProjects,
          source.sourceId,
        )
      : undefined;
    const status =
      selectedResolution && selectedResolution.status !== "matched"
        ? selectedResolution.status
        : "ok";
    return {
      ambiguousProjectCount: resolutions.filter(
        ({ resolution }) => resolution.status === "ambiguous",
      ).length,
      connection: successConnection(shell.fetchedAt, source),
      counts,
      ...(selectedResolution && selectedResolution.status !== "matched"
        ? { error: selectedResolution.explanation }
        : {}),
      ...(source.label === undefined ? {} : { label: source.label }),
      machineId: source.machineId,
      projectCount: shell.projects.length,
      recognizedProjectCount: resolutions.filter(
        ({ resolution }) => resolution.status === "matched",
      ).length,
      sourceId: source.sourceId,
      status,
      threadCount,
      unmatchedProjectCount: resolutions.filter(
        ({ resolution }) => resolution.status === "unmatched",
      ).length,
    };
  };

  const makeActivityForSource = async (
    source: SourceRuntime,
    project: FactoryProject,
  ): Promise<T3ObservedActivity> => {
    const shell = await source.reader.readShell();
    if (isT3Failure(shell))
      return failureStatus(application, project, shell, source);
    source.lastSuccessfulFetchAt = shell.fetchedAt;
    const resolution = shellProjectResolution(
      shell,
      project,
      projects(),
      source.sourceId,
    );
    if (resolution.status !== "matched")
      return unresolvedStatus(
        application,
        project,
        resolution,
        shell.fetchedAt,
        source,
      );
    const t3Project = shell.projects.find((candidate) => {
      const candidateResolution = resolveT3Project(
        candidate,
        projects(),
        source.sourceId,
      );
      return (
        candidateResolution.status === "matched" &&
        candidateResolution.project.id === project.id
      );
    });
    if (!t3Project)
      return unresolvedStatus(
        application,
        project,
        {
          basis: [],
          candidates: [],
          explanation:
            "The selected Factory Project has no matching T3 Project.",
          status: "unmatched",
        },
        shell.fetchedAt,
        source,
      );
    const observations = shell.threads
      .filter((thread) => thread.projectId === t3Project.id)
      .map((thread) =>
        mapT3ThreadObservation({
          machineId: source.machineId,
          observedAt: shell.fetchedAt,
          project: t3Project,
          projectId: project.id,
          sourceDigest: shell.sourceDigest,
          sourceId: source.sourceId,
          sourceSequence: shell.sourceSequence,
          sourceStream: shell.sourceStream,
          sourceUpdatedAt: thread.updatedAt,
          thread,
        }),
      );
    refreshObservations(application, {
      observations,
      refreshedProjects: [
        {
          machineId: source.machineId,
          observedAt: date(shell.fetchedAt),
          projectId: project.id,
          sourceId: source.sourceId,
          sourceSequence: shell.sourceSequence,
          sourceStream: shell.sourceStream,
          sourceUpdatedAt: date(shell.sourceUpdatedAt),
        },
      ],
    });
    return activityView(
      application,
      project,
      successConnection(shell.fetchedAt, source),
      "ok",
      undefined,
      new Set(observations.map((observation) => observation.externalThreadId)),
      source,
    );
  };

  const aggregateActivity = (
    project: FactoryProject,
    perSource: T3ObservedActivity[],
  ): T3ObservedActivity => {
    const sourceViews = perSource.flatMap((activity) => activity.sources ?? []);
    const healthy = perSource.filter((activity) => activity.status === "ok");
    const first = perSource[0];
    if (!first) throw new Error("T3 coordinator has no source activity.");
    const aggregateStatus: T3RouteStatus = healthy.length
      ? "ok"
      : perSource.some((activity) => activity.status === "ambiguous")
        ? "ambiguous"
        : perSource.some((activity) => activity.status === "unmatched")
          ? "unmatched"
          : first.status;
    const counts = emptyCounts();
    const threads = perSource.flatMap((activity) => activity.threads);
    for (const activity of perSource) {
      for (const key of Object.keys(counts) as Array<keyof typeof counts>)
        counts[key] += activity.counts[key];
    }
    const firstConnection = healthy[0]?.connection ?? first.connection;
    const errors = perSource
      .map((activity) => activity.error)
      .filter((error): error is string => error !== undefined);
    return {
      connection: firstConnection,
      counts,
      ...(errors.length ? { error: errors.join("; ") } : {}),
      findings: perSource.flatMap((activity) => activity.findings),
      machineId: sources.length === 1 ? sources[0]!.machineId : "aggregate",
      projectName: project.name,
      sourceId: sources.length === 1 ? sources[0]!.sourceId : "aggregate",
      sources: sourceViews,
      status: aggregateStatus,
      targets:
        perSource.find((activity) => activity.targets.length > 0)?.targets ??
        targetList(application, project.id),
      threads,
    };
  };

  const chooseThreadSource = async (
    threadId: string,
    sourceId?: string,
  ): Promise<
    | {
        source: SourceRuntime;
        shell: Extract<T3ShellObservation, { ok: true }>;
        shellThread: T3ThreadShellObservation;
      }
    | T3ThreadDetailResult
  > => {
    const scoped =
      sourceId === undefined ? undefined : sourceForSingle(sourceId);
    const candidates: Array<{
      source: SourceRuntime;
      shell: Extract<T3ShellObservation, { ok: true }>;
      shellThread: T3ThreadShellObservation;
    }> = [];
    const errors: Array<{
      source: SourceRuntime;
      result: Extract<T3ShellObservation, { ok: false }>;
    }> = [];
    const candidatesSources = sourceId === undefined ? sources : [scoped!];
    await Promise.all(
      candidatesSources.map(async (source) => {
        const shell = await source.reader.readShell();
        if (isT3Failure(shell)) {
          errors.push({ source, result: shell });
          return;
        }
        source.lastSuccessfulFetchAt = shell.fetchedAt;
        for (const shellThread of shell.threads.filter(
          (thread) => thread.id === threadId,
        )) {
          candidates.push({ shell, shellThread, source });
        }
      }),
    );
    if (candidates.length > 1) {
      const first = candidates[0]!;
      const candidateSourceIds = new Set(
        candidates.map((candidate) => candidate.source.sourceId),
      );
      const candidateMachineIds = new Set(
        candidates.map((candidate) => candidate.source.machineId),
      );
      const sourceId =
        candidateSourceIds.size === 1 ? first.source.sourceId : "aggregate";
      const machineId =
        candidateMachineIds.size === 1 ? first.source.machineId : "aggregate";
      return {
        connection: successConnection(first.shell.fetchedAt, first.source),
        error: `T3 thread ${threadId} is present in multiple T3 projects or sources; provide sourceId and project identity.`,
        machineId,
        sourceId,
        status: "ambiguous",
        threadId,
      };
    }
    const candidate = candidates[0];
    if (candidate && sourceId === undefined && errors.length > 0) {
      // A healthy match is insufficient when another unscoped source could
      // still contain the same external ID. Keep automatic linking fail
      // closed until every source has answered or the caller scopes it.
      const failure = errors[0]!;
      return resultFailure(threadId, failure.result, failure.source);
    }
    if (candidate) return candidate;
    if (errors.length) {
      const failure = errors[0]!;
      return resultFailure(threadId, failure.result, failure.source);
    }
    const fallback = scoped ?? sources[0]!;
    return {
      connection: successConnection(new Date().toISOString(), fallback),
      error: `T3 thread ${threadId} was not found in the current shell.`,
      machineId: fallback.machineId,
      sourceId: fallback.sourceId,
      status: "unavailable",
      threadId,
    };
  };

  return {
    async status(
      projectId?: string,
      sourceId?: string,
    ): Promise<T3StatusResult> {
      const selected =
        projectId === undefined ? undefined : requireProject(projectId);
      const scoped =
        sourceId === undefined ? undefined : sourceForSingle(sourceId);
      const results = await Promise.all(
        (scoped ? [scoped] : sources).map((source) =>
          makeStatusForSource(source, selected),
        ),
      );
      const first = results[0]!;
      const healthy = results.filter((result) => result.status === "ok");
      const aggregateStatus: T3RouteStatus = healthy.length
        ? "ok"
        : results.some((result) => result.status === "ambiguous")
          ? "ambiguous"
          : results.some((result) => result.status === "unmatched")
            ? "unmatched"
            : first.status;
      const counts = emptyCounts();
      for (const result of results)
        for (const key of Object.keys(counts) as Array<keyof typeof counts>)
          counts[key] += result.counts[key];
      const sum = (
        key:
          | "projectCount"
          | "threadCount"
          | "recognizedProjectCount"
          | "unmatchedProjectCount"
          | "ambiguousProjectCount",
      ) => {
        const values = results
          .map((result) => result[key])
          .filter((value): value is number => value !== undefined);
        return values.length
          ? values.reduce((total, value) => total + value, 0)
          : undefined;
      };
      return {
        ambiguousProjectCount: sum("ambiguousProjectCount"),
        connection: healthy[0]?.connection ?? first.connection,
        counts,
        ...(results.map((result) => result.error).filter(Boolean).length
          ? {
              error: results
                .map((result) => result.error)
                .filter(Boolean)
                .join("; "),
            }
          : {}),
        machineId: results.length === 1 ? first.machineId : "aggregate",
        projectCount: sum("projectCount"),
        recognizedProjectCount: sum("recognizedProjectCount"),
        sourceId: results.length === 1 ? first.sourceId : "aggregate",
        sources: results,
        status: aggregateStatus,
        threadCount: sum("threadCount"),
        unmatchedProjectCount: sum("unmatchedProjectCount"),
      };
    },

    async projectActivity(
      projectId: string,
      sourceId?: string,
    ): Promise<T3ObservedActivity> {
      const project = requireProject(projectId);
      const scoped =
        sourceId === undefined ? undefined : sourceForSingle(sourceId);
      const perSource = await Promise.all(
        (scoped ? [scoped] : sources).map((source) =>
          makeActivityForSource(source, project),
        ),
      );
      if (scoped) {
        const activity = perSource[0];
        if (!activity) throw new Error("T3 source activity was not returned.");
        return activity;
      }
      return aggregateActivity(project, perSource);
    },

    async threadDetail(
      threadId: string,
      turnLimit: number,
      sourceId?: string,
    ): Promise<T3ThreadDetailResult> {
      const selected = await chooseThreadSource(threadId, sourceId);
      if ("status" in selected) return selected;
      const { shell, shellThread, source } = selected;
      const factoryProjects = projects();
      const t3Project = shell.projects.find(
        (project) => project.id === shellThread.projectId,
      );
      if (!t3Project)
        return {
          connection: successConnection(shell.fetchedAt, source),
          machineId: source.machineId,
          sourceId: source.sourceId,
          error:
            "The T3 thread references a project absent from the current shell.",
          status: "invalid_response",
          threadId,
        };
      const resolution = resolveT3Project(
        t3Project,
        factoryProjects,
        source.sourceId,
      );
      if (resolution.status !== "matched")
        return {
          connection: successConnection(shell.fetchedAt, source),
          machineId: source.machineId,
          sourceId: source.sourceId,
          error: resolution.explanation,
          status: resolution.status,
          threadId,
        };
      const detail = await source.reader.readThread({ threadId, turnLimit });
      if (isT3Failure(detail)) return resultFailure(threadId, detail, source);
      if (
        detail.thread.id !== shellThread.id ||
        detail.thread.projectId !== t3Project.id
      )
        return {
          connection: successConnection(detail.fetchedAt, source),
          machineId: source.machineId,
          sourceId: source.sourceId,
          error:
            "T3 returned a thread that does not match the requested shell entry.",
          status: "invalid_response",
          threadId,
        };
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
        machineId: source.machineId,
        observedAt: detail.fetchedAt,
        project: t3Project,
        projectId: resolution.project.id,
        sourceDigest: detail.sourceDigest,
        sourceId: source.sourceId,
        sourceSequence: detail.sourceSequence,
        sourceStream: detail.sourceStream,
        sourceUpdatedAt: detail.sourceUpdatedAt,
        thread: sanitizedThread,
      });
      refreshObservations(application, {
        observations: [observation],
        evidence: [
          {
            ...detailEvidence(detail),
            machineId: source.machineId,
            sourceId: source.sourceId,
          },
        ],
      });
      const activity = getThreadActivity(
        application,
        threadId,
        source.sourceId,
      );
      return {
        activity,
        connection: successConnection(detail.fetchedAt, source),
        evidence: listEvidence(application, threadId, source.sourceId).at(-1),
        findings: application.listReconciliationFindings(
          resolution.project.id,
          source.sourceId,
        ),
        machineId: source.machineId,
        observation,
        projectId: resolution.project.id,
        projectName: resolution.project.name,
        sourceId: source.sourceId,
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
      sourceId,
    }: {
      projectId: string;
      threadId: string;
      taskId?: string;
      subtaskId?: string;
      sourceId?: string;
    }) {
      const source = sourceForSingle(sourceId);
      const detail = getThreadActivity(application, threadId, source.sourceId);
      if (detail.observation.projectId !== projectId)
        throw new Error(
          "T3 thread does not belong to the selected Factory Project.",
        );
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
      sourceId,
      machineId,
      threadId,
    }: {
      branchName: string;
      projectId: string;
      taskId?: string;
      subtaskId?: string;
      sourceId?: string;
      machineId?: string;
      threadId?: string;
    }): Promise<T3AutoLinkResult> {
      const normalizedBranch = branchName.trim();
      if (!normalizedBranch)
        throw new Error("Automatic T3 association requires a branch name.");
      let scoped: SourceRuntime | undefined;
      try {
        scoped = checkSourceScope(sourceId, machineId);
      } catch (error) {
        // Auto-link is an observation/reporting operation. An unrecognized
        // machine or source must remain a typed no-link result so the remote
        // route does not turn expected scope ambiguity into HTTP 500. An
        // explicit source/machine mismatch still throws and fails closed.
        const sourceExists = sourceId === undefined || sourceById(sourceId);
        const machineMatches = sourcesByMachine(machineId);
        if (!sourceExists) {
          return {
            branchName: normalizedBranch,
            candidateThreadIds: [],
            error:
              error instanceof Error
                ? error.message
                : `T3 source ${normalizeT3SourceId(sourceId)} is not configured.`,
            machineId: machineId?.trim(),
            projectId,
            sourceId: normalizeT3SourceId(sourceId),
            status: "unmatched",
          };
        }
        if (sourceId === undefined && machineMatches.length > 1) {
          return {
            branchName: normalizedBranch,
            candidateThreadIds: [],
            error:
              error instanceof Error
                ? error.message
                : `T3 machine ${machineId} identifies multiple T3 sources; provide sourceId.`,
            machineId: machineId?.trim(),
            projectId,
            status: "ambiguous",
          };
        }
        if (sourceId === undefined && machineMatches.length === 0) {
          return {
            branchName: normalizedBranch,
            candidateThreadIds: [],
            error:
              error instanceof Error
                ? error.message
                : `T3 machine ${machineId} is not configured.`,
            machineId: machineId?.trim(),
            projectId,
            status: "unmatched",
          };
        }
        throw error;
      }
      if (threadId) {
        const detail = await this.threadDetail(
          threadId,
          10,
          scoped?.sourceId ?? sourceId,
        );
        if (detail.status !== "ok")
          return {
            branchName: normalizedBranch,
            candidateThreadIds: [],
            ...(detail.error === undefined ? {} : { error: detail.error }),
            machineId: detail.machineId,
            projectId,
            sourceId: detail.sourceId,
            status: detail.status,
          };
        if (detail.projectId !== projectId)
          throw new Error(
            "T3 thread does not belong to the selected Factory Project.",
          );
        const linked = this.linkThread({
          projectId,
          sourceId: detail.sourceId,
          subtaskId,
          taskId,
          threadId,
        });
        return {
          associationId: linked.association.id,
          branchName: normalizedBranch,
          candidateThreadIds: [threadId],
          machineId: detail.machineId,
          projectId,
          sourceId: detail.sourceId,
          status: "linked",
          threadId,
        };
      }
      const activity = await this.projectActivity(projectId, scoped?.sourceId);
      if (activity.status !== "ok")
        return {
          branchName: normalizedBranch,
          candidateThreadIds: [],
          ...(activity.error === undefined ? {} : { error: activity.error }),
          projectId,
          sourceId: scoped?.sourceId,
          machineId: scoped?.machineId,
          status: activity.status,
        };
      let candidates = activity.threads.filter(
        (candidate) =>
          candidate.branch === normalizedBranch && threadIsRunning(candidate),
      );
      if (scoped)
        candidates = candidates.filter(
          (candidate) =>
            candidate.sourceId === scoped.sourceId &&
            candidate.machineId === scoped.machineId,
        );
      else if (sources.length > 1)
        return {
          branchName: normalizedBranch,
          candidateThreadIds: candidates.map((candidate) => candidate.threadId),
          error:
            "Automatic T3 association requires sourceId or machineId when multiple sources are configured.",
          projectId,
          status: "ambiguous",
        };
      if (candidates.length !== 1)
        return {
          branchName: normalizedBranch,
          candidateThreadIds: candidates.map((candidate) => candidate.threadId),
          projectId,
          status: candidates.length === 0 ? "unmatched" : "ambiguous",
        };
      const candidate = candidates[0]!;
      const linked = this.linkThread({
        projectId,
        sourceId: candidate.sourceId,
        subtaskId,
        taskId,
        threadId: candidate.threadId,
      });
      return {
        associationId: linked.association.id,
        branchName: normalizedBranch,
        candidateThreadIds: [candidate.threadId],
        machineId: candidate.machineId,
        projectId,
        sourceId: candidate.sourceId,
        status: "linked",
        threadId: candidate.threadId,
      };
    },

    unlinkThread(threadId: string, associationId?: string, sourceId?: string) {
      const source = sourceForSingle(sourceId);
      return application.unlinkT3Thread({
        ...(associationId === undefined ? {} : { associationId }),
        externalThreadId: threadId,
        sourceId: source.sourceId,
      });
    },
  };
}
