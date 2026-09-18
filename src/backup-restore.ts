import {
  chmodSync,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  copyFileSync,
  openSync,
  closeSync,
  fsyncSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { Database } from "bun:sqlite";

import {
  backupFactorySnapshot,
  verifyFactorySnapshot,
} from "./backup-snapshot";
import {
  type BackupService,
  type BackupSettings,
  type BackupStatus,
  type BackupSummary,
  type BackupTrigger,
  type RestorePreparation,
} from "./backup-service";

export type { BackupTrigger, RestorePreparation } from "./backup-service";

export type MaintenanceGate = {
  enterMaintenance: () => Promise<void>;
  leaveMaintenance: () => void;
  runMaintenance: <T>(operation: () => T | PromiseLike<T>) => Promise<T>;
  run: <T>(
    operation: () => T | PromiseLike<T>,
    options?: { allowMaintenance?: boolean },
  ) => Promise<T>;
};

export type RestoreJournal = {
  version: 1;
  phase: "prepared" | "ready" | "applied";
  databasePath: string;
  stagedDatabasePath: string;
  stagedManifestPath: string;
  backupId: string;
  preRestoreId: string;
};

export type BackupRestoreCoordinator = {
  readonly service: BackupService;
  readonly configured: boolean;
  status: () => BackupStatus;
  list: () => Promise<BackupSummary[]>;
  create: (trigger: BackupTrigger) => Promise<BackupSummary>;
  updateSettings: (settings: BackupSettings) => Promise<BackupSettings>;
  delete: (id: string) => Promise<void>;
  prepareRestore: (id: string) => Promise<RestorePreparation>;
  start: () => Promise<void>;
  stop: () => void;
};

export type RestoreStartupResult = {
  applied: boolean;
  databasePath: string;
  journalPath: string;
};

const RESTORE_JOURNAL_SUFFIX = ".restore-journal.json";

const disabledService: BackupService = {
  status: () => ({
    busy: false,
    configured: false,
    directory: null,
    lastError: "Backups are not configured.",
    lastSuccessAt: null,
    settings: {
      enabled: false,
      intervalMinutes: 30,
      keepDaily: 30,
      keepRecent: 336,
    },
    stale: false,
  }),
  list: async () => [],
  create: async () => {
    throw new Error("Application backups are not configured.");
  },
  updateSettings: async () => {
    throw new Error("Application backups are not configured.");
  },
  delete: async () => {
    throw new Error("Application backups are not configured.");
  },
  prepareRestore: async () => {
    throw new Error("Application backups are not configured.");
  },
  start: async () => {},
  stop() {},
};

export function createDisabledBackupService(): BackupService {
  return disabledService;
}

export function restoreJournalPath(databasePath: string): string {
  return `${resolve(databasePath)}${RESTORE_JOURNAL_SUFFIX}`;
}

export function createBackupRestoreCoordinator({
  databasePath,
  service = disabledService,
  gate,
  onRestorePrepared,
}: {
  databasePath: string;
  service?: BackupService;
  gate: MaintenanceGate;
  onRestorePrepared?: (prepared: RestorePreparation) => void | Promise<void>;
}): BackupRestoreCoordinator {
  const configured = service !== disabledService;
  return {
    configured,
    service,
    status: () => service.status(),
    list: () => service.list(),
    create: (trigger) => service.create(trigger),
    updateSettings: (settings) => service.updateSettings(settings),
    delete: (id) => service.delete(id),
    prepareRestore: (id) =>
      gate.runMaintenance(async () => {
        let journalWritten = false;
        try {
          // prepareRestore performs the mandatory pre-restore generation in
          // the worker, after this gate has drained admitted writes.
          const prepared = await service.prepareRestore(id);
          writeRestoreJournal(databasePath, prepared);
          journalWritten = true;
          await onRestorePrepared?.(prepared);
          return prepared;
        } catch (error) {
          // No live database has been changed during preparation. Remove the
          // journal so a failed request cannot apply a staged copy later.
          if (journalWritten) removeRestoreJournal(databasePath);
          gate.leaveMaintenance();
          throw error;
        }
      }),
    start: () => service.start(),
    stop: () => service.stop(),
  };
}

export function writeRestoreJournal(
  databasePath: string,
  prepared: RestorePreparation,
): RestoreJournal {
  const journal: RestoreJournal = {
    version: 1,
    phase: "prepared",
    backupId: prepared.backupId,
    preRestoreId: prepared.preRestoreId,
    databasePath: resolve(databasePath),
    stagedDatabasePath: resolve(prepared.stagedDatabasePath),
    stagedManifestPath: resolve(prepared.stagedManifestPath),
  };
  validatePaths(journal);
  verifyPair(journal.stagedDatabasePath, journal.stagedManifestPath);
  const path = restoreJournalPath(databasePath);
  if (existsSync(path)) throw new Error("A restore is already pending.");
  syncFile(journal.stagedDatabasePath);
  syncFile(journal.stagedManifestPath);
  syncDirectory(dirname(journal.stagedDatabasePath));
  atomicWriteJson(path, journal);
  return journal;
}

export type RestoreStep =
  | "ready"
  | "sidecars-removed"
  | "database-replaced"
  | "applied"
  | "journal-removed";

/** Runs before opening any application database handles, with every old writer stopped. */
export function applyPendingRestore(
  databasePath: string,
  options: { onStep?: (step: RestoreStep) => void } = {},
): RestoreStartupResult {
  const live = resolve(databasePath);
  const path = restoreJournalPath(live);
  const result = { applied: false, databasePath: live, journalPath: path };
  if (!existsSync(path)) return result;
  assertRegularFile(path);
  const journal = readJournal(path);
  if (journal.databasePath !== live)
    throw new Error("Restore journal database path mismatch.");
  validatePaths(journal);
  // Recheck on every resumed phase before touching the live path or sidecars.
  assertRegularFile(live);
  const directory = dirname(journal.stagedDatabasePath);
  const install = join(directory, "install.sqlite");
  const installManifest = join(directory, "install.manifest.json");
  const rollback = join(directory, "rollback.sqlite");
  const rollbackManifest = join(directory, "rollback.manifest.json");

  if (journal.phase === "prepared") {
    // Until the ready journal is durable, we have not touched the live DB or WAL.
    // A crash while making either local copy can safely restart this preparation.
    try {
      verifyPair(journal.stagedDatabasePath, journal.stagedManifestPath);
      assertRegularFile(live);
      for (const name of [
        "working.sqlite",
        "working.sqlite-wal",
        "working.sqlite-shm",
        "install.sqlite",
        "install.manifest.json",
        "rollback.sqlite",
        "rollback.manifest.json",
      ]) {
        removeRegular(join(directory, name));
      }
      const working = join(directory, "working.sqlite");
      copyFileSync(journal.stagedDatabasePath, working);
      chmodSync(working, 0o600);
      const connection = new Database(working);
      try {
        const sessions = connection
          .query(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='factory_sessions'",
          )
          .get();
        if (sessions) connection.exec("DELETE FROM factory_sessions");
      } finally {
        connection.close();
      }
      const installed = backupFactorySnapshot({
        databasePath: working,
        outputPath: install,
        manifestPath: installManifest,
      }).manifest;
      const selected = verifyPair(
        journal.stagedDatabasePath,
        journal.stagedManifestPath,
      ).manifest;
      if (
        installed.state.contentDigest !== selected.state.contentDigest ||
        installed.state.durableIdsDigest !== selected.state.durableIdsDigest ||
        installed.schema.objectsDigest !== selected.schema.objectsDigest ||
        installed.protectedTables.factory_sessions.count !== 0
      ) {
        throw new Error(
          "Session invalidation changed restored application data.",
        );
      }
      for (const table of [
        "factory_machine_credentials",
        "factory_idempotency_receipts",
      ] as const) {
        if (
          installed.protectedTables[table].contentDigest !==
          selected.protectedTables[table].contentDigest
        ) {
          throw new Error(
            "Session invalidation changed protected application data.",
          );
        }
      }
      // VACUUM INTO includes a surviving WAL after an unclean old-process exit.
      // Never copy the live DB alone and then discard its WAL.
      backupFactorySnapshot({
        databasePath: live,
        outputPath: rollback,
        manifestPath: rollbackManifest,
      });
      for (const file of [install, installManifest, rollback, rollbackManifest])
        syncFile(file);
      syncDirectory(directory);
      journal.phase = "ready";
      atomicWriteJson(path, journal);
    } catch (error) {
      recordResult(journal, "failed", errorMessage(error));
      removeRestoreJournal(live);
      throw new Error(
        `Restore preparation failed; live data is unchanged: ${errorMessage(error)}`,
      );
    }
    options.onStep?.("ready");
  }

  try {
    verifyPair(rollback, rollbackManifest);
    if (journal.phase === "ready") {
      if (existsSync(install)) {
        verifyPair(install, installManifest);
        removeLiveSidecars(live);
        options.onStep?.("sidecars-removed");
        renameSync(install, live);
        syncDirectory(dirname(live));
        options.onStep?.("database-replaced");
      } else {
        // Atomic rename completed but the process died before advancing the journal.
        verifyPair(live, installManifest);
      }
      journal.phase = "applied";
      atomicWriteJson(path, journal);
      options.onStep?.("applied");
    }
    verifyPair(live, installManifest);
  } catch (error) {
    // Keep rollback immutable. An interrupted rollback can be retried from the
    // same durable ready/applied journal; never unlink a live DB first.
    try {
      verifyPair(rollback, rollbackManifest);
      const replacement = join(directory, "rollback-install.sqlite");
      removeRegular(replacement);
      copyFileSync(rollback, replacement);
      chmodSync(replacement, 0o600);
      syncFile(replacement);
      verifyPair(replacement, rollbackManifest);
      removeLiveSidecars(live);
      renameSync(replacement, live);
      syncDirectory(dirname(live));
      verifyPair(live, rollbackManifest);
      recordResult(journal, "failed", errorMessage(error));
      removeRestoreJournal(live);
    } catch (rollbackError) {
      throw new Error(
        `Restore stopped; recovery files preserved: ${errorMessage(rollbackError)}`,
      );
    }
    throw new Error(
      `Restore failed; the pre-restore database was recovered: ${errorMessage(error)}`,
    );
  }

  // Commit completion before deleting any recovery files. Cleanup failure must
  // never trigger rollback or make a successful restore unusable at next startup.
  recordResult(journal, "restored");
  removeRestoreJournal(live);
  options.onStep?.("journal-removed");
  try {
    rmSync(directory, { recursive: true });
  } catch (error) {
    console.warn(
      `Factory restore completed; local staging cleanup failed: ${errorMessage(error)}`,
    );
  }
  return { ...result, applied: true };
}

function verifyPair(databasePath: string, manifestPath: string) {
  assertRegularFile(databasePath);
  assertRegularFile(manifestPath);
  return verifyFactorySnapshot({ databasePath, manifestPath });
}

function validatePaths(journal: RestoreJournal): void {
  const liveDirectory = dirname(journal.databasePath);
  const staging = dirname(journal.stagedDatabasePath);
  if (
    resolve(journal.databasePath) !== journal.databasePath ||
    dirname(staging) !== liveDirectory ||
    !/^\.factory-restore-[A-Za-z0-9_-]+$/.test(basename(staging)) ||
    basename(journal.stagedDatabasePath) !== "snapshot.sqlite" ||
    journal.stagedManifestPath !== join(staging, "manifest.json") ||
    realpathSync(staging) !==
      join(realpathSync(liveDirectory), basename(staging))
  ) {
    throw new Error(
      "Restore staging must be a real managed local directory beside the database.",
    );
  }
  const stat = lstatSync(staging);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Invalid restore staging directory.");
}

function readJournal(path: string): RestoreJournal {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!data || typeof data !== "object")
    throw new Error("Invalid restore journal.");
  const record = data as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !["prepared", "ready", "applied"].includes(String(record.phase)) ||
    typeof record.databasePath !== "string" ||
    typeof record.stagedDatabasePath !== "string" ||
    typeof record.stagedManifestPath !== "string" ||
    typeof record.backupId !== "string" ||
    typeof record.preRestoreId !== "string"
  )
    throw new Error("Invalid restore journal.");
  return record as RestoreJournal;
}

function assertRegularFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Restore file must be a regular file.");
}

function removeRegular(path: string): void {
  try {
    assertRegularFile(path);
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return;
    throw error;
  }
  rmSync(path);
}

function removeLiveSidecars(databasePath: string): void {
  removeRegular(`${databasePath}-wal`);
  removeRegular(`${databasePath}-shm`);
  syncDirectory(dirname(databasePath));
}

function removeRestoreJournal(databasePath: string): void {
  removeRegular(restoreJournalPath(databasePath));
  syncDirectory(dirname(resolve(databasePath)));
}

function atomicWriteJson(path: string, value: unknown): void {
  const temporary = `${path}.tmp-${crypto.randomUUID()}`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    syncFile(temporary);
    renameSync(temporary, path);
    syncDirectory(dirname(path));
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function syncFile(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function syncDirectory(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } catch (error) {
    if (
      !["EINVAL", "ENOTSUP"].includes((error as { code?: string }).code ?? "")
    )
      throw error;
  } finally {
    closeSync(descriptor);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordResult(
  journal: RestoreJournal,
  state: "restored" | "failed",
  error?: string,
): void {
  atomicWriteJson(`${journal.databasePath}.restore-result.json`, {
    state,
    at: new Date().toISOString(),
    backupId: journal.backupId,
    preRestoreId: journal.preRestoreId,
    ...(error ? { error } : {}),
  });
}
