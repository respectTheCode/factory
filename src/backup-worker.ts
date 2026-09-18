import { randomBytes } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  backupFactorySnapshot,
  verifyFactorySnapshot,
} from "./backup-snapshot";

export type BackupTrigger =
  | "manual"
  | "scheduled"
  | "pre-restore"
  | "pre-deploy";

export type BackupSettings = {
  enabled: boolean;
  intervalMinutes: number;
  keepRecent: number;
  keepDaily: number;
};

export type BackupIntegrity = "verified" | "corrupt" | "incomplete";

export type BackupSummary = {
  id: string;
  createdAt: string;
  trigger: BackupTrigger;
  revision?: string;
  integrity: BackupIntegrity;
  sizeBytes: number;
  snapshotSizeBytes: number;
  manifestSizeBytes: number;
};

export type RestorePreparation = {
  backupId: string;
  preRestoreId: string;
  stagedDatabasePath: string;
  stagedManifestPath: string;
};

export type BackupWorkerRequest =
  | {
      kind: "create";
      databasePath: string;
      directory: string;
      requireNfs: boolean;
      trigger: BackupTrigger;
      revision?: string;
      settings: BackupSettings;
    }
  | {
      kind: "list";
      directory: string;
      requireNfs: boolean;
      databasePath?: string;
    }
  | {
      kind: "delete";
      directory: string;
      id: string;
      requireNfs: boolean;
      databasePath?: string;
    }
  | {
      kind: "prepare-restore";
      databasePath: string;
      directory: string;
      id: string;
      requireNfs: boolean;
      revision?: string;
      settings: BackupSettings;
    };

export type BackupWorkerResponse =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

const METADATA_FILE = "metadata.json";
const SNAPSHOT_FILE = "snapshot.sqlite";
const MANIFEST_FILE = "manifest.json";
const ARTIFACT_MARKER_FILE = ".factory-backup-owner.json";
const METADATA_VERSION = 1 as const;
const ARTIFACT_MARKER_VERSION = 1 as const;
const PREDEPLOY_KEEP = 10;
const SAFE_ID = /^b-[0-9]{8}T[0-9]{6}\.[0-9]{3}Z-[a-f0-9]{8}$/;
const MAX_RECLAIM_ARTIFACTS = 32;

type BackupMetadata = {
  format: "factory-backup";
  version: typeof METADATA_VERSION;
  id: string;
  createdAt: string;
  trigger: BackupTrigger;
  revision?: string;
  snapshotFile: typeof SNAPSHOT_FILE;
  manifestFile: typeof MANIFEST_FILE;
  verification: "verified";
  snapshotSizeBytes: number;
  manifestSizeBytes: number;
};

type ArtifactKind = "staging" | "local";

type BackupArtifactMarker = {
  format: "factory-backup-artifact";
  version: typeof ARTIFACT_MARKER_VERSION;
  kind: ArtifactKind;
  artifactPath: string;
  backupRoot: string;
  databasePath: string;
  pid: number;
  processStartToken?: string;
  token: string;
  createdAt: string;
};

type OwnedBackup = {
  directory: string;
  metadata: BackupMetadata;
  summary: BackupSummary;
};

function run(request: BackupWorkerRequest): unknown {
  switch (request.kind) {
    case "create":
      return createBackup(request);
    case "list":
      return listBackups(
        request.directory,
        request.requireNfs,
        request.databasePath,
      );
    case "delete":
      deleteBackup(
        request.directory,
        request.id,
        request.requireNfs,
        request.databasePath,
      );
      return undefined;
    case "prepare-restore":
      return prepareRestore(request);
  }
}

