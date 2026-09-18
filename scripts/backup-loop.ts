import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

import { checkFactoryDatabase } from "../src/application";
import { verifyFactorySnapshot } from "../src/backup-snapshot";

const DEFAULT_DATABASE_PATH = "/data/factory.sqlite";
const DEFAULT_BACKUP_DIRECTORY = "/backups";
const DEFAULT_SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
const DEFAULT_SNAPSHOT_TIMEOUT_MS = 20 * 1000;
const DEFAULT_SNAPSHOT_SCRIPT = join(import.meta.dir, "backup-snapshot.ts");

const LATEST_DIRECTORY_NAME = "latest";
const PREVIOUS_DIRECTORY_NAME = "previous";
const TEMPORARY_DIRECTORY_PREFIX = ".snapshot-";
const STAGING_DIRECTORY_PREFIX = ".publish-";

export type SnapshotLoopLogger = {
  info: (message: string) => void;
  error: (message: string) => void;
};

export type SnapshotInvocation = {
  databasePath: string;
  outputPath: string;
  snapshotScript: string;
  timeoutMs: number;
};

export type SnapshotRunner = (invocation: SnapshotInvocation) => Promise<void>;

export type BackupLoopOptions = {
  databasePath?: string;
  backupDirectory?: string;
  snapshotScript?: string;
  intervalMs?: number;
  maxAgeMs?: number;
  snapshotTimeoutMs?: number;
  logger?: SnapshotLoopLogger;
  runSnapshot?: SnapshotRunner;
};

export type PublishedSnapshot = {
  databasePath: string;
  manifestPath: string;
  publishedAt: string;
  generationDirectory: string;
};

export type SnapshotHealth = {
  databasePath: string;
  manifestPath: string;
  ageMs: number;
  maxAgeMs: number;
  integrity: "ok";
};

export type BackupLoopController = {
  promise: Promise<void>;
  stop: () => void;
};

const defaultLogger: SnapshotLoopLogger = {
  info(message) {
    console.log(`[backup-loop] ${message}`);
  },
  error(message) {
    console.error(`[backup-loop] ${message}`);
  },
};

export function manifestPathForDatabase(databasePath: string): string {
  return `${databasePath}.manifest.json`;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer; received ${value}.`);
  }
  return value;
}

function resolveOptions(options: BackupLoopOptions = {}) {
  return {
    databasePath: resolve(
      options.databasePath ?? process.env.FACTORY_DB ?? DEFAULT_DATABASE_PATH,
    ),
    backupDirectory: resolve(
      options.backupDirectory ??
        process.env.FACTORY_BACKUP_DIR ??
        process.env.BACKUP_DIR ??
        DEFAULT_BACKUP_DIRECTORY,
    ),
    snapshotScript: resolve(
      options.snapshotScript ??
        process.env.FACTORY_SNAPSHOT_SCRIPT ??
        DEFAULT_SNAPSHOT_SCRIPT,
    ),
    intervalMs: positiveInteger(
      options.intervalMs ??
        parseConfiguredInteger(
          process.env.FACTORY_SNAPSHOT_INTERVAL_MS ??
            process.env.BACKUP_INTERVAL_MS,
          DEFAULT_SNAPSHOT_INTERVAL_MS,
          "FACTORY_SNAPSHOT_INTERVAL_MS",
        ),
      "intervalMs",
    ),
    maxAgeMs: positiveInteger(
      options.maxAgeMs ??
        parseConfiguredInteger(
          process.env.FACTORY_SNAPSHOT_MAX_AGE_MS,
          DEFAULT_SNAPSHOT_MAX_AGE_MS,
          "FACTORY_SNAPSHOT_MAX_AGE_MS",
        ),
      "maxAgeMs",
    ),
    snapshotTimeoutMs: positiveInteger(
      options.snapshotTimeoutMs ??
        parseConfiguredInteger(
          process.env.FACTORY_SNAPSHOT_TIMEOUT_MS,
          DEFAULT_SNAPSHOT_TIMEOUT_MS,
          "FACTORY_SNAPSHOT_TIMEOUT_MS",
        ),
      "snapshotTimeoutMs",
    ),
    logger: options.logger ?? defaultLogger,
    runSnapshot: options.runSnapshot ?? runSnapshotCommand,
  };
}

function parseConfiguredInteger(
  configured: string | undefined,
  fallback: number,
  name: string,
): number {
  if (configured === undefined || configured.trim() === "") return fallback;
  const value = Number(configured);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive integer; received ${JSON.stringify(configured)}.`,
    );
  }
  return value;
}

