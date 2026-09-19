import {
  chmodSync,
  closeSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  backupFactoryDatabase,
  createFactoryApplication,
  type FactoryDatabaseBackup,
} from "../src/application";
import { inspectFactoryDatabase } from "../src/backup-snapshot";
import { createHumanSessionStore } from "../src/human-session";
import { createMachineCredentialStore } from "../src/machine-credential";

const MACHINE_IDS = ["mac-mini", "agent-ubuntu"] as const;

export type PilotCopyOptions = {
  sourceDatabasePath: string;
  destinationDatabasePath: string;
  projectId: string;
  tokenDirectory: string;
  confirmIsolatedPilot: true;
};

type RecordSummary = {
  counts: Record<string, number>;
  totalCount: number;
  idHash: string;
  contentHash: string;
  history: Record<
    string,
    {
      count: number;
      idHash: string;
      contentHash: string;
    }
  >;
  protectedState: {
    idempotencyReceipts: {
      present: boolean;
      count: number;
      contentHash: string;
    };
  };
};

export type PilotCopyResult = {
  backup: FactoryDatabaseBackup;
  revokedMachineIds: string[];
  credentials: Array<{
    id: string;
    machineId: (typeof MACHINE_IDS)[number];
    projectIds: string[];
    tokenPath: string;
  }>;
  recordComparison: {
    source: RecordSummary;
    destination: RecordSummary;
    match: true;
    credentialRowsExcluded: true;
    protectedState: {
      beforeRotation: RecordSummary["protectedState"];
      afterRotation: RecordSummary["protectedState"];
      excludedTables: ["factory_machine_credentials", "factory_sessions"];
      match: true;
    };
  };
};

const USAGE =
  "Usage: bun scripts/prepare-pilot-copy.ts --source-database /absolute/source.sqlite --destination-database /absolute/new-copy.sqlite --project-id PROJECT_ID --token-dir /absolute/new-private-dir --confirm-isolated-pilot";