function createBackup(
  request: Extract<BackupWorkerRequest, { kind: "create" }>,
): BackupSummary {
  const root = requireBackupDirectory(request.directory, request.requireNfs);
  const databasePath = resolve(request.databasePath);
  reclaimOwnedTemporaryArtifacts(root, databasePath);
  const id = createBackupId();
  const createdAt = new Date().toISOString();
  const localDirectory = createMarkedArtifactDirectory(
    join(tmpdir(), "factory-backup-local-"),
    "local",
    root,
    databasePath,
  );
  const localSnapshot = join(localDirectory, SNAPSHOT_FILE);
  const localManifest = join(localDirectory, MANIFEST_FILE);
  let stagingDirectory: string | undefined;

  try {
    stagingDirectory = createMarkedArtifactDirectory(
      join(root, `.factory-backup-staging-${id}-`),
      "staging",
      root,
      databasePath,
    );
    if (request.revision) process.env.FACTORY_REVISION = request.revision;
    backupFactorySnapshot({
      databasePath,
      manifestPath: localManifest,
      outputPath: localSnapshot,
    });

    const stagedSnapshot = join(stagingDirectory, SNAPSHOT_FILE);
    const stagedManifest = join(stagingDirectory, MANIFEST_FILE);
    copyFileSync(localSnapshot, stagedSnapshot);
    copyFileSync(localManifest, stagedManifest);
    chmodSync(stagedSnapshot, 0o600);
    chmodSync(stagedManifest, 0o600);
    syncFile(stagedSnapshot);
    syncFile(stagedManifest);

    blockForTest(Bun.env.FACTORY_BACKUP_TEST_DELAY_AFTER_STAGING_MS);

    verifyFactorySnapshot({
      databasePath: stagedSnapshot,
      manifestPath: stagedManifest,
    });

    const snapshotSizeBytes = lstatSync(stagedSnapshot).size;
    const manifestSizeBytes = lstatSync(stagedManifest).size;
    const metadata: BackupMetadata = {
      createdAt,
      format: "factory-backup",
      id,
      manifestFile: MANIFEST_FILE,
      ...(request.revision ? { revision: request.revision } : {}),
      snapshotFile: SNAPSHOT_FILE,
      snapshotSizeBytes,
      manifestSizeBytes,
      trigger: request.trigger,
      verification: "verified",
      version: METADATA_VERSION,
    };
    writeFileSync(
      join(stagingDirectory, METADATA_FILE),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
    chmodSync(join(stagingDirectory, METADATA_FILE), 0o600);
    syncFile(join(stagingDirectory, METADATA_FILE));
    syncDirectory(stagingDirectory);

    const finalDirectory = join(root, id);
    if (existsSync(finalDirectory))
      throw new Error("Backup ID already exists.");
    renameSync(stagingDirectory, finalDirectory);
    // Keep the marker through publication so a kill between rename and
    // marker cleanup leaves a harmless, readable backup instead of an
    // unowned staging directory. The marker is allowed in a published entry
    // until a later successful cleanup can remove it.
    try {
      removeArtifactMarker(finalDirectory);
    } catch {
      // The marker is ignored by backup reads and is safe to leave behind.
    }
    syncDirectory(root);
    const owned = readOwnedBackup(root, id);
    if (!owned) throw new Error("Published backup could not be read back.");
    pruneBackups(root, request.settings);
    return owned.summary;
  } catch (error) {
    if (stagingDirectory)
      rmSync(stagingDirectory, { force: true, recursive: true });
    throw error;
  } finally {
    rmSync(localDirectory, { force: true, recursive: true });
  }
}

function listBackups(
  directory: string,
  requireNfs: boolean,
  databasePath?: string,
): BackupSummary[] {
  const root = requireBackupDirectory(directory, requireNfs);
  if (databasePath) reclaimOwnedTemporaryArtifacts(root, resolve(databasePath));
  return discoverOwnedBackups(root)
    .map((entry) => entry.summary)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function deleteBackup(
  directory: string,
  id: string,
  requireNfs: boolean,
  databasePath?: string,
): void {
  assertSafeId(id);
  const root = requireBackupDirectory(directory, requireNfs);
  if (databasePath) reclaimOwnedTemporaryArtifacts(root, resolve(databasePath));
  const owned = readOwnedBackup(root, id);
  if (!owned)
    throw new Error("Backup does not exist or is not owned by Factory.");
  rmSync(owned.directory, { force: false, recursive: true });
}

function prepareRestore(
  request: Extract<BackupWorkerRequest, { kind: "prepare-restore" }>,
): RestorePreparation {
  assertSafeId(request.id);
  const root = requireBackupDirectory(request.directory, request.requireNfs);
  const databasePath = resolve(request.databasePath);
  reclaimOwnedTemporaryArtifacts(root, databasePath);
  const selected = readOwnedBackup(root, request.id);
  if (!selected)
    throw new Error("Backup does not exist or is not owned by Factory.");

  const selectedSnapshot = join(selected.directory, SNAPSHOT_FILE);
  const selectedManifest = join(selected.directory, MANIFEST_FILE);
  verifyFactorySnapshot({
    databasePath: selectedSnapshot,
    manifestPath: selectedManifest,
  });

  const localDirectory = mkdtempSync(
    join(dirname(databasePath), ".factory-restore-"),
  );
  const stagedDatabasePath = join(localDirectory, SNAPSHOT_FILE);
  const stagedManifestPath = join(localDirectory, MANIFEST_FILE);
  try {
    copyFileSync(selectedSnapshot, stagedDatabasePath);
    copyFileSync(selectedManifest, stagedManifestPath);
    chmodSync(stagedDatabasePath, 0o600);
    chmodSync(stagedManifestPath, 0o600);
    syncFile(stagedDatabasePath);
    syncFile(stagedManifestPath);
    verifyFactorySnapshot({
      databasePath: stagedDatabasePath,
      manifestPath: stagedManifestPath,
    });
    // Stage and verify before creating the pre-restore backup. Retention may
    // prune the selected scheduled entry once the pre-restore entry exists.
    const preRestore = createBackup({
      databasePath,
      directory: request.directory,
      requireNfs: request.requireNfs,
      revision: request.revision,
      settings: request.settings,
      trigger: "pre-restore",
      kind: "create",
    });
    return {
      backupId: request.id,
      preRestoreId: preRestore.id,
      stagedDatabasePath,
      stagedManifestPath,
    };
  } catch (error) {
    rmSync(localDirectory, { force: true, recursive: true });
    throw error;
  }
}

function pruneBackups(root: string, settings: BackupSettings): string[] {
  const entries = discoverOwnedBackups(root);
  const scheduled = entries
    .filter(
      (entry) =>
        entry.metadata.trigger === "scheduled" &&
        entry.summary.integrity === "verified",
    )
    .sort((left, right) =>
      right.metadata.createdAt.localeCompare(left.metadata.createdAt),
    );
  const preDeploy = entries
    .filter(
      (entry) =>
        entry.metadata.trigger === "pre-deploy" &&
        entry.summary.integrity === "verified",
    )
    .sort((left, right) =>
      right.metadata.createdAt.localeCompare(left.metadata.createdAt),
    );
  const keep = new Set<string>();

  for (const entry of scheduled.slice(0, settings.keepRecent))
    keep.add(entry.metadata.id);
  const dates = new Set<string>();
  for (const entry of scheduled) {
    const day = entry.metadata.createdAt.slice(0, 10);
    if (dates.has(day) || dates.size >= settings.keepDaily) continue;
    dates.add(day);
    keep.add(entry.metadata.id);
  }
  for (const entry of preDeploy.slice(0, PREDEPLOY_KEEP))
    keep.add(entry.metadata.id);

  const deleted: string[] = [];
  for (const entry of [...scheduled, ...preDeploy]) {
    if (keep.has(entry.metadata.id)) continue;
    rmSync(entry.directory, { force: false, recursive: true });
    deleted.push(entry.metadata.id);
  }
  return deleted;
}

function discoverOwnedBackups(root: string): OwnedBackup[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const results: OwnedBackup[] = [];
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !SAFE_ID.test(entry.name)
    )
      continue;
    const owned = readOwnedBackup(root, entry.name);
    if (owned) results.push(owned);
  }
  return results;
}

