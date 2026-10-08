import { useEffect, useRef, useState } from "react";
import { createTRPCProxyClient } from "@trpc/client";

import type { FactoryRouter } from "../server";
import { useAgentTokenHandoff } from "./agent-token-handoff";

type AgentCredentialsClient = ReturnType<
  typeof createTRPCProxyClient<FactoryRouter>
>;

type AgentProject = { id: string; name: string };
type AgentCredential = {
  allProjects: boolean;
  createdAt: string;
  id: string;
  lastUsedAt: string | null;
  machineId: string;
  projectIds: string[];
  revokedAt: string | null;
  role: "coding" | "reviewer";
  reviewerName?: string;
};

type AgentCredentialList = {
  credentials: AgentCredential[];
  projects: AgentProject[];
};

type AgentCredentialDraft = {
  allProjects: boolean;
  machineId: string;
  projectIds: string[];
  reviewerName: string;
  role: "coding" | "reviewer";
};

type AgentAccessDraft = Pick<
  AgentCredentialDraft,
  "allProjects" | "projectIds"
>;

type PendingAction = {
  credentialId: string;
  kind: "revoke" | "rotate";
  machineId: string;
};
type OperationKind = "action" | "create" | "edit";

type AgentCredentialsProps = {
  canManage: boolean;
  client: AgentCredentialsClient | null;
};

const emptyDraft = (): AgentCredentialDraft => ({
  allProjects: false,
  machineId: "",
  projectIds: [],
  reviewerName: "",
  role: "coding",
});

export function agentCredentialDraftForRole(
  current: AgentCredentialDraft,
  role: AgentCredentialDraft["role"],
): AgentCredentialDraft {
  return {
    ...current,
    allProjects: role === "coding" ? false : current.allProjects,
    reviewerName: role === "reviewer" ? current.reviewerName : "",
    role,
  };
}

export function agentCredentialCreateInput(draft: AgentCredentialDraft) {
  const reviewerName = draft.reviewerName.trim();
  return {
    allProjects: draft.allProjects,
    machineId: draft.machineId.trim(),
    projectIds: draft.projectIds,
    ...(draft.role === "reviewer" && reviewerName ? { reviewerName } : {}),
    role: draft.role,
  };
}

export function agentCredentialAccessChanged(
  initial: AgentAccessDraft,
  current: AgentAccessDraft,
): boolean {
  if (initial.allProjects !== current.allProjects) return true;
  if (initial.projectIds.length !== current.projectIds.length) return true;
  const initialIds = new Set(initial.projectIds);
  return current.projectIds.some((projectId) => !initialIds.has(projectId));
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The agent credential request failed.";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function projectNames(
  credential: AgentCredential,
  projects: AgentProject[],
): string[] {
  const namesById = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  return credential.projectIds.map(
    (projectId) => namesById.get(projectId) ?? projectId,
  );
}

function ProjectCheckboxes({
  disabled,
  projects,
  selected,
  onToggle,
}: {
  disabled?: boolean;
  projects: AgentProject[];
  selected: string[];
  onToggle: (projectId: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <p className="agent-credentials-empty-projects">
        No Projects are configured.
      </p>
    );
  }
  return (
    <div className="agent-project-checkboxes">
      {projects.map((project) => (
        <label key={project.id}>
          <input
            checked={selected.includes(project.id)}
            disabled={disabled}
            onChange={() => onToggle(project.id)}
            type="checkbox"
          />
          <span>{project.name}</span>
        </label>
      ))}
    </div>
  );
}

