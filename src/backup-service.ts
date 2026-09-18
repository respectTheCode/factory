import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  type BackupSettings,
  type BackupSummary,
  type BackupTrigger,
  type BackupWorkerRequest,
  type BackupWorkerResponse,
  type RestorePreparation,
} from "./backup-worker";

export type {
  BackupIntegrity,
  BackupSettings,
  BackupSummary,
  BackupTrigger,
  RestorePreparation,
} from "./backup-worker";

export type BackupServiceOptions = {
  databasePath: string;
  directory?: string;
  requireNfs?: boolean;
  revision?: string;
  /** Test and operator escape hatch; production defaults to two minutes. */
  operationTimeoutMs?: number;
};

export type BackupStatus = {
  configured: boolean;
  directory: string | null;
  settings: BackupSettings;
  busy: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastRestore?: BackupRestoreResult | null;
  stale: boolean;
};

export type BackupRestoreResult = {
  state: "restored" | "failed";
  at: string;
  backupId: string;
  preRestoreId: string;
  error?: string;
};

export type BackupService = {
  status(): BackupStatus;
  list(): Promise<BackupSummary[]>;
  create(trigger?: BackupTrigger): Promise<BackupSummary>;
  updateSettings(settings: Partial<BackupSettings>): Promise<BackupSettings>;
  delete(id: string): Promise<void>;
  prepareRestore(id: string): Promise<RestorePreparation>;
  start(): Promise<void>;
  stop(): void;
};

const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_KEEP_RECENT = 336;
const DEFAULT_KEEP_DAILY = 30;
const DEFAULT_OPERATION_TIMEOUT_MS = 120_000;
const SCHEDULER_HEARTBEAT_MS = 60_000;
const SETTINGS_SUFFIX = ".backup-settings.json";

export function createBackupService(
  options: BackupServiceOptions,
): BackupService {
  return new FactoryBackupService(options);
}

class FactoryBackupService implements BackupService {
  private readonly databasePath: string;
  private readonly directory: string | null;
  private readonly requireNfs: boolean;
  private readonly revision: string | undefined;
  private readonly settingsPath: string;
  private readonly operationTimeoutMs: number;
  private settings: BackupSettings;
  private busyState = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSuccessAt: string | null = null;
  private lastScheduledSuccessAt: string | null = null;
  private lastError: string | null = null;
  private settingsError: string | null = null;

  constructor(options: BackupServiceOptions) {
    if (!options.databasePath.trim())
      throw new Error("Database path is required.");
    this.databasePath = resolve(options.databasePath);
    this.directory = options.directory ? resolve(options.directory) : null;
    this.requireNfs = options.requireNfs ?? false;
    this.revision = options.revision?.trim() || undefined;
    if (this.revision && !/^[A-Za-z0-9._-]+$/.test(this.revision)) {
      throw new Error("revision contains unsupported characters.");
    }
    this.settingsPath = `${this.databasePath}${SETTINGS_SUFFIX}`;
    this.operationTimeoutMs = validateTimeout(options.operationTimeoutMs);
    this.settings = this.readSettings();
  }

  status(): BackupStatus {
    const configured = this.directory !== null;
    const lastError = this.lastError ?? this.settingsError;
    const stale =
      configured &&
      this.settings.enabled &&
      (!this.lastSuccessAt ||
        Date.now() - Date.parse(this.lastSuccessAt) >
          this.settings.intervalMinutes * 60_000);
    return {
      busy: this.busyState,
      configured,
      directory: this.directory,
      lastError,
      lastRestore: this.readLastRestore(),
      lastSuccessAt: this.lastSuccessAt,
      settings: { ...this.settings },
      stale,
    };
  }