function readOwnedBackup(root: string, id: string): OwnedBackup | undefined {
  assertSafeId(id);
  const directory = join(root, id);
  let directoryStat;
  try {
    directoryStat = lstatSync(directory);
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw error;
  }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink())
    return undefined;

  const names = readdirSync(directory);
  if (
    !names.includes(METADATA_FILE) ||
    names.some(
      (name) =>
        name !== METADATA_FILE &&
        name !== SNAPSHOT_FILE &&
        name !== MANIFEST_FILE &&
        name !== ARTIFACT_MARKER_FILE,
    )
  ) {
    return undefined;
  }
  if (names.includes(ARTIFACT_MARKER_FILE)) {
    let markerStat;
    try {
      markerStat = lstatSync(join(directory, ARTIFACT_MARKER_FILE));
    } catch (error) {
      if (isMissingPath(error)) return undefined;
      throw error;
    }
    if (!markerStat.isFile() || markerStat.isSymbolicLink()) return undefined;
  }
  const metadataPath = join(directory, METADATA_FILE);
  const snapshotPath = join(directory, SNAPSHOT_FILE);
  const manifestPath = join(directory, MANIFEST_FILE);

  let metadataStat;
  try {
    metadataStat = lstatSync(metadataPath);
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw error;
  }
  if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) return undefined;

  let metadata: BackupMetadata;
  let metadataText: string;
  try {
    metadataText = readFileSync(metadataPath, "utf8");
  } catch (error) {
    if (isMissingPath(error)) return undefined;
    throw error;
  }
  try {
    metadata = parseMetadata(JSON.parse(metadataText), id);
  } catch {
    return undefined;
  }

  let snapshotSizeBytes = 0;
  let manifestSizeBytes = 0;
  let incomplete = false;
  for (const [path, setSize] of [
    [snapshotPath, (size: number) => (snapshotSizeBytes = size)],
    [manifestPath, (size: number) => (manifestSizeBytes = size)],
  ] as const) {
    let fileStat;
    try {
      fileStat = lstatSync(path);
    } catch (error) {
      if (isMissingPath(error)) {
        incomplete = true;
        continue;
      }
      throw error;
    }
    if (fileStat.isSymbolicLink()) return undefined;
    if (!fileStat.isFile()) {
      incomplete = true;
      continue;
    }
    setSize(fileStat.size);
  }

  const integrity: BackupIntegrity =
    incomplete ||
    metadata.verification !== "verified" ||
    snapshotSizeBytes !== metadata.snapshotSizeBytes ||
    manifestSizeBytes !== metadata.manifestSizeBytes
      ? "incomplete"
      : verifyBackupIntegrity(snapshotPath, manifestPath);
  return {
    directory,
    metadata,
    summary: {
      createdAt: metadata.createdAt,
      id: metadata.id,
      ...(metadata.revision ? { revision: metadata.revision } : {}),
      integrity,
      manifestSizeBytes,
      sizeBytes: snapshotSizeBytes + manifestSizeBytes,
      snapshotSizeBytes,
      trigger: metadata.trigger,
    },
  };
}