export function AgentCredentialsSection({
  canManage,
  client,
}: AgentCredentialsProps) {
  const [data, setData] = useState<AgentCredentialList | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentCredentialDraft | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProjectIds, setEditProjectIds] = useState<string[]>([]);
  const [editAllProjects, setEditAllProjects] = useState(false);
  const [editInitialAccess, setEditInitialAccess] =
    useState<AgentAccessDraft | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccessId, setEditSuccessId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const tokenHandoff = useAgentTokenHandoff();
  const tokenNotice = tokenHandoff.notice;
  const lifecycleVersion = useRef(0);
  const requestVersion = useRef(0);
  const busyOperation = useRef<OperationKind | null>(null);
  const createEditorRef = useRef<HTMLElement>(null);
  const machineIdInputRef = useRef<HTMLInputElement>(null);
  const actionCancelRef = useRef<HTMLButtonElement>(null);
  const cardHeadingRefs = useRef<Record<string, HTMLHeadingElement | null>>({});
  const actionReturnFocus = useRef<{
    credentialId: string;
    element: HTMLButtonElement | null;
  } | null>(null);
  const restoreActionFocus = useRef<{
    credentialId: string;
    target: "trigger" | "heading";
  } | null>(null);

  const loadCredentials = async () => {
    if (!client) return;
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await client.agentCredentials.list.query({});
      if (requestVersion.current === version) setData(result);
    } catch (error) {
      if (requestVersion.current === version) setLoadError(errorMessage(error));
    } finally {
      if (requestVersion.current === version) setLoading(false);
    }
  };

  useEffect(() => {
    lifecycleVersion.current += 1;
    const lifecycle = lifecycleVersion.current;
    void loadCredentials();
    return () => {
      if (lifecycleVersion.current === lifecycle) lifecycleVersion.current += 1;
      requestVersion.current += 1;
    };
  }, [client]);

  const projects = data?.projects ?? [];
  const operationBusy =
    createBusy ||
    editBusy ||
    actionBusy ||
    busyOperation.current !== null ||
    tokenHandoff.pending;
  const editDirty =
    editingId !== null &&
    editInitialAccess !== null &&
    agentCredentialAccessChanged(editInitialAccess, {
      allProjects: editAllProjects,
      projectIds: editProjectIds,
    });
  const createOpen = draft !== null;

  useEffect(() => {
    if (!createOpen) return;
    const frame = window.requestAnimationFrame(() => {
      createEditorRef.current?.scrollIntoView({ block: "start" });
      machineIdInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createOpen]);

  useEffect(() => {
    if (pendingAction) {
      if (!actionBusy) actionCancelRef.current?.focus();
      return;
    }
    const restore = restoreActionFocus.current;
    if (!restore) return;
    const frame = window.requestAnimationFrame(() => {
      restoreActionFocus.current = null;
      if (restore.target === "trigger") {
        const trigger = actionReturnFocus.current;
        if (
          trigger?.credentialId === restore.credentialId &&
          trigger.element?.isConnected
        ) {
          trigger.element.focus();
          return;
        }
      }
      cardHeadingRefs.current[restore.credentialId]?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionBusy, pendingAction]);

  useEffect(() => {
    if (!pendingAction || actionBusy) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      restoreActionFocus.current = {
        credentialId: pendingAction.credentialId,
        target: "trigger",
      };
      setPendingAction(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [actionBusy, pendingAction]);

  const beginOperation = (kind: OperationKind): boolean => {
    if (busyOperation.current !== null) return false;
    busyOperation.current = kind;
    return true;
  };

  const endOperation = (kind: OperationKind): void => {
    if (busyOperation.current === kind) busyOperation.current = null;
  };

  const startCreate = () => {
    if (operationBusy || tokenNotice) return;
    setCreateError(null);
    setPendingAction(null);
    setDraft(emptyDraft());
  };

  const closeCreate = () => {
    if (createBusy) return;
    setDraft(null);
    setCreateError(null);
  };

  const toggleDraftProject = (projectId: string) => {
    setDraft((current) => {
      if (!current) return current;
      const projectIds = current.projectIds.includes(projectId)
        ? current.projectIds.filter((id) => id !== projectId)
        : [...current.projectIds, projectId];
      return { ...current, projectIds };
    });
  };

  const handleCreate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !draft || !canManage || operationBusy || tokenNotice) return;
    if (draft.role === "coding" && draft.projectIds.length === 0) {
      setCreateError("Select at least one Project for a coding credential.");
      return;
    }
    if (draft.role === "reviewer" && !draft.reviewerName.trim()) {
      setCreateError("Enter a reviewer name.");
      return;
    }
    if (!beginOperation("create")) return;
    const input = agentCredentialCreateInput(draft);
    const machineId = input.machineId;
    const lifecycle = lifecycleVersion.current;
    setCreateBusy(true);
    tokenHandoff.setPending(true);
    setCreateError(null);
    try {
      const result = await client.agentCredentials.create.mutate(input);
      tokenHandoff.issue({ kind: "created", machineId, token: result.token });
      if (lifecycleVersion.current !== lifecycle) return;
      setDraft(null);
      await loadCredentials();
    } catch (error) {
      if (lifecycleVersion.current === lifecycle) {
        setCreateError(errorMessage(error));
      }
    } finally {
      if (lifecycleVersion.current === lifecycle) setCreateBusy(false);
      tokenHandoff.setPending(false);
      endOperation("create");
    }
  };

  const startEdit = (credential: AgentCredential) => {
    if (operationBusy) return;
    if (editDirty) {
      setEditError(
        "Save or cancel your current Project access changes before editing another credential.",
      );
      return;
    }
    const projectIds = credential.allProjects
      ? projects.map((project) => project.id)
      : credential.projectIds;
    setEditingId(credential.id);
    setEditProjectIds(projectIds);
    setEditAllProjects(credential.allProjects);
    setEditInitialAccess({
      allProjects: credential.allProjects,
      projectIds,
    });
    setEditError(null);
    setEditSuccessId(null);
    setActionError(null);
    setPendingAction(null);
  };

  const cancelEdit = () => {
    if (editBusy) return;
    setEditingId(null);
    setEditInitialAccess(null);
    setEditError(null);
  };

  const toggleEditProject = (projectId: string) => {
    setEditProjectIds((current) =>
      current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId],
    );
  };

  const handleSaveAccess = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !editingId || !canManage || operationBusy || !editDirty)
      return;
    if (!beginOperation("edit")) return;
    const lifecycle = lifecycleVersion.current;
    setEditBusy(true);
    setEditError(null);
    try {
      await client.agentCredentials.updateProjectAccess.mutate({
        allProjects: editAllProjects,
        credentialId: editingId,
        projectIds: editProjectIds,
      });
      if (lifecycleVersion.current !== lifecycle) return;
      setEditSuccessId(editingId);
      setEditingId(null);
      setEditInitialAccess(null);
      await loadCredentials();
    } catch (error) {
      if (lifecycleVersion.current === lifecycle)
        setEditError(errorMessage(error));
    } finally {
      if (lifecycleVersion.current === lifecycle) setEditBusy(false);
      endOperation("edit");
    }
  };

  const runPendingAction = async () => {
    if (
      !client ||
      !pendingAction ||
      !canManage ||
      operationBusy ||
      (pendingAction.kind === "rotate" && tokenNotice)
    )
      return;
    if (!beginOperation("action")) return;
    const action = pendingAction;
    const lifecycle = lifecycleVersion.current;
    setActionBusy(true);
    if (action.kind === "rotate") tokenHandoff.setPending(true);
    setActionError(null);
    try {
      if (action.kind === "rotate") {
        const result = await client.agentCredentials.rotate.mutate({
          credentialId: action.credentialId,
        });
        tokenHandoff.issue({
          kind: "rotated",
          machineId: action.machineId,
          token: result.token,
        });
      } else {
        await client.agentCredentials.revoke.mutate({
          credentialId: action.credentialId,
        });
      }
      if (lifecycleVersion.current !== lifecycle) return;
      if (action.kind === "revoke") {
        restoreActionFocus.current = {
          credentialId: action.credentialId,
          target: "heading",
        };
      }
      setPendingAction(null);
      await loadCredentials();
    } catch (error) {
      if (lifecycleVersion.current === lifecycle) {
        setActionError(errorMessage(error));
        restoreActionFocus.current = {
          credentialId: action.credentialId,
          target: "trigger",
        };
        setPendingAction(null);
      }
    } finally {
      if (lifecycleVersion.current === lifecycle) setActionBusy(false);
      if (action.kind === "rotate") tokenHandoff.setPending(false);
      endOperation("action");
    }
  };

  const cancelPendingAction = () => {
    if (!pendingAction || actionBusy) return;
    restoreActionFocus.current = {
      credentialId: pendingAction.credentialId,
      target: "trigger",
    };
    setPendingAction(null);
  };

  const openPendingAction = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: PendingAction,
  ) => {
    actionReturnFocus.current = {
      credentialId: action.credentialId,
      element: event.currentTarget,
    };
    setActionError(null);
    setPendingAction(action);
  };

  return (
    <section
      className="agent-credentials"
      aria-labelledby="agent-credentials-title"
    >
      <div className="connections-heading">
        <div>
          <p className="eyebrow">Factory access</p>
          <h2 id="agent-credentials-title">Agent credentials</h2>
          <p className="connections-intro">
            Manage the credentials agents use to read Factory and report work.
            Project access changes apply to the existing token.
          </p>
        </div>
        <button
          disabled={!canManage || operationBusy || Boolean(tokenNotice)}
          onClick={startCreate}
          type="button"
        >
          Add credential
        </button>
      </div>

      {(tokenHandoff.pending || tokenNotice) && (
        <p className="agent-token-handoff-hint">
          {tokenNotice
            ? "Add credential and Rotate token are unavailable until you copy or save the one-time token and choose “I’ve saved it”."
            : "Add credential and Rotate token are unavailable while the one-time token is being issued. Keep this tab open."}
        </p>
      )}

      {loadError && (
        <p className="connections-error" role="alert">
          Could not load agent credentials: {loadError}{" "}
          <button
            className="secondary"
            onClick={() => void loadCredentials()}
            type="button"
          >
            Retry
          </button>
        </p>
      )}
      {actionError && (
        <p className="connections-error" role="alert">
          {actionError}
        </p>
      )}
      {loading && (
        <p className="connections-empty">
          {client
            ? "Loading agent credentials…"
            : "Waiting for the Factory connection…"}
        </p>
      )}
      {!loading && !loadError && data?.credentials.length === 0 && !draft && (
        <div className="connections-empty-state">
          <h3>No agent credentials</h3>
          <p>
            Create a credential for a coding agent or reviewer to connect to
            Factory.
          </p>
          <button
            disabled={!canManage || operationBusy || Boolean(tokenNotice)}
            onClick={startCreate}
            type="button"
          >
            Add credential
          </button>
        </div>
      )}

      {data && data.credentials.length > 0 && (
        <div className="agent-credentials-list" aria-label="Agent credentials">
          {data.credentials.map((credential) => {
            const names = credential.allProjects
              ? projects.map((project) => project.name)
              : projectNames(credential, projects);
            const isEditing = editingId === credential.id;
            const isActive = credential.revokedAt === null;
            return (
              <article className="agent-credential-card" key={credential.id}>
                <div className="connection-card-heading">
                  <div className="connection-card-title">
                    <h3
                      ref={(element) => {
                        cardHeadingRefs.current[credential.id] = element;
                      }}
                      tabIndex={-1}
                    >
                      {credential.machineId}
                    </h3>
                    <span className="connection-health connection-health-neutral">
                      {credential.role === "reviewer" ? "Reviewer" : "Coding"}
                    </span>
                    <span
                      className={`connection-health ${isActive ? "connection-health-good" : "connection-health-down"}`}
                    >
                      {isActive ? "Active" : "Revoked"}
                    </span>
                  </div>
                  {isActive && (
                    <div className="connections-heading-actions">
                      <button
                        className="secondary"
                        disabled={!canManage || operationBusy}
                        onClick={() => startEdit(credential)}
                        type="button"
                      >
                        Edit access
                      </button>
                      <button
                        className="secondary"
                        disabled={
                          !canManage || operationBusy || Boolean(tokenNotice)
                        }
                        onClick={(event) =>
                          openPendingAction(event, {
                            credentialId: credential.id,
                            kind: "rotate",
                            machineId: credential.machineId,
                          })
                        }
                        type="button"
                      >
                        Rotate token
                      </button>
                      <button
                        className="danger"
                        disabled={!canManage || operationBusy}
                        onClick={(event) =>
                          openPendingAction(event, {
                            credentialId: credential.id,
                            kind: "revoke",
                            machineId: credential.machineId,
                          })
                        }
                        type="button"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
                {credential.reviewerName && (
                  <p className="agent-credential-reviewer">
                    Reviewer name: {credential.reviewerName}
                  </p>
                )}
                <dl className="connection-fields">
                  <div>
                    <dt>Project access</dt>
                    <dd>
                      {credential.allProjects
                        ? `All Projects (${projects.length})`
                        : `${credential.projectIds.length} Project${credential.projectIds.length === 1 ? "" : "s"}`}
                    </dd>
                  </div>
                  <div>
                    <dt>Projects</dt>
                    <dd>
                      {names.length > 0 ? (
                        names.join(", ")
                      ) : (
                        <>
                          <span>None</span>{" "}
                          <span className="connection-health connection-health-down agent-access-disabled">
                            Access disabled
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Last used</dt>
                    <dd>{formatDate(credential.lastUsedAt)}</dd>
                  </div>
                  <div>
                    <dt>{isActive ? "Created" : "Revoked"}</dt>
                    <dd>
                      {formatDate(
                        isActive ? credential.createdAt : credential.revokedAt,
                      )}
                    </dd>
                  </div>
                </dl>

                {editSuccessId === credential.id && (
                  <p className="connections-success" role="status">
                    Project access saved.
                  </p>
                )}

                {pendingAction?.credentialId === credential.id && (
                  <div
                    aria-describedby={`agent-action-confirmation-message-${credential.id}`}
                    aria-labelledby={`agent-action-confirmation-title-${credential.id}`}
                    className={`agent-action-confirmation ${pendingAction.kind === "revoke" ? "agent-action-confirmation-danger" : ""}`}
                    role="group"
                  >
                    <strong
                      id={`agent-action-confirmation-title-${credential.id}`}
                    >
                      {pendingAction.kind === "revoke"
                        ? `Revoke ${credential.machineId}? Existing tokens will stop working.`
                        : `Rotate ${credential.machineId}'s token? The current token will stop working immediately.`}
                    </strong>
                    <p
                      className="agent-action-confirmation-message"
                      id={`agent-action-confirmation-message-${credential.id}`}
                    >
                      {pendingAction.kind === "revoke"
                        ? "This cannot be undone."
                        : "You will need to save the new token before leaving this page."}
                    </p>
                    <div className="connections-heading-actions">
                      <button
                        className={
                          pendingAction.kind === "revoke" ? "danger" : undefined
                        }
                        disabled={
                          operationBusy ||
                          (pendingAction.kind === "rotate" &&
                            Boolean(tokenNotice))
                        }
                        onClick={() => void runPendingAction()}
                        type="button"
                      >
                        {actionBusy
                          ? pendingAction.kind === "revoke"
                            ? "Revoking…"
                            : "Rotating…"
                          : pendingAction.kind === "revoke"
                            ? "Confirm revoke"
                            : "Confirm rotation"}
                      </button>
                      <button
                        className="secondary"
                        disabled={operationBusy}
                        onClick={cancelPendingAction}
                        ref={actionCancelRef}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {isEditing && (
                  <form
                    className="agent-access-editor"
                    onSubmit={(event) => void handleSaveAccess(event)}
                  >
                    <div>
                      <strong>Edit Project access</strong>
                      <p>
                        Clear every checkbox to disable this credential without
                        rotating its token.
                      </p>
                    </div>
                    {credential.role === "reviewer" && (
                      <label className="agent-all-projects-toggle">
                        <input
                          checked={editAllProjects}
                          disabled={operationBusy}
                          onChange={(event) => {
                            const allProjects = event.currentTarget.checked;
                            setEditAllProjects(allProjects);
                            if (allProjects)
                              setEditProjectIds(
                                projects.map((project) => project.id),
                              );
                          }}
                          type="checkbox"
                        />
                        <span>Allow access to all Projects</span>
                      </label>
                    )}
                    <fieldset
                      className="agent-project-fieldset"
                      disabled={operationBusy || editAllProjects}
                    >
                      <legend>Project access</legend>
                      <ProjectCheckboxes
                        disabled={operationBusy || editAllProjects}
                        onToggle={toggleEditProject}
                        projects={projects}
                        selected={editProjectIds}
                      />
                    </fieldset>
                    {editError && (
                      <p className="connections-error" role="alert">
                        {editError}
                      </p>
                    )}
                    <div className="connection-form-actions">
                      <button
                        className="secondary"
                        disabled={operationBusy}
                        onClick={cancelEdit}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={operationBusy || !canManage || !editDirty}
                        type="submit"
                      >
                        {editBusy ? "Saving…" : "Save access"}
                      </button>
                    </div>
                  </form>
                )}
              </article>
            );
          })}
        </div>
      )}

      {draft && (
        <section
          className="connection-editor"
          aria-labelledby="agent-credential-editor-title"
          ref={createEditorRef}
        >
          <div className="connection-editor-heading">
            <div>
              <p className="eyebrow">New agent credential</p>
              <h3 id="agent-credential-editor-title">Add credential</h3>
            </div>
            <button
              className="secondary"
              disabled={operationBusy}
              onClick={closeCreate}
              type="button"
            >
              Cancel
            </button>
          </div>
          <form
            className="connection-form"
            onSubmit={(event) => void handleCreate(event)}
          >
            <label>
              <span>Machine ID</span>
              <small className="agent-field-help" id="agent-machine-id-help">
                Use a stable lowercase machine name with letters, numbers, or
                hyphens.
              </small>
              <input
                autoComplete="off"
                aria-describedby="agent-machine-id-help"
                disabled={operationBusy}
                maxLength={63}
                ref={machineIdInputRef}
                onChange={(event) => {
                  const machineId = event.currentTarget.value;
                  setDraft((current) => current && { ...current, machineId });
                }}
                pattern={"[a-z0-9][a-z0-9\\-]{1,62}"}
                required
                value={draft.machineId}
              />
            </label>
            <label>
              <span>Role</span>
              <select
                disabled={operationBusy}
                onChange={(event) => {
                  const role = event.currentTarget
                    .value as AgentCredentialDraft["role"];
                  setDraft((current) =>
                    current
                      ? agentCredentialDraftForRole(current, role)
                      : current,
                  );
                }}
                value={draft.role}
              >
                <option value="coding">Coding agent</option>
                <option value="reviewer">Reviewer</option>
              </select>
            </label>
            {draft.role === "reviewer" && (
              <label>
                <span>Reviewer name</span>
                <input
                  autoComplete="name"
                  disabled={operationBusy}
                  onChange={(event) => {
                    const reviewerName = event.currentTarget.value;
                    setDraft(
                      (current) => current && { ...current, reviewerName },
                    );
                  }}
                  required
                  value={draft.reviewerName}
                />
              </label>
            )}
            {draft.role === "reviewer" && (
              <label className="agent-all-projects-toggle">
                <input
                  checked={draft.allProjects}
                  disabled={operationBusy}
                  onChange={(event) => {
                    const allProjects = event.currentTarget.checked;
                    setDraft(
                      (current) =>
                        current && {
                          ...current,
                          allProjects,
                        },
                    );
                  }}
                  type="checkbox"
                />
                <span>Allow access to all Projects</span>
              </label>
            )}
            <fieldset
              className="agent-project-fieldset"
              disabled={operationBusy || draft.allProjects}
            >
              <legend>Project access</legend>
              <ProjectCheckboxes
                disabled={operationBusy || draft.allProjects}
                onToggle={toggleDraftProject}
                projects={projects}
                selected={draft.projectIds}
              />
            </fieldset>
            {createError && (
              <p className="connections-error" role="alert">
                {createError}
              </p>
            )}
            <div className="connection-form-actions">
              <button
                disabled={
                  !canManage || operationBusy || !draft.machineId.trim()
                }
                type="submit"
              >
                {createBusy ? "Creating…" : "Create credential"}
              </button>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}