  async list(): Promise<BackupSummary[]> {
    if (!this.directory) return [];
    try {
      const backups = await this.runWorker<BackupSummary[]>({
        directory: this.directory,
        kind: "list",
        requireNfs: this.requireNfs,
      });
      this.refreshRecoveryPoints(backups);
      return backups;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async create(trigger: BackupTrigger = "manual"): Promise<BackupSummary> {
    if (!isTrigger(trigger)) throw new Error("Backup trigger is invalid.");
    if (!this.directory) throw this.fail("Backups are not configured.");
    if (!this.settings.enabled && trigger === "scheduled") {
      throw this.fail("Scheduled backups are disabled.");
    }
    try {
      const result = await this.runWorker<BackupSummary>({
        databasePath: this.databasePath,
        directory: this.directory,
        kind: "create",
        requireNfs: this.requireNfs,
        revision: this.revision,
        settings: this.settings,
        trigger,
      });
      this.lastSuccessAt = result.createdAt;
      if (trigger === "scheduled")
        this.lastScheduledSuccessAt = result.createdAt;
      this.lastError = null;
      return result;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async updateSettings(
    patch: Partial<BackupSettings>,
  ): Promise<BackupSettings> {
    const next = validateSettings({ ...this.settings, ...patch });
    this.writeSettings(next);
    this.settings = next;
    if (!next.enabled) this.stop();
    else {
      this.stop();
      await this.start();
    }
    return { ...next };
  }

  async delete(id: string): Promise<void> {
    if (!this.directory) throw this.fail("Backups are not configured.");
    try {
      await this.runWorker({
        directory: this.directory,
        id,
        kind: "delete",
        requireNfs: this.requireNfs,
      });
      const remaining = await this.list();
      this.refreshRecoveryPoints(remaining);
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async prepareRestore(id: string): Promise<RestorePreparation> {
    if (!this.directory) throw this.fail("Backups are not configured.");
    try {
      const result = await this.runWorker<RestorePreparation>({
        databasePath: this.databasePath,
        directory: this.directory,
        id,
        kind: "prepare-restore",
        requireNfs: this.requireNfs,
        revision: this.revision,
        settings: this.settings,
      });
      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return result;
    } catch (error) {
      this.recordError(error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.directory || !this.settings.enabled || this.timer) return;
    this.timer = setInterval(() => {
      if (this.busyState) return;
      void this.refreshScheduleState().catch(() => undefined);
    }, SCHEDULER_HEARTBEAT_MS);
    await this.refreshScheduleState();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async runWorker<T>(request: BackupWorkerRequest): Promise<T> {
    if (this.busyState)
      throw this.fail("A backup operation is already in progress.");
    this.busyState = true;
    const worker = Bun.spawn(
      [
        process.execPath,
        "run",
        fileURLToPath(new URL("./backup-worker.ts", import.meta.url)),
      ],
      {
        cwd: dirname(this.databasePath),
        env: { ...Bun.env },
        stderr: "pipe",
        stdin: "pipe",
        stdout: "pipe",
      },
    );
    const stdout = new Response(worker.stdout).text();
    const stderr = new Response(worker.stderr).text();
    try {
      worker.stdin.write(JSON.stringify(request));
      worker.stdin.end();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          const timeoutError = new Error("Backup operation timed out.");
          this.recordError(timeoutError);
          console.error(`[backup] ${timeoutError.message}`);
          if (!worker.killed) worker.kill("SIGKILL");
          reject(timeoutError);
        }, this.operationTimeoutMs);
      });
      const completed = Promise.all([worker.exited, stdout, stderr]);
      let result: [number, string, string];
      try {
        result = await Promise.race([completed, timeout]);
      } finally {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      }
      const [exitCode, output, errorOutput] = result;
      if (exitCode !== 0) {
        throw new Error(
          errorOutput.trim() || `Backup worker exited with code ${exitCode}.`,
        );
      }
      let response: BackupWorkerResponse;
      try {
        response = JSON.parse(output) as BackupWorkerResponse;
      } catch {
        throw new Error("Backup worker returned invalid JSON.");
      }
      if (!response.ok) throw new Error(response.error);
      return response.result as T;
    } catch (error) {
      if (!worker.killed) worker.kill();
      await worker.exited;
      await Promise.allSettled([stdout, stderr]);
      throw error;
    } finally {
      // Keep the single-operation lock through child exit, including timeout
      // cleanup, so a timed-out native I/O operation cannot overlap another.
      this.busyState = false;
    }
  }

  private readSettings(): BackupSettings {
    const defaults: BackupSettings = {
      enabled: this.directory !== null,
      intervalMinutes: DEFAULT_INTERVAL_MINUTES,
      keepDaily: DEFAULT_KEEP_DAILY,
      keepRecent: DEFAULT_KEEP_RECENT,
    };
    if (!existsSync(this.settingsPath)) return defaults;
    try {
      const parsed = JSON.parse(
        readFileSync(this.settingsPath, "utf8"),
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Settings must be an object.");
      }
      return validateSettings({
        ...defaults,
        ...(parsed as Partial<BackupSettings>),
      });
    } catch (error) {
      this.settingsError =
        error instanceof Error ? error.message : String(error);
      return defaults;
    }
  }

  private writeSettings(settings: BackupSettings): void {
    const temporaryPath = `${this.settingsPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      renameSync(temporaryPath, this.settingsPath);
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // Preserve the original write/rename error.
      }
      throw error;
    }
  }

  private recordError(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
  }

  private refreshRecoveryPoints(backups: BackupSummary[]): void {
    const latest = backups.find((backup) => backup.integrity === "verified");
    this.lastSuccessAt = latest?.createdAt ?? null;
    const latestScheduled = backups.find(
      (backup) =>
        backup.trigger === "scheduled" && backup.integrity === "verified",
    );
    this.lastScheduledSuccessAt = latestScheduled?.createdAt ?? null;
  }

  private readLastRestore(): BackupRestoreResult | null {
    const resultPath = `${this.databasePath}.restore-result.json`;
    if (!existsSync(resultPath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(resultPath, "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const value = parsed as Record<string, unknown>;
      if (
        (value.state !== "restored" && value.state !== "failed") ||
        typeof value.at !== "string" ||
        !Number.isFinite(Date.parse(value.at)) ||
        !safeResultString(value.backupId) ||
        !safeResultString(value.preRestoreId) ||
        (value.error !== undefined && !safeResultString(value.error))
      ) {
        return null;
      }
      return {
        at: value.at,
        backupId: value.backupId as string,
        ...(value.error !== undefined ? { error: value.error as string } : {}),
        preRestoreId: value.preRestoreId as string,
        state: value.state,
      };
    } catch {
      return null;
    }
  }

  private fail(message: string): Error {
    const error = new Error(message);
    this.lastError = message;
    return error;
  }

  private async refreshScheduleState(): Promise<void> {
    if (this.busyState || !this.directory || !this.settings.enabled) return;
    const backups = await this.list();
    const latestScheduled = backups.find(
      (backup) =>
        backup.trigger === "scheduled" && backup.integrity === "verified",
    );
    if (latestScheduled) {
      this.lastScheduledSuccessAt = latestScheduled.createdAt;
    }
    const due =
      !this.lastScheduledSuccessAt ||
      Date.now() - Date.parse(this.lastScheduledSuccessAt) >=
        this.settings.intervalMinutes * 60_000;
    if (due && !this.busyState) {
      const result = await this.create("scheduled");
      this.lastScheduledSuccessAt = result.createdAt;
    }
  }
}

function safeResultString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 512;
}

function validateSettings(settings: BackupSettings): BackupSettings {
  if (typeof settings.enabled !== "boolean")
    throw new Error("enabled must be boolean.");
  if (
    !Number.isInteger(settings.intervalMinutes) ||
    settings.intervalMinutes < 1 ||
    settings.intervalMinutes > 10080
  ) {
    throw new Error("intervalMinutes must be an integer from 1 to 10080.");
  }
  if (
    !Number.isInteger(settings.keepRecent) ||
    settings.keepRecent < 0 ||
    settings.keepRecent > 100000
  ) {
    throw new Error("keepRecent must be an integer from 0 to 100000.");
  }
  if (
    !Number.isInteger(settings.keepDaily) ||
    settings.keepDaily < 0 ||
    settings.keepDaily > 10000
  ) {
    throw new Error("keepDaily must be an integer from 0 to 10000.");
  }
  return { ...settings };
}

function validateTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_OPERATION_TIMEOUT_MS;
  if (!Number.isInteger(value) || value < 100 || value > 3_600_000) {
    throw new Error(
      "operationTimeoutMs must be an integer from 100 to 3600000.",
    );
  }
  return value;
}

function isTrigger(value: unknown): value is BackupTrigger {
  return (
    value === "manual" ||
    value === "scheduled" ||
    value === "pre-restore" ||
    value === "pre-deploy"
  );
}
