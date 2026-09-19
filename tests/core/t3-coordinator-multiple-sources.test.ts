import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";
import {
  createT3Coordinator,
  resolveT3Project,
} from "../../src/t3-coordinator";
import type { T3ShellObservation, T3ThreadObservation } from "../../src/t3";

const observedAt = "2026-09-18T12:00:00.000Z";

function createApplication() {
  let nextId = 0;
  return new FactoryApplication({
    clock: () => new Date(observedAt),
    idGenerator: () => `id-${++nextId}`,
  });
}

function reader({
  sourceId,
  threadId,
  sequence = 1,
  fail = false,
}: {
  sourceId: string;
  threadId: string;
  sequence?: number;
  fail?: boolean;
}) {
  const projectId = `t3-project-${sourceId}`;
  const thread = {
    id: threadId,
    projectId,
    title: `Thread ${sourceId}`,
    branch: "feature/watchtower",
    createdAt: observedAt,
    updatedAt: observedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    session: { status: "running" as const, updatedAt: observedAt },
  };
  return {
    async readShell(): Promise<T3ShellObservation> {
      if (fail) {
        return {
          error: `Source ${sourceId} is offline.`,
          fetchedAt: observedAt,
          ok: false,
          status: "unreachable",
        };
      }
      return {
        fetchedAt: observedAt,
        ok: true,
        projects: [
          {
            createdAt: observedAt,
            id: projectId,
            repositoryIdentity: { canonicalKey: "github.com/app/watchtower" },
            title: "Watchtower",
            updatedAt: observedAt,
            workspaceRoot: `/work/${sourceId}`,
          },
        ],
        sourceDigest: `${sourceId}-${sequence}`,
        sourceSequence: sequence,
        sourceStream: "shell",
        sourceUpdatedAt: observedAt,
        status: "ok",
        threads: [thread],
      };
    },
    async readThread({
      threadId: requested,
    }: {
      threadId: string;
      turnLimit: number;
    }): Promise<T3ThreadObservation> {
      return {
        fetchedAt: observedAt,
        ok: true,
        sourceDigest: `${sourceId}-detail`,
        sourceSequence: sequence,
        sourceStream: `thread:${requested}`,
        sourceUpdatedAt: observedAt,
        status: "ok",
        thread: {
          ...thread,
          id: requested,
          activities: [],
          checkpoints: [],
          messages: [],
        },
      };
    },
  };
}

