import { useEffect, useMemo, useRef, useState } from "react";

import { createTRPCProxyClient } from "@trpc/client";

import type {
  BackupSettings,
  BackupStatus,
  BackupSummary,
} from "../backup-service";
import type { FactoryRouter } from "../server";
import type { ConnectionSnapshot } from "./connection-state";

type BackupClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;
type BackupRecord = BackupSummary;

type BackupPageProps = {
  client: BackupClient | null;
  connection: ConnectionSnapshot;
};

type HealthState =
  | "healthy"
  | "error"
  | "stale"
  | "busy"
  | "disabled"
  | "unknown";

const DEFAULT_SETTINGS: BackupSettings = {
  enabled: true,
  intervalMinutes: 30,
  keepRecent: 336,
  keepDaily: 30,
};

type NumericSettingKey = "intervalMinutes" | "keepRecent" | "keepDaily";
type NumericDraft = Record<NumericSettingKey, string>;

const SETTING_LIMITS: Record<NumericSettingKey, { min: number; max: number }> =
  {
    intervalMinutes: { min: 1, max: 10080 },
    keepRecent: { min: 0, max: 100000 },
    keepDaily: { min: 0, max: 10000 },
  };

export function settingsDraft(settings: BackupSettings): NumericDraft {
  return {
    intervalMinutes: String(settings.intervalMinutes),
    keepRecent: String(settings.keepRecent),
    keepDaily: String(settings.keepDaily),
  };
}

function normalizeSettings(status: BackupStatus): BackupSettings {
  return {
    enabled: status.settings?.enabled ?? DEFAULT_SETTINGS.enabled,
    intervalMinutes: boundedInteger(
      status.settings?.intervalMinutes,
      SETTING_LIMITS.intervalMinutes.min,
      SETTING_LIMITS.intervalMinutes.max,
      DEFAULT_SETTINGS.intervalMinutes,
    ),
    keepRecent: boundedInteger(
      status.settings?.keepRecent,
      SETTING_LIMITS.keepRecent.min,
      SETTING_LIMITS.keepRecent.max,
      DEFAULT_SETTINGS.keepRecent,
    ),
    keepDaily: boundedInteger(
      status.settings?.keepDaily,
      SETTING_LIMITS.keepDaily.min,
      SETTING_LIMITS.keepDaily.max,
      DEFAULT_SETTINGS.keepDaily,
    ),
  };
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
}

export function settingsFromDraft(
  current: BackupSettings,
  draft: NumericDraft,
): { settings?: BackupSettings; error?: string } {
  const next = { ...current };
  for (const key of Object.keys(SETTING_LIMITS) as NumericSettingKey[]) {
    const value = draft[key].trim();
    const { min, max } = SETTING_LIMITS[key];
    if (!/^\d+$/.test(value)) {
      return { error: `${key} must be a whole number from ${min} to ${max}.` };
    }
    const numeric = Number(value);
    if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
      return { error: `${key} must be a whole number from ${min} to ${max}.` };
    }
    next[key] = numeric;
  }
  return { settings: next };
}

function healthState(status: BackupStatus | null): HealthState {
  if (!status) return "unknown";
  if (status.busy) return "busy";
  if (status.lastError) return "error";
  if (!status.configured) return "disabled";
  if (status.stale) return "stale";
  return "healthy";
}

function destinationLabel(status: BackupStatus | null): string {
  if (!status) return "Configuration unavailable";
  return status.configured
    ? (status.directory ?? "Destination configured")
    : "No destination configured";
}

function formatDate(value: unknown): string {
  if (value instanceof Date) return formatDate(value.toISOString());
  if (typeof value !== "string") return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatContents(backup: BackupRecord): string {
  const snapshotSize = formatBytes(backup.snapshotSizeBytes);
  const manifestSize = formatBytes(backup.manifestSizeBytes);
  return `${backup.integrity} · snapshot ${snapshotSize}${
    manifestSize === "Size unavailable" ? "" : ` · manifest ${manifestSize}`
  }`;
}

function restoreOutcomeLabel(
  outcome: NonNullable<BackupStatus["lastRestore"]>,
): string {
  return outcome.state === "restored" ? "Restored" : "Restore failed";
}

function mutationError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The backup operation failed.";
}

