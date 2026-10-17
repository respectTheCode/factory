import type { FactoryApplication } from "./application";
import { resolveT3Project } from "./t3-coordinator";
import { T3_SOURCE_HAS_TOKEN, type T3Source } from "./t3-sources";

type ProjectDiscoveryApplication = Pick<
  FactoryApplication,
  "createProject" | "listProjects" | "updateProject"
>;

type SourceProvider = readonly T3Source[] | (() => readonly T3Source[]);

export type DiscoverRecentT3ProjectsInput = {
  application: ProjectDiscoveryApplication;
  sources: SourceProvider;
  notBeforeISO: string;
  signal?: AbortSignal;
  isStopped?: () => boolean;
};

/**
 * Add Factory Projects for T3 Projects with recent, unarchived shell activity.
 * Historical T3 projects without a recent thread are deliberately ignored.
 */
export async function discoverRecentT3Projects({
  application,
  sources: sourceProvider,
  notBeforeISO,
  signal,
  isStopped,
}: DiscoverRecentT3ProjectsInput): Promise<string[]> {
  const cutoff = Date.parse(notBeforeISO);
  if (!Number.isFinite(cutoff) || isStoppedNow(signal, isStopped)) return [];

  let sources: readonly T3Source[];
  try {
    sources =
      typeof sourceProvider === "function" ? sourceProvider() : sourceProvider;
  } catch {
    return [];
  }

  const createdProjectIds: string[] = [];
  const createdProjectIdSet = new Set<string>();

  for (const source of sources) {
    if (isStoppedNow(signal, isStopped)) break;
    if (source[T3_SOURCE_HAS_TOKEN] === false) continue;

    let shell;
    try {
      shell = await source.reader.readShell();
    } catch {
      continue;
    }

    if (isStoppedNow(signal, isStopped) || !shell.ok) continue;
    if (
      typeof sourceProvider === "function" &&
      !isCurrentSource(source, sourceProvider)
    ) {
      continue;
    }

    const recentProjectIds = new Set(
      shell.threads
        .filter(
          (thread) =>
            !thread.archivedAt &&
            Number.isFinite(Date.parse(thread.updatedAt)) &&
            Date.parse(thread.updatedAt) >= cutoff,
        )
        .map((thread) => thread.projectId),
    );

    for (const t3Project of shell.projects) {
      if (isStoppedNow(signal, isStopped)) break;
      if (!recentProjectIds.has(t3Project.id)) continue;

      const factoryProjects = application.listProjects();
      const resolution = resolveT3Project(
        t3Project,
        factoryProjects,
        source.sourceId,
      );
      if (resolution.status === "matched") {
        if (
          resolution.basis.includes("repositoryIdentity") &&
          !resolution.basis.includes("t3ProjectId") &&
          !resolution.basis.includes("workspaceRoot") &&
          !resolution.project.t3Mappings?.some(
            (mapping) => mapping.sourceId === source.sourceId,
          )
        ) {
          application.updateProject({
            gitOriginUrl: resolution.project.gitOriginUrl ?? null,
            projectId: resolution.project.id,
            t3Mappings: [
              ...(resolution.project.t3Mappings ?? []),
              {
                sourceId: source.sourceId,
                t3ProjectId: t3Project.id,
                workspaceRoot: t3Project.workspaceRoot,
              },
            ],
          });
        }
        continue;
      }
      if (resolution.status === "ambiguous") continue;
      // Repository metadata can temporarily disappear from a T3 shell. A
      // matching checkout/repository name is a reason to wait for identity,
      // never a sufficient basis to attach work or create a duplicate Project.
      if (!t3Project.repositoryIdentity) {
        if (shouldDeferCreationWithoutRepository(t3Project, factoryProjects))
          continue;
      }

      // The connection may have been replaced while its shell read was in
      // flight. Do not use data from that former source to create a Project.
      if (
        typeof sourceProvider === "function" &&
        !isCurrentSource(source, sourceProvider)
      ) {
        break;
      }
      if (isStoppedNow(signal, isStopped)) break;

      const project = application.createProject({
        name: t3Project.title,
        t3Mappings: [
          {
            sourceId: source.sourceId,
            t3ProjectId: t3Project.id,
            workspaceRoot: t3Project.workspaceRoot,
          },
        ],
        ...(t3Project.repositoryIdentity?.remoteUrl
          ? { gitOriginUrl: t3Project.repositoryIdentity.remoteUrl }
          : {}),
        ...(source.sourceId === "legacy" ? { t3ProjectId: t3Project.id } : {}),
        workspaceRoot: t3Project.workspaceRoot,
      });

      if (!createdProjectIdSet.has(project.id)) {
        createdProjectIdSet.add(project.id);
        createdProjectIds.push(project.id);
      }
    }
  }

  return createdProjectIds;
}

function isCurrentSource(
  expected: T3Source,
  provider: () => readonly T3Source[],
): boolean {
  try {
    return provider().some((current) => sameSourceIdentity(expected, current));
  } catch {
    return false;
  }
}

function sameSourceIdentity(left: T3Source, right: T3Source): boolean {
  return (
    left.sourceId === right.sourceId &&
    left.machineId === right.machineId &&
    left.baseUrl === right.baseUrl &&
    left.accessTokenFile === right.accessTokenFile &&
    left.reader === right.reader
  );
}

function isStoppedNow(
  signal?: AbortSignal,
  isStopped?: () => boolean,
): boolean {
  if (signal?.aborted) return true;
  try {
    return isStopped?.() === true;
  } catch {
    return true;
  }
}

function identityBasename(value: string): string {
  return (
    value
      .split(/[\\/:]/)
      .filter(Boolean)
      .at(-1) ?? ""
  )
    .replace(/\.git$/i, "")
    .trim()
    .toLowerCase();
}

function normalizeProjectName(value: string): string {
  return value.trim().toLowerCase();
}

function shouldDeferCreationWithoutRepository(
  t3Project: { title: string; workspaceRoot: string },
  factoryProjects: ReturnType<FactoryApplication["listProjects"]>,
): boolean {
  const observedName = normalizeProjectName(t3Project.title);
  const workspaceSegments = new Set(
    t3Project.workspaceRoot
      .split(/[\\/:]/)
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean),
  );
  return factoryProjects.some((project) => {
    if (normalizeProjectName(project.name) === observedName) return true;
    const knownRepositoryName = project.gitOriginUrl
      ? identityBasename(project.gitOriginUrl)
      : "";
    return (
      knownRepositoryName !== "" && workspaceSegments.has(knownRepositoryName)
    );
  });
}
