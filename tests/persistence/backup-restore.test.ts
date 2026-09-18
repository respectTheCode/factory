import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createFactoryApplication } from "../../src/application";
import { createHumanSessionStore } from "../../src/human-session";
import { createBackupService } from "../../src/backup-service";
import {
  applyPendingRestore,
  restoreJournalPath,
  writeRestoreJournal,
  type RestoreStep,
} from "../../src/backup-restore";
import {
  inspectFactoryDatabase,
  verifyFactorySnapshot,
} from "../../src/backup-snapshot";

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "factory-app-restore-"));
  const databasePath = join(directory, "factory.sqlite");
  const backups = join(directory, "backups");
  const app = createFactoryApplication({ databasePath });
  const project = app.createProject({ name: "Original" });
  const task = app.createTask({ projectId: project.id, name: "History" });
  const subtask = app.createSubtask({
    taskId: task.id,
    name: "Restore history",
  });
  const report = app.reportSubtaskStatus({
    subtaskId: subtask.id,
    reporter: "fixture",
    reportedState: "in_progress",
    evidence: "Durable report",
  });
  app.close();
  const sessions = createHumanSessionStore({ databasePath });
  sessions.create("restore-test");
  sessions.close();
  const service = createBackupService({ databasePath, directory: backups });
  const source = await service.create();
  const current = createFactoryApplication({ databasePath });
  current.createProject({ name: "Newer work" });
  current.close();
  const prepared = await service.prepareRestore(source.id);
  return {
    directory,
    databasePath,
    backups,
    service,
    source,
    prepared,
    report,
  };
}