function isTransportError(error: unknown): boolean {
  const message = mutationError(error).toLowerCase();
  return /closed|disconnect|network|socket|transport|timeout|connection/.test(
    message,
  );
}

function HealthBadge({ state }: { state: HealthState }) {
  const label =
    state === "unknown"
      ? "Unavailable"
      : state.charAt(0).toUpperCase() + state.slice(1);
  return (
    <span className={`backup-health backup-health-${state}`}>{label}</span>
  );
}

export function BackupsPage({ client, connection }: BackupPageProps) {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [settings, setSettings] = useState<BackupSettings>(DEFAULT_SETTINGS);
  const [numericDraft, setNumericDraft] = useState<NumericDraft>(() =>
    settingsDraft(DEFAULT_SETTINGS),
  );
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const settingsDirty = useRef(false);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<
    "create" | "settings" | "delete" | "restore" | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<BackupRecord | null>(
    null,
  );
  const [restoreState, setRestoreState] = useState<
    | "idle"
    | "submitting"
    | "awaiting-reconnect"
    | "reloading"
    | "failed"
    | "uncertain"
  >("idle");
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
  const reloadTimer = useRef<number | null>(null);
  const restoreSawDisconnect = useRef(false);
  const mutationRef = useRef(mutation);
  const restoreStateRef = useRef(restoreState);
  mutationRef.current = mutation;
  restoreStateRef.current = restoreState;

  const reportPageError = (message: string | null) => {
    setPageError(message);
  };

  const connected = connection.state === "connected";
  const restoreBlocksMutations =
    restoreState === "submitting" ||
    restoreState === "awaiting-reconnect" ||
    restoreState === "reloading" ||
    restoreState === "uncertain";
  const canMutate =
    connected &&
    connection.canMutate &&
    mutation === null &&
    !status?.busy &&
    !restoreBlocksMutations;
  const health = useMemo(
    () => (status ? healthState(status) : "unknown"),
    [status],
  );
  const destination = useMemo(() => destinationLabel(status), [status]);
  const destinationAvailable = status?.configured === true;
  const disabledReason = !connected
    ? "Waiting for the dashboard connection."
    : !connection.canMutate
      ? "Waiting for an authoritative refresh."
      : status === null
        ? "Loading backup configuration."
        : status.configured === false
          ? "Configure a backup destination before changing backup settings."
          : null;

  const refresh = () => setRefreshToken((current) => current + 1);

  useEffect(() => {
    if (!client || !connected) {
      setLoading(false);
      return;
    }
    let active = true;
    const refreshBackups = async (
      includeList: boolean,
      showLoading: boolean,
    ) => {
      if (showLoading) setLoading(true);
      if (showLoading) reportPageError(null);

      const statusResult = await Promise.allSettled([
        client.backups.status.query(),
      ]);
      if (!active) return;

      const statusEntry = statusResult[0];
      const statusSucceeded = statusEntry?.status === "fulfilled";
      let currentStatus: BackupStatus | null = null;
      if (statusEntry?.status === "fulfilled") {
        currentStatus = statusEntry.value;
        setStatus(currentStatus);
        if (!settingsDirty.current) {
          const nextSettings = normalizeSettings(currentStatus);
          setSettings(nextSettings);
          setNumericDraft(settingsDraft(nextSettings));
          setSettingsError(null);
        }
      } else {
        reportPageError(
          mutationError(
            statusEntry?.status === "rejected" ? statusEntry.reason : undefined,
          ),
        );
      }

      const idle =
        mutationRef.current === null && restoreStateRef.current === "idle";
      const shouldReadList =
        includeList && idle && (!currentStatus || !currentStatus.busy);
      if (shouldReadList) {
        const listResult = await Promise.allSettled([
          client.backups.list.query(),
        ]);
        if (!active) return;
        if (listResult[0]?.status === "fulfilled") {
          setBackups(listResult[0].value);
          if (statusSucceeded) reportPageError(null);
        } else {
          reportPageError(
            mutationError(
              listResult[0]?.status === "rejected"
                ? listResult[0].reason
                : undefined,
            ),
          );
        }
      }
      if (showLoading && active) setLoading(false);
    };

    void refreshBackups(true, true);
    const poll = window.setInterval(() => {
      void refreshBackups(true, false);
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [client, connected, refreshToken]);

  useEffect(() => {
    if (restoreState !== "awaiting-reconnect") return;
    if (connection.state !== "connected") {
      restoreSawDisconnect.current = true;
      return;
    }
    if (!restoreSawDisconnect.current) return;
    setRestoreState("reloading");
    setRestoreMessage(
      "Factory reconnected. Reloading the dashboard to establish a fresh session…",
    );
    reloadTimer.current = window.setTimeout(
      () => window.location.reload(),
      650,
    );
    return () => {
      if (reloadTimer.current !== null)
        window.clearTimeout(reloadTimer.current);
    };
  }, [connection.state, restoreState]);

  useEffect(
    () => () => {
      if (reloadTimer.current !== null)
        window.clearTimeout(reloadTimer.current);
    },
    [],
  );

  const runCreate = async () => {
    if (!client || !canMutate) return;
    setMutation("create");
    reportPageError(null);
    try {
      await client.backups.create.mutate({ trigger: "manual" });
    } catch (error: unknown) {
      reportPageError(mutationError(error));
    } finally {
      setMutation(null);
      refresh();
    }
  };

  const saveSettings = async () => {
    if (!client || !canMutate || !destinationAvailable) return;
    const parsed = settingsFromDraft(settings, numericDraft);
    if (!parsed.settings) {
      setSettingsError(parsed.error ?? "Review the backup settings.");
      return;
    }
    setSettings(parsed.settings);
    setSettingsError(null);
    setMutation("settings");
    reportPageError(null);
    try {
      const saved = await client.backups.updateSettings.mutate(parsed.settings);
      settingsDirty.current = false;
      setSettings(saved);
      setNumericDraft(settingsDraft(saved));
    } catch (error: unknown) {
      reportPageError(mutationError(error));
    } finally {
      setMutation(null);
      refresh();
    }
  };

  const deleteBackup = async (backupId: string) => {
    if (!client || !canMutate) return;
    setMutation("delete");
    reportPageError(null);
    try {
      await client.backups.delete.mutate({ backupId });
      setConfirmDelete(null);
    } catch (error: unknown) {
      reportPageError(mutationError(error));
    } finally {
      setMutation(null);
      refresh();
    }
  };

  const restoreBackup = async (backup: BackupRecord) => {
    if (!client || !canMutate) return;
    setMutation("restore");
    setRestoreState("submitting");
    restoreSawDisconnect.current = false;
    setRestoreMessage(null);
    reportPageError(null);
    try {
      await client.backups.restore.mutate({
        backupId: backup.id,
        confirm: true,
      });
      setConfirmRestore(null);
      setRestoreState("awaiting-reconnect");
      setRestoreMessage(
        "Safety backup created and restore staged. Factory will replace current data and restart; waiting for reconnection before reloading.",
      );
    } catch (error: unknown) {
      setConfirmRestore(null);
      if (connection.state !== "connected" || isTransportError(error)) {
        setRestoreState("uncertain");
        setRestoreMessage(
          "The restore connection closed before it could be confirmed. Reconnect and verify the backup state before trying again.",
        );
      } else {
        setRestoreState("failed");
        reportPageError(mutationError(error));
      }
    } finally {
      setMutation(null);
    }
  };

  const updateNumber = (key: NumericSettingKey, value: string) => {
    settingsDirty.current = true;
    setSettingsError(null);
    setNumericDraft((current) => ({ ...current, [key]: value }));
  };

  const reloadAfterUncertainRestore = () => {
    setRestoreMessage("Reloading to reconcile the restore state…");
    window.location.reload();
  };

  return (
    <section className="backups-page" aria-labelledby="backups-title">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1 id="backups-title">Backups</h1>
          <p className="project-summary">
            Manage the configured Factory data backup destination and recovery
            controls.
          </p>
        </div>
        <div className="detail-actions">
          <button
            className="secondary"
            disabled={loading || !connected}
            onClick={refresh}
            type="button"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {(disabledReason || pageError) && (
        <div
          className={`backup-notice ${pageError ? "backup-notice-error" : ""}`}
          role={pageError ? "alert" : "status"}
        >
          {pageError ?? disabledReason}
        </div>
      )}

      {restoreMessage && (
        <div
          className={`backup-notice ${restoreState === "failed" || restoreState === "uncertain" ? "backup-notice-error" : "backup-notice-warn"}`}
          role="status"
        >
          {restoreMessage}
        </div>
      )}

      <div className="backup-status-grid">
        <section
          className="backup-card"
          aria-labelledby="backup-destination-title"
        >
          <div className="backup-card-heading">
            <div>
              <p className="eyebrow">Destination</p>
              <h2 id="backup-destination-title">Configured backend</h2>
            </div>
            <HealthBadge state={health} />
          </div>
          <dl className="backup-facts">
            <div>
              <dt>Location</dt>
              <dd>{destination}</dd>
            </div>
            <div>
              <dt>Health</dt>
              <dd>{health === "unknown" ? "Unavailable" : health}</dd>
            </div>
            <div>
              <dt>Last backup</dt>
              <dd>
                {status?.lastSuccessAt
                  ? formatDate(status.lastSuccessAt)
                  : backups[0]
                    ? formatDate(backups[0].createdAt)
                    : "Unavailable"}
              </dd>
            </div>
          </dl>
          {status?.lastError && (
            <p className="backup-error">{status.lastError}</p>
          )}
          {status?.stale && (
            <p className="backup-warning">The latest backup is stale.</p>
          )}
          {status?.busy && (
            <p className="backup-warning">A backup operation is in progress.</p>
          )}
          {status?.lastRestore && (
            <div
              aria-label="Last restore outcome"
              className={`backup-restore-outcome backup-restore-${status.lastRestore.state}`}
              role="status"
            >
              <strong>{restoreOutcomeLabel(status.lastRestore)}</strong>
              <span>
                {formatDate(status.lastRestore.at)} · backup{" "}
                {status.lastRestore.backupId} · safety backup{" "}
                {status.lastRestore.preRestoreId}
              </span>
              {status.lastRestore.error && (
                <span>{status.lastRestore.error}</span>
              )}
            </div>
          )}
        </section>

        <section
          className="backup-card"
          aria-labelledby="backup-schedule-title"
        >
          <div className="backup-card-heading">
            <div>
              <p className="eyebrow">Schedule & retention</p>
              <h2 id="backup-schedule-title">Automatic backups</h2>
            </div>
          </div>
          <div className="backup-settings-grid">
            <label className="backup-toggle">
              <input
                checked={settings.enabled}
                disabled={!canMutate || !destinationAvailable}
                onChange={(event) => {
                  settingsDirty.current = true;
                  setSettings((current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }));
                }}
                type="checkbox"
              />
              <span>Enable scheduled backups</span>
            </label>
            <label>
              <span>Interval (minutes)</span>
              <input
                aria-label="Backup interval minutes"
                disabled={!canMutate || !destinationAvailable}
                max={SETTING_LIMITS.intervalMinutes.max}
                min={SETTING_LIMITS.intervalMinutes.min}
                onChange={(event) =>
                  updateNumber("intervalMinutes", event.target.value)
                }
                type="number"
                value={numericDraft.intervalMinutes}
              />
            </label>
            <label>
              <span>Keep recent</span>
              <input
                aria-label="Recent backup retention"
                disabled={!canMutate || !destinationAvailable}
                max={SETTING_LIMITS.keepRecent.max}
                min={SETTING_LIMITS.keepRecent.min}
                onChange={(event) =>
                  updateNumber("keepRecent", event.target.value)
                }
                type="number"
                value={numericDraft.keepRecent}
              />
            </label>
            <label>
              <span>Keep daily</span>
              <input
                aria-label="Daily backup retention"
                disabled={!canMutate || !destinationAvailable}
                max={SETTING_LIMITS.keepDaily.max}
                min={SETTING_LIMITS.keepDaily.min}
                onChange={(event) =>
                  updateNumber("keepDaily", event.target.value)
                }
                type="number"
                value={numericDraft.keepDaily}
              />
            </label>
          </div>
          {settingsError && <p className="backup-error">{settingsError}</p>}
          <button
            disabled={
              !canMutate || !destinationAvailable || mutation === "settings"
            }
            onClick={() => void saveSettings()}
            type="button"
          >
            {mutation === "settings" ? "Saving…" : "Save settings"}
          </button>
          {!destinationAvailable && status !== null && (
            <p className="backup-disabled-note">
              Settings are disabled until a backup destination is configured.
            </p>
          )}
        </section>
      </div>

      <section
        className="backup-card backup-list-card"
        aria-labelledby="backup-list-title"
      >
        <div className="backup-card-heading">
          <div>
            <p className="eyebrow">Recovery points</p>
            <h2 id="backup-list-title">Dated backups</h2>
          </div>
          <button
            disabled={!canMutate || !destinationAvailable || mutation !== null}
            onClick={() => void runCreate()}
            type="button"
          >
            {mutation === "create" ? "Creating…" : "Create backup now"}
          </button>
        </div>

        {confirmRestore && (
          <div className="backup-confirm backup-confirm-restore" role="alert">
            <strong>Restore {formatDate(confirmRestore.createdAt)}?</strong>
            <p>
              This replaces current Factory data, creates a safety backup first,
              and restarts the service. The dashboard may disconnect and will
              reload only after reconnection.
            </p>
            <div className="detail-actions">
              <button
                className="danger"
                disabled={!canMutate || mutation === "restore"}
                onClick={() => void restoreBackup(confirmRestore)}
                type="button"
              >
                {mutation === "restore" ? "Restoring…" : "Confirm restore"}
              </button>
              <button
                className="secondary"
                disabled={mutation === "restore"}
                onClick={() => setConfirmRestore(null)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {restoreState === "uncertain" && (
          <div className="backup-confirm backup-confirm-restore" role="alert">
            <strong>Restore outcome needs reconciliation.</strong>
            <p>
              The connection closed before Factory could confirm the restore.
              Reload the dashboard and verify the backup state before attempting
              another operation.
            </p>
            <div className="detail-actions">
              <button
                className="danger"
                onClick={reloadAfterUncertainRestore}
                type="button"
              >
                Reload to reconcile
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="empty">Loading backups…</p>
        ) : backups.length === 0 ? (
          <p className="empty">No backups are available yet.</p>
        ) : (
          <div className="backup-table-wrap">
            <table className="backup-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Trigger</th>
                  <th>Size</th>
                  <th>Contents</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td data-label="Date">{formatDate(backup.createdAt)}</td>
                    <td data-label="Trigger">{backup.trigger}</td>
                    <td data-label="Size">{formatBytes(backup.sizeBytes)}</td>
                    <td data-label="Contents">{formatContents(backup)}</td>
                    <td data-label="Actions">
                      {confirmDelete === backup.id ? (
                        <div className="backup-inline-confirm">
                          <span>Delete this backup?</span>
                          <button
                            className="danger"
                            disabled={!canMutate || mutation === "delete"}
                            onClick={() => void deleteBackup(backup.id)}
                            type="button"
                          >
                            {mutation === "delete" ? "Deleting…" : "Confirm"}
                          </button>
                          <button
                            className="secondary"
                            disabled={mutation === "delete"}
                            onClick={() => setConfirmDelete(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="backup-row-actions">
                          <button
                            className="secondary"
                            disabled={!canMutate || mutation !== null}
                            onClick={() => setConfirmRestore(backup)}
                            type="button"
                          >
                            Restore
                          </button>
                          <button
                            className="secondary"
                            disabled={!canMutate || mutation !== null}
                            onClick={() => setConfirmDelete(backup.id)}
                            type="button"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
