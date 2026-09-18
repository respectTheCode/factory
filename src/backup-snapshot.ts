import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fchmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { Database } from "bun:sqlite";

export const BACKUP_MANIFEST_VERSION = 1 as const;
export const FACTORY_SNAPSHOT_SCHEMA_VERSION = 1 as const;

const STATE_COLLECTIONS = [
  "projects",
  "tasks",
  "subtasks",
  "statusReports",
  "verifications",
  "trackerLinks",
  "runs",
  "codeSessions",
  "codeSessionAssociations",
  "codeSessionObservations",
  "sessionEvidence",
  "reconciliationFindings",
] as const;

const HISTORY_COLLECTIONS = ["statusReports", "verifications"] as const;

const REQUIRED_STATE_COLLECTIONS = [
  "projects",
  "tasks",
  "subtasks",
  "statusReports",
  "verifications",
] as const;

const PROTECTED_TABLES = [
  "factory_machine_credentials",
  "factory_sessions",
  "factory_idempotency_receipts",
] as const;

type StateCollectionName = (typeof STATE_COLLECTIONS)[number];
type HistoryCollectionName = (typeof HISTORY_COLLECTIONS)[number];
type ProtectedTableName = (typeof PROTECTED_TABLES)[number];

export type SnapshotCollectionSummary = {
  count: number;
  ids: string[];
  idsDigest: string;
  contentDigest: string;
};

export type SnapshotProtectedTableSummary = {
  present: boolean;
  count: number;
  contentDigest: string;
};

export type FactorySnapshotManifest = {
  manifestVersion: typeof BACKUP_MANIFEST_VERSION;
  createdAt: string;
  snapshot: {
    sha256: string;
    sizeBytes: number;
    integrity: "ok";
  };
  schema: {
    snapshotSchemaVersion: typeof FACTORY_SNAPSHOT_SCHEMA_VERSION;
    sqliteVersion: string;
    sqliteUserVersion: number;
    objectsDigest: string;
    tables: string[];
  };
  runtime: {
    bunVersion: string;
    platform: string;
    arch: string;
    revision?: string;
  };
  state: {
    contentDigest: string;
    durableIdsDigest: string;
    collections: Record<StateCollectionName, SnapshotCollectionSummary>;
    history: Record<HistoryCollectionName, SnapshotCollectionSummary>;
  };
  protectedTables: Record<ProtectedTableName, SnapshotProtectedTableSummary>;
};

export type FactorySnapshotInspection = Omit<
  FactorySnapshotManifest,
  "manifestVersion" | "createdAt" | "snapshot"
> & {
  integrity: "ok";
};

export type FactorySnapshotBackupResult = {
  databasePath: string;
  snapshotPath: string;
  manifestPath: string;
  manifest: FactorySnapshotManifest;
};

export type FactorySnapshotVerifyResult = {
  databasePath: string;
  manifestPath: string;
  verified: true;
  manifest: FactorySnapshotManifest;
};

type RawRecord = Record<string, unknown>;

/**
 * The manifest contains only hashes, IDs, counts, and runtime metadata. It is
 * deliberately safe to print or move with the backup; token and session
 * values are never selected into it.
 */
export function inspectFactoryDatabase({
  databasePath,
}: {
  databasePath: string;
}): FactorySnapshotInspection {
  const resolvedDatabasePath = resolveDatabasePath(databasePath);
  requireExistingPath(resolvedDatabasePath, "Database");

  const database = openReadonlyDatabase(resolvedDatabasePath);
  let readTransaction = false;
  try {
    database.exec("BEGIN");
    readTransaction = true;
    return inspectOpenDatabase(database);
  } finally {
    if (readTransaction) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Closing the read-only handle below is still safe if rollback itself
        // fails after an SQLite error.
      }
    }
    database.close();
  }
}

/**
 * Capture a consistent online SQLite snapshot and its manifest. VACUUM INTO
 * obtains a read snapshot from the source connection; the staged file is
 * validated before it is published as the requested write-once target.
 */
