import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";
import { discoverRecentT3Projects } from "../../src/issue-project-discovery";
import { T3_SOURCE_HAS_TOKEN, type T3Source } from "../../src/t3-sources";
import type {
  T3ProjectObservation,
  T3ShellObservation,
  T3ThreadShellObservation,
} from "../../src/t3";

const cutoff = "2026-10-14T00:00:00.000Z";
const recent = "2026-10-16T12:00:00.000Z";

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => new Date(recent),
    idGenerator: () => `factory-${++nextId}`,
  });
}

function observedProject(
  overrides: Partial<T3ProjectObservation> = {},
): T3ProjectObservation {
  return {
    createdAt: recent,
    id: "t3-project-1",
    repositoryIdentity: {
      canonicalKey: "github.com/example/app",
      remoteUrl: "git@github.com:example/app.git",
    },
    title: "Example app",
    updatedAt: recent,
    workspaceRoot: "/work/example-app",
    ...overrides,
  };
}

function observedThread(
  overrides: Partial<T3ThreadShellObservation> = {},
): T3ThreadShellObservation {
  return {
    createdAt: recent,
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    id: "thread-1",
    projectId: "t3-project-1",
    title: "Recent work",
    updatedAt: recent,
    ...overrides,
  };
}

function successfulShell(
  projects = [observedProject()],
  threads = [observedThread()],
): T3ShellObservation {
  return {
    fetchedAt: recent,
    ok: true,
    projects,
    sourceDigest: "digest",
    sourceSequence: 1,
    sourceStream: "shell",
    sourceUpdatedAt: recent,
    status: "ok",
    threads,
  };
}

function makeSource(
  sourceId: string,
  readShell: T3Source["reader"]["readShell"],
  options: { hasToken?: boolean; baseUrl?: string } = {},
): T3Source {
  const source = {
    accessTokenFile: `/private/${sourceId}.token`,
    baseUrl: options.baseUrl ?? `https://${sourceId}.example.test`,
    machineId: `machine-${sourceId}`,
    reader: {
      readShell,
      readThread: async () => {
        throw new Error("Not used by project discovery.");
      },
    },
    sourceId,
  } as T3Source;
  if (options.hasToken !== undefined) {
    Object.defineProperty(source, T3_SOURCE_HAS_TOKEN, {
      value: options.hasToken,
    });
  }
  return source;
}

