import { createTRPCProxyClient } from "@trpc/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import type {
  Issue,
  IssueConnection,
  IssueDetail,
  IssuePullRequest,
  IssueStatus,
  IssueThread,
} from "../issues";
import type { FactoryRouter } from "../server";
import { issueNeedsMergedPullRequestsForDone } from "./issue-completion";
import {
  groupIssues,
  ISSUE_STATUSES,
  readCollapsedStatuses,
  writeCollapsedStatuses,
} from "./issue-board";
import { ProjectIcon, type ProjectIconSummary } from "./project-icon";
import "./issues.css";

type IssuesClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;
type ProjectSummary = ProjectIconSummary;
type IssuesPageProps = {
  canMutate: boolean;
  client: IssuesClient | null;
  onCreateProject: (name: string) => Promise<void>;
  onOpenProjectSettings: (projectId: string) => void;
  projects: ProjectSummary[];
};
type EditValues = {
  projectId: string;
  title: string;
  description: string;
  labels: string;
  branches: string;
  pullRequestUrls: string;
  status: IssueStatus;
};
type MessageDraft = { text: string; requestId?: string };

const STATUS_LABEL: Record<IssueStatus, string> = {
  done: "Done",
  wont_do: "Won’t do",
  needs_attention: "Needs attention",
  in_progress: "In progress",
  todo: "To do",
};
const REFRESH_INTERVAL_MS = 15_000;
const THREAD_MESSAGE_LIMIT = 5;

function statusTone(status: IssueStatus): string {
  return `issue-status-${status}`;
}

