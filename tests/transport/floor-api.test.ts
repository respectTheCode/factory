import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";

describe("projects.floor API", () => {
  test("returns only machine-authorized Projects and their derived claims", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-floor-api-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({
      databasePath,
    });
    const visible = application.createProject({ name: "Visible" });
    const hidden = application.createProject({ name: "Hidden" });
    const hiddenTask = application.createTask({
      name: "Hidden task",
      projectId: hidden.id,
    });
    const hiddenSubtask = application.createSubtask({
      name: "Hidden claim",
      taskId: hiddenTask.id,
    });
    application.reportSubtaskStatus({
      reason: "Ready for review",
      reportedState: "complete",
      reporter: "codex",
      subtaskId: hiddenSubtask.id,
    });
    const server = createFactoryServer({
      databasePath,
      operator: { name: "Kevin", secret: "operator-secret" },
      port: 0,
      t3ActivityReader: {
        readShell: async () => ({
          error: "fixture unavailable",
          fetchedAt: new Date("2026-09-22T16:00:00.000Z").toISOString(),
          ok: false as const,
          status: "unavailable" as const,
        }),
        readThread: async () => ({
          error: "fixture unavailable",
          fetchedAt: new Date("2026-09-22T16:00:00.000Z").toISOString(),
          ok: false as const,
          status: "unavailable" as const,
        }),
      },
    });
    const credentialStore = createMachineCredentialStore({ databasePath });
    const credential = credentialStore.create({
      machineId: "mac-mini",
      projectIds: [visible.id],
    });
    try {
      for (const pathname of ["/ledger", "/ledger/"]) {
        for (const method of ["GET", "HEAD"] as const) {
          const ledger = await fetch(new URL(pathname, server.url), {
            method,
            redirect: "manual",
          });
          expect(ledger.status).toBe(302);
          expect(new URL(ledger.headers.get("location")!).pathname).toBe("/");
        }
      }
      const input = encodeURIComponent(JSON.stringify({}));
      const response = await fetch(
        new URL(`/api/projects.floor?input=${input}`, server.url),
        {
          headers: { Authorization: `Bearer ${credential.token}` },
        },
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        result?: {
          data?: {
            projects?: Array<{ id: string; name: string }>;
            queue?: Array<{ projectId: string }>;
            events?: Array<{ projectId: string }>;
          };
        };
      };
      const data = body.result?.data;
      expect(data?.projects).toEqual([
        expect.objectContaining({ id: visible.id, name: "Visible" }),
      ]);
      expect(data?.queue?.some((item) => item.projectId === hidden.id)).toBe(
        false,
      );
      expect(data?.events?.some((item) => item.projectId === hidden.id)).toBe(
        false,
      );
      expect(JSON.stringify(data)).not.toContain(hidden.id);
      expect(JSON.stringify(data)).not.toContain("Hidden");
    } finally {
      await server.stop();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