function fail(message: string): never {
  throw new Error(message);
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function requiredValue(argv: string[], index: number, option: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${option} requires a value.`);
  }
  return value;
}

function assignOnce(
  current: string | undefined,
  value: string,
  option: string,
): string {
  if (current !== undefined) fail(`${option} may only be provided once.`);
  return value;
}

function absolutePath(value: string, option: string): string {
  if (!isAbsolute(value)) fail(`${option} must be an absolute path.`);
  return resolve(value);
}

export function parsePilotCopyOptions(argv: string[]): PilotCopyOptions {
  let sourceDatabasePath: string | undefined;
  let destinationDatabasePath: string | undefined;
  let projectId: string | undefined;
  let tokenDirectory: string | undefined;
  let confirmIsolatedPilot = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--source-database":
      case "--source":
        sourceDatabasePath = assignOnce(
          sourceDatabasePath,
          requiredValue(argv, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--destination-database":
      case "--destination":
        destinationDatabasePath = assignOnce(
          destinationDatabasePath,
          requiredValue(argv, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--project-id":
        projectId = assignOnce(
          projectId,
          requiredValue(argv, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--token-dir":
      case "--output-dir":
      case "--credentials-dir":
        tokenDirectory = assignOnce(
          tokenDirectory,
          requiredValue(argv, index, argument),
          argument,
        );
        index += 1;
        break;
      case "--confirm-isolated-pilot":
        if (confirmIsolatedPilot) {
          fail("--confirm-isolated-pilot may only be provided once.");
        }
        confirmIsolatedPilot = true;
        break;
      case "--help":
      case "-h":
        fail(USAGE);
      default:
        fail(`Unknown argument: ${argument}\n${USAGE}`);
    }
  }

  if (!sourceDatabasePath)
    fail(`Missing required --source-database.\n${USAGE}`);
  if (!destinationDatabasePath)
    fail(`Missing required --destination-database.\n${USAGE}`);
  if (!projectId?.trim()) fail("Missing required --project-id.");
  if (!tokenDirectory) fail(`Missing required --token-dir.\n${USAGE}`);
  if (!confirmIsolatedPilot) {
    fail("Refusing to prepare a pilot copy without --confirm-isolated-pilot.");
  }

  return {
    sourceDatabasePath: absolutePath(sourceDatabasePath, "--source-database"),
    destinationDatabasePath: absolutePath(
      destinationDatabasePath,
      "--destination-database",
    ),
    projectId: projectId.trim(),
    tokenDirectory: absolutePath(tokenDirectory, "--token-dir"),
    confirmIsolatedPilot: true,
  };
}

function assertNoFactoryUrl(): void {
  if (process.env.FACTORY_URL?.trim()) {
    fail(
      "FACTORY_URL must be unset; this preparation command only supports explicit local database paths.",
    );
  }
}

function assertSourceAndDestinations(options: PilotCopyOptions): void {
  if (!isAbsolute(options.sourceDatabasePath)) {
    fail("--source-database must be an absolute path.");
  }
  if (!isAbsolute(options.destinationDatabasePath)) {
    fail("--destination-database must be an absolute path.");
  }
  if (!isAbsolute(options.tokenDirectory)) {
    fail("--token-dir must be an absolute path.");
  }
  if (!pathExists(options.sourceDatabasePath)) {
    fail(`Source database does not exist: ${options.sourceDatabasePath}`);
  }
  if (!statSync(options.sourceDatabasePath).isFile()) {
    fail(`Source database is not a file: ${options.sourceDatabasePath}`);
  }
  if (options.sourceDatabasePath === options.destinationDatabasePath) {
    fail("Source and destination database paths must differ.");
  }

  for (const path of [
    options.destinationDatabasePath,
    `${options.destinationDatabasePath}-wal`,
    `${options.destinationDatabasePath}-shm`,
  ]) {
    if (pathExists(path)) {
      fail(`Refusing an existing destination path: ${path}`);
    }
  }
  if (pathExists(options.tokenDirectory)) {
    fail(`Refusing an existing token directory: ${options.tokenDirectory}`);
  }
  if (!pathExists(dirname(options.tokenDirectory))) {
    fail(
      `Token directory parent does not exist: ${dirname(options.tokenDirectory)}`,
    );
  }
}

function summaryFor(
  inspection: ReturnType<typeof inspectFactoryDatabase>,
): RecordSummary {
  const counts = Object.fromEntries(
    Object.entries(inspection.state.collections).map(([name, summary]) => [
      name,
      summary.count,
    ]),
  );
  return {
    counts,
    totalCount: Object.values(counts).reduce(
      (total, count) => total + count,
      0,
    ),
    idHash: inspection.state.durableIdsDigest,
    contentHash: inspection.state.contentDigest,
    history: Object.fromEntries(
      Object.entries(inspection.state.history).map(([name, summary]) => [
        name,
        {
          count: summary.count,
          idHash: summary.idsDigest,
          contentHash: summary.contentDigest,
        },
      ]),
    ),
    protectedState: {
      idempotencyReceipts: {
        present:
          inspection.protectedTables.factory_idempotency_receipts.present,
        count: inspection.protectedTables.factory_idempotency_receipts.count,
        contentHash:
          inspection.protectedTables.factory_idempotency_receipts.contentDigest,
      },
    },
  };
}

function summariesMatch(left: RecordSummary, right: RecordSummary): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function writeTokenExclusive(path: string, token: string): void {
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(path, "wx", 0o600);
    created = true;
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, `${token}\n`, "utf8");
    chmodSync(path, 0o600);
  } catch (error) {
    if (created) {
      try {
        unlinkSync(path);
      } catch {
        // Preserve the original write error.
      }
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function prepareTokenDirectory(path: string): void {
  mkdirSync(path, { mode: 0o700 });
  chmodSync(path, 0o700);
}

export function preparePilotCopy(options: PilotCopyOptions): PilotCopyResult {
  assertNoFactoryUrl();
  if (!options.confirmIsolatedPilot) {
    fail("Refusing to prepare a pilot copy without --confirm-isolated-pilot.");
  }
  assertSourceAndDestinations(options);

  const backup = backupFactoryDatabase({
    databasePath: options.sourceDatabasePath,
    destinationPath: options.destinationDatabasePath,
  });
  // The backup API has produced the stable source snapshot. Inspect that
  // destination before any credential rotation; the live source may continue
  // to receive legitimate writes while this preparation is running.
  const destinationBeforeRotation = summaryFor(
    inspectFactoryDatabase({ databasePath: options.destinationDatabasePath }),
  );

  const destinationApplication = createFactoryApplication({
    databasePath: options.destinationDatabasePath,
    refreshBeforeOperations: false,
  });
  try {
    if (
      !destinationApplication
        .listProjects()
        .some((project) => project.id === options.projectId)
    ) {
      fail(
        `Project ${options.projectId} does not exist in the copied Factory database.`,
      );
    }
  } finally {
    destinationApplication.close();
  }

  const humanSessions = createHumanSessionStore({
    databasePath: options.destinationDatabasePath,
  });
  try {
    humanSessions.invalidateAll();
  } finally {
    humanSessions.close();
  }

  prepareTokenDirectory(options.tokenDirectory);
  const machineCredentials = createMachineCredentialStore({
    databasePath: options.destinationDatabasePath,
  });
  const createdCredentials: PilotCopyResult["credentials"] = [];
  const revokedMachineIds: string[] = [];
  try {
    for (const credential of machineCredentials.list()) {
      if (!credential.revokedAt) {
        machineCredentials.revoke(credential.machineId);
        revokedMachineIds.push(credential.machineId);
      }
    }

    for (const machineId of MACHINE_IDS) {
      const credential = machineCredentials.create({
        machineId,
        projectIds: [options.projectId],
      });
      const tokenPath = resolve(options.tokenDirectory, `${machineId}.token`);
      writeTokenExclusive(tokenPath, credential.token);
      createdCredentials.push({
        id: credential.id,
        machineId,
        projectIds: credential.projectIds,
        tokenPath,
      });
    }
  } finally {
    machineCredentials.close();
  }

  const destination = summaryFor(
    inspectFactoryDatabase({ databasePath: options.destinationDatabasePath }),
  );
  if (!summariesMatch(destinationBeforeRotation, destination)) {
    fail(
      "Copied Factory record counts, ID hash, content, or history digests changed during credential rotation; the copy is unsafe to use.",
    );
  }

  return {
    backup,
    revokedMachineIds,
    credentials: createdCredentials,
    recordComparison: {
      source: destinationBeforeRotation,
      destination,
      match: true,
      credentialRowsExcluded: true,
      protectedState: {
        beforeRotation: destinationBeforeRotation.protectedState,
        afterRotation: destination.protectedState,
        excludedTables: ["factory_machine_credentials", "factory_sessions"],
        match: true,
      },
    },
  };
}

export function redactPilotCopyResult(result: PilotCopyResult): string {
  // Keep the helper intentionally explicit: credential tokens are never part
  // of the result, and therefore can never reach JSON stdout.
  return JSON.stringify(result);
}

function main(argv: string[]): void {
  const options = parsePilotCopyOptions(argv);
  const result = preparePilotCopy(options);
  process.stdout.write(`${redactPilotCopyResult(result)}\n`);
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