async function interruptAt(databasePath: string, step: RestoreStep) {
  const modulePath = resolve(import.meta.dir, "../../src/backup-restore.ts");
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import {applyPendingRestore} from ${JSON.stringify(modulePath)}; applyPendingRestore(${JSON.stringify(databasePath)}, {onStep(step){if(step===${JSON.stringify(step)})process.exit(77)}});`,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const exit = await child.exited;
  const error = await new Response(child.stderr).text();
  expect(error).toBe("");
  expect(exit).toBe(77);
}

describe("application restore startup", () => {
  test("refuses a changed live symlink when resuming a ready restore", async () => {
    const f = await fixture();
    try {
      writeRestoreJournal(f.databasePath, f.prepared);
      await interruptAt(f.databasePath, "ready");
      const target = join(f.directory, "untouched.sqlite");
      writeFileSync(target, readFileSync(f.databasePath));
      const before = readFileSync(target);
      rmSync(f.databasePath);
      symlinkSync(target, f.databasePath);
      expect(() => applyPendingRestore(f.databasePath)).toThrow();
      expect(readFileSync(target)).toEqual(before);
      expect(existsSync(restoreJournalPath(f.databasePath))).toBe(true);
    } finally {
      f.service.stop();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  test("restores history, preserves newer work in safety backup, and invalidates sessions", async () => {
    const f = await fixture();
    try {
      writeRestoreJournal(f.databasePath, f.prepared);
      expect(applyPendingRestore(f.databasePath).applied).toBe(true);
      const restored = inspectFactoryDatabase({ databasePath: f.databasePath });
      expect(restored.state.collections.projects.count).toBe(1);
      expect(restored.state.collections.statusReports.ids).toContain(
        f.report.id,
      );
      expect(restored.protectedTables.factory_sessions.count).toBe(0);
      const safety = verifyFactorySnapshot({
        databasePath: join(
          f.backups,
          f.prepared.preRestoreId,
          "snapshot.sqlite",
        ),
        manifestPath: join(f.backups, f.prepared.preRestoreId, "manifest.json"),
      });
      expect(safety.manifest.state.collections.projects.count).toBe(2);
      expect(existsSync(restoreJournalPath(f.databasePath))).toBe(false);
      expect(
        JSON.parse(
          readFileSync(`${f.databasePath}.restore-result.json`, "utf8"),
        ),
      ).toMatchObject({
        state: "restored",
        backupId: f.source.id,
        preRestoreId: f.prepared.preRestoreId,
      });
      expect(applyPendingRestore(f.databasePath).applied).toBe(false);
    } finally {
      f.service.stop();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  for (const step of [
    "ready",
    "sidecars-removed",
    "database-replaced",
    "applied",
    "journal-removed",
  ] as const) {
    test(`recovers after process exit at ${step}`, async () => {
      const f = await fixture();
      try {
        writeRestoreJournal(f.databasePath, f.prepared);
        await interruptAt(f.databasePath, step);
        applyPendingRestore(f.databasePath);
        const restored = inspectFactoryDatabase({
          databasePath: f.databasePath,
        });
        expect(restored.state.collections.projects.count).toBe(1);
        expect(restored.state.collections.statusReports.ids).toContain(
          f.report.id,
        );
        expect(restored.protectedTables.factory_sessions.count).toBe(0);
        expect(existsSync(restoreJournalPath(f.databasePath))).toBe(false);
      } finally {
        f.service.stop();
        rmSync(f.directory, { recursive: true, force: true });
      }
    });
  }

  test("corrupt staging aborts without replacing the live database", async () => {
    const f = await fixture();
    try {
      writeRestoreJournal(f.databasePath, f.prepared);
      writeFileSync(f.prepared.stagedDatabasePath, "corrupt");
      expect(() => applyPendingRestore(f.databasePath)).toThrow(
        "live data is unchanged",
      );
      expect(
        inspectFactoryDatabase({ databasePath: f.databasePath }).state
          .collections.projects.count,
      ).toBe(2);
      expect(existsSync(restoreJournalPath(f.databasePath))).toBe(false);
      expect(
        JSON.parse(
          readFileSync(`${f.databasePath}.restore-result.json`, "utf8"),
        ).state,
      ).toBe("failed");
    } finally {
      f.service.stop();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  test("bad installed copy recovers the immutable local rollback, including an old WAL", async () => {
    const f = await fixture();
    try {
      // Simulate an old writer exiting without checkpointing its WAL.
      const child = Bun.spawn(
        [
          process.execPath,
          "-e",
          `import {Database} from "bun:sqlite";const db=new Database(${JSON.stringify(f.databasePath)});db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE recovery_probe(value TEXT); INSERT INTO recovery_probe VALUES ('latest WAL write')");process.exit(0);`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(await child.exited).toBe(0);
      writeRestoreJournal(f.databasePath, f.prepared);
      await interruptAt(f.databasePath, "database-replaced");
      writeFileSync(f.databasePath, "invalid replacement");
      expect(() => applyPendingRestore(f.databasePath)).toThrow(
        "pre-restore database was recovered",
      );
      const db = new Database(f.databasePath, { readonly: true });
      try {
        expect(db.query("SELECT value FROM recovery_probe").get()).toEqual({
          value: "latest WAL write",
        });
      } finally {
        db.close();
      }
      expect(
        inspectFactoryDatabase({ databasePath: f.databasePath }).state
          .collections.projects.count,
      ).toBe(2);
    } finally {
      f.service.stop();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });

  test("rejects symlink staging and never overwrites an existing restore request", async () => {
    const f = await fixture();
    try {
      const link = join(f.directory, ".factory-restore-linked");
      symlinkSync(resolve(f.prepared.stagedDatabasePath, ".."), link);
      expect(() =>
        writeRestoreJournal(f.databasePath, {
          ...f.prepared,
          stagedDatabasePath: join(link, "snapshot.sqlite"),
          stagedManifestPath: join(link, "manifest.json"),
        }),
      ).toThrow("real managed local directory");
      writeRestoreJournal(f.databasePath, f.prepared);
      const before = readFileSync(restoreJournalPath(f.databasePath), "utf8");
      expect(() => writeRestoreJournal(f.databasePath, f.prepared)).toThrow(
        "already pending",
      );
      expect(readFileSync(restoreJournalPath(f.databasePath), "utf8")).toBe(
        before,
      );
    } finally {
      f.service.stop();
      rmSync(f.directory, { recursive: true, force: true });
    }
  });
});