function parseLabels(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function parseEntries(value: string): string[] {
  return [
    ...new Set(
      value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function issueEditValues(issue: Issue): EditValues {
  return {
    branches: issue.branches.join("\n"),
    description: issue.description,
    labels: issue.labels.join(", "),
    projectId: issue.projectId,
    pullRequestUrls: issue.pullRequestUrls.join("\n"),
    status: issue.status,
    title: issue.title,
  };
}

function newEditValues(projectId: string): EditValues {
  return {
    branches: "",
    description: "",
    labels: "",
    projectId,
    pullRequestUrls: "",
    status: "todo",
    title: "",
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The issue request failed.";
}

function formatDate(value: string | Date | undefined): string {
  if (!value) return "Time unavailable";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dateTimeValue(value: string | Date): string | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function messageKey(issueId: string, thread: IssueThread): string {
  return `${issueId}:${thread.sourceId}:${thread.threadId}`;
}

function isIssueStatus(value: string | undefined): value is IssueStatus {
  return ISSUE_STATUSES.includes(value as IssueStatus);
}

function pullRequestLabel(pullRequest: IssuePullRequest): string {
  if (pullRequest.merged || pullRequest.state === "merged") return "Merged";
  if (pullRequest.state === "closed") return "Closed unmerged";
  if (pullRequest.state === "open") return "Open";
  return "Status unavailable";
}

function pullRequestTone(pullRequest: IssuePullRequest): string {
  if (pullRequest.merged || pullRequest.state === "merged")
    return "issue-pr-merged";
  if (pullRequest.state === "closed") return "issue-pr-closed";
  if (pullRequest.state === "open") return "issue-pr-open";
  return "issue-pr-unknown";
}

function pullRequestNumber(url: string): string {
  const match = /\/pull\/(\d+)(?:\/|$)/.exec(url);
  return match ? `#${match[1]}` : "PR";
}

function makeRequestId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function IssuesPage({
  canMutate,
  client,
  onCreateProject,
  onOpenProjectSettings,
  projects,
}: IssuesPageProps) {
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [selectedLabel, setSelectedLabel] = useState("all");
  const [search, setSearch] = useState("");
  const [collapsedStatuses, setCollapsedStatuses] = useState<IssueStatus[]>(
    () => readCollapsedStatuses(),
  );
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [detail, setDetail] = useState<IssueDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editValues, setEditValues] = useState<EditValues | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [messageDrafts, setMessageDrafts] = useState<
    Record<string, MessageDraft>
  >({});
  const [messageErrors, setMessageErrors] = useState<Record<string, string>>(
    {},
  );
  const [sendingKeys, setSendingKeys] = useState<Record<string, boolean>>({});
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectBusy, setProjectBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [movingIssueId, setMovingIssueId] = useState<string | null>(null);
  const [draggingIssueId, setDraggingIssueId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{
    status: IssueStatus;
    beforeId?: string;
  } | null>(null);
  const listGeneration = useRef(0);
  const detailGeneration = useRef(0);
  const activeIssueIdRef = useRef(activeIssueId);
  const activeSends = useRef(new Set<string>());
  const moveBusyRef = useRef(false);
  const issueDrag = useRef<{
    id: string;
    startX: number;
    startY: number;
    moved: boolean;
    status?: IssueStatus;
    beforeId?: string;
  } | null>(null);
  const activeIssue =
    issues?.find((issue) => issue.id === activeIssueId) ?? null;
  const detailIssue =
    detail?.issue.id === activeIssueId ? detail.issue : activeIssue;

  useEffect(() => {
    activeIssueIdRef.current = activeIssueId;
  }, [activeIssueId]);

  const refreshIssues = useCallback(async () => {
    if (!client || document.visibilityState === "hidden") return;
    const generation = ++listGeneration.current;
    try {
      const result = await client.issues.list.query({});
      if (listGeneration.current !== generation) return;
      setIssues(result);
      setListError(null);
      const selectedId = activeIssueIdRef.current;
      if (selectedId && !result.some((issue) => issue.id === selectedId)) {
        setActiveIssueId(null);
        setDetail(null);
      }
    } catch (error) {
      if (listGeneration.current === generation) setListError(errorText(error));
    }
  }, [client]);

  useEffect(() => {
    if (!client) {
      setIssues(null);
      return;
    }
    void refreshIssues();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshIssues();
    };
    const interval = window.setInterval(
      refreshWhenVisible,
      REFRESH_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      listGeneration.current += 1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [client, refreshIssues]);

  const refreshDetail = useCallback(
    async (issueId: string, background = false) => {
      if (
        !client ||
        activeIssueIdRef.current !== issueId ||
        document.visibilityState === "hidden"
      )
        return;
      const generation = ++detailGeneration.current;
      if (!background) {
        setDetailLoading(true);
        setDetailError(null);
      }
      try {
        const result = await client.issues.detail.query({ id: issueId });
        if (
          detailGeneration.current !== generation ||
          activeIssueIdRef.current !== issueId
        )
          return;
        setDetail(result);
        setIssues(
          (current) =>
            current?.map((issue) =>
              issue.id === result.issue.id ? result.issue : issue,
            ) ?? current,
        );
        setDetailError(null);
      } catch (error) {
        if (
          detailGeneration.current === generation &&
          activeIssueIdRef.current === issueId
        )
          setDetailError(errorText(error));
      } finally {
        if (
          detailGeneration.current === generation &&
          activeIssueIdRef.current === issueId &&
          !background
        )
          setDetailLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (!activeIssueId || !client) {
      setDetail(null);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    void refreshDetail(activeIssueId);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible")
        void refreshDetail(activeIssueId, true);
    };
    const interval = window.setInterval(
      refreshWhenVisible,
      REFRESH_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      detailGeneration.current += 1;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [activeIssueId, client, refreshDetail]);

  const labelOptions = useMemo(
    () =>
      [...new Set((issues ?? []).flatMap((issue) => issue.labels))].sort(
        (a, b) => a.localeCompare(b),
      ),
    [issues],
  );
  const visibleIssues = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (issues ?? []).filter((issue) => {
      if (selectedProjectId !== "all" && issue.projectId !== selectedProjectId)
        return false;
      if (selectedLabel !== "all" && !issue.labels.includes(selectedLabel))
        return false;
      if (!query) return true;
      const projectName =
        projects.find((project) => project.id === issue.projectId)?.name ?? "";
      const searchable = [
        issue.simpleId,
        issue.title,
        issue.description,
        projectName,
        ...issue.labels,
        ...issue.branches,
        ...issue.pullRequestUrls,
      ]
        .join(" ")
        .toLocaleLowerCase();
      return searchable.includes(query);
    });
  }, [issues, projects, search, selectedLabel, selectedProjectId]);
  const groupedIssues = useMemo(
    () => groupIssues(visibleIssues),
    [visibleIssues],
  );

  const toggleStatusGroup = (status: IssueStatus) => {
    const next = collapsedStatuses.includes(status)
      ? collapsedStatuses.filter((collapsed) => collapsed !== status)
      : [...collapsedStatuses, status];
    setCollapsedStatuses(next);
    writeCollapsedStatuses(next);
  };

  const moveIssue = async (
    id: string,
    status: IssueStatus,
    beforeId?: string,
  ) => {
    if (!client || !canMutate || moveBusyRef.current) return;
    const issue = issues?.find((item) => item.id === id);
    if (!issue) return;
    if (
      issue.status !== "done" &&
      status === "done" &&
      issueNeedsMergedPullRequestsForDone(
        issue.pullRequestUrls,
        issue.pullRequests,
      )
    ) {
      setMoveError(
        "All linked pull requests must be confirmed merged before this issue can be marked done.",
      );
      return;
    }
    if (status === issue.status && beforeId === id) return;

    moveBusyRef.current = true;
    setMovingIssueId(id);
    setMoveError(null);
    try {
      await client.issues.move.mutate({
        id,
        status,
        ...(beforeId ? { beforeId } : {}),
      });
      await refreshIssues();
      if (activeIssueIdRef.current === id) void refreshDetail(id, true);
    } catch (error) {
      setMoveError(errorText(error));
    } finally {
      moveBusyRef.current = false;
      setMovingIssueId(null);
    }
  };

  const findIssueDropTarget = (
    clientX: number,
    clientY: number,
    draggedId: string,
  ): { status: IssueStatus; beforeId?: string } | null => {
    const hovered = document.elementFromPoint(clientX, clientY);
    const target = hovered?.closest<HTMLElement>("[data-issue-status]");
    const status = isIssueStatus(target?.dataset.issueStatus)
      ? target.dataset.issueStatus
      : null;
    if (!target || !status) return null;

    const row = hovered?.closest<HTMLElement>("[data-issue-id]");
    if (!row || !target.contains(row)) return { status };
    const rect = row.getBoundingClientRect();
    const after = clientY > rect.top + rect.height / 2;
    const siblingRows = Array.from(row.parentElement?.children ?? []).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && Boolean(child.dataset.issueId),
    );
    const rowIndex = siblingRows.indexOf(row);
    const beforeId = after
      ? siblingRows[rowIndex + 1]?.dataset.issueId
      : row.dataset.issueId;

    if (row.dataset.issueId === draggedId && after) {
      return { status, beforeId: siblingRows[rowIndex + 1]?.dataset.issueId };
    }
    return { status, ...(beforeId ? { beforeId } : {}) };
  };

  const startIssueDrag = (
    event: PointerEvent<HTMLButtonElement>,
    issue: Issue,
  ) => {
    if (!canMutate || moveBusyRef.current) return;
    issueDrag.current = {
      id: issue.id,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateIssueDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = issueDrag.current;
    if (!current) return;
    if (
      !current.moved &&
      Math.hypot(
        event.clientX - current.startX,
        event.clientY - current.startY,
      ) < 6
    )
      return;
    current.moved = true;
    setDraggingIssueId(current.id);
    const target = findIssueDropTarget(
      event.clientX,
      event.clientY,
      current.id,
    );
    current.status = target?.status;
    current.beforeId = target?.beforeId;
    setDragOver(target);
  };

  const finishIssueDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = issueDrag.current;
    if (!current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    issueDrag.current = null;
    setDraggingIssueId(null);
    setDragOver(null);
    if (current.moved && current.status) {
      void moveIssue(current.id, current.status, current.beforeId);
    }
  };

  const cancelIssueDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    issueDrag.current = null;
    setDraggingIssueId(null);
    setDragOver(null);
  };

  const reorderIssue = (
    status: IssueStatus,
    id: string,
    direction: "up" | "down",
  ) => {
    const ids = groupedIssues
      .find(([groupStatus]) => groupStatus === status)?.[1]
      .map((issue) => issue.id);
    if (!ids) return;
    const index = ids.indexOf(id);
    if (index < 0) return;
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === ids.length - 1)
    )
      return;
    const beforeId = direction === "up" ? ids[index - 1] : ids[index + 2];
    void moveIssue(id, status, beforeId);
  };

  const replaceIssue = (issue: Issue) => {
    setIssues((current) =>
      current?.some((item) => item.id === issue.id)
        ? current.map((item) => (item.id === issue.id ? issue : item))
        : [...(current ?? []), issue],
    );
    setDetail((current) =>
      current?.issue.id === issue.id ? { ...current, issue } : current,
    );
  };

  const selectIssue = (issue: Issue) => {
    setActiveIssueId(issue.id);
    setEditorMode(null);
    setEditValues(null);
    setSaveError(null);
    setMobileDetailOpen(true);
  };

  const submitProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = projectName.trim();
    if (!name || projectBusy || !canMutate) return;
    setProjectBusy(true);
    setProjectError(null);
    try {
      await onCreateProject(name);
      setProjectName("");
      setProjectFormOpen(false);
    } catch (error) {
      setProjectError(errorText(error));
    } finally {
      setProjectBusy(false);
    }
  };

  const startCreate = () => {
    const projectId =
      selectedProjectId === "all" ? (projects[0]?.id ?? "") : selectedProjectId;
    setActiveIssueId(null);
    setDetail(null);
    setEditorMode("create");
    setEditValues(newEditValues(projectId));
    setSaveError(null);
    setMobileDetailOpen(true);
  };

  const startEdit = () => {
    if (!detailIssue) return;
    setEditorMode("edit");
    setEditValues(issueEditValues(detailIssue));
    setSaveError(null);
  };

  const cancelEdit = () => {
    setEditorMode(null);
    setEditValues(null);
    setSaveError(null);
  };

  const submitIssue = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client || !canMutate || !editValues || saveBusy) return;
    const title = editValues.title.trim();
    if (!title) {
      setSaveError("Add a title before saving.");
      return;
    }
    if (!editValues.projectId) {
      setSaveError("Choose a project before saving.");
      return;
    }
    if (
      editorMode === "edit" &&
      editValues.status === "done" &&
      issueNeedsMergedPullRequestsForDone(
        parseEntries(editValues.pullRequestUrls),
        detailIssue?.pullRequests ?? [],
      )
    ) {
      setSaveError(
        "All linked pull requests must be confirmed merged before this issue can be marked done.",
      );
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    try {
      let saved: Issue;
      if (editorMode === "create") {
        saved = await client.issues.create.mutate({
          branches: parseEntries(editValues.branches),
          description: editValues.description.trim(),
          labels: parseLabels(editValues.labels),
          projectId: editValues.projectId,
          pullRequestUrls: parseEntries(editValues.pullRequestUrls),
          title,
        });
        replaceIssue(saved);
        setActiveIssueId(saved.id);
        setMobileDetailOpen(true);
      } else if (editorMode === "edit" && detailIssue) {
        saved = await client.issues.update.mutate({
          branches: parseEntries(editValues.branches),
          description: editValues.description.trim(),
          id: detailIssue.id,
          labels: parseLabels(editValues.labels),
          pullRequestUrls: parseEntries(editValues.pullRequestUrls),
          status: editValues.status,
          title,
        });
        replaceIssue(saved);
        setEditValues(issueEditValues(saved));
        setEditorMode(null);
        void refreshDetail(saved.id, true);
      } else {
        return;
      }
      setEditorMode(null);
      setEditValues(null);
    } catch (error) {
      setSaveError(errorText(error));
    } finally {
      setSaveBusy(false);
    }
  };

  const updateMessageDraft = (key: string, text: string) => {
    setMessageDrafts((current) => ({ ...current, [key]: { text } }));
    setMessageErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const sendMessage = async (
    event: FormEvent<HTMLFormElement>,
    thread: IssueThread,
  ) => {
    event.preventDefault();
    if (!client || !canMutate || !detailIssue || thread.canSend === false)
      return;
    const key = messageKey(detailIssue.id, thread);
    const text = messageDrafts[key]?.text.trim() ?? "";
    if (!text || sendingKeys[key] || activeSends.current.has(key)) return;
    const requestId = messageDrafts[key]?.requestId ?? makeRequestId();
    activeSends.current.add(key);
    setMessageDrafts((current) => ({
      ...current,
      [key]: { text: current[key]?.text ?? "", requestId },
    }));
    setSendingKeys((current) => ({ ...current, [key]: true }));
    setMessageErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      await client.issues.sendMessage.mutate({
        id: detailIssue.id,
        requestId,
        sourceId: thread.sourceId,
        text,
        threadId: thread.threadId,
      });
      setMessageDrafts((current) => ({ ...current, [key]: { text: "" } }));
      void refreshDetail(detailIssue.id, true);
    } catch (error) {
      setMessageErrors((current) => ({ ...current, [key]: errorText(error) }));
    } finally {
      activeSends.current.delete(key);
      setSendingKeys((current) => ({ ...current, [key]: false }));
    }
  };

  const issueForPanel = detailIssue;
  const detailForPanel = detail?.issue.id === issueForPanel?.id ? detail : null;
  const selectedProject = projects.find(
    (project) => project.id === issueForPanel?.projectId,
  );
  const panelOpen = editorMode !== null || activeIssueId !== null;

  return (
    <section
      aria-label="Issue tracker"
      className="issues-page"
      data-mobile-detail={mobileDetailOpen && panelOpen ? "open" : "closed"}
    >
      <div className="issues-topbar">
        <div className="issues-title-block">
          <h1>Issues</h1>
        </div>
        <div className="issues-tools">
          <label className="issues-filter">
            <span>Project</span>
            <select
              aria-label="Filter by project"
              onChange={(event) => setSelectedProjectId(event.target.value)}
              value={selectedProjectId}
            >
              <option value="all">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="issues-filter">
            <span>Label</span>
            <select
              aria-label="Filter by label"
              onChange={(event) => setSelectedLabel(event.target.value)}
              value={selectedLabel}
            >
              <option value="all">All labels</option>
              {labelOptions.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="issues-search">
            <span className="sr-only">Search issues</span>
            <input
              aria-label="Search issues"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search issues"
              type="search"
              value={search}
            />
          </label>
          {selectedProjectId !== "all" && (
            <button
              className="secondary issue-project-settings-button"
              onClick={() => onOpenProjectSettings(selectedProjectId)}
              type="button"
            >
              Project settings
            </button>
          )}
          {canMutate && (
            <button
              className="secondary issue-new-project-button"
              onClick={() => {
                setProjectFormOpen((open) => !open);
                setProjectError(null);
              }}
              type="button"
            >
              {projectFormOpen ? "Close project form" : "New project"}
            </button>
          )}
          {canMutate && (
            <button
              className="issues-primary-button"
              onClick={startCreate}
              type="button"
            >
              New issue
            </button>
          )}
        </div>
      </div>

      {listError && issues !== null && (
        <div className="issues-error" role="alert">
          <span>Issues could not be refreshed: {listError}</span>
          <button
            className="secondary"
            onClick={() => void refreshIssues()}
            type="button"
          >
            Retry
          </button>
        </div>
      )}

      {projectFormOpen && (
        <form
          className="issue-project-creator"
          onSubmit={(event) => void submitProject(event)}
        >
          <label className="issue-project-create-name">
            <span>Project name</span>
            <input
              autoFocus
              disabled={projectBusy}
              maxLength={160}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
              required
              value={projectName}
            />
          </label>
          {projectError && (
            <span className="issue-form-error" role="alert">
              {projectError}
            </span>
          )}
          <button
            className="issues-primary-button"
            disabled={projectBusy || !projectName.trim()}
            type="submit"
          >
            {projectBusy ? "Creating…" : "Create project"}
          </button>
        </form>
      )}

      {draggingIssueId && (
        <div aria-hidden="true" className="issue-drag-status-strip">
          {ISSUE_STATUSES.map((status) => (
            <div
              className={`issue-drag-status-target ${statusTone(status)} ${
                dragOver?.status === status ? "issue-drag-status-over" : ""
              }`}
              data-issue-status={status}
              key={status}
            >
              <span aria-hidden="true" className="issue-status-dot" />
              {STATUS_LABEL[status]}
            </div>
          ))}
        </div>
      )}

      <div className="issues-layout">
        <section
          aria-label="Issue list"
          className={`issue-list-panel ${canMutate ? "issue-list-mutable" : ""}`}
        >
          {moveError && (
            <div className="issues-error issue-move-error" role="alert">
              <span>Issue could not be moved: {moveError}</span>
              <button
                aria-label="Dismiss issue move error"
                className="secondary"
                onClick={() => setMoveError(null)}
                type="button"
              >
                Dismiss
              </button>
            </div>
          )}
          {issues === null && listError ? (
            <div className="issue-no-results" role="alert">
              <h2>Issues could not be loaded</h2>
              <p>{listError}</p>
              <button
                className="secondary"
                onClick={() => void refreshIssues()}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : issues === null ? (
            <div aria-live="polite" className="issue-list-loading">
              <span className="issue-loading-mark" aria-hidden="true" />
              <p>{client ? "Loading issues…" : "Connecting to Factory…"}</p>
            </div>
          ) : (
            <div className="issue-groups">
              <div className="issue-list-heading" aria-hidden="true">
                <span>Issue</span>
                <span>Pull requests</span>
                <span>Branches</span>
                {canMutate && <span>Move</span>}
              </div>
              {issues.length === 0 ? (
                <div className="issue-board-notice" role="status">
                  <div>
                    <h2>No issues yet</h2>
                    <p>
                      Create an issue to keep its status, branches, pull
                      requests, and T3 threads together.
                    </p>
                    {projects.length === 0 && (
                      <p className="issue-empty-note">
                        Create a project before filing an issue.
                      </p>
                    )}
                  </div>
                  {canMutate && projects.length > 0 && (
                    <button
                      className="issues-primary-button"
                      onClick={startCreate}
                      type="button"
                    >
                      Create the first issue
                    </button>
                  )}
                </div>
              ) : visibleIssues.length === 0 ? (
                <div className="issue-board-notice" role="status">
                  <div>
                    <h2>No matching issues</h2>
                    <p>Change the project, label or search to see more.</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelectedProjectId("all");
                      setSelectedLabel("all");
                      setSearch("");
                    }}
                    type="button"
                  >
                    Clear filters
                  </button>
                </div>
              ) : null}
              {groupedIssues.map(([status, items]) => (
                <section
                  aria-labelledby={`issue-group-${status}`}
                  className={`issue-group ${
                    dragOver?.status === status ? "issue-group-drag-over" : ""
                  }`}
                  data-issue-status={status}
                  key={status}
                >
                  <h2
                    className={`issue-group-heading ${statusTone(status)}`}
                    id={`issue-group-${status}`}
                  >
                    <button
                      aria-controls={`issue-group-rows-${status}`}
                      aria-expanded={!collapsedStatuses.includes(status)}
                      className="issue-group-toggle"
                      onClick={() => toggleStatusGroup(status)}
                      type="button"
                    >
                      <span aria-hidden="true" className="issue-status-dot" />
                      <span>{STATUS_LABEL[status]}</span>
                      <span className="issue-group-count">{items.length}</span>
                      <span
                        aria-hidden="true"
                        className="issue-group-chevron"
                      />
                    </button>
                  </h2>
                  <div
                    className="issue-group-rows"
                    hidden={collapsedStatuses.includes(status)}
                    id={`issue-group-rows-${status}`}
                  >
                    {items.map((issue) => (
                      <IssueRow
                        active={issue.id === activeIssueId}
                        busy={movingIssueId !== null}
                        canMutate={canMutate}
                        dragging={issue.id === draggingIssueId}
                        dropBefore={dragOver?.beforeId === issue.id}
                        key={issue.id}
                        onSelect={() => selectIssue(issue)}
                        issue={issue}
                        onMoveToStatus={(nextStatus) =>
                          void moveIssue(issue.id, nextStatus)
                        }
                        onPointerCancel={cancelIssueDrag}
                        onPointerDown={(event) => startIssueDrag(event, issue)}
                        onPointerMove={updateIssueDrag}
                        onPointerUp={finishIssueDrag}
                        onReorder={(direction) =>
                          reorderIssue(status, issue.id, direction)
                        }
                        projectIcon={(() => {
                          const project = projects.find(
                            (p) => p.id === issue.projectId,
                          );
                          return project ? (
                            <ProjectIcon client={client} project={project} />
                          ) : null;
                        })()}
                        projectName={
                          projects.find(
                            (project) => project.id === issue.projectId,
                          )?.name
                        }
                      />
                    ))}
                    {items.length === 0 && (
                      <div
                        aria-label={`${STATUS_LABEL[status]} has no visible issues`}
                        className={`issue-group-empty ${
                          dragOver?.status === status
                            ? "issue-group-empty-drag-over"
                            : ""
                        }`}
                      >
                        {draggingIssueId ? "Drop issue here" : "No issues here"}
                      </div>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>

        {panelOpen && (
          <aside
            aria-labelledby="issue-panel-title"
            className="issue-detail-panel"
          >
            <button
              className="issue-back-button"
              onClick={() => setMobileDetailOpen(false)}
              type="button"
            >
              ← All issues
            </button>
            {editorMode ? (
              <IssueEditor
                canMutate={canMutate}
                editValues={editValues}
                error={saveError}
                mode={editorMode}
                onCancel={cancelEdit}
                onChange={setEditValues}
                onSubmit={(event) => void submitIssue(event)}
                pullRequests={
                  editorMode === "edit" ? (detailIssue?.pullRequests ?? []) : []
                }
                projects={projects}
                saving={saveBusy}
              />
            ) : issueForPanel ? (
              <>
                <div className="issue-detail-heading">
                  <div className="issue-detail-title-row">
                    <span className="issue-id">{issueForPanel.simpleId}</span>
                    <span
                      className={`issue-status-chip ${statusTone(issueForPanel.status)}`}
                    >
                      <span aria-hidden="true" className="issue-status-dot" />
                      {STATUS_LABEL[issueForPanel.status]}
                    </span>
                  </div>
                  <h2 id="issue-panel-title">{issueForPanel.title}</h2>
                  <p className="issue-project-name">
                    {selectedProject && (
                      <ProjectIcon client={client} project={selectedProject} />
                    )}
                    {selectedProject?.name ?? "Project unavailable"}
                  </p>
                </div>
                <div className="issue-detail-actions">
                  {canMutate && (
                    <button
                      className="secondary"
                      onClick={startEdit}
                      type="button"
                    >
                      Edit issue
                    </button>
                  )}
                  {issueForPanel.projectId && (
                    <button
                      className="secondary"
                      onClick={() =>
                        onOpenProjectSettings(issueForPanel.projectId)
                      }
                      type="button"
                    >
                      Project settings
                    </button>
                  )}
                </div>
                <div className="issue-detail-section">
                  <h3>Description</h3>
                  {issueForPanel.description ? (
                    <p className="issue-description">
                      {issueForPanel.description}
                    </p>
                  ) : (
                    <p className="issue-muted">No description.</p>
                  )}
                </div>
                {issueForPanel.labels.length > 0 && (
                  <div className="issue-detail-section">
                    <h3>Labels</h3>
                    <div className="issue-label-list">
                      {issueForPanel.labels.map((label) => (
                        <span className="issue-label" key={label}>
                          {label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="issue-detail-section">
                  <h3>Pull requests</h3>
                  {issueForPanel.pullRequests.length > 0 ? (
                    <ul className="issue-pr-list">
                      {issueForPanel.pullRequests.map((pullRequest) => (
                        <li key={pullRequest.url}>
                          <a
                            href={pullRequest.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {pullRequestNumber(pullRequest.url)}{" "}
                            <span className="sr-only">
                              (opens in a new tab)
                            </span>
                          </a>
                          <span
                            className={`issue-pr-badge ${pullRequestTone(pullRequest)}`}
                          >
                            {pullRequestLabel(pullRequest)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="issue-muted">No pull requests linked.</p>
                  )}
                </div>
                {detailLoading && !detail && (
                  <p className="issue-detail-loading" role="status">
                    Loading linked threads…
                  </p>
                )}
                {detailError && (
                  <div className="issues-error issue-detail-error" role="alert">
                    <span>
                      Thread details could not be{" "}
                      {detailForPanel ? "refreshed" : "loaded"}: {detailError}
                    </span>
                    <button
                      className="secondary"
                      onClick={() => void refreshDetail(issueForPanel.id)}
                      type="button"
                    >
                      Retry
                    </button>
                  </div>
                )}
                <ThreadSection
                  canMutate={canMutate}
                  loading={
                    detailLoading || (!detailForPanel && detailError === null)
                  }
                  failed={detailError !== null && !detailForPanel}
                  issueId={issueForPanel.id}
                  connections={detailForPanel?.connections ?? []}
                  threads={detailForPanel?.threads ?? []}
                  messageDrafts={messageDrafts}
                  messageErrors={messageErrors}
                  onDraftChange={updateMessageDraft}
                  onSend={(event, thread) => void sendMessage(event, thread)}
                  sendingKeys={sendingKeys}
                />
                <p className="issue-updated">
                  Updated {formatDate(issueForPanel.updatedAt)}
                </p>
              </>
            ) : (
              <div className="issue-detail-loading" role="status">
                Select an issue to see its details.
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

function IssueRow({
  active,
  busy,
  canMutate,
  dragging,
  dropBefore,
  issue,
  onMoveToStatus,
  onPointerCancel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onReorder,
  onSelect,
  projectName,
  projectIcon,
}: {
  active: boolean;
  busy: boolean;
  canMutate: boolean;
  dragging: boolean;
  dropBefore: boolean;
  issue: Issue;
  onMoveToStatus: (status: IssueStatus) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onReorder: (direction: "up" | "down") => void;
  onSelect: () => void;
  projectName?: string;
  projectIcon?: ReactNode;
}) {
  const pullRequests = issue.pullRequests;
  return (
    <div
      className={`issue-row ${active ? "issue-row-active" : ""} ${
        dragging ? "issue-row-dragging" : ""
      } ${dropBefore ? "issue-row-drop-before" : ""}`}
      data-issue-id={issue.id}
    >
      <div className="issue-row-main">
        <span
          aria-hidden="true"
          className={`issue-row-status ${statusTone(issue.status)}`}
        />
        <button
          aria-current={active ? "true" : undefined}
          className="issue-row-select"
          onClick={onSelect}
          type="button"
        >
          <span className="issue-row-ident">
            <span className="issue-id">{issue.simpleId}</span>
            {projectName && (
              <span className="issue-row-project">
                {projectIcon}
                {projectName}
              </span>
            )}
          </span>
          <span className="issue-row-title">{issue.title}</span>
        </button>
        {issue.labels.length > 0 && (
          <div aria-label="Labels" className="issue-row-labels" role="group">
            {issue.labels.slice(0, 3).map((label) => (
              <span className="issue-label" key={label}>
                {label}
              </span>
            ))}
            {issue.labels.length > 3 && (
              <span className="issue-label-more">
                +{issue.labels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
      <div
        aria-label="Pull request status"
        className="issue-row-prs"
        role="group"
      >
        {pullRequests.length ? (
          pullRequests.slice(0, 2).map((pullRequest) => (
            <a
              className={`issue-row-pr ${pullRequestTone(pullRequest)}`}
              href={pullRequest.url}
              key={pullRequest.url}
              rel="noreferrer"
              target="_blank"
            >
              <span>{pullRequestNumber(pullRequest.url)}</span>
              <span>{pullRequestLabel(pullRequest)}</span>
            </a>
          ))
        ) : (
          <span className="issue-row-empty-hint">No PR</span>
        )}
        {pullRequests.length > 2 && (
          <span className="issue-row-count">+{pullRequests.length - 2}</span>
        )}
      </div>
      <div
        aria-label="Linked branches"
        className="issue-row-branches"
        role="group"
      >
        {issue.branches.length ? (
          <>
            <span className="issue-branch-name">{issue.branches[0]}</span>
            {issue.branches.length > 1 && (
              <span className="issue-row-count">
                +{issue.branches.length - 1}
              </span>
            )}
          </>
        ) : (
          <span className="issue-row-empty-hint">No branch</span>
        )}
      </div>
      {canMutate && (
        <div className="issue-row-actions">
          <button
            aria-keyshortcuts="ArrowUp ArrowDown"
            aria-label={`Reorder ${issue.simpleId}. Use up and down arrow keys.`}
            className="issue-row-reorder"
            disabled={busy}
            draggable={false}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              onReorder(event.key === "ArrowUp" ? "up" : "down");
            }}
            onPointerCancel={onPointerCancel}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            title="Drag to reorder or move between statuses. Use arrow keys to reorder."
            type="button"
          >
            <span aria-hidden="true">⠿</span>
          </button>
          <label className="issue-row-move-label">
            <span className="sr-only">Move {issue.simpleId} to status</span>
            <select
              aria-label={`Move ${issue.simpleId} to status`}
              disabled={busy}
              onChange={(event) => {
                if (isIssueStatus(event.target.value)) {
                  onMoveToStatus(event.target.value);
                }
              }}
              value=""
            >
              <option disabled value="">
                Move to…
              </option>
              {ISSUE_STATUSES.filter((status) => status !== issue.status).map(
                (status) => (
                  <option key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </option>
                ),
              )}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}

function IssueEditor({
  canMutate,
  editValues,
  error,
  mode,
  onCancel,
  onChange,
  onSubmit,
  pullRequests,
  projects,
  saving,
}: {
  canMutate: boolean;
  editValues: EditValues | null;
  error: string | null;
  mode: "create" | "edit";
  onCancel: () => void;
  onChange: (values: EditValues | null) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  pullRequests: IssuePullRequest[];
  projects: ProjectSummary[];
  saving: boolean;
}) {
  if (!editValues) return null;
  const setField = <K extends keyof EditValues>(
    key: K,
    value: EditValues[K],
  ) => {
    onChange({ ...editValues, [key]: value });
  };
  const pullRequestUrls = parseEntries(editValues.pullRequestUrls);
  const hasPullRequests = pullRequestUrls.length > 0 || pullRequests.length > 0;
  const doneNeedsMergedEvidence = issueNeedsMergedPullRequestsForDone(
    pullRequestUrls,
    pullRequests,
  );
  return (
    <form className="issue-editor" onSubmit={onSubmit}>
      <div className="issue-editor-heading">
        <p className="eyebrow">
          {mode === "create" ? "New record" : "Edit record"}
        </p>
        <h2 id="issue-panel-title">
          {mode === "create" ? "Create issue" : "Edit issue"}
        </h2>
      </div>
      <label className="issue-field">
        <span>Project</span>
        <select
          disabled={mode === "edit" || saving}
          onChange={(event) => setField("projectId", event.target.value)}
          required
          value={editValues.projectId}
        >
          <option value="">Choose a project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <label className="issue-field">
        <span>Title</span>
        <input
          autoFocus
          disabled={!canMutate || saving}
          maxLength={240}
          onChange={(event) => setField("title", event.target.value)}
          required
          value={editValues.title}
        />
      </label>
      <label className="issue-field">
        <span>Description</span>
        <textarea
          disabled={!canMutate || saving}
          onChange={(event) => setField("description", event.target.value)}
          rows={5}
          value={editValues.description}
        />
      </label>
      <label className="issue-field">
        <span>Labels</span>
        <input
          disabled={!canMutate || saving}
          onChange={(event) => setField("labels", event.target.value)}
          placeholder="bug, onboarding, api"
          value={editValues.labels}
        />
        <small>Separate labels with commas or new lines.</small>
      </label>
      <label className="issue-field">
        <span>Branches</span>
        <textarea
          disabled={!canMutate || saving}
          onChange={(event) => setField("branches", event.target.value)}
          placeholder="feature/issue-work"
          rows={3}
          value={editValues.branches}
        />
        <small>
          Use one branch per line. T3 threads match by repository and branch.
        </small>
      </label>
      <label className="issue-field">
        <span>Pull request URLs</span>
        <textarea
          disabled={!canMutate || saving}
          onChange={(event) => setField("pullRequestUrls", event.target.value)}
          placeholder="https://github.com/org/repo/pull/123"
          rows={3}
          value={editValues.pullRequestUrls}
        />
        <small>Use one GitHub pull request URL per line.</small>
      </label>
      <label className="issue-field">
        <span>Status</span>
        <select
          disabled={!canMutate || saving}
          onChange={(event) =>
            setField("status", event.target.value as IssueStatus)
          }
          value={editValues.status}
        >
          {ISSUE_STATUSES.map((status) => (
            <option
              disabled={status === "done" && doneNeedsMergedEvidence}
              key={status}
              value={status}
            >
              {STATUS_LABEL[status]}
              {status === "done" && doneNeedsMergedEvidence
                ? " · merge all PRs first"
                : ""}
            </option>
          ))}
        </select>
        <small>
          {hasPullRequests
            ? "All linked pull requests must be confirmed merged before marking this issue done."
            : "Issues without pull requests can be marked done manually."}
        </small>
      </label>
      {error && (
        <p className="issue-form-error" role="alert">
          {error}
        </p>
      )}
      <div className="issue-editor-actions">
        <button
          className="secondary"
          disabled={saving}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
        <button
          className="issues-primary-button"
          disabled={!canMutate || saving || projects.length === 0}
          type="submit"
        >
          {saving
            ? "Saving…"
            : mode === "create"
              ? "Create issue"
              : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function ThreadSection({
  canMutate,
  connections,
  failed,
  loading,
  issueId,
  threads,
  messageDrafts,
  messageErrors,
  onDraftChange,
  onSend,
  sendingKeys,
}: {
  canMutate: boolean;
  connections: IssueConnection[];
  loading: boolean;
  failed: boolean;
  issueId: string;
  threads: IssueThread[];
  messageDrafts: Record<string, MessageDraft>;
  messageErrors: Record<string, string>;
  onDraftChange: (key: string, text: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>, thread: IssueThread) => void;
  sendingKeys: Record<string, boolean>;
}) {
  const connectionProblems = connections.filter(
    (connection) => connection.state !== "connected" || connection.error,
  );
  return (
    <section className="issue-detail-section issue-threads-section">
      <div className="issue-thread-section-heading">
        <h3>T3 threads</h3>
        <span>
          {loading
            ? "Loading"
            : failed
              ? "Unavailable"
              : threads.length
                ? `${threads.length} linked`
                : "No match"}
        </span>
      </div>
      {loading ? (
        <p className="issue-muted">Loading linked T3 conversations…</p>
      ) : failed ? (
        <p className="issue-muted">
          Thread details are unavailable. Retry the detail request above.
        </p>
      ) : threads.length ? (
        <div className="issue-thread-list">
          {connectionProblems.length > 0 && (
            <p className="issue-thread-warning" role="status">
              Some T3 connections could not be checked. Review them in{" "}
              <a href="/connections">Connections</a>.
            </p>
          )}
          {threads.map((thread) => {
            const key = messageKey(issueId, thread);
            const messages =
              thread.messages?.slice(-THREAD_MESSAGE_LIMIT) ?? [];
            const sendDisabled =
              !canMutate ||
              thread.canSend === false ||
              !messageDrafts[key]?.text.trim() ||
              sendingKeys[key];
            return (
              <article
                className="issue-thread"
                key={`${thread.sourceId}:${thread.threadId}`}
              >
                <div className="issue-thread-heading">
                  <div className="issue-thread-title-wrap">
                    <h4>{thread.title || "T3 conversation"}</h4>
                    <p className="issue-thread-repo-branch">
                      <span>
                        {thread.repository || "Repository unavailable"}
                      </span>
                      <span aria-hidden="true">/</span>
                      <code>{thread.branch || "Branch unavailable"}</code>
                    </p>
                  </div>
                  <span
                    className={`issue-thread-state ${thread.state === "working" ? "working" : "stopped"}`}
                  >
                    {thread.state === "working" ? "Working" : "Stopped"}
                    {thread.current ? " · current" : ""}
                  </span>
                </div>
                <div
                  aria-label="Recent messages"
                  className="issue-thread-messages"
                >
                  {messages.length ? (
                    messages.map((message) => (
                      <div
                        className={`issue-thread-message role-${message.role}`}
                        key={message.id}
                      >
                        <div className="issue-thread-message-meta">
                          <strong>
                            {message.role === "user"
                              ? "You"
                              : message.role === "assistant"
                                ? "Agent"
                                : "System"}
                          </strong>
                          <time dateTime={dateTimeValue(message.createdAt)}>
                            {formatDate(message.createdAt)}
                          </time>
                        </div>
                        <p>{message.text}</p>
                      </div>
                    ))
                  ) : (
                    <p className="issue-muted">No recent messages available.</p>
                  )}
                </div>
                {thread.messageError && (
                  <p className="issue-thread-error" role="status">
                    {thread.messageError}
                  </p>
                )}
                {messageErrors[key] && (
                  <p className="issue-thread-error" role="alert">
                    Reply failed: {messageErrors[key]}
                  </p>
                )}
                {thread.canSend === false && (
                  <p className="issue-muted">
                    Replies require a T3 connection with orchestration:operate
                    permission. Update this connection in{" "}
                    <a href="/connections">Connections</a>.
                  </p>
                )}
                {!canMutate && thread.canSend !== false && (
                  <p className="issue-muted">
                    Factory is disconnected. Reconnect before sending a reply.
                  </p>
                )}
                <form
                  className="issue-reply-form"
                  onSubmit={(event) => onSend(event, thread)}
                >
                  <label className="sr-only" htmlFor={`issue-reply-${key}`}>
                    Reply to {thread.title || "T3 conversation"}
                  </label>
                  <textarea
                    disabled={
                      !canMutate ||
                      thread.canSend === false ||
                      Boolean(sendingKeys[key])
                    }
                    id={`issue-reply-${key}`}
                    onChange={(event) => onDraftChange(key, event.target.value)}
                    placeholder={
                      thread.canSend === false
                        ? "Replies unavailable"
                        : !canMutate
                          ? "Reconnect to Factory to reply"
                          : "Write a reply…"
                    }
                    rows={2}
                    value={messageDrafts[key]?.text ?? ""}
                  />
                  <button
                    className="secondary"
                    disabled={sendDisabled}
                    type="submit"
                  >
                    {sendingKeys[key] ? "Sending…" : "Send reply"}
                  </button>
                </form>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="issue-thread-empty">
          {connections.length === 0 ? (
            <>
              <p>No T3 connections are configured.</p>
              <p>
                Configure a connection in <a href="/connections">Connections</a>{" "}
                to find matching threads.
              </p>
            </>
          ) : connectionProblems.length > 0 ? (
            <>
              <p>T3 thread matches are unavailable.</p>
              <p>
                Restore the connection in <a href="/connections">Connections</a>{" "}
                and refresh this issue.
              </p>
            </>
          ) : (
            <>
              <p>No T3 thread matches this issue yet.</p>
              <p>Linked branches are matched within the project repository.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
