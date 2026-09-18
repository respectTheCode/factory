import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  checkSnapshotHealth,
  runSnapshotOnce,
  startBackupLoop,
  type SnapshotInvocation,
} from "../../scripts/backup-loop";
import { createFactoryApplication } from "../../src/application";
import { backupFactorySnapshot } from "../../src/backup-snapshot";

function writeGeneration(invocation: SnapshotInvocation, sourcePath: string) {
  backupFactorySnapshot({
    databasePath: sourcePath,
    outputPath: invocation.outputPath,
  });
}

describe("backup snapshot loop", () => {
  test("publishes complete generations and retains the prior generation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-loop-"));
    const sourcePath = join(directory, "source.sqlite");
    const backupDirectory = join(directory, "backups");
    const app = createFactoryApplication({ databasePath: sourcePath });
    const project = app.createProject({ name: "First project" });
    try {
      await runSnapshotOnce({
        backupDirectory,
        databasePath: sourcePath,
        runSnapshot: async (invocation) =>
          writeGeneration(invocation, sourcePath),
      });

      app.createProject({ name: "Second project" });
      await runSnapshotOnce({
        backupDirectory,
        databasePath: sourcePath,
        runSnapshot: async (invocation) =>
          writeGeneration(invocation, sourcePath),
      });

      const latestManifest = JSON.parse(
        readFileSync(
          join(backupDirectory, "latest", "factory.sqlite.manifest.json"),
          "utf8",
        ),
      ) as { state: { collections: { projects: { count: number } } } };
      const previousManifest = JSON.parse(
        readFileSync(
          join(backupDirectory, "previous", "factory.sqlite.manifest.json"),
          "utf8",
        ),
      ) as { state: { collections: { projects: { count: number } } } };
      expect(latestManifest.state.collections.projects.count).toBe(2);
      expect(previousManifest.state.collections.projects.count).toBe(1);
      expect(
        existsSync(join(backupDirectory, "latest", "factory.sqlite")),
      ).toBe(true);
      expect(
        existsSync(
          join(backupDirectory, "latest", "factory.sqlite.manifest.json"),
        ),
      ).toBe(true);
      expect(
        checkSnapshotHealth({ backupDirectory, maxAgeMs: 60_000 }).integrity,
      ).toBe("ok");
      expect(project.id).toBeString();
    } finally {
      app.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("keeps the last good snapshot when a later snapshot fails validation", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-backup-loop-failure-"),
    );
    const sourcePath = join(directory, "source.sqlite");
    const backupDirectory = join(directory, "backups");
    const app = createFactoryApplication({ databasePath: sourcePath });
    app.createProject({ name: "Keep this project" });
    try {
      await runSnapshotOnce({
        backupDirectory,
        databasePath: sourcePath,
        runSnapshot: async (invocation) =>
          writeGeneration(invocation, sourcePath),
      });
      const latestManifestPath = join(
        backupDirectory,
        "latest",
        "factory.sqlite.manifest.json",
      );
      const before = readFileSync(latestManifestPath, "utf8");

      await expect(
        runSnapshotOnce({
          backupDirectory,
          databasePath: sourcePath,
          runSnapshot: async (invocation) => {
            writeFileSync(invocation.outputPath, "not sqlite");
            writeFileSync(`${invocation.outputPath}.manifest.json`, "{}");
          },
        }),
      ).rejects.toThrow();

      expect(readFileSync(latestManifestPath, "utf8")).toBe(before);
      expect(
        checkSnapshotHealth({ backupDirectory, maxAgeMs: 60_000 }),
      ).toMatchObject({
        integrity: "ok",
      });
      expect([
        ...new Bun.Glob(".snapshot-*").scanSync({ cwd: backupDirectory }),
      ]).toEqual([]);
    } finally {
      app.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("recovers previous as latest after an interrupted publish", async () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-backup-loop-recovery-"),
    );
    const sourcePath = join(directory, "source.sqlite");
    const backupDirectory = join(directory, "backups");
    const app = createFactoryApplication({ databasePath: sourcePath });
    app.createProject({ name: "Recoverable snapshot" });
    try {
      await runSnapshotOnce({
        backupDirectory,
        databasePath: sourcePath,
        runSnapshot: async (invocation) =>
          writeGeneration(invocation, sourcePath),
      });
      renameSync(
        join(backupDirectory, "latest"),
        join(backupDirectory, "previous"),
      );
      await runSnapshotOnce({
        backupDirectory,
        databasePath: sourcePath,
        runSnapshot: async (invocation) =>
          writeGeneration(invocation, sourcePath),
      });
      expect(
        checkSnapshotHealth({ backupDirectory, maxAgeMs: 60_000 }),
      ).toMatchObject({
        integrity: "ok",
      });
      expect(
        existsSync(join(backupDirectory, "previous", "factory.sqlite")),
      ).toBe(true);
    } finally {
      app.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("SIGTERM-style stop waits for the active snapshot and publishes it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-loop-stop-"));
    const sourcePath = join(directory, "source.sqlite");
    const backupDirectory = join(directory, "backups");
    const app = createFactoryApplication({ databasePath: sourcePath });
    app.createProject({ name: "Graceful shutdown" });
    let started: (() => void) | undefined;
    const active = new Promise<void>((resolve) => {
      started = resolve;
    });
    try {
      const controller = startBackupLoop({
        backupDirectory,
        databasePath: sourcePath,
        intervalMs: 60_000,
        runSnapshot: async (invocation) => {
          started?.();
          await Bun.sleep(25);
          writeGeneration(invocation, sourcePath);
        },
      });
      await active;
      controller.stop();
      await controller.promise;
      expect(
        existsSync(join(backupDirectory, "latest", "factory.sqlite")),
      ).toBe(true);
      expect(
        readFileSync(
          join(backupDirectory, "latest", "factory.sqlite.manifest.json"),
          "utf8",
        ),
      ).toContain("factory_state");
    } finally {
      app.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("healthcheck rejects a stale latest manifest", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-backup-loop-stale-"));
    const sourcePath = join(directory, "source.sqlite");
    const backupDirectory = join(directory, "backups");
    const app = createFactoryApplication({ databasePath: sourcePath });
    app.createProject({ name: "Stale snapshot" });
    try {
      await runSnapshotOnce({
        backupDirectory,
        databasePath: sourcePath,
        runSnapshot: async (invocation) =>
          writeGeneration(invocation, sourcePath),
      });
      const manifestPath = join(
        backupDirectory,
        "latest",
        "factory.sqlite.manifest.json",
      );
      const old = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<
        string,
        unknown
      >;
      manifest.createdAt = old;
      writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
      expect(() =>
        checkSnapshotHealth({ backupDirectory, maxAgeMs: 60_000 }),
      ).toThrow(/stale/);
    } finally {
      app.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