function verifyBackupIntegrity(
  snapshotPath: string,
  manifestPath: string,
): BackupIntegrity {
  try {
    verifyFactorySnapshot({
      databasePath: snapshotPath,
      manifestPath,
    });
    return "verified";
  } catch (error) {
    if (isIntegrityVerificationFailure(error)) return "corrupt";
    throw error;
  }
}

function isIntegrityVerificationFailure(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return false;
  }
  const message = error instanceof Error ? error.message : String(error);
  return (
    /^Snapshot (size|checksum|content) /.test(message) ||
    /^Manifest /.test(message) ||
    /^SQLite integrity check failed:/.test(message) ||
    /^Factory (database has no persisted|state snapshot is corrupt)/.test(
      message,
    ) ||
    /^Persisted (collection|snapshot) /.test(message) ||
    /^Not a Factory database:/.test(message) ||
    /database disk image is malformed|file is not a database/i.test(message)
  );
}

function parseMetadata(value: unknown, id: string): BackupMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Metadata is invalid.");
  const record = value as Record<string, unknown>;
  if (
    record.format !== "factory-backup" ||
    record.version !== METADATA_VERSION ||
    record.id !== id ||
    !SAFE_ID.test(id) ||
    typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !isTrigger(record.trigger) ||
    record.snapshotFile !== SNAPSHOT_FILE ||
    record.manifestFile !== MANIFEST_FILE ||
    record.verification !== "verified" ||
    typeof record.snapshotSizeBytes !== "number" ||
    !Number.isSafeInteger(record.snapshotSizeBytes) ||
    record.snapshotSizeBytes < 0 ||
    typeof record.manifestSizeBytes !== "number" ||
    !Number.isSafeInteger(record.manifestSizeBytes) ||
    record.manifestSizeBytes < 0 ||
    (record.revision !== undefined &&
      (typeof record.revision !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(record.revision)))
  ) {
    throw new Error("Metadata is invalid.");
  }
  return record as unknown as BackupMetadata;
}

function isMissingPath(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT",
  );
}

function reclaimOwnedTemporaryArtifacts(
  backupRoot: string,
  databasePath: string,
): void {
  const rootEntries = readdirSync(backupRoot, { withFileTypes: true });
  const stagingEntries = rootEntries.filter(
    (entry) =>
      entry.name.startsWith(".factory-backup-staging-") &&
      entry.isDirectory() &&
      !entry.isSymbolicLink(),
  );
  let reclaimedStaging = 0;
  for (const entry of stagingEntries) {
    if (reclaimedStaging >= MAX_RECLAIM_ARTIFACTS) {
      continue;
    }
    if (
      reclaimOwnedArtifact(join(backupRoot, entry.name), "staging", {
        backupRoot,
        databasePath,
      })
    ) {
      reclaimedStaging += 1;
    }
  }

  const localRoot = resolve(tmpdir());
  let localRootStat;
  try {
    localRootStat = lstatSync(localRoot);
  } catch (error) {
    if (isMissingPath(error)) return;
    throw error;
  }
  if (!localRootStat.isDirectory() || localRootStat.isSymbolicLink()) return;
  const localEntries = readdirSync(localRoot, { withFileTypes: true });
  const localArtifactEntries = localEntries.filter(
    (entry) =>
      entry.name.startsWith("factory-backup-local-") &&
      entry.isDirectory() &&
      !entry.isSymbolicLink(),
  );
  let reclaimedLocal = 0;
  for (const entry of localArtifactEntries) {
    if (reclaimedLocal >= MAX_RECLAIM_ARTIFACTS) continue;
    if (
      reclaimOwnedArtifact(join(localRoot, entry.name), "local", {
        backupRoot,
        databasePath,
      })
    ) {
      reclaimedLocal += 1;
    }
  }
}