async function runSnapshotCommand(
  invocation: SnapshotInvocation,
): Promise<void> {
  const child = Bun.spawn(
    [
      process.execPath,
      invocation.snapshotScript,
      "backup",
      "--database",
      invocation.databasePath,
      "--output",
      invocation.outputPath,
    ],
    {
      cwd: dirname(invocation.snapshotScript),
      stdout: "pipe",
      stderr: "pipe",
    },
  );

  const stdoutPromise = child.stdout
    ? new Response(child.stdout).text()
    : Promise.resolve("");
  const stderrPromise = child.stderr
    ? new Response(child.stderr).text()
    : Promise.resolve("");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const exitCode = await Promise.race([
      child.exited,
      new Promise<number>((_, reject) => {
        timeout = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // The process may have exited between the timeout and kill call;
            // waiting on exited below still closes the race before returning.
          }
          void child.exited.then(
            () =>
              reject(
                new Error(
                  `snapshot command exceeded ${invocation.timeoutMs}ms and was terminated`,
                ),
              ),
            (error) => reject(error),
          );
        }, invocation.timeoutMs);
      }),
    ]);
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
    if (exitCode !== 0) {
      const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join("; ");
      throw new Error(
        `snapshot command exited with code ${exitCode}${detail ? `: ${detail}` : ""}`,
      );
    }
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function generationPaths(backupDirectory: string, generationDirectory: string) {
  const databasePath = join(generationDirectory, "factory.sqlite");
  return {
    generationDirectory,
    databasePath,
    manifestPath: manifestPathForDatabase(databasePath),
    latestDirectory: join(backupDirectory, LATEST_DIRECTORY_NAME),
    previousDirectory: join(backupDirectory, PREVIOUS_DIRECTORY_NAME),
  };
}

