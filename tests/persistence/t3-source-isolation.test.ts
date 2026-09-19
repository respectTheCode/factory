import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { describe, expect, test } from "bun:test";

import {
  createFactoryApplication,
  FactoryApplication,
  type CodeSessionObservationInput,
} from "../../src/application";

const observedAt = new Date("2026-09-18T12:00:00.000Z");

function observation(
  projectId: string,
  sourceId: string,
  overrides: Partial<CodeSessionObservationInput> = {},
): CodeSessionObservationInput {
  return {
    branch: "feature/shared",
    externalProjectId: "t3-project",
    externalThreadId: "thread-duplicate",
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    latestSessionState: "ready",
    latestTurnState: "completed",
    observedAt,
    projectId,
    provider: "t3",
    repositoryIdentity: "github.com/app-press/factory",
    sourceDigest: `${sourceId}-digest-1`,
    sourceId,
    sourceSequence: 1,
    sourceStream: "shell",
    sourceUpdatedAt: observedAt,
    title: `Thread from ${sourceId}`,
    workspaceRoot: `/work/${sourceId}`,
    ...overrides,
  };
}

function inMemoryApplication(): FactoryApplication {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => observedAt,
    idGenerator: () => `id-${++nextId}`,
  });
}

describe("T3 source identity isolation", () => {
  test("keeps duplicate external thread IDs independent across sources", () => {
    const app = inMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app-press/factory.git",
      name: "Factory",
    });
    app.createTask({
      branchName: "feature/shared",
      name: "Shared branch task",
      projectId: project.id,
    });
    const first = observation(project.id, "mac-mini");
    const second = observation(project.id, "linux-agent", {
      workspaceRoot: "/srv/factory",
      sourceDigest: "linux-agent-digest-1",
    });

    app.refreshT3Observations({ observations: [first, second] });

    expect(app.listProjectT3Activity(project.id)).toHaveLength(2);
    expect(
      app.getT3ThreadDetail("thread-duplicate", "mac-mini").observation,
    ).toMatchObject({
      sourceId: "mac-mini",
      workspaceRoot: "/work/mac-mini",
    });
    expect(
      app.getT3ThreadDetail("thread-duplicate", "linux-agent").observation,
    ).toMatchObject({
      sourceId: "linux-agent",
      workspaceRoot: "/srv/factory",
    });
    expect(app.matchT3Observation(second)).toMatchObject({
      basis: "repository_branch",
      status: "matched",
    });
  });

  test("validates source mappings and permits portable Git matching across roots", () => {
    const app = inMemoryApplication();
    expect(() =>
      app.createProject({
        name: "Duplicate mappings",
        t3Mappings: [
          { sourceId: "linux-agent", t3ProjectId: "one" },
          { sourceId: "linux-agent", t3ProjectId: "two" },
        ],
      }),
    ).toThrow("duplicated");
    expect(() =>
      app.createProject({
        name: "Relative mapping",
        t3Mappings: [{ sourceId: "linux-agent", workspaceRoot: "relative" }],
      }),
    ).toThrow("absolute");

    const local = app.createProject({
      name: "No remote",
      t3Mappings: [{ sourceId: "linux-agent", t3ProjectId: "local-t3" }],
    });
    const localObservation = observation(local.id, "linux-agent", {
      externalProjectId: "local-t3",
      repositoryIdentity: undefined,
    });
    expect(() =>
      app.refreshT3Observations({ observations: [localObservation] }),
    ).not.toThrow();

    const mappedLegacy = app.createProject({
      gitOriginUrl: "git@github.com:app-press/mapped.git",
      name: "Mapped legacy source",
      t3ProjectId: "legacy-global",
      t3Mappings: [
        {
          sourceId: "legacy",
          t3ProjectId: "legacy-mapped",
          workspaceRoot: "/explicit/legacy",
        },
      ],
      workspaceRoot: "/old/legacy",
    });
    expect(() =>
      app.refreshT3Observations({
        observations: [
          observation(mappedLegacy.id, "legacy", {
            externalProjectId: "legacy-mapped",
            externalThreadId: "mapped-legacy-thread",
            repositoryIdentity: "github.com/app-press/mapped",
            workspaceRoot: "/explicit/legacy",
          }),
        ],
      }),
    ).not.toThrow();

    const portableLegacy = app.createProject({
      gitOriginUrl: "git@github.com:app-press/portable.git",
      name: "Portable legacy source",
      t3ProjectId: "portable-legacy",
      workspaceRoot: "/old/portable",
    });
    expect(() =>
      app.refreshT3Observations({
        observations: [
          observation(portableLegacy.id, "legacy", {
            externalProjectId: "portable-legacy",
            externalThreadId: "portable-legacy-thread",
            repositoryIdentity: "github.com/app-press/portable.git",
            workspaceRoot: "/new/portable",
          }),
        ],
      }),
    ).not.toThrow();
  });

  test("scopes sequence ordering and evidence deduplication to a source", () => {
    const app = inMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app-press/factory.git",
      name: "Factory",
    });
    const mac = observation(project.id, "mac-mini");
    const linux = observation(project.id, "linux-agent");
    app.refreshT3Observations({ observations: [mac, linux] });

    app.refreshT3Observations({
      observations: [
        {
          ...mac,
          latestTurnState: "running",
          sourceDigest: "mac-mini-digest-2",
          sourceSequence: 2,
        },
        {
          ...linux,
          latestTurnState: "error",
          sourceDigest: "linux-agent-digest-2",
          sourceSequence: 2,
        },
      ],
    });
    const evidence = {
      checkpointFiles: ["src/application.ts"],
      digest: "same-digest",
      externalThreadId: "thread-duplicate",
      observedAt,
      provider: "t3" as const,
      sourceSequence: 2,
      turnIds: ["turn-2"],
    };
    app.recordSessionEvidence({ ...evidence, sourceId: "mac-mini" });
    app.recordSessionEvidence({ ...evidence, sourceId: "linux-agent" });
    app.recordSessionEvidence({ ...evidence, sourceId: "mac-mini" });

    expect(
      app.getT3ThreadDetail("thread-duplicate", "mac-mini").observation,
    ).toMatchObject({
      latestTurnState: "running",
      sourceSequence: 2,
    });
    expect(
      app.getT3ThreadDetail("thread-duplicate", "linux-agent").observation,
    ).toMatchObject({
      latestTurnState: "error",
      sourceSequence: 2,
    });
    expect(
      app.listSessionEvidence("thread-duplicate", "mac-mini"),
    ).toHaveLength(1);
    expect(
      app.listSessionEvidence("thread-duplicate", "linux-agent"),
    ).toHaveLength(1);
  });

  test("ages only the source covered by a refresh boundary", () => {
    const app = inMemoryApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app-press/factory.git",
      name: "Factory",
    });
    const mac = observation(project.id, "mac-mini");
    const linux = observation(project.id, "linux-agent");
    app.refreshT3Observations({ observations: [mac, linux] });

    app.refreshT3Observations({
      observations: [],
      refreshedProjects: [
        {
          observedAt,
          projectId: project.id,
          sourceId: "mac-mini",
          sourceSequence: 2,
          sourceStream: "shell",
          sourceUpdatedAt: observedAt,
        },
      ],
      sourceUnavailable: [
        {
          explanation: "mac-mini unavailable",
          projectId: project.id,
          sourceId: "mac-mini",
          observedAt,
        },
      ],
    });

    expect(app.listProjectT3Activity(project.id, "mac-mini")).toEqual([]);
    expect(app.listProjectT3Activity(project.id, "linux-agent")).toHaveLength(
      1,
    );
    expect(app.listReconciliationFindings(project.id, "mac-mini")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "source_unavailable",
          sourceId: "mac-mini",
          status: "open",
        }),
      ]),
    );
  });

  test("keeps legacy run and association IDs when old snapshots are reopened", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "factory-t3-source-migration-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({ name: "Factory" });
      const task = first.createTask({ name: "Task", projectId: project.id });
      const input = observation(project.id, "legacy", {
        sourceId: undefined,
        externalThreadId: "legacy-thread",
      });
      const linked = first.linkT3Thread({
        observation: input,
        taskId: task.id,
      });
      first.close();

      const database = new Database(databasePath);
      const row = database
        .query("SELECT state FROM factory_state WHERE id = 1")
        .get() as {
        state: string;
      };
      const state = JSON.parse(row.state) as Record<string, unknown>;
      for (const field of [
        "codeSessions",
        "codeSessionObservations",
        "reconciliationFindings",
      ]) {
        for (const item of (state[field] as Array<Record<string, unknown>>) ??
          []) {
          delete item.sourceId;
        }
      }
      database
        .query("UPDATE factory_state SET state = $state WHERE id = 1")
        .run({ $state: JSON.stringify(state) });
      database.close();

      const reopened = createFactoryApplication({ databasePath });
      const detail = reopened.getT3ThreadDetail("legacy-thread");
      expect(detail).toMatchObject({
        codeSession: { id: linked.codeSession.id, runId: linked.run.id },
        observation: { sourceId: "legacy" },
        run: { id: linked.run.id },
      });
      expect(detail.associations).toEqual([
        expect.objectContaining({ id: linked.association.id, taskId: task.id }),
      ]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("migrates old finding keys once even when the legacy project ID is ambiguous", () => {
    let persisted: any;
    let nextId = 0;
    const first = new FactoryApplication({
      clock: () => observedAt,
      idGenerator: () => (++nextId === 1 ? "legacy" : `id-${nextId}`),
      persist: (state) => {
        persisted = state;
      },
      refreshBeforeOperations: false,
    });
    first.createProject({ name: "Legacy" });
    first.refreshT3Observations({
      observations: [],
      sourceUnavailable: [
        {
          explanation: "offline",
          observedAt,
          projectId: "legacy",
        },
      ],
    });
    const findingId = persisted.reconciliationFindings[0].id;
    persisted.reconciliationFindings[0].dedupeKey = "source_unavailable:legacy";
    delete persisted.reconciliationFindings[0].sourceId;

    const reopened = new FactoryApplication({
      clock: () => observedAt,
      idGenerator: () => `reopened-${++nextId}`,
      refreshBeforeOperations: false,
      state: persisted,
    });
    expect(reopened.listReconciliationFindings("legacy")).toEqual([
      expect.objectContaining({
        dedupeKey: "source_unavailable:legacy:legacy",
        id: findingId,
        sourceId: "legacy",
      }),
    ]);
    reopened.reconcileT3Project({
      projectId: "legacy",
      sourceUnavailable: [
        { explanation: "offline", observedAt, projectId: "legacy" },
      ],
    });
    expect(reopened.listReconciliationFindings("legacy")).toEqual([
      expect.objectContaining({ id: findingId }),
    ]);
  });

  test("preserves a migrated finding ID across a real snapshot reopen", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "factory-t3-finding-migration-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    try {
      const first = createFactoryApplication({ databasePath });
      const project = first.createProject({ name: "Factory" });
      const unavailableAt = new Date();
      first.refreshT3Observations({
        observations: [],
        sourceUnavailable: [
          {
            explanation: "source offline",
            observedAt: unavailableAt,
            projectId: project.id,
          },
        ],
      });
      const finding = first.listReconciliationFindings(project.id)[0];
      if (!finding) throw new Error("Expected a source unavailable finding.");
      first.close();

      const database = new Database(databasePath);
      const row = database
        .query("SELECT state FROM factory_state WHERE id = 1")
        .get() as { state: string };
      const state = JSON.parse(row.state) as {
        reconciliationFindings: Array<{
          dedupeKey: string;
          id: string;
          sourceId?: string;
        }>;
      };
      const persistedFinding = state.reconciliationFindings.find(
        (candidate) => candidate.id === finding.id,
      );
      if (!persistedFinding) throw new Error("Finding was not persisted.");
      persistedFinding.dedupeKey = `source_unavailable:${project.id}`;
      delete persistedFinding.sourceId;
      database
        .query("UPDATE factory_state SET state = $state WHERE id = 1")
        .run({ $state: JSON.stringify(state) });
      database.close();

      const reopened = createFactoryApplication({ databasePath });
      expect(reopened.listReconciliationFindings(project.id)).toEqual([
        expect.objectContaining({
          dedupeKey: `source_unavailable:legacy:${project.id}`,
          id: finding.id,
          sourceId: "legacy",
        }),
      ]);
      reopened.reconcileT3Project({
        projectId: project.id,
        sourceUnavailable: [
          {
            explanation: "source offline",
            observedAt: unavailableAt,
            projectId: project.id,
          },
        ],
      });
      expect(reopened.listReconciliationFindings(project.id)).toEqual([
        expect.objectContaining({ id: finding.id }),
      ]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("normalizes legacy status report session references on hydrate", () => {
    let persisted: any;
    let nextId = 0;
    const first = new FactoryApplication({
      clock: () => observedAt,
      idGenerator: () => `id-${++nextId}`,
      persist: (state) => {
        persisted = state;
      },
      refreshBeforeOperations: false,
    });
    const project = first.createProject({ name: "Legacy report refs" });
    const task = first.createTask({ name: "Task", projectId: project.id });
    const subtask = first.createSubtask({ name: "Subtask", taskId: task.id });
    const report = first.reportSubtaskStatus({
      reporter: "codex",
      reportedState: "in_progress",
      sessionRef: { provider: "t3", externalThreadId: "legacy-thread" },
      subtaskId: subtask.id,
    });
    delete persisted.statusReports.find(
      (candidate: { id: string }) => candidate.id === report.id,
    ).sessionRef.sourceId;

    const reopened = new FactoryApplication({
      clock: () => observedAt,
      idGenerator: () => `reopened-${++nextId}`,
      refreshBeforeOperations: false,
      state: persisted,
    });
    expect(reopened.getSubtaskReportHistory(subtask.id)).toEqual([
      expect.objectContaining({
        id: report.id,
        sessionRef: {
          externalThreadId: "legacy-thread",
          provider: "t3",
          sourceId: "legacy",
        },
      }),
    ]);

    const reopenedAgain = new FactoryApplication({
      clock: () => observedAt,
      idGenerator: () => `again-${++nextId}`,
      refreshBeforeOperations: false,
      state: persisted,
    });
    expect(reopenedAgain.getSubtaskReportHistory(subtask.id)[0]).toEqual(
      expect.objectContaining({
        id: report.id,
        sessionRef: expect.objectContaining({ sourceId: "legacy" }),
      }),
    );
  });
});
