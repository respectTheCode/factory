import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";
import type {
  T3ActivityReader,
  T3ShellObservation,
  T3ThreadObservation,
} from "../../src/t3";
import { createT3Coordinator } from "../../src/t3-coordinator";

const observedAt = "2026-10-06T12:00:00.000Z";

function reader(): T3ActivityReader {
  const projectId = "t3-project-watchtower";
  const threads = ["linked-thread", "unlinked-thread"].map((id) => ({
    branch: "feature/watchtower",
    createdAt: observedAt,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    id,
    projectId,
    session: { status: "running" as const, updatedAt: observedAt },
    title: id,
    updatedAt: observedAt,
  }));
  return {
    async readShell(): Promise<T3ShellObservation> {
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
            workspaceRoot: "/work/watchtower",
          },
        ],
        sourceDigest: "ubuntu-shell-1",
        sourceSequence: 1,
        sourceStream: "shell",
        sourceUpdatedAt: observedAt,
        status: "ok",
        threads,
      };
    },
    async readThread({ threadId }): Promise<T3ThreadObservation> {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) {
        return {
          error: `Unknown thread ${threadId}`,
          fetchedAt: observedAt,
          ok: false,
          status: "invalid_response",
        };
      }
      return {
        fetchedAt: observedAt,
        ok: true,
        sourceDigest: `${threadId}-detail`,
        sourceSequence: 1,
        sourceStream: `thread:${threadId}`,
        sourceUpdatedAt: observedAt,
        status: "ok",
        thread: { ...thread, activities: [], checkpoints: [], messages: [] },
      };
    },
  };
}

describe("T3 task attribution", () => {
  test("exposes stored run attribution only for linked observations", async () => {
    let nextId = 0;
    const app = new FactoryApplication({
      clock: () => new Date(observedAt),
      idGenerator: () => `id-${++nextId}`,
    });
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
          machineId: "agent-ubuntu",
          reader: reader(),
          sourceId: "ubuntu",
        },
      ],
    });

    const initial = await coordinator.projectActivity(project.id, "ubuntu");
    expect(initial.threads).toHaveLength(2);
    const linkedObservation = app
      .listProjectT3Activity(project.id, "ubuntu")
      .find(
        ({ observation }) => observation.externalThreadId === "linked-thread",
      )?.observation;
    if (!linkedObservation)
      throw new Error("Expected linked-thread observation.");
    const link = app.linkT3Thread({
      observation: linkedObservation,
      taskId: task.id,
    });

    const activity = await coordinator.projectActivity(project.id, "ubuntu");
    const linked = activity.threads.find(
      ({ threadId }) => threadId === "linked-thread",
    );
    const unlinked = activity.threads.find(
      ({ threadId }) => threadId === "unlinked-thread",
    );
    expect(linked).toMatchObject({
      codeSessionId: link.codeSession.id,
      machineId: "agent-ubuntu",
      runId: link.run.id,
      sourceCurrent: true,
      sourceId: "ubuntu",
      threadId: "linked-thread",
    });
    expect(unlinked).toMatchObject({
      machineId: "agent-ubuntu",
      sourceCurrent: true,
      sourceId: "ubuntu",
      threadId: "unlinked-thread",
    });
    expect(unlinked).not.toHaveProperty("codeSessionId");
    expect(unlinked).not.toHaveProperty("runId");
  });
});