function reclaimOwnedArtifact(
  artifactPath: string,
  kind: ArtifactKind,
  scope: { backupRoot: string; databasePath: string },
): boolean {
  let artifactStat;
  try {
    artifactStat = lstatSync(artifactPath);
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
  if (!artifactStat.isDirectory() || artifactStat.isSymbolicLink())
    return false;

  const markerPath = join(artifactPath, ARTIFACT_MARKER_FILE);
  let markerStat;
  try {
    markerStat = lstatSync(markerPath);
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) return false;

  let marker: BackupArtifactMarker;
  let markerText: string;
  try {
    markerText = readFileSync(markerPath, "utf8");
  } catch (error) {
    if (isMissingPath(error)) return false;
    throw error;
  }
  try {
    marker = parseArtifactMarker(JSON.parse(markerText));
  } catch {
    return false;
  }
  if (
    marker.kind !== kind ||
    marker.artifactPath !== resolve(artifactPath) ||
    marker.backupRoot !== scope.backupRoot ||
    marker.databasePath !== scope.databasePath ||
    isArtifactOwnerLive(marker)
  ) {
    return false;
  }
  rmSync(artifactPath, { force: false, recursive: true });
  return true;
}

function createMarkedArtifactDirectory(
  prefix: string,
  kind: ArtifactKind,
  backupRoot: string,
  databasePath: string,
): string {
  const artifactPath = mkdtempSync(prefix);
  try {
    const markerPath = join(artifactPath, ARTIFACT_MARKER_FILE);
    const processStartToken = readProcessStartToken(process.pid);
    const marker: BackupArtifactMarker = {
      artifactPath: resolve(artifactPath),
      backupRoot,
      createdAt: new Date().toISOString(),
      databasePath,
      format: "factory-backup-artifact",
      kind,
      pid: process.pid,
      ...(processStartToken ? { processStartToken } : {}),
      token: randomBytes(16).toString("hex"),
      version: ARTIFACT_MARKER_VERSION,
    };
    writeFileSync(markerPath, `${JSON.stringify(marker)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(markerPath, 0o600);
    syncFile(markerPath);
    return artifactPath;
  } catch (error) {
    rmSync(artifactPath, { force: true, recursive: true });
    throw error;
  }
}

function removeArtifactMarker(artifactPath: string): void {
  rmSync(join(artifactPath, ARTIFACT_MARKER_FILE), {
    force: false,
    recursive: false,
  });
}

function parseArtifactMarker(value: unknown): BackupArtifactMarker {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Artifact marker is invalid.");
  const record = value as Record<string, unknown>;
  if (
    record.format !== "factory-backup-artifact" ||
    record.version !== ARTIFACT_MARKER_VERSION ||
    (record.kind !== "staging" && record.kind !== "local") ||
    typeof record.artifactPath !== "string" ||
    typeof record.backupRoot !== "string" ||
    typeof record.databasePath !== "string" ||
    typeof record.pid !== "number" ||
    !Number.isSafeInteger(record.pid) ||
    record.pid <= 0 ||
    (record.processStartToken !== undefined &&
      (typeof record.processStartToken !== "string" ||
        record.processStartToken.length === 0)) ||
    typeof record.token !== "string" ||
    !/^[a-f0-9]{32}$/.test(record.token) ||
    typeof record.createdAt !== "string" ||
    !Number.isFinite(Date.parse(record.createdAt))
  ) {
    throw new Error("Artifact marker is invalid.");
  }
  return record as unknown as BackupArtifactMarker;
}

function isArtifactOwnerLive(marker: BackupArtifactMarker): boolean {
  if (marker.processStartToken) {
    const currentStartToken = readProcessStartToken(marker.pid);
    if (currentStartToken && currentStartToken !== marker.processStartToken)
      return false;
  }
  try {
    process.kill(marker.pid, 0);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ESRCH"
    ) {
      return false;
    }
    // EPERM and unknown process errors are kept conservatively: an artifact
    // is never reclaimed while ownership cannot be disproved.
    return true;
  }
}

function readProcessStartToken(pid: number): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(") ");
    if (commandEnd < 0) return undefined;
    const fields = stat.slice(commandEnd + 2).split(" ");
    return fields[19] || undefined;
  } catch {
    return undefined;
  }
}

function blockForTest(value: string | undefined): void {
  const milliseconds = Number(value ?? "0");
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function requireBackupDirectory(
  directory: string,
  requireNfs: boolean,
): string {
  const root = resolve(directory);
  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    if (requireNfs) {
      // Validate the configured path against mountinfo before creating it;
      // this prevents a missing NFS subdirectory from silently becoming a
      // local fallback.
      validateNfsMount(root);
    }
    mkdirSync(root, { recursive: true, mode: 0o700 });
    rootStat = lstatSync(root);
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Backup directory must be a real directory.");
  }
  if (requireNfs) validateNfsMount(root);
  return root;
}

function validateNfsMount(directory: string): void {
  if (process.platform !== "linux") {
    throw new Error("NFS backup validation requires Linux mountinfo.");
  }
  let mountInfo: string;
  try {
    mountInfo = readFileSync("/proc/self/mountinfo", "utf8");
  } catch (error) {
    throw new Error(
      `Unable to validate NFS mount: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const mounts = mountInfo.split("\n").flatMap((line) => {
    const separator = line.indexOf(" - ");
    if (separator < 0) return [];
    const left = line.slice(0, separator).split(" ");
    const right = line.slice(separator + 3).split(" ");
    const mountPoint = left[4];
    const filesystem = right[0];
    if (!mountPoint || !filesystem) return [];
    return [{ filesystem, mountPoint: decodeMountPath(mountPoint) }];
  });
  const match = mounts
    .filter(
      (mount) =>
        directory === mount.mountPoint ||
        directory.startsWith(`${mount.mountPoint}/`),
    )
    .sort((left, right) => right.mountPoint.length - left.mountPoint.length)[0];
  if (!match || (match.filesystem !== "nfs" && match.filesystem !== "nfs4")) {
    throw new Error("Backup directory is not on an nfs/nfs4 mount.");
  }
}

function syncFile(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // Some filesystems do not expose fsync for a read-only descriptor. The
    // copy was already verified; durability is best effort where unsupported.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function syncDirectory(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // Directory fsync is not available on every supported filesystem.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function decodeMountPath(value: string): string {
  return value
    .replaceAll("\\040", " ")
    .replaceAll("\\011", "\t")
    .replaceAll("\\134", "\\");
}

function createBackupId(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "")
    .replace(/-/g, "");
  const compact = `${timestamp.slice(0, 8)}T${timestamp.slice(9, 15)}.${timestamp.slice(16, 19)}Z`;
  return `b-${compact}-${randomBytes(4).toString("hex")}`;
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) throw new Error("Backup ID is invalid.");
}

function isTrigger(value: unknown): value is BackupTrigger {
  return (
    value === "manual" ||
    value === "scheduled" ||
    value === "pre-restore" ||
    value === "pre-deploy"
  );
}

if (
  !import.meta.main &&
  typeof (globalThis as { onmessage?: unknown }).onmessage !== "undefined"
) {
  globalThis.onmessage = async (event: MessageEvent<BackupWorkerRequest>) => {
    try {
      const result = run(event.data);
      globalThis.postMessage({
        ok: true,
        result,
      } satisfies BackupWorkerResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      globalThis.postMessage({
        ok: false,
        error: message,
      } satisfies BackupWorkerResponse);
    }
  };
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin).text();
  let response: BackupWorkerResponse;
  try {
    const testDelayMs = Number(Bun.env.FACTORY_BACKUP_TEST_DELAY_MS ?? "0");
    if (Number.isFinite(testDelayMs) && testDelayMs > 0) {
      await Bun.sleep(testDelayMs);
    }
    response = {
      ok: true,
      result: run(JSON.parse(input) as BackupWorkerRequest),
    };
  } catch (error) {
    response = {
      error: error instanceof Error ? error.message : String(error),
      ok: false,
    };
  }
  process.stdout.write(`${JSON.stringify(response)}\n`);
}