describe("recent T3 project discovery", () => {
  test("waits for missing repository identity rather than duplicating a known checkout", async () => {
    const application = createApplication();
    application.createProject({
      name: "Existing app",
      gitOriginUrl: "git@github.com:example/app.git",
    });
    let project = observedProject({
      repositoryIdentity: undefined,
      workspaceRoot: "/work/app",
    });
    const source = makeSource("agent-m4", async () =>
      successfulShell([project]),
    );
    expect(
      await discoverRecentT3Projects({
        application,
        sources: [source],
        notBeforeISO: cutoff,
      }),
    ).toEqual([]);
    project = observedProject({ workspaceRoot: "/work/app" });
    expect(
      await discoverRecentT3Projects({
        application,
        sources: [source],
        notBeforeISO: cutoff,
      }),
    ).toEqual([]);
    expect(application.listProjects()).toHaveLength(1);
  });

  test("reuses a project matched by repository identity", async () => {
    const application = createApplication();
    const existing = application.createProject({
      gitOriginUrl: "https://github.com/example/app.git",
      name: "Existing Example app",
    });
    const source = makeSource("agent-m4", async () => successfulShell());

    const created = await discoverRecentT3Projects({
      application,
      notBeforeISO: cutoff,
      sources: [source],
    });

    expect(created).toEqual([]);
    expect(application.listProjects()).toHaveLength(1);
    expect(application.listProjects()[0]?.id).toBe(existing.id);
  });

  test("skips an ambiguous project instead of creating a duplicate", async () => {
    const application = createApplication();
    for (const name of ["First candidate", "Second candidate"]) {
      application.createProject({
        name,
        t3Mappings: [
          {
            sourceId: "agent-m4",
            t3ProjectId: "t3-project-1",
            workspaceRoot: "/work/example-app",
          },
        ],
      });
    }
    const source = makeSource("agent-m4", async () => successfulShell());

    const created = await discoverRecentT3Projects({
      application,
      notBeforeISO: cutoff,
      sources: [source],
    });

    expect(created).toEqual([]);
    expect(application.listProjects()).toHaveLength(2);
  });

  test("creates once across sources that observe the same repository", async () => {
    const application = createApplication();
    const project = observedProject();
    const sourceA = makeSource("agent-m4", async () =>
      successfulShell([project]),
    );
    const sourceB = makeSource("agent-m5", async () =>
      successfulShell(
        [
          observedProject({
            id: "t3-project-m5",
            title: "Different T3 title",
            workspaceRoot: "/work/m5/example-app",
          }),
        ],
        [observedThread({ projectId: "t3-project-m5" })],
      ),
    );

    const created = await discoverRecentT3Projects({
      application,
      notBeforeISO: cutoff,
      sources: [sourceA, sourceB],
    });

    expect(created).toHaveLength(1);
    expect(application.listProjects()).toMatchObject([
      {
        gitOriginUrl: "git@github.com:example/app.git",
        id: created[0],
        name: "Example app",
        t3Mappings: [
          {
            sourceId: "agent-m4",
            t3ProjectId: "t3-project-1",
            workspaceRoot: "/work/example-app",
          },
        ],
      },
    ]);
  });

  test("imports only projects with recent unarchived shell threads", async () => {
    const application = createApplication();
    const source = makeSource("agent-m4", async () =>
      successfulShell(
        [
          observedProject(),
          observedProject({
            id: "old-project",
            title: "Old project",
            workspaceRoot: "/work/old-project",
          }),
          observedProject({
            id: "archived-project",
            title: "Archived project",
            workspaceRoot: "/work/archived-project",
          }),
        ],
        [
          observedThread(),
          observedThread({
            id: "old-thread",
            projectId: "old-project",
            updatedAt: "2026-10-13T23:59:59.999Z",
          }),
          observedThread({
            archivedAt: recent,
            id: "archived-thread",
            projectId: "archived-project",
          }),
        ],
      ),
    );

    const created = await discoverRecentT3Projects({
      application,
      notBeforeISO: cutoff,
      sources: [source],
    });

    expect(created).toHaveLength(1);
    expect(application.listProjects().map(({ name }) => name)).toEqual([
      "Example app",
    ]);
  });

  test("skips unavailable and uncredentialed sources", async () => {
    const application = createApplication();
    let uncredentialedReads = 0;
    const noToken = makeSource(
      "no-token",
      async () => {
        uncredentialedReads += 1;
        return successfulShell();
      },
      { hasToken: false },
    );
    const unavailable = makeSource("offline", async () => ({
      error: "offline",
      fetchedAt: recent,
      ok: false,
      status: "unreachable",
    }));

    const created = await discoverRecentT3Projects({
      application,
      notBeforeISO: cutoff,
      sources: [noToken, unavailable],
    });

    expect(created).toEqual([]);
    expect(uncredentialedReads).toBe(0);
    expect(application.listProjects()).toEqual([]);
  });

  test("ignores a source replaced while its shell read is in flight", async () => {
    const application = createApplication();
    let finishRead: ((value: T3ShellObservation) => void) | undefined;
    let markReadStarted: (() => void) | undefined;
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const pendingSource = makeSource(
      "agent-m4",
      () =>
        new Promise<T3ShellObservation>((resolve) => {
          finishRead = resolve;
          markReadStarted?.();
        }),
    );
    const replacement = makeSource("agent-m4", async () => successfulShell(), {
      baseUrl: "https://replacement.example.test",
    });
    let currentSources: readonly T3Source[] = [pendingSource];

    const discovery = discoverRecentT3Projects({
      application,
      notBeforeISO: cutoff,
      sources: () => currentSources,
    });
    await readStarted;
    currentSources = [replacement];
    finishRead?.(successfulShell());

    expect(await discovery).toEqual([]);
    expect(application.listProjects()).toEqual([]);
  });
});