export function backupFactorySnapshot({
  databasePath,
  outputPath,
  manifestPath = `${resolve(outputPath)}.manifest.json`,
}: {
  databasePath: string;
  outputPath: string;
  manifestPath?: string;
}): FactorySnapshotBackupResult {
  const sourcePath = resolveDatabasePath(databasePath);
  const snapshotPath = resolve(outputPath);
  const resolvedManifestPath = resolve(manifestPath);

  if (sourcePath === snapshotPath || sourcePath === resolvedManifestPath) {
    throw new Error(
      "Backup destinations must differ from the source database.",
    );
  }
  if (snapshotPath === resolvedManifestPath) {
    throw new Error("Snapshot and manifest paths must be different.");
  }
  requireExistingPath(sourcePath, "Database");
  refuseExistingPath(snapshotPath, "Snapshot destination");
  refuseExistingPath(resolvedManifestPath, "Manifest destination");

  mkdirSync(dirname(snapshotPath), { recursive: true, mode: 0o700 });
  mkdirSync(dirname(resolvedManifestPath), { recursive: true, mode: 0o700 });

  const temporaryDirectory = mkdtempSync(
    join(dirname(snapshotPath), ".factory-snapshot-"),
  );
  const temporaryPath = join(temporaryDirectory, "snapshot.sqlite");
  const database = openReadonlyDatabase(sourcePath);
  let snapshotCreated = false;
  let manifestCreated = false;
  try {
    requireFactoryStateTable(database);
    // VACUUM INTO takes its own consistent read snapshot. It works from a
    // read-only connection, including while a live WAL writer is connected,
    // and produces a standalone rollback-journal database.
    database.exec(`VACUUM INTO ${sqlStringLiteral(temporaryPath)}`);
    database.close();

    chmodSync(temporaryPath, 0o600);
    const inspection = inspectFactoryDatabase({
      databasePath: temporaryPath,
    });
    const stagedSnapshot = readFileSync(temporaryPath);
    const snapshotSha256 = digestBytes(stagedSnapshot);

    // Publishing a hard link is exclusive on the same filesystem: a race that
    // creates the requested target fails without replacing that other file.
    linkSync(temporaryPath, snapshotPath);
    chmodSync(snapshotPath, 0o600);
    snapshotCreated = true;
    const writtenSnapshot = readFileSync(snapshotPath);
    if (digestBytes(writtenSnapshot) !== snapshotSha256) {
      throw new Error("Snapshot bytes changed while being written.");
    }
    const writtenInspection = inspectFactoryDatabase({
      databasePath: snapshotPath,
    });
    if (!sameInspection(inspection, writtenInspection)) {
      throw new Error("Snapshot content changed while being written.");
    }

    const manifest: FactorySnapshotManifest = {
      createdAt: new Date().toISOString(),
      manifestVersion: BACKUP_MANIFEST_VERSION,
      runtime: inspection.runtime,
      schema: inspection.schema,
      snapshot: {
        integrity: "ok",
        sha256: snapshotSha256,
        sizeBytes: writtenSnapshot.byteLength,
      },
      state: inspection.state,
      protectedTables: inspection.protectedTables,
    };
    writeExclusive(
      resolvedManifestPath,
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    );
    manifestCreated = true;
    return {
      databasePath: sourcePath,
      manifest,
      manifestPath: resolvedManifestPath,
      snapshotPath,
    };
  } catch (error) {
    if (manifestCreated) safelyUnlink(resolvedManifestPath);
    if (snapshotCreated) safelyUnlink(snapshotPath);
    throw error;
  } finally {
    try {
      database.close();
    } catch {
      // The source handle may already be closed after VACUUM INTO.
    }
    rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

/**
 * Verify both the byte-level snapshot checksum and the logical durable records
 * represented by a saved manifest. A changed or missing record therefore
 * fails even when the caller only needs the logical comparison details.
 */
export function verifyFactorySnapshot({
  databasePath,
  manifestPath,
}: {
  databasePath: string;
  manifestPath: string;
}): FactorySnapshotVerifyResult {
  const resolvedDatabasePath = resolveDatabasePath(databasePath);
  const resolvedManifestPath = resolve(manifestPath);
  requireExistingPath(resolvedDatabasePath, "Database");
  requireExistingPath(resolvedManifestPath, "Manifest");

  const manifest = readManifest(resolvedManifestPath);
  const bytes = readFileSync(resolvedDatabasePath);
  if (bytes.byteLength !== manifest.snapshot.sizeBytes) {
    throw new Error("Snapshot size does not match the manifest.");
  }
  if (digestBytes(bytes) !== manifest.snapshot.sha256) {
    throw new Error("Snapshot checksum does not match the manifest.");
  }

  const inspection = inspectFactoryDatabase({
    databasePath: resolvedDatabasePath,
  });
  const differences = compareInspection(manifest, inspection);
  if (differences.length > 0) {
    throw new Error(
      `Snapshot content does not match the manifest: ${differences.join(", ")}.`,
    );
  }

  return {
    databasePath: resolvedDatabasePath,
    manifest,
    manifestPath: resolvedManifestPath,
    verified: true,
  };
}

export function defaultManifestPath(outputPath: string): string {
  return `${resolve(outputPath)}.manifest.json`;
}

function inspectOpenDatabase(database: Database): FactorySnapshotInspection {
  const integrityResult = database.query("PRAGMA integrity_check").get() as {
    integrity_check?: unknown;
  } | null;
  if (integrityResult?.integrity_check !== "ok") {
    throw new Error(
      `SQLite integrity check failed: ${String(integrityResult?.integrity_check ?? "no result")}`,
    );
  }

  requireFactoryStateTable(database);

  const stateRow = database
    .query("SELECT state FROM factory_state WHERE id = 1")
    .get() as { state?: unknown } | null;
  if (!stateRow || typeof stateRow.state !== "string") {
    throw new Error(
      "Factory database has no persisted factory_state snapshot.",
    );
  }

  let state: RawRecord;
  try {
    const parsed: unknown = JSON.parse(stateRow.state);
    if (!isRecord(parsed)) throw new Error("snapshot must be a JSON object");
    state = parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Factory state snapshot is corrupt: ${detail}`);
  }

  const collections = {} as Record<
    StateCollectionName,
    SnapshotCollectionSummary
  >;
  for (const name of STATE_COLLECTIONS) {
    const value = state[name];
    if (
      value === undefined &&
      (REQUIRED_STATE_COLLECTIONS as readonly string[]).includes(name)
    ) {
      throw new Error(`Persisted collection is missing: ${name}.`);
    }
    const optionalEmpty =
      value === undefined ||
      (value === null &&
        !(REQUIRED_STATE_COLLECTIONS as readonly string[]).includes(name));
    const records = optionalEmpty ? [] : requireRecordArray(name, value);
    collections[name] = summarizeCollection(records);
  }

  if (
    "schemaVersion" in state &&
    state.schemaVersion !== FACTORY_SNAPSHOT_SCHEMA_VERSION
  ) {
    throw new Error("Persisted snapshot schemaVersion is unsupported.");
  }

  const history = {} as Record<
    HistoryCollectionName,
    SnapshotCollectionSummary
  >;
  for (const name of HISTORY_COLLECTIONS) history[name] = collections[name];

  const durableIds = Object.fromEntries(
    STATE_COLLECTIONS.map((name) => [name, collections[name].ids]),
  );
  const stateContentDigest = digestCanonical(state);
  const objects = database
    .query(
      `SELECT type, name, tbl_name AS tblName, sql
         FROM sqlite_master
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name`,
    )
    .all() as Array<Record<string, unknown>>;
  const objectRows = objects.map((object) => ({
    name: object.name,
    sql: object.sql,
    tblName: object.tblName,
    type: object.type,
  }));
  const tableNames = objectRows
    .filter((object) => object.type === "table")
    .map((object) => String(object.name))
    .sort();
  const protectedTables = {} as Record<
    ProtectedTableName,
    SnapshotProtectedTableSummary
  >;
  for (const table of PROTECTED_TABLES) {
    const present = tableNames.includes(table);
    const rows = present
      ? (database.query(`SELECT * FROM "${table}"`).all() as RawRecord[])
      : [];
    protectedTables[table] = {
      contentDigest: digestCanonical(
        rows
          .slice()
          .sort((left, right) =>
            canonicalJson(left).localeCompare(canonicalJson(right)),
          ),
      ),
      count: rows.length,
      present,
    };
  }

  const sqliteVersionRow = database
    .query("SELECT sqlite_version() AS sqliteVersion")
    .get() as { sqliteVersion?: unknown } | null;
  const userVersionRow = database.query("PRAGMA user_version").get() as {
    user_version?: unknown;
  } | null;
  const sqliteUserVersion = Number(userVersionRow?.user_version ?? 0);
  if (!Number.isInteger(sqliteUserVersion) || sqliteUserVersion < 0) {
    throw new Error("SQLite user_version is invalid.");
  }

  const revision = resolveBuildRevision();
  const runtime = {
    arch: process.arch,
    bunVersion: Bun.version,
    platform: process.platform,
    ...(revision ? { revision } : {}),
  };
  const schema = {
    objectsDigest: digestCanonical(objectRows),
    snapshotSchemaVersion: FACTORY_SNAPSHOT_SCHEMA_VERSION,
    sqliteUserVersion,
    sqliteVersion: String(sqliteVersionRow?.sqliteVersion ?? ""),
    tables: tableNames,
  };

  return {
    integrity: "ok",
    protectedTables,
    runtime,
    schema,
    state: {
      collections,
      contentDigest: stateContentDigest,
      durableIdsDigest: digestCanonical(durableIds),
      history,
    },
  };
}

function summarizeCollection(records: RawRecord[]): SnapshotCollectionSummary {
  const ids = records.map((record, index) => {
    if (typeof record.id !== "string" || !record.id) {
      throw new Error(`Persisted record at index ${index} has no string ID.`);
    }
    return record.id;
  });
  const sortedIds = ids.slice().sort();
  return {
    contentDigest: digestCanonical(records),
    count: records.length,
    ids: sortedIds,
    idsDigest: digestCanonical(sortedIds),
  };
}

function compareInspection(
  manifest: FactorySnapshotManifest,
  inspection: FactorySnapshotInspection,
): string[] {
  const differences: string[] = [];
  if (manifest.snapshot.integrity !== inspection.integrity)
    differences.push("snapshot.integrity");
  const comparableSchema = (schema: FactorySnapshotInspection["schema"]) => ({
    objectsDigest: schema.objectsDigest,
    snapshotSchemaVersion: schema.snapshotSchemaVersion,
    sqliteUserVersion: schema.sqliteUserVersion,
    tables: schema.tables,
  });
  if (
    canonicalJson(comparableSchema(manifest.schema)) !==
    canonicalJson(comparableSchema(inspection.schema))
  )
    differences.push("schema");
  if (canonicalJson(manifest.state) !== canonicalJson(inspection.state))
    differences.push("state");
  if (
    canonicalJson(manifest.protectedTables) !==
    canonicalJson(inspection.protectedTables)
  )
    differences.push("protectedTables");
  return differences;
}

function readManifest(path: string): FactorySnapshotManifest {
  let manifestText: string;
  try {
    manifestText = readFileSync(path, "utf8");
  } catch (error) {
    // Preserve filesystem errors (including NAS I/O failures) for callers;
    // only malformed bytes should be reported as a corrupt manifest.
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(manifestText);
  } catch {
    throw new Error("Manifest is not valid JSON.");
  }
  if (!isRecord(value)) throw new Error("Manifest must be a JSON object.");
  if (value.manifestVersion !== BACKUP_MANIFEST_VERSION) {
    throw new Error("Manifest version is unsupported.");
  }
  const snapshot = value.snapshot;
  if (!isRecord(snapshot))
    throw new Error("Manifest snapshot metadata is missing.");
  if (
    snapshot.integrity !== "ok" ||
    typeof snapshot.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(snapshot.sha256) ||
    !Number.isSafeInteger(snapshot.sizeBytes) ||
    typeof snapshot.sizeBytes !== "number" ||
    snapshot.sizeBytes < 0
  ) {
    throw new Error("Manifest snapshot metadata is invalid.");
  }
  if (
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("Manifest createdAt is invalid.");
  }
  // Validate the rest of the shape by requiring the same complete metadata
  // fields that inspection produces. Unknown fields are retained for forward
  // compatibility, but no caller-provided row values are interpreted.
  if (
    !isRecord(value.schema) ||
    !isRecord(value.runtime) ||
    !isRecord(value.state) ||
    !isRecord(value.protectedTables)
  ) {
    throw new Error("Manifest content metadata is incomplete.");
  }
  validateInspectionShape({
    protectedTables: value.protectedTables,
    runtime: value.runtime,
    schema: value.schema,
    state: value.state,
  });
  return value as unknown as FactorySnapshotManifest;
}

function validateInspectionShape(value: {
  schema: RawRecord;
  runtime: RawRecord;
  state: RawRecord;
  protectedTables: RawRecord;
}): void {
  const schema = value.schema;
  if (
    schema.snapshotSchemaVersion !== FACTORY_SNAPSHOT_SCHEMA_VERSION ||
    typeof schema.sqliteVersion !== "string" ||
    !Number.isSafeInteger(schema.sqliteUserVersion) ||
    typeof schema.objectsDigest !== "string" ||
    !Array.isArray(schema.tables) ||
    !schema.tables.every((table) => typeof table === "string")
  ) {
    throw new Error("Manifest schema metadata is invalid.");
  }
  const runtime = value.runtime;
  if (
    typeof runtime.bunVersion !== "string" ||
    typeof runtime.platform !== "string" ||
    typeof runtime.arch !== "string" ||
    (runtime.revision !== undefined && typeof runtime.revision !== "string")
  ) {
    throw new Error("Manifest runtime metadata is invalid.");
  }
  const state = value.state;
  if (
    typeof state.contentDigest !== "string" ||
    typeof state.durableIdsDigest !== "string" ||
    !isRecord(state.collections) ||
    !isRecord(state.history)
  ) {
    throw new Error("Manifest state metadata is invalid.");
  }
  for (const name of STATE_COLLECTIONS) {
    validateCollectionSummary(
      state.collections[name],
      `state.collections.${name}`,
    );
  }
  for (const name of HISTORY_COLLECTIONS) {
    validateCollectionSummary(state.history[name], `state.history.${name}`);
  }
  for (const name of PROTECTED_TABLES) {
    const table = value.protectedTables[name];
    if (
      !isRecord(table) ||
      typeof table.present !== "boolean" ||
      !Number.isSafeInteger(table.count) ||
      typeof table.count !== "number" ||
      table.count < 0 ||
      typeof table.contentDigest !== "string"
    ) {
      throw new Error(`Manifest protected table metadata is invalid: ${name}.`);
    }
  }
}

function validateCollectionSummary(value: unknown, label: string): void {
  if (!isRecord(value))
    throw new Error(`Manifest collection is invalid: ${label}.`);
  if (
    !Number.isSafeInteger(value.count) ||
    typeof value.count !== "number" ||
    value.count < 0 ||
    !Array.isArray(value.ids) ||
    !value.ids.every((id) => typeof id === "string") ||
    typeof value.idsDigest !== "string" ||
    typeof value.contentDigest !== "string" ||
    value.ids.length !== value.count
  ) {
    throw new Error(`Manifest collection is invalid: ${label}.`);
  }
}

function requireRecordArray(name: string, value: unknown): RawRecord[] {
  if (!Array.isArray(value))
    throw new Error(`Persisted collection is invalid: ${name}.`);
  return value.map((record, index) => {
    if (!isRecord(record))
      throw new Error(`Persisted ${name} record ${index} is invalid.`);
    return record;
  });
}

function openReadonlyDatabase(path: string): Database {
  try {
    return new Database(path, { readonly: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to open database read-only: ${detail}`);
  }
}

function resolveDatabasePath(path: string): string {
  const resolvedPath = resolve(path);
  if (!resolvedPath.trim()) throw new Error("Database path is required.");
  return resolvedPath;
}

function requireExistingPath(path: string, label: string): void {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} does not exist: ${path}`);
  }
}

function refuseExistingPath(path: string, label: string): void {
  if (existsSync(path)) throw new Error(`${label} already exists: ${path}`);
}

function writeExclusive(path: string, bytes: Uint8Array): void {
  let descriptor: number | undefined;
  let created = false;
  try {
    descriptor = openSync(path, "wx", 0o600);
    created = true;
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    chmodSync(path, 0o600);
  } catch (error) {
    if (created) safelyUnlink(path);
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function requireFactoryStateTable(database: Database): void {
  const factoryStateTable = database
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'factory_state'",
    )
    .get();
  if (!factoryStateTable) {
    throw new Error("Not a Factory database: factory_state table is missing.");
  }
}

function sqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function safelyUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Cleanup is best effort; the original operation's error is more useful.
  }
}

function sameInspection(
  left: FactorySnapshotInspection,
  right: FactorySnapshotInspection,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function digestBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestCanonical(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveBuildRevision(): string | undefined {
  const configured = Bun.env.FACTORY_REVISION?.trim();
  if (configured && /^[A-Za-z0-9._-]+$/.test(configured)) return configured;

  const revisionPath = Bun.env.FACTORY_REVISION_FILE?.trim() || "/app/REVISION";
  try {
    const value = readFileSync(revisionPath, "utf8").trim().split(/\s+/)[0];
    return value && /^[A-Za-z0-9._-]+$/.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
