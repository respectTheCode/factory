import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createTestServer } from "./helpers";
import type { T3ActivityReader } from "../../src/t3";

type ApiBody = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

async function postApi(
  server: { url: URL },
  path: string,
  input: unknown,
  token: string,
): Promise<{ response: Response; body: ApiBody }> {
  const response = await fetch(new URL(`/api/${path}`, server.url), {
    body: JSON.stringify(input),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = (await response.json()) as ApiBody;
  return { body, response };
}

function unavailableReader(): T3ActivityReader {
  return {
    readShell: async () => ({
      error: "fixture unavailable",
      fetchedAt: new Date().toISOString(),
      ok: false,
      status: "unavailable",
    }),
    readThread: async () => ({
      error: "fixture unavailable",
      fetchedAt: new Date().toISOString(),
      ok: false,
      status: "unavailable",
    }),
  };
}

describe("report tracking HTTP API", () => {
  test("accepts scoped claims while keeping scope and human-only actions enforced", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-report-tracking-api-"),
    );
    const databasePath = join(directory, "factory.sqlite");
    const app = createFactoryApplication({ databasePath });
    const allowedProject = app.createProject({ name: "Allowed" });
    const allowedTask = app.createTask({
      name: "Allowed task",
      projectId: allowedProject.id,
    });
    const target = app.createSubtask({
      name: "Target",
      taskId: allowedTask.id,
    });
    const waiting = app.createSubtask({
      name: "Waiting",
      taskId: allowedTask.id,
    });
    const outsideProject = app.createProject({ name: "Outside" });
    const outsideTask = app.createTask({
      name: "Outside task",
      projectId: outsideProject.id,
    });
    const outside = app.createSubtask({
      name: "Outside",
      taskId: outsideTask.id,
    });
    const server = createTestServer({
      databasePath,
      hostname: "127.0.0.1",
      port: 0,
      t3Sources: [
        {
          accessTokenFile: "/tmp/report-tracking-token",
          baseUrl: "http://127.0.0.1:3773",
          machineId: "reporting-agent",
          reader: unavailableReader(),
          sourceId: "legacy",
        },
      ],
    });
    const credentialStore = createMachineCredentialStore({ databasePath });
    const credential = credentialStore.create({
      machineId: "reporting-agent",
      projectIds: [allowedProject.id],
    });

    try {
      const reportInput = {
        artifacts: [
          {
            kind: "preview",
            label: "Candidate preview",
            url: "https://preview.example.test/build/42",
          },
        ],
        evidence: "Ready for the human acceptance check.",
        handoff: {
          nextAction: "Compare the candidate with the approved design.",
          nextOwner: "Kevin",
          nextOwnerKind: "human",
          waitingOnSubtaskIds: [waiting.simpleId],
        },
        reason: "The implementation and candidate preview are ready.",
        reportedState: "complete",
        reporter: "codex",
        requestKey: "report-tracking-replay-1",
        testedRevision: "abcdef1234567",
        subtaskId: target.id,
      };
      const report = await postApi(
        server,
        "subtasks.report",
        reportInput,
        credential.token,
      );
      expect(report.response.status).toBe(200);
      expect(report.body.result?.data).toMatchObject({
        artifacts: [
          {
            kind: "preview",
            label: "Candidate preview",
            url: "https://preview.example.test/build/42",
          },
        ],
        handoff: {
          nextAction: "Compare the candidate with the approved design.",
          nextOwner: "Kevin",
          nextOwnerKind: "human",
          waitingOnSubtaskIds: [waiting.id],
        },
        machineId: "reporting-agent",
        testedRevision: "abcdef1234567",
      });
      const replay = await postApi(
        server,
        "subtasks.report",
        reportInput,
        credential.token,
      );
      expect(replay.response.status).toBe(200);
      expect(replay.body).toEqual(report.body);
      expect(app.getSubtaskReportHistory(target.id)).toHaveLength(1);

      const changedPayload = await postApi(
        server,
        "subtasks.report",
        {
          ...reportInput,
          handoff: {
            ...reportInput.handoff,
            nextAction: "Review a different candidate.",
          },
        },
        credential.token,
      );
      expect(changedPayload.response.status).toBe(409);
      expect(changedPayload.body.error?.data?.code).toBe("CONFLICT");
      expect(app.getSubtaskReportHistory(target.id)).toHaveLength(1);

      const denied = await postApi(
        server,
        "subtasks.report",
        {
          evidence: "Out-of-scope report",
          reportedState: "in_progress",
          reporter: "codex",
          subtaskId: outside.id,
        },
        credential.token,
      );
      expect(denied.response.status).toBe(403);
      expect(denied.body.error?.data?.code).toBe("FORBIDDEN");
      expect(app.getSubtaskReportHistory(outside.id)).toEqual([]);

      const cannotAccept = await postApi(
        server,
        "subtasks.verify",
        {
          decision: "accepted",
          reportId: (report.body.result?.data as { id: string }).id,
        },
        credential.token,
      );
      expect(cannotAccept.response.status).toBe(401);
      expect(cannotAccept.body.error?.data?.code).toBe("UNAUTHORIZED");
      expect(app.getTaskStatus(allowedTask.id)).toMatchObject({
        taskCompleted: false,
        subtasks: [
          {
            effectiveState: "completed",
            verificationState: "not_required",
          },
          {
            effectiveState: "planned",
            verificationState: "unreported",
          },
        ],
        taskState: "planned",
      });
    } finally {
      credentialStore.close();
      app.close();
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