function readManifest(manifestPath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`snapshot manifest is not valid JSON: ${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("snapshot manifest must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function validateManifest(manifestPath: string): Record<string, unknown> {
  return readManifest(manifestPath);
}

function validateGeneration(
  generationDirectory: string,
): ReturnType<typeof checkFactoryDatabase> {
  const { databasePath, manifestPath } = generationPaths(
    dirname(generationDirectory),
    generationDirectory,
  );
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    throw new Error(`snapshot database was not produced: ${databasePath}`);
  }
  if (statSync(databasePath).size <= 0) {
    throw new Error(`snapshot database is empty: ${databasePath}`);
  }
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    throw new Error(`snapshot manifest was not produced: ${manifestPath}`);
  }
  if (statSync(manifestPath).size <= 0) {
    throw new Error(`snapshot manifest is empty: ${manifestPath}`);
  }
  validateManifest(manifestPath);
  const validation = checkFactoryDatabase({
    databasePath,
    requireSnapshot: true,
  });
  verifyFactorySnapshot({ databasePath, manifestPath });
  return validation;
}

/**
 * A process crash can occur after latest has been moved to previous but before
 * the new generation is moved into latest. Recovering that prior directory on
 * startup keeps the service useful and makes the archive's restore target
 * unambiguous.
 */
function recoverMissingLatest(
  backupDirectory: string,
  logger: SnapshotLoopLogger,
): void {
  const latestDirectory = join(backupDirectory, LATEST_DIRECTORY_NAME);
  const previousDirectory = join(backupDirectory, PREVIOUS_DIRECTORY_NAME);
  if (existsSync(latestDirectory) || !existsSync(previousDirectory)) return;
  try {
    validateGeneration(previousDirectory);
    renameSync(previousDirectory, latestDirectory);
    logger.info(
      "recovered latest snapshot from previous after an interrupted publish",
    );
  } catch (error) {
    logger.error(
      `could not recover previous snapshot as latest: ${describeError(error)}`,
    );
  }
}

function removeIfPresent(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true, recursive: true });
}

/**
 * Move a validated generation into the published pair while retaining one
 * previous generation. Rollback restores the old layout if a rename fails.
 */
function publishGeneration(
  backupDirectory: string,
  generationDirectory: string,
  publishedAt: Date,
): PublishedSnapshot {
  const paths = generationPaths(backupDirectory, generationDirectory);
  const publishStagingDirectory = join(
    backupDirectory,
    `${STAGING_DIRECTORY_PREFIX}${randomUUID()}`,
  );
  let oldPreviousMoved = false;
  let oldLatestMoved = false;
  let generationMoved = false;

  try {
    // Keep the manifest mtime aligned with publication for operators inspecting
    // the volume; healthcheck uses the manifest's createdAt when available.
    utimesSync(paths.manifestPath, publishedAt, publishedAt);

    if (existsSync(paths.previousDirectory)) {
      renameSync(paths.previousDirectory, publishStagingDirectory);
      oldPreviousMoved = true;
    }
    if (existsSync(paths.latestDirectory)) {
      renameSync(paths.latestDirectory, paths.previousDirectory);
      oldLatestMoved = true;
    }
    renameSync(generationDirectory, paths.latestDirectory);
    generationMoved = true;

    if (oldPreviousMoved) removeIfPresent(publishStagingDirectory);
    return {
      databasePath: join(paths.latestDirectory, "factory.sqlite"),
      manifestPath: manifestPathForDatabase(
        join(paths.latestDirectory, "factory.sqlite"),
      ),
      publishedAt: publishedAt.toISOString(),
      generationDirectory: paths.latestDirectory,
    };
  } catch (error) {
    // Restore the prior pair where possible. A failed generation is never
    // allowed to replace the last good latest directory.
    if (generationMoved && existsSync(paths.latestDirectory)) {
      renameSync(paths.latestDirectory, generationDirectory);
    }
    if (oldLatestMoved && existsSync(paths.previousDirectory)) {
      renameSync(paths.previousDirectory, paths.latestDirectory);
    }
    if (oldPreviousMoved && existsSync(publishStagingDirectory)) {
      renameSync(publishStagingDirectory, paths.previousDirectory);
    }
    throw error;
  }
}

export async function runSnapshotOnce(
  options: BackupLoopOptions = {},
): Promise<PublishedSnapshot> {
  const resolved = resolveOptions(options);
  mkdirSync(resolved.backupDirectory, { recursive: true });
  recoverMissingLatest(resolved.backupDirectory, resolved.logger);
  const generationDirectory = join(
    resolved.backupDirectory,
    `${TEMPORARY_DIRECTORY_PREFIX}${Date.now()}-${randomUUID()}`,
  );
  mkdirSync(generationDirectory, { recursive: true });
  const outputPath = join(generationDirectory, "factory.sqlite");

  try {
    await resolved.runSnapshot({
      databasePath: resolved.databasePath,
      outputPath,
      snapshotScript: resolved.snapshotScript,
      timeoutMs: resolved.snapshotTimeoutMs,
    });
    const validation = validateGeneration(generationDirectory);
    const published = publishGeneration(
      resolved.backupDirectory,
      generationDirectory,
      new Date(),
    );
    resolved.logger.info(
      `published ${published.databasePath} (${validation.counts.projects} projects, ${validation.counts.tasks} tasks)`,
    );
    return published;
  } catch (error) {
    removeIfPresent(generationDirectory);
    throw error;
  }
}

export function checkSnapshotHealth(
  options: BackupLoopOptions = {},
): SnapshotHealth {
  const resolved = resolveOptions(options);
  const latestDirectory = join(resolved.backupDirectory, LATEST_DIRECTORY_NAME);
  const databasePath = join(latestDirectory, "factory.sqlite");
  const manifestPath = manifestPathForDatabase(databasePath);
  if (!existsSync(latestDirectory)) {
    throw new Error(`no published snapshot exists: ${latestDirectory}`);
  }
  const validation = validateGeneration(latestDirectory);
  const manifest = readManifest(manifestPath);
  const createdAt =
    typeof manifest.createdAt === "string"
      ? Date.parse(manifest.createdAt)
      : Number.NaN;
  const timestampMs = Number.isFinite(createdAt)
    ? createdAt
    : statSync(manifestPath).mtimeMs;
  const ageMs = Math.max(0, Date.now() - timestampMs);
  if (ageMs > resolved.maxAgeMs) {
    throw new Error(
      `latest snapshot is stale: age ${Math.round(ageMs / 1000)}s exceeds ${Math.round(resolved.maxAgeMs / 1000)}s`,
    );
  }
  return {
    ageMs,
    databasePath,
    integrity: validation.integrity,
    manifestPath,
    maxAgeMs: resolved.maxAgeMs,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleepUntilWake(
  delayMs: number,
  registerWake: (wake: () => void) => void,
): Promise<void> {
  return new Promise((resolvePromise) => {
    const timer = setTimeout(resolvePromise, delayMs);
    registerWake(() => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}

export function startBackupLoop(
  options: BackupLoopOptions = {},
): BackupLoopController {
  const resolved = resolveOptions(options);
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };

  const promise = (async () => {
    recoverMissingLatest(resolved.backupDirectory, resolved.logger);
    resolved.logger.info(
      `starting; database=${resolved.databasePath}, directory=${resolved.backupDirectory}, interval=${resolved.intervalMs}ms`,
    );
    while (true) {
      try {
        await runSnapshotOnce(resolved);
      } catch (error) {
        resolved.logger.error(`snapshot failed: ${describeError(error)}`);
        try {
          const health = checkSnapshotHealth(resolved);
          resolved.logger.error(
            `retaining last good snapshot; latest age=${Math.round(health.ageMs / 1000)}s`,
          );
        } catch (healthError) {
          resolved.logger.error(
            `no usable prior snapshot: ${describeError(healthError)}`,
          );
        }
      }
      if (stopping) break;
      await sleepUntilWake(resolved.intervalMs, (nextWake) => {
        wake = nextWake;
      });
      wake = undefined;
      if (stopping) break;
    }
    resolved.logger.info("stopped after the current snapshot completed");
  })();

  return { promise, stop };
}

type CliMode = "run" | "once" | "healthcheck";

function parseCli(argv: string[]): {
  mode: CliMode;
  options: BackupLoopOptions;
} {
  let mode: CliMode = "run";
  let index = 0;
  if (argv[0] === "once" || argv[0] === "healthcheck") {
    mode = argv[0];
    index = 1;
  }
  const options: BackupLoopOptions = {};
  while (index < argv.length) {
    const argument = argv[index++];
    const value = argv[index++];
    if (!value) throw new Error(`missing value for ${argument}`);
    switch (argument) {
      case "--database":
        options.databasePath = value;
        break;
      case "--directory":
      case "--backup-directory":
        options.backupDirectory = value;
        break;
      case "--snapshot-script":
        options.snapshotScript = value;
        break;
      case "--interval-ms":
        options.intervalMs = Number(value);
        break;
      case "--max-age-ms":
        options.maxAgeMs = Number(value);
        break;
      case "--timeout-ms":
        options.snapshotTimeoutMs = Number(value);
        break;
      default:
        throw new Error(`unknown argument: ${argument}`);
    }
  }
  return { mode, options };
}

async function main(): Promise<void> {
  const { mode, options } = parseCli(Bun.argv.slice(2));
  if (mode === "once") {
    await runSnapshotOnce(options);
    return;
  }
  if (mode === "healthcheck") {
    const health = checkSnapshotHealth(options);
    console.log(
      `[backup-loop] healthy; latest age=${Math.round(health.ageMs / 1000)}s, database=${health.databasePath}`,
    );
    return;
  }

  const controller = startBackupLoop(options);
  const requestShutdown = () => controller.stop();
  process.once("SIGTERM", requestShutdown);
  process.once("SIGINT", requestShutdown);
  try {
    await controller.promise;
  } finally {
    process.off("SIGTERM", requestShutdown);
    process.off("SIGINT", requestShutdown);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`[backup-loop] fatal: ${describeError(error)}`);
    process.exitCode = 1;
  });
}
