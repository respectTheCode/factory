import { useEffect, useRef, useState } from "react";
import { createTRPCProxyClient } from "@trpc/client";

import type { FactoryRouter } from "../server";
import type {
  T3ConnectionStatus,
  T3ConnectionSummary,
} from "../t3-connections";

type ConnectionsClient = ReturnType<
  typeof createTRPCProxyClient<FactoryRouter>
>;

type ConnectionDraft = {
  sourceId?: string;
  label: string;
  baseUrl: string;
  machineId: string;
  accessToken: string;
};

type ConnectionsPageProps = {
  client: ConnectionsClient | null;
  canManage: boolean;
};

const emptyDraft = (): ConnectionDraft => ({
  label: "",
  baseUrl: "",
  machineId: "",
  accessToken: "",
});

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The T3 connection request failed.";
}

function formatDate(value: string | Date | undefined): string {
  if (!value) return "Never";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function stateLabel(state: string): string {
  return state
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function statusTone(state: string): "good" | "down" | "neutral" {
  if (state === "connected") return "good";
  if (state === "unavailable" || state === "not_configured") return "neutral";
  return "down";
}

function savedSourceTitle(source: T3ConnectionSummary): string {
  return source.label?.trim() || source.machineId;
}

export function ConnectionsPage({ client, canManage }: ConnectionsPageProps) {
  const [sources, setSources] = useState<T3ConnectionSummary[] | null>(null);
  const [statuses, setStatuses] = useState<T3ConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConnectionDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<T3ConnectionStatus | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const sourceRequestVersion = useRef(0);
  const lifecycleVersion = useRef(0);
  const saveVersion = useRef(0);
  const testVersion = useRef(0);
  const testDraftVersion = useRef(0);

  useEffect(() => {
    lifecycleVersion.current += 1;
    const version = lifecycleVersion.current;
    return () => {
      if (lifecycleVersion.current === version) lifecycleVersion.current += 1;
    };
  }, []);

  const loadSources = async () => {
    if (!client) return;
    const version = ++sourceRequestVersion.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await client.t3.connections.list.query({});
      if (sourceRequestVersion.current === version) setSources(result.sources);
    } catch (error) {
      if (sourceRequestVersion.current === version)
        setLoadError(errorMessage(error));
    } finally {
      if (sourceRequestVersion.current === version) setLoading(false);
    }
  };

  const refreshStatuses = async (sourceId?: string) => {
    if (!client) return;
    const version = ++requestVersion.current;
    setRefreshing(true);
    setRefreshError(null);
    setStatuses((current) =>
      sourceId ? current.filter((status) => status.sourceId !== sourceId) : [],
    );
    try {
      const result = await client.t3.connections.refresh.query(
        sourceId ? { sourceId } : {},
      );
      if (requestVersion.current === version) {
        setStatuses((current) => {
          if (!sourceId) return result;
          return [
            ...current.filter((status) => status.sourceId !== sourceId),
            ...result,
          ];
        });
      }
    } catch (error) {
      if (requestVersion.current === version) {
        setRefreshError(errorMessage(error));
      }
    } finally {
      if (requestVersion.current === version) setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadSources();
    void refreshStatuses();
    return () => {
      requestVersion.current += 1;
      sourceRequestVersion.current += 1;
    };
  }, [client]);

  const startAdd = () => {
    testVersion.current += 1;
    setTestBusy(false);
    setSaveMessage(null);
    setDraftError(null);
    setTestResult(null);
    setDraft(emptyDraft());
  };

  const startEdit = (source: T3ConnectionSummary) => {
    testVersion.current += 1;
    setTestBusy(false);
    setSaveMessage(null);
    setDraftError(null);
    setTestResult(null);
    setDraft({
      sourceId: source.sourceId,
      label: source.label ?? "",
      baseUrl: source.baseUrl,
      machineId: source.machineId,
      accessToken: "",
    });
  };

  const updateDraft = (
    key: keyof Omit<ConnectionDraft, "sourceId">,
    value: string,
  ) => {
    testDraftVersion.current += 1;
    testVersion.current += 1;
    setTestBusy(false);
    setTestResult(null);
    setDraftError(null);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const closeEditor = () => {
    testVersion.current += 1;
    setTestBusy(false);
    setDraft(null);
    setDraftError(null);
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!client || !draft || testBusy) return;
    const version = ++testVersion.current;
    const lifecycle = lifecycleVersion.current;
    const draftVersion = testDraftVersion.current;
    setTestBusy(true);
    setDraftError(null);
    setTestResult(null);
    try {
      const result = await client.t3.connections.test.mutate({
        ...(draft.sourceId ? { sourceId: draft.sourceId } : {}),
        label: draft.label.trim(),
        baseUrl: draft.baseUrl.trim(),
        machineId: draft.machineId.trim(),
        ...(draft.accessToken ? { accessToken: draft.accessToken } : {}),
      });
      if (
        lifecycleVersion.current === lifecycle &&
        testVersion.current === version &&
        testDraftVersion.current === draftVersion
      ) {
        setTestResult(result);
      }
    } catch (error) {
      if (
        lifecycleVersion.current === lifecycle &&
        testVersion.current === version &&
        testDraftVersion.current === draftVersion
      ) {
        setDraftError(errorMessage(error));
      }
    } finally {
      if (
        lifecycleVersion.current === lifecycle &&
        testVersion.current === version
      )
        setTestBusy(false);
    }
  };

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !draft || !canManage || saveBusy) return;
    setSaveBusy(true);
    const version = ++saveVersion.current;
    const lifecycle = lifecycleVersion.current;
    testVersion.current += 1;
    setTestBusy(false);
    setTestResult(null);
    setDraftError(null);
    setSaveMessage(null);
    try {
      await client.t3.connections.save.mutate({
        ...(draft.sourceId ? { sourceId: draft.sourceId } : {}),
        label: draft.label.trim(),
        baseUrl: draft.baseUrl.trim(),
        machineId: draft.machineId.trim(),
        ...(draft.accessToken ? { accessToken: draft.accessToken } : {}),
      });
      if (
        lifecycleVersion.current !== lifecycle ||
        saveVersion.current !== version
      )
        return;
      setDraft(null);
      setTestResult(null);
      setSaveMessage("Connection saved.");
      await loadSources();
      if (lifecycleVersion.current !== lifecycle) return;
      await refreshStatuses();
    } catch (error) {
      if (
        lifecycleVersion.current === lifecycle &&
        saveVersion.current === version
      )
        setDraftError(errorMessage(error));
    } finally {
      if (
        lifecycleVersion.current === lifecycle &&
        saveVersion.current === version
      )
        setSaveBusy(false);
    }
  };

  const statusFor = (sourceId: string) =>
    statuses.find((status) => status.sourceId === sourceId);

  return (
    <section className="connections-page" aria-labelledby="connections-title">
      <div className="connections-heading">
        <div>
          <p className="eyebrow">Factory settings</p>
          <h1 id="connections-title">T3 connections</h1>
          <p className="connections-intro">
            Manage the Macs that provide read-only T3 activity to Factory.
          </p>
        </div>
        <div className="connections-heading-actions">
          <button
            className="secondary"
            disabled={!client || refreshing}
            onClick={() => void refreshStatuses()}
            type="button"
          >
            {refreshing ? "Checking…" : "Refresh status"}
          </button>
          <button
            disabled={!canManage || saveBusy}
            onClick={startAdd}
            type="button"
          >
            Add Mac
          </button>
        </div>
      </div>

      <aside className="connections-guidance" aria-label="Connection setup">
        <strong>Before you connect</strong>
        <p>
          Make sure this Factory server can reach each Mac’s T3 endpoint over
          your private network. Use a dedicated read-only T3 token. Saved tokens
          are never shown here.
        </p>
      </aside>

      {loadError && (
        <p className="connections-error" role="alert">
          Could not load T3 connections: {loadError}{" "}
          <button
            className="secondary"
            onClick={() => void loadSources()}
            type="button"
          >
            Retry
          </button>
        </p>
      )}
      {refreshError && (
        <p className="connections-error" role="status">
          Could not refresh connection status: {refreshError}
        </p>
      )}
      {saveMessage && (
        <p className="connections-success" role="status">
          {saveMessage}
        </p>
      )}

      {loading && (
        <p className="connections-empty">
          {client
            ? "Loading T3 connections…"
            : "Waiting for the Factory connection…"}
        </p>
      )}
      {!loading && !loadError && sources?.length === 0 && !draft && (
        <div className="connections-empty-state">
          <h2>No Macs connected</h2>
          <p>Add a Mac to start reading its T3 activity in Factory.</p>
          <button
            disabled={!canManage || saveBusy}
            onClick={startAdd}
            type="button"
          >
            Add a Mac
          </button>
        </div>
      )}

      {sources && sources.length > 0 && (
        <div
          className="connections-list"
          aria-label="Configured T3 connections"
        >
          {sources.map((source) => {
            const status = statusFor(source.sourceId);
            return (
              <article className="connection-card" key={source.sourceId}>
                <div className="connection-card-heading">
                  <div className="connection-card-title">
                    <h2>{savedSourceTitle(source)}</h2>
                    <span
                      className={`connection-health connection-health-${status ? statusTone(status.state) : "neutral"}`}
                    >
                      {status ? stateLabel(status.state) : "Status unknown"}
                    </span>
                  </div>
                  <button
                    className="secondary"
                    disabled={!canManage || saveBusy}
                    onClick={() => startEdit(source)}
                    type="button"
                  >
                    Edit
                  </button>
                </div>
                <dl className="connection-fields">
                  <div>
                    <dt>Machine ID</dt>
                    <dd>{source.machineId}</dd>
                  </div>
                  <div>
                    <dt>T3 endpoint</dt>
                    <dd>{source.baseUrl}</dd>
                  </div>
                  <div>
                    <dt>Last successful fetch</dt>
                    <dd>
                      {refreshing
                        ? "Checking…"
                        : status
                          ? formatDate(status.lastSuccessfulFetchAt)
                          : "Not checked"}
                    </dd>
                  </div>
                  <div>
                    <dt>Read-only token</dt>
                    <dd>
                      {source.tokenConfigured ? "Configured" : "Not configured"}
                    </dd>
                  </div>
                  {status?.sourceVersion && (
                    <div>
                      <dt>Source version</dt>
                      <dd>{status.sourceVersion}</dd>
                    </div>
                  )}
                  {status?.projectCount !== undefined && (
                    <div>
                      <dt>Projects</dt>
                      <dd>{status.projectCount}</dd>
                    </div>
                  )}
                  {status?.threadCount !== undefined && (
                    <div>
                      <dt>Threads</dt>
                      <dd>{status.threadCount}</dd>
                    </div>
                  )}
                </dl>
                {status?.error && (
                  <p className="connections-status-error">{status.error}</p>
                )}
                {status?.observedAt && (
                  <p className="connections-observed">
                    Status checked {formatDate(status.observedAt)}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {draft && (
        <section
          className="connection-editor"
          aria-labelledby="connection-editor-title"
        >
          <div className="connection-editor-heading">
            <div>
              <p className="eyebrow">
                {draft.sourceId ? "Connection settings" : "New connection"}
              </p>
              <h2 id="connection-editor-title">
                {draft.sourceId ? "Edit T3 connection" : "Add a Mac"}
              </h2>
            </div>
            <button
              className="secondary"
              disabled={saveBusy}
              onClick={closeEditor}
              type="button"
            >
              Cancel
            </button>
          </div>
          <form
            className="connection-form"
            onSubmit={(event) => void handleSave(event)}
          >
            {draft.sourceId && (
              <div className="connection-stable-id">
                <span>Stable connection ID</span>
                <code>{draft.sourceId}</code>
                <small>This ID is fixed when the connection is created.</small>
              </div>
            )}
            <label>
              <span>Label</span>
              <input
                autoComplete="organization-title"
                disabled={saveBusy}
                maxLength={100}
                onChange={(event) =>
                  updateDraft("label", event.currentTarget.value)
                }
                required
                value={draft.label}
              />
            </label>
            <label>
              <span>T3 endpoint</span>
              <input
                autoComplete="url"
                disabled={saveBusy}
                onChange={(event) =>
                  updateDraft("baseUrl", event.currentTarget.value)
                }
                placeholder="http://192.168.6.50:3773"
                required
                type="url"
                value={draft.baseUrl}
              />
            </label>
            <label>
              <span>Machine ID</span>
              <input
                autoComplete="off"
                disabled={saveBusy}
                maxLength={200}
                onChange={(event) =>
                  updateDraft("machineId", event.currentTarget.value)
                }
                required
                value={draft.machineId}
              />
            </label>
            <label>
              <span>
                Read-only T3 token
                {draft.sourceId ? " (leave blank to keep saved token)" : ""}
              </span>
              <input
                autoComplete="new-password"
                disabled={saveBusy}
                onChange={(event) =>
                  updateDraft("accessToken", event.currentTarget.value)
                }
                placeholder={
                  draft.sourceId
                    ? "Saved token is not shown"
                    : "Paste read-only token"
                }
                required={!draft.sourceId}
                type="password"
                value={draft.accessToken}
              />
            </label>
            {draftError && (
              <p className="connections-error" role="alert">
                {draftError}
              </p>
            )}
            {testResult && (
              <div className="connection-test-result" role="status">
                <div>
                  <strong>Test result for these draft settings</strong>
                  <span
                    className={`connection-health connection-health-${statusTone(testResult.state)}`}
                  >
                    {stateLabel(testResult.state)}
                  </span>
                </div>
                <p>
                  This check is temporary. Save the form to apply these
                  settings.
                </p>
                {testResult.error && (
                  <p className="connections-status-error">{testResult.error}</p>
                )}
                {testResult.lastSuccessfulFetchAt && (
                  <p>
                    Successful fetch{" "}
                    {formatDate(testResult.lastSuccessfulFetchAt)}
                  </p>
                )}
              </div>
            )}
            <div className="connection-form-actions">
              <button
                className="secondary"
                disabled={
                  saveBusy ||
                  !client ||
                  testBusy ||
                  !draft.label.trim() ||
                  !draft.baseUrl.trim() ||
                  !draft.machineId.trim() ||
                  (!draft.sourceId && !draft.accessToken)
                }
                onClick={() => void handleTest()}
                type="button"
              >
                {testBusy ? "Testing…" : "Test connection"}
              </button>
              <button disabled={!canManage || saveBusy} type="submit">
                {saveBusy ? "Saving…" : "Save connection"}
              </button>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}
