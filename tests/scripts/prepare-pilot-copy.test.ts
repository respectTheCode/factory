import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createHumanSessionStore } from "../../src/human-session";
import { createMachineCredentialStore } from "../../src/machine-credential";
import {
  parsePilotCopyOptions,
  preparePilotCopy,
  redactPilotCopyResult,
} from "../../scripts/prepare-pilot-copy";

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "factory-pilot-copy-"));
  mkdirSync(join(directory, "staging"));
  return directory;
}

describe("prepare-pilot-copy", () => {
  test("requires explicit isolated-pilot confirmation and absolute paths", () => {
    expect(() =>
      parsePilotCopyOptions([
        "--source-database",
        "relative.sqlite",
        "--destination-database",
        "/tmp/copy.sqlite",
        "--project-id",
        "project-1",
        "--token-dir",
        "/tmp/tokens",
        "--confirm-isolated-pilot",
      ]),
    ).toThrow("--source-database must be an absolute path");

    expect(() =>
      parsePilotCopyOptions([
        "--source-database",
        "/tmp/source.sqlite",
        "--destination-database",
        "/tmp/copy.sqlite",
        "--project-id",
        "project-1",
        "--token-dir",
        "/tmp/tokens",
      ]),
    ).toThrow("--confirm-isolated-pilot");
  });

  test("copies Factory history, revokes copied credentials, and writes fresh private tokens", () => {
    const directory = fixtureDirectory();
    const sourcePath = join(directory, "source.sqlite");
    const destinationPath = join(directory, "staging", "newstagingcopy.sqlite");
    const tokenDirectory = join(directory, "staging", "new-private-tokens");
    const application = createFactoryApplication({ databasePath: sourcePath });
    const sourceCredentials = createMachineCredentialStore({
      databasePath: sourcePath,
    });
    const sourceSessions = createHumanSessionStore({
      databasePath: sourcePath,
    });
    try {
      const project = application.createProject({ name: "Copied project" });
      const task = application.createTask({
        name: "Historical task",
        projectId: project.id,
      });
      const subtask = application.createSubtask({
        name: "Historical subtask",
        taskId: task.id,
      });
      const report = application.reportSubtaskStatus({
        evidence: "The source history is retained.",
        reason: "Fixture history",
        reporter: "codex",
        reportedState: "complete",
        subtaskId: subtask.id,
      });
      application.verifyStatusReport({
        decision: "accepted",
        reportId: report.id,
        verifier: "kevin",
      });
      const oldCredential = sourceCredentials.create({
        machineId: "old-machine",
        projectIds: [project.id],
      });
      const oldSession = sourceSessions.create("Kevin");
      const sourceBefore = readFileSync(sourcePath);

      const result = preparePilotCopy({
        confirmIsolatedPilot: true,
        destinationDatabasePath: destinationPath,
        projectId: project.id,
        sourceDatabasePath: sourcePath,
        tokenDirectory,
      });

      expect(readFileSync(sourcePath)).toEqual(sourceBefore);
      expect(sourceSessions.get(oldSession)).toEqual({ name: "Kevin" });
      expect(result.revokedMachineIds).toEqual(["old-machine"]);
      expect(result.recordComparison.match).toBe(true);
      expect(result.recordComparison.credentialRowsExcluded).toBe(true);
      expect(result.recordComparison.protectedState.match).toBe(true);
      expect(result.recordComparison.protectedState.excludedTables).toEqual([
        "factory_machine_credentials",
        "factory_sessions",
      ]);
      expect(result.recordComparison.source).toEqual(
        result.recordComparison.destination,
      );
      expect(result.recordComparison.source.contentHash).toEqual(
        expect.any(String),
      );
      expect(
        result.recordComparison.source.history.statusReports,
      ).toMatchObject({
        count: 1,
        idHash: expect.any(String),
        contentHash: expect.any(String),
      });
      expect(
        result.recordComparison.source.history.verifications,
      ).toMatchObject({
        count: 1,
        idHash: expect.any(String),
        contentHash: expect.any(String),
      });
      expect(result.recordComparison.source.counts).toMatchObject({
        projects: 1,
        tasks: 1,
        subtasks: 1,
        statusReports: 1,
        verifications: 1,
      });

      const destinationCredentials = createMachineCredentialStore({
        databasePath: destinationPath,
      });
      try {
        expect(
          destinationCredentials.authenticate(oldCredential.token),
        ).toBeNull();
        expect(destinationCredentials.list()).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              machineId: "old-machine",
              revokedAt: expect.any(String),
            }),
            expect.objectContaining({
              machineId: "mac-mini",
              projectIds: [project.id],
              revokedAt: null,
            }),
            expect.objectContaining({
              machineId: "agent-ubuntu",
              projectIds: [project.id],
              revokedAt: null,
            }),
          ]),
        );
        for (const credential of result.credentials) {
          expect(readFileSync(credential.tokenPath, "utf8").trim()).toMatch(
            /^fmc_[A-Za-z0-9_-]+$/,
          );
          expect(statSync(credential.tokenPath).mode & 0o777).toBe(0o600);
        }
      } finally {
        destinationCredentials.close();
      }
      const destinationSessions = createHumanSessionStore({
        databasePath: destinationPath,
      });
      try {
        expect(destinationSessions.get(oldSession)).toBeNull();
      } finally {
        destinationSessions.close();
      }
      const destinationApplication = createFactoryApplication({
        databasePath: destinationPath,
      });
      try {
        expect(
          destinationApplication.getSubtaskReportHistory(subtask.id),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: report.id,
              evidence: "The source history is retained.",
            }),
          ]),
        );
        expect(
          destinationApplication.getSubtaskVerificationHistory(subtask.id),
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              decision: "accepted",
              reportId: report.id,
            }),
          ]),
        );
      } finally {
        destinationApplication.close();
      }
      expect(statSync(tokenDirectory).mode & 0o777).toBe(0o700);
      expect(readdirSync(tokenDirectory).sort()).toEqual([
        "agent-ubuntu.token",
        "mac-mini.token",
      ]);
      expect(redactPilotCopyResult(result)).not.toContain(oldCredential.token);
      expect(redactPilotCopyResult(result)).not.toMatch(/fmc_[A-Za-z0-9_-]+/);
      expect(existsSync(sourcePath)).toBe(true);
    } finally {
      sourceSessions.close();
      sourceCredentials.close();
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects an existing destination before touching the source", () => {
    const directory = fixtureDirectory();
    const sourcePath = join(directory, "source.sqlite");
    const destinationPath = join(directory, "staging", "existing.sqlite");
    const tokenDirectory = join(directory, "staging", "tokens");
    const application = createFactoryApplication({ databasePath: sourcePath });
    try {
      const project = application.createProject({ name: "Source project" });
      writeFileSync(destinationPath, "keep this destination");
      const sourceBefore = readFileSync(sourcePath);

      expect(() =>
        preparePilotCopy({
          confirmIsolatedPilot: true,
          destinationDatabasePath: destinationPath,
          projectId: project.id,
          sourceDatabasePath: sourcePath,
          tokenDirectory,
        }),
      ).toThrow("Refusing an existing destination path");
      expect(readFileSync(sourcePath)).toEqual(sourceBefore);
      expect(readFileSync(destinationPath, "utf8")).toBe(
        "keep this destination",
      );
      expect(existsSync(tokenDirectory)).toBe(false);
    } finally {
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects FACTORY_URL rather than entering remote mode", () => {
    const previous = process.env.FACTORY_URL;
    process.env.FACTORY_URL = "https://factory.example";
    try {
      expect(() =>
        preparePilotCopy({
          confirmIsolatedPilot: true,
          destinationDatabasePath: "/tmp/newstagingcopy.sqlite",
          projectId: "project-1",
          sourceDatabasePath: "/tmp/source.sqlite",
          tokenDirectory: "/tmp/new-private-tokens",
        }),
      ).toThrow("FACTORY_URL must be unset");
    } finally {
      if (previous === undefined) delete process.env.FACTORY_URL;
      else process.env.FACTORY_URL = previous;
    }
  });
});