describe("T3 coordinator multiple sources", () => {
  test("keeps duplicate thread IDs source-scoped and requires scope for branch auto-link", async () => {
    const app = createApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app/watchtower.git",
      name: "Watchtower",
    });
    const task = app.createTask({
      branchName: "feature/watchtower",
      name: "Build Watchtower",
      projectId: project.id,
    });
    const coordinator = createT3Coordinator({
      application: app,
      sources: [
        {
          machineId: "mac",
          reader: reader({ sourceId: "mac", threadId: "same" }),
          sourceId: "mac",
        },
        {
          machineId: "linux",
          reader: reader({ sourceId: "linux", threadId: "same" }),
          sourceId: "linux",
        },
      ],
    });

    const activity = await coordinator.projectActivity(project.id);
    expect(
      activity.threads.map((thread) => [thread.threadId, thread.sourceId]),
    ).toEqual([
      ["same", "mac"],
      ["same", "linux"],
    ]);
    expect(activity.sources?.map((source) => source.sourceId)).toEqual([
      "mac",
      "linux",
    ]);
    expect((await coordinator.threadDetail("same", 3)).status).toBe(
      "ambiguous",
    );
    expect(await coordinator.threadDetail("same", 3, "linux")).toMatchObject({
      sourceId: "linux",
      status: "ok",
    });
    expect(
      (
        await coordinator.autoLinkThread({
          branchName: "feature/watchtower",
          projectId: project.id,
          taskId: task.id,
        })
      ).status,
    ).toBe("ambiguous");

    const linked = await coordinator.autoLinkThread({
      branchName: "feature/watchtower",
      machineId: "mac",
      projectId: project.id,
      sourceId: "mac",
      taskId: task.id,
    });
    expect(linked).toMatchObject({
      sourceId: "mac",
      status: "linked",
      threadId: "same",
    });
    expect(app.getT3ThreadDetail("same", "mac").associations).toHaveLength(1);
    expect(app.getT3ThreadDetail("same", "linux").associations).toHaveLength(0);
  });

  test("returns healthy source observations while preserving a failed source last success", async () => {
    const app = createApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app/watchtower.git",
      name: "Watchtower",
    });
    const coordinator = createT3Coordinator({
      application: app,
      sources: [
        {
          machineId: "mac",
          reader: reader({ sourceId: "mac", threadId: "mac-thread" }),
          sourceId: "mac",
        },
        {
          machineId: "linux",
          reader: reader({ sourceId: "linux", threadId: "linux-thread" }),
          sourceId: "linux",
        },
      ],
    });
    await coordinator.projectActivity(project.id);

    const failing = createT3Coordinator({
      application: app,
      sources: [
        {
          machineId: "mac",
          reader: reader({
            fail: true,
            sourceId: "mac",
            threadId: "mac-thread",
          }),
          sourceId: "mac",
        },
        {
          machineId: "linux",
          reader: reader({
            sequence: 2,
            sourceId: "linux",
            threadId: "linux-thread",
          }),
          sourceId: "linux",
        },
      ],
    });
    const activity = await failing.projectActivity(project.id);
    expect(activity.status).toBe("ok");
    expect(activity.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceId: "mac", status: "unreachable" }),
        expect.objectContaining({ sourceId: "linux", status: "ok" }),
      ]),
    );
    expect(
      activity.sources?.find((source) => source.sourceId === "mac")?.connection
        .lastSuccessfulFetchAt,
    ).toBe(observedAt);
    expect((await failing.projectActivity(project.id, "mac")).status).toBe(
      "unreachable",
    );
    expect((await failing.status(project.id, "mac")).status).toBe(
      "unreachable",
    );
    await expect(
      failing.autoLinkThread({
        branchName: "feature/watchtower",
        projectId: project.id,
        threadId: "linux-thread",
      }),
    ).resolves.toMatchObject({ status: "unreachable" });
  });

  test("returns an ambiguous result when a machine maps to multiple sources", async () => {
    const app = createApplication();
    const project = app.createProject({
      gitOriginUrl: "git@github.com:app/watchtower.git",
      name: "Watchtower",
    });
    const coordinator = createT3Coordinator({
      application: app,
      sources: [
        {
          machineId: "shared",
          reader: reader({ sourceId: "one", threadId: "one" }),
          sourceId: "one",
        },
        {
          machineId: "shared",
          reader: reader({ sourceId: "two", threadId: "two" }),
          sourceId: "two",
        },
      ],
    });
    await expect(
      coordinator.autoLinkThread({
        branchName: "feature/watchtower",
        machineId: "shared",
        projectId: project.id,
      }),
    ).resolves.toMatchObject({
      machineId: "shared",
      projectId: project.id,
      status: "ambiguous",
    });
    await expect(
      coordinator.autoLinkThread({
        branchName: "feature/watchtower",
        machineId: "unknown",
        projectId: project.id,
      }),
    ).resolves.toMatchObject({
      machineId: "unknown",
      projectId: project.id,
      status: "unmatched",
    });
  });

  test("does not select the first project when a source repeats a thread ID", async () => {
    const app = createApplication();
    app.createProject({
      name: "First",
      t3Mappings: [{ sourceId: "shared", t3ProjectId: "t3-first" }],
    });
    app.createProject({
      name: "Second",
      t3Mappings: [{ sourceId: "shared", t3ProjectId: "t3-second" }],
    });
    const thread = (projectId: string) => ({
      branch: "feature/watchtower",
      createdAt: observedAt,
      hasActionableProposedPlan: false,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      id: "duplicate",
      latestTurn: {
        requestedAt: observedAt,
        state: "running" as const,
        turnId: `${projectId}-turn`,
      },
      projectId,
      session: { status: "running" as const, updatedAt: observedAt },
      title: `Thread ${projectId}`,
      updatedAt: observedAt,
    });
    const coordinator = createT3Coordinator({
      application: app,
      sources: [
        {
          machineId: "shared-machine",
          reader: {
            readShell: async () => ({
              fetchedAt: observedAt,
              ok: true as const,
              projects: [
                {
                  createdAt: observedAt,
                  id: "t3-first",
                  title: "First",
                  updatedAt: observedAt,
                  workspaceRoot: "/work/first",
                },
                {
                  createdAt: observedAt,
                  id: "t3-second",
                  title: "Second",
                  updatedAt: observedAt,
                  workspaceRoot: "/work/second",
                },
              ],
              sourceDigest: "duplicate-shell",
              sourceSequence: 1,
              sourceStream: "shell",
              sourceUpdatedAt: observedAt,
              status: "ok" as const,
              threads: [thread("t3-first"), thread("t3-second")],
            }),
            readThread: async () => {
              throw new Error("detail must not be fetched for an ambiguous ID");
            },
          },
          sourceId: "shared",
        },
      ],
    });
    await expect(
      coordinator.threadDetail("duplicate", 1),
    ).resolves.toMatchObject({
      machineId: "shared-machine",
      sourceId: "shared",
      status: "ambiguous",
      threadId: "duplicate",
    });
  });

  test("prefers portable repository identity while honoring source mapping roots", () => {
    const app = createApplication();
    const portable = app.createProject({
      gitOriginUrl: "git@github.com:app/watchtower.git",
      name: "Portable",
      workspaceRoot: "/Users/kevin/watchtower",
    });
    const mapped = app.createProject({
      gitOriginUrl: "git@github.com:app/mapped.git",
      name: "Mapped",
      t3Mappings: [{ sourceId: "linux", workspaceRoot: "/Users/kevin/mapped" }],
    });
    const portableT3 = {
      createdAt: observedAt,
      id: "portable-t3",
      repositoryIdentity: { canonicalKey: "github.com/app/watchtower" },
      title: "Portable",
      updatedAt: observedAt,
      workspaceRoot: "/home/agent/watchtower",
    };
    expect(
      resolveT3Project(portableT3, app.listProjects(), "linux"),
    ).toMatchObject({
      project: { id: portable.id },
      status: "matched",
    });
    expect(
      resolveT3Project(
        {
          ...portableT3,
          id: "mapped-t3",
          repositoryIdentity: { canonicalKey: "github.com/app/mapped" },
          workspaceRoot: "/home/agent/mapped",
        },
        app.listProjects(),
        "linux",
      ),
    ).toMatchObject({ status: "unmatched" });
    expect(mapped.id).not.toBe(portable.id);
  });
});
