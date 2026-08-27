import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { FactoryRouter } from "../server";
import { ConnectionState, type ConnectionSnapshot } from "./connection-state";
import {
  dashboardPath,
  dashboardViewFromPath,
  editProjectView,
  homeView,
  projectView,
  type DashboardView,
} from "./navigation";
import { createProjectAndRefresh } from "./project-actions";
import {
  filterAttention,
  summarizeTaskProgress,
  type AttentionFilter,
} from "./task-summary";
import "./styles.css";

type ProjectSummary = { id: string; name: string };
type WorkCounts = {
  planned: number;
  active: number;
  awaiting_verification: number;
  completed: number;
  blocked: number;
  released: number;
  wont_do: number;
};
type PortfolioStatus = {
  totalTasks: number;
  counts: WorkCounts;
  projects: Array<{
    projectId: string;
    projectName: string;
    totalTasks: number;
    counts: WorkCounts;
  }>;
};
type AttentionItem = {
  projectId: string;
  projectName: string;
  taskId: string;
  taskName: string;
  state: "planned" | "active" | "awaiting_verification" | "blocked";
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
};
type ProjectDetail = {
  gitOriginUrl?: string;
  id: string;
  name: string;
  trackerLinks: Array<{
    id: string;
    system: "linear" | "notion";
    stableId: string;
    title?: string;
    url: string;
  }>;
  tasks: Array<{
    id: string;
    name: string;
    projectId: string;
    branchName?: string;
    archiveState?: "released" | "wont_do";
    subtasks: Array<{
      id: string;
      name: string;
      taskId: string;
      description?: string;
      archiveState?: "released" | "wont_do";
    }>;
  }>;
};
type TaskStatus = {
  taskCompleted: boolean;
  taskState:
    | "planned"
    | "active"
    | "awaiting_verification"
    | "completed"
    | "blocked"
    | "released"
    | "wont_do";
  archiveState?: "released" | "wont_do";
  subtasks: Array<{
    reportedState?: "not_started" | "in_progress" | "blocked" | "complete";
    verificationState:
      | "accepted"
      | "awaiting_verification"
      | "deferred"
      | "rejected"
      | "unreported";
    reportId?: string;
    evidence?: string;
    reporter?: string;
    archiveState?: "released" | "wont_do";
  }>;
};
type TaskDetail = {
  branchName?: string;
  id: string;
  name: string;
  projectId: string;
  objective?: string;
  acceptanceCriteria: string[];
  priority?: "low" | "medium" | "high" | "urgent";
  owner?: string;
  dependencies: string[];
  repositoryLinks: string[];
  archiveState?: "released" | "wont_do";
  trackerLinks: Array<{
    id: string;
    system: "linear" | "notion";
    stableId: string;
    title?: string;
    url: string;
  }>;
};
type SubtaskHistory = {
  reports: Array<{
    id: string;
    reportedState: string;
    reporter: string;
    evidence?: string;
  }>;
  verifications: Array<{
    id: string;
    reportId: string;
    decision: string;
    verifier: string;
  }>;
};

type TRPCClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;

function Dashboard() {
  const [connection] = useState(() => new ConnectionState());
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(
    connection.snapshot(),
  );
  const [projectName, setProjectName] = useState("");
  const [view, setView] = useState<DashboardView>(() =>
    dashboardViewFromPath(window.location.pathname),
  );
  const [taskName, setTaskName] = useState("");
  const [taskBranchName, setTaskBranchName] = useState("");
  const [taskObjective, setTaskObjective] = useState("");
  const [taskAcceptanceCriteria, setTaskAcceptanceCriteria] = useState("");
  const [taskPriority, setTaskPriority] = useState<
    "low" | "medium" | "high" | "urgent"
  >("medium");
  const [taskOwner, setTaskOwner] = useState("");
  const [taskDependencies, setTaskDependencies] = useState("");
  const [taskRepositoryLinks, setTaskRepositoryLinks] = useState("");
  const [subtaskNames, setSubtaskNames] = useState<Record<string, string>>({});
  const [subtaskDescriptions, setSubtaskDescriptions] = useState<
    Record<string, string>
  >({});
  const [projectLinkInputs, setProjectLinkInputs] = useState<
    Record<
      string,
      {
        system: "linear" | "notion";
        stableId: string;
        title: string;
        url: string;
      }
    >
  >({});
  const [projectTrackerInput, setProjectTrackerInput] = useState({
    system: "linear" as "linear" | "notion",
    stableId: "",
    title: "",
    url: "",
  });
  const [projectGitOriginInput, setProjectGitOriginInput] = useState("");
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [portfolioStatus, setPortfolioStatus] =
    useState<PortfolioStatus | null>(null);
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  const [attentionFilter, setAttentionFilter] =
    useState<AttentionFilter>("all");
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(
    null,
  );
  const [taskDetails, setTaskDetails] = useState<Record<string, TaskDetail>>(
    {},
  );
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>(
    {},
  );
  const [subtaskHistories, setSubtaskHistories] = useState<
    Record<string, SubtaskHistory>
  >({});
  const [collapsedTasks, setCollapsedTasks] = useState<Record<string, boolean>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const trpc = useRef<TRPCClient | null>(null);
  const subscriptionCleanup = useRef<(() => void) | null>(null);

  useEffect(() => {
    const client = createWSClient({
      onClose: () => {
        subscriptionCleanup.current?.();
        subscriptionCleanup.current = null;
        connection.markDisconnected();
        setProjects(null);
        setPortfolioStatus(null);
        setAttention(null);
        setProjectDetail(null);
        setTaskDetails({});
        setTaskStatuses({});
        setSubtaskHistories({});
        setSnapshot(connection.snapshot());
      },
      onOpen: () => {
        connection.markConnected(new Date());
        setSnapshot(connection.snapshot());
        void Promise.all([
          trpc.current?.projects.list.query(),
          trpc.current?.projects.portfolio.query(),
          trpc.current?.projects.attention.query(),
        ]).then(([nextProjects, nextPortfolio, nextAttention]) => {
          if (!nextProjects || !nextPortfolio || !nextAttention) return;
          setProjects(nextProjects);
          setPortfolioStatus(nextPortfolio);
          setAttention(nextAttention);
          connection.markAuthoritativeRefresh();
          setSnapshot(connection.snapshot());
        });
      },
      url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/trpc`,
    });
    trpc.current = createTRPCProxyClient<FactoryRouter>({
      links: [wsLink({ client })],
    });

    return () => {
      subscriptionCleanup.current?.();
      subscriptionCleanup.current = null;
      void client.close();
    };
  }, [connection]);

  const refreshProject = async (projectId: string) => {
    const client = trpc.current;
    if (!client) return;
    const [detail, nextPortfolio, nextAttention] = await Promise.all([
      client.projects.detail.query({ projectId }) as Promise<ProjectDetail>,
      client.projects.portfolio.query(),
      client.projects.attention.query(),
    ]);
    setPortfolioStatus(nextPortfolio);
    setAttention(nextAttention);
    const [details, statuses] = await Promise.all([
      Promise.all(
        detail.tasks.map(
          async (task) =>
            [
              task.id,
              (await client.tasks.detail.query({
                taskId: task.id,
              })) as TaskDetail,
            ] as const,
        ),
      ),
      Promise.all(
        detail.tasks.map(
          async (task) =>
            [
              task.id,
              (await client.tasks.status.query({
                taskId: task.id,
              })) as TaskStatus,
            ] as const,
        ),
      ),
    ]);
    setProjectDetail(detail);
    setTaskDetails(Object.fromEntries(details));
    setTaskStatuses(Object.fromEntries(statuses));
  };

  useEffect(() => {
    setProjectGitOriginInput(projectDetail?.gitOriginUrl ?? "");
  }, [projectDetail?.gitOriginUrl, projectDetail?.id]);

  const stopProjectSubscription = () => {
    subscriptionCleanup.current?.();
    subscriptionCleanup.current = null;
  };

  const navigateToView = (nextView: DashboardView) => {
    const nextPath = dashboardPath(nextView);
    if (window.location.pathname !== nextPath || window.location.search) {
      window.history.pushState({}, "", nextPath);
    }
    setView(nextView);
  };

  const mutateAndRefresh = async (action: () => Promise<unknown>) => {
    if (!snapshot.canMutate || !projectDetail) return;
    setBusy(true);
    try {
      await action();
      await refreshProject(projectDetail.id);
    } finally {
      setBusy(false);
    }
  };

  const loadProject = async (projectId: string) => {
    stopProjectSubscription();
    await refreshProject(projectId);
    const subscription = trpc.current?.projects.updates.subscribe(
      { projectId },
      {
        onData: () => {
          void refreshProject(projectId);
        },
      },
    );
    subscriptionCleanup.current = subscription
      ? () => subscription.unsubscribe()
      : null;
  };

  const openProject = (projectId: string) => {
    navigateToView(projectView(projectId));
    void loadProject(projectId);
  };

  const openHome = () => {
    stopProjectSubscription();
    navigateToView(homeView());
  };

  const openProjectEditor = (projectId: string) => {
    navigateToView(editProjectView(projectId));
  };

  useEffect(() => {
    const handlePopState = () => {
      const nextView = dashboardViewFromPath(window.location.pathname);
      setView(nextView);
      if (nextView.screen === "home") {
        stopProjectSubscription();
        return;
      }
      void loadProject(nextView.projectId);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (snapshot.state !== "connected") return;
    const nextView = dashboardViewFromPath(window.location.pathname);
    setView(nextView);
    if (nextView.screen !== "home") {
      void loadProject(nextView.projectId);
    }
  }, [snapshot.state]);

  const lines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const visibleAttention = attention
    ? filterAttention(attention, attentionFilter)
    : null;

  const loadSubtaskHistory = async (subtaskId: string) => {
    const client = trpc.current;
    if (!client) return;
    const [reports, verifications] = await Promise.all([
      client.subtasks.history.query({ subtaskId }),
      client.subtasks.verifications.query({ subtaskId }),
    ]);
    setSubtaskHistories((current) => ({
      ...current,
      [subtaskId]: { reports, verifications },
    }));
  };

  const createTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taskName.trim() || !projectDetail || !trpc.current) return;
    await mutateAndRefresh(async () => {
      await trpc.current!.tasks.create.mutate({
        acceptanceCriteria: lines(taskAcceptanceCriteria),
        branchName: taskBranchName.trim() || undefined,
        dependencies: lines(taskDependencies),
        name: taskName.trim(),
        objective: taskObjective.trim() || undefined,
        owner: taskOwner.trim() || undefined,
        priority: taskPriority,
        projectId: projectDetail.id,
        repositoryLinks: lines(taskRepositoryLinks),
      });
      setTaskName("");
      setTaskBranchName("");
      setTaskObjective("");
      setTaskAcceptanceCriteria("");
      setTaskPriority("medium");
      setTaskOwner("");
      setTaskDependencies("");
      setTaskRepositoryLinks("");
    });
  };

  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">Project operations</p>
          <h1>Software Factory</h1>
        </div>
        <ConnectionIndicator snapshot={snapshot} />
      </header>

      {view.screen === "home" && (
        <>
          <section className="hero" aria-labelledby="portfolio-title">
            <p className="eyebrow">Portfolio</p>
            <h2 id="portfolio-title">Your project work, in one clear place.</h2>
            <p>
              Factory keeps native work, agent reports, and Kevin’s verification
              visible without replacing Notion or Linear.
            </p>
          </section>

          <section
            className="panel attention-panel"
            aria-labelledby="attention-title"
          >
            <div className="attention-header">
              <div>
                <p className="eyebrow">Attention</p>
                <h2 id="attention-title">
                  {attention === null
                    ? "Loading work…"
                    : attention.length === 0
                      ? "Nothing needs attention"
                      : `${attention.length} open tasks`}
                </h2>
                <p className="attention-summary">
                  Start with blocked or awaiting-verification work, then pick
                  the next planned task.
                </p>
              </div>
              <div
                aria-label="Attention filters"
                className="attention-filters"
                role="group"
              >
                {(
                  [
                    ["all", "All"],
                    ["blocked", "Blocked"],
                    ["awaiting_verification", "Awaiting"],
                    ["active", "Active"],
                    ["planned", "Planned"],
                  ] as const
                ).map(([filter, label]) => (
                  <button
                    aria-pressed={attentionFilter === filter}
                    className={
                      attentionFilter === filter
                        ? "filter-selected"
                        : "secondary"
                    }
                    key={filter}
                    onClick={() => setAttentionFilter(filter)}
                    type="button"
                  >
                    {label}
                    {attention && (
                      <span>
                        {filter === "all"
                          ? attention.length
                          : attention.filter((item) => item.state === filter)
                              .length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            {visibleAttention && visibleAttention.length > 0 && (
              <div className="attention-list">
                {visibleAttention.map((item) => (
                  <article className="attention-item" key={item.taskId}>
                    <div>
                      <strong>{item.taskName}</strong>
                      <p>
                        {item.projectName}
                        {item.owner ? ` · ${item.owner}` : ""}
                      </p>
                    </div>
                    <div className="attention-item-meta">
                      <span className={`status-pill ${item.state}`}>
                        {formatWorkState(item.state)}
                      </span>
                      {item.priority && (
                        <small>{formatWorkState(item.priority)} priority</small>
                      )}
                      <button
                        className="secondary"
                        disabled={snapshot.state !== "connected"}
                        onClick={() => void openProject(item.projectId)}
                        type="button"
                      >
                        Open
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {attention &&
              attention.length > 0 &&
              visibleAttention &&
              visibleAttention.length === 0 && (
                <p className="empty attention-empty">
                  No tasks match this filter.
                </p>
              )}
          </section>

          <section className="panel projects-panel" aria-live="polite">
            <div>
              <p className="eyebrow">Projects</p>
              <h2>
                {projects === null
                  ? "Loading projects…"
                  : `${projects.length} projects`}
              </h2>
              {portfolioStatus && (
                <p className="portfolio-summary">
                  {portfolioStatus.totalTasks} tasks ·{" "}
                  {portfolioStatus.counts.planned} planned ·{" "}
                  {portfolioStatus.counts.active} active ·{" "}
                  {portfolioStatus.counts.awaiting_verification} awaiting
                  verification · {portfolioStatus.counts.completed} completed ·{" "}
                  {portfolioStatus.counts.blocked} blocked ·{" "}
                  {portfolioStatus.counts.released} released ·{" "}
                  {portfolioStatus.counts.wont_do} won&apos;t do
                </p>
              )}
            </div>
            {projects && projects.length > 0 && (
              <div aria-label="Project links" className="project-links">
                {projects.map((project) => (
                  <button
                    className="project-link"
                    disabled={snapshot.state !== "connected"}
                    key={project.id}
                    onClick={() => void openProject(project.id)}
                    type="button"
                  >
                    <span>{project.name}</span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!projectName.trim() || !trpc.current || !snapshot.canMutate)
                  return;
                void createProjectAndRefresh({
                  actions: {
                    createProject: (input) =>
                      trpc.current!.projects.create.mutate(input),
                    listProjects: () => trpc.current!.projects.list.query(),
                  },
                  name: projectName.trim(),
                }).then((nextProjects) => {
                  setProjects(nextProjects);
                  setProjectName("");
                  void trpc.current?.projects.portfolio
                    .query()
                    .then(setPortfolioStatus);
                });
              }}
            >
              <label>
                <span className="visually-hidden">Project name</span>
                <input
                  disabled={!snapshot.canMutate}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="New project name"
                  value={projectName}
                />
              </label>
              <button
                disabled={!snapshot.canMutate || !projectName.trim()}
                type="submit"
              >
                New project
              </button>
            </form>
          </section>
        </>
      )}

      {projects && projects.length > 0 && view.screen !== "home" && (
        <nav aria-label="Projects" className="project-tabs">
          {projects.map((project) => (
            <button
              className={
                project.id === view.projectId ? "selected" : "secondary"
              }
              disabled={snapshot.state !== "connected"}
              key={project.id}
              onClick={() => void openProject(project.id)}
              type="button"
            >
              {project.name}
            </button>
          ))}
        </nav>
      )}

      {projectDetail &&
        view.screen === "edit_project" &&
        projectDetail.id === view.projectId && (
          <section className="detail" aria-labelledby="project-edit-title">
            <div className="detail-heading">
              <div>
                <p className="eyebrow">Project settings</p>
                <h2 id="project-edit-title">Edit {projectDetail.name}</h2>
                <p className="project-summary">
                  Keep planning metadata and external project links together.
                </p>
              </div>
              <div className="detail-actions">
                <button
                  className="secondary"
                  onClick={() => openProject(projectDetail.id)}
                  type="button"
                >
                  Back to tasks
                </button>
                <button className="secondary" onClick={openHome} type="button">
                  Home
                </button>
              </div>
            </div>

            <form
              className="project-link-form project-context-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!trpc.current) return;
                void mutateAndRefresh(() =>
                  trpc.current!.projects.update.mutate({
                    gitOriginUrl: projectGitOriginInput.trim() || null,
                    projectId: projectDetail.id,
                  }),
                );
              }}
            >
              <input
                aria-label="Git origin URL"
                disabled={!snapshot.canMutate || busy}
                onChange={(event) =>
                  setProjectGitOriginInput(event.target.value)
                }
                placeholder="Git origin URL (SSH or HTTPS)"
                value={projectGitOriginInput}
              />
              <button disabled={!snapshot.canMutate || busy} type="submit">
                Save Git URL
              </button>
            </form>

            <form
              className="project-link-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  !projectTrackerInput.stableId.trim() ||
                  !projectTrackerInput.url.trim() ||
                  !trpc.current
                )
                  return;
                void mutateAndRefresh(async () => {
                  await trpc.current!.projects.link.mutate({
                    ...projectTrackerInput,
                    projectId: projectDetail.id,
                    stableId: projectTrackerInput.stableId.trim(),
                    title: projectTrackerInput.title.trim() || undefined,
                    url: projectTrackerInput.url.trim(),
                  });
                  setProjectTrackerInput({
                    system: projectTrackerInput.system,
                    stableId: "",
                    title: "",
                    url: "",
                  });
                });
              }}
            >
              <select
                aria-label="Project tracker system"
                disabled={!snapshot.canMutate || busy}
                onChange={(event) =>
                  setProjectTrackerInput((current) => ({
                    ...current,
                    system: event.target.value as "linear" | "notion",
                  }))
                }
                value={projectTrackerInput.system}
              >
                <option value="linear">Linear project</option>
                <option value="notion">Notion project</option>
              </select>
              <input
                aria-label="Project tracker ID"
                disabled={!snapshot.canMutate || busy}
                onChange={(event) =>
                  setProjectTrackerInput((current) => ({
                    ...current,
                    stableId: event.target.value,
                  }))
                }
                placeholder="Project ID"
                value={projectTrackerInput.stableId}
              />
              <input
                aria-label="Project tracker URL"
                disabled={!snapshot.canMutate || busy}
                onChange={(event) =>
                  setProjectTrackerInput((current) => ({
                    ...current,
                    url: event.target.value,
                  }))
                }
                placeholder="https://…"
                value={projectTrackerInput.url}
              />
              <input
                aria-label="Project tracker title"
                disabled={!snapshot.canMutate || busy}
                onChange={(event) =>
                  setProjectTrackerInput((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                placeholder="Display title (optional)"
                value={projectTrackerInput.title}
              />
              <button
                disabled={
                  !snapshot.canMutate ||
                  busy ||
                  !projectTrackerInput.stableId.trim() ||
                  !projectTrackerInput.url.trim()
                }
                type="submit"
              >
                Link project
              </button>
            </form>

            {projectDetail.trackerLinks.length > 0 && (
              <div className="links" aria-label="Project tracker links">
                {projectDetail.trackerLinks.map((link) => (
                  <a
                    href={link.url}
                    key={link.id}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {link.system}: {link.title ?? link.stableId}
                  </a>
                ))}
              </div>
            )}

            <form className="task-editor" onSubmit={createTask}>
              <div>
                <p className="eyebrow">New task</p>
                <h3>Plan the next piece of work</h3>
              </div>
              <div className="task-create-main">
                <label>
                  <span className="visually-hidden">Task name</span>
                  <input
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) => setTaskName(event.target.value)}
                    placeholder="Task name"
                    value={taskName}
                  />
                </label>
                <button
                  disabled={!snapshot.canMutate || busy || !taskName.trim()}
                  type="submit"
                >
                  Add task
                </button>
              </div>
              <details className="task-planning" open>
                <summary>Planning metadata</summary>
                <div className="planning-grid">
                  <textarea
                    aria-label="Task objective"
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) => setTaskObjective(event.target.value)}
                    placeholder="Objective"
                    value={taskObjective}
                  />
                  <textarea
                    aria-label="Acceptance criteria"
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) =>
                      setTaskAcceptanceCriteria(event.target.value)
                    }
                    placeholder="Acceptance criteria (one per line)"
                    value={taskAcceptanceCriteria}
                  />
                  <input
                    aria-label="Task branch name"
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) => setTaskBranchName(event.target.value)}
                    placeholder="Branch name (optional)"
                    value={taskBranchName}
                  />
                  <select
                    aria-label="Task priority"
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) =>
                      setTaskPriority(
                        event.target.value as
                          | "low"
                          | "medium"
                          | "high"
                          | "urgent",
                      )
                    }
                    value={taskPriority}
                  >
                    <option value="low">Low priority</option>
                    <option value="medium">Medium priority</option>
                    <option value="high">High priority</option>
                    <option value="urgent">Urgent priority</option>
                  </select>
                  <input
                    aria-label="Task owner"
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) => setTaskOwner(event.target.value)}
                    placeholder="Owner"
                    value={taskOwner}
                  />
                  <textarea
                    aria-label="Task dependencies"
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) =>
                      setTaskDependencies(event.target.value)
                    }
                    placeholder="Dependencies (one per line)"
                    value={taskDependencies}
                  />
                  <textarea
                    aria-label="Repository links"
                    disabled={!snapshot.canMutate || busy}
                    onChange={(event) =>
                      setTaskRepositoryLinks(event.target.value)
                    }
                    placeholder="Repository links (one URL per line)"
                    value={taskRepositoryLinks}
                  />
                </div>
              </details>
            </form>
          </section>
        )}

      {projectDetail &&
        view.screen === "project" &&
        projectDetail.id === view.projectId && (
          <section className="detail" aria-labelledby="project-detail-title">
            <div className="detail-heading">
              <div>
                <p className="eyebrow">Project tasks</p>
                <h2 id="project-detail-title">{projectDetail.name}</h2>
                {portfolioStatus &&
                  (() => {
                    const status = portfolioStatus.projects.find(
                      (candidate) => candidate.projectId === projectDetail.id,
                    );
                    return status ? (
                      <p className="project-summary">
                        {status.totalTasks} tasks · {status.counts.planned}{" "}
                        planned · {status.counts.active} active ·{" "}
                        {status.counts.awaiting_verification} awaiting
                        verification · {status.counts.completed} completed ·{" "}
                        {status.counts.blocked} blocked ·{" "}
                        {status.counts.released} released ·{" "}
                        {status.counts.wont_do} won&apos;t do
                      </p>
                    ) : null;
                  })()}
              </div>
              <div className="detail-actions">
                <button className="secondary" onClick={openHome} type="button">
                  Home
                </button>
                <button
                  className="secondary"
                  onClick={() => openProjectEditor(projectDetail.id)}
                  type="button"
                >
                  Edit project
                </button>
              </div>
            </div>

            {portfolioStatus &&
              (() => {
                const status = portfolioStatus.projects.find(
                  (candidate) => candidate.projectId === projectDetail.id,
                );
                if (!status) return null;
                return (
                  <div className="project-stats" aria-label="Project summary">
                    <div className="project-stat">
                      <strong>{status.totalTasks}</strong>
                      <span>Total tasks</span>
                    </div>
                    <div className="project-stat">
                      <strong>
                        {status.counts.completed}/{status.totalTasks}
                      </strong>
                      <span>Tasks complete</span>
                    </div>
                    <div className="project-stat">
                      <strong>{status.counts.active}</strong>
                      <span>Active</span>
                    </div>
                    <div className="project-stat">
                      <strong>{status.counts.blocked}</strong>
                      <span>Blocked</span>
                    </div>
                  </div>
                );
              })()}

            {projectDetail.tasks.length === 0 ? (
              <div className="empty">
                <p>
                  No tasks yet. Add the first piece of work from project
                  settings.
                </p>
                <button
                  className="secondary"
                  onClick={() => openProjectEditor(projectDetail.id)}
                  type="button"
                >
                  Add a task
                </button>
              </div>
            ) : (
              <div className="task-list">
                {projectDetail.tasks.map((task) => {
                  const status = taskStatuses[task.id];
                  const taskDetail = taskDetails[task.id];
                  const linkInput = projectLinkInputs[task.id] ?? {
                    system: "linear" as const,
                    stableId: "",
                    title: "",
                    url: "",
                  };
                  const subtasksCollapsed = collapsedTasks[task.id] ?? true;
                  const progress = summarizeTaskProgress(task, status);
                  return (
                    <article className="task-card" key={task.id}>
                      <div className="task-card-header">
                        <div className="task-summary">
                          <div className="task-summary-heading">
                            <h3>{task.name}</h3>
                            <span
                              className={`status-pill ${status?.taskState ?? "planned"}`}
                            >
                              {formatWorkState(status?.taskState ?? "planned")}
                            </span>
                          </div>
                          {taskDetail?.objective && (
                            <p className="task-objective">
                              {taskDetail.objective}
                            </p>
                          )}
                          <div className="task-preview-meta">
                            {taskDetail?.owner && (
                              <span>Owner: {taskDetail.owner}</span>
                            )}
                            {taskDetail?.priority && (
                              <span>
                                Priority: {formatWorkState(taskDetail.priority)}
                              </span>
                            )}
                            <span>
                              {progress.totalSubtasks > 0
                                ? `${progress.completedSubtasks}/${progress.totalSubtasks} subtasks done`
                                : "No subtasks yet"}
                            </span>
                          </div>
                          {progress.totalSubtasks > 0 && (
                            <progress
                              aria-label={
                                String(progress.completedSubtasks) +
                                " of " +
                                String(progress.totalSubtasks) +
                                " subtasks complete"
                              }
                              className="task-progress"
                              max={progress.totalSubtasks}
                              value={progress.completedSubtasks}
                            />
                          )}
                          {progress.nextSubtaskName && (
                            <p className="task-next">
                              <strong>Next:</strong> {progress.nextSubtaskName}
                            </p>
                          )}
                        </div>
                        <div
                          aria-label={`Quick status for ${task.name}`}
                          className="task-actions"
                        >
                          <button
                            aria-expanded={!subtasksCollapsed}
                            className={
                              subtasksCollapsed ? "primary" : "secondary"
                            }
                            onClick={() =>
                              setCollapsedTasks((current) => ({
                                ...current,
                                [task.id]: !subtasksCollapsed,
                              }))
                            }
                            type="button"
                          >
                            {subtasksCollapsed
                              ? `Show ${progress.totalSubtasks} subtasks`
                              : "Hide subtasks"}
                          </button>
                          <details className="task-menu">
                            <summary>More</summary>
                            <div className="task-menu-options">
                              <button
                                className="secondary"
                                disabled={!snapshot.canMutate || busy}
                                onClick={() =>
                                  void mutateAndRefresh(() =>
                                    trpc.current!.tasks.archive.mutate({
                                      archiveState: "released",
                                      taskId: task.id,
                                    }),
                                  )
                                }
                                type="button"
                              >
                                Released
                              </button>
                              <button
                                className="danger"
                                disabled={!snapshot.canMutate || busy}
                                onClick={() =>
                                  void mutateAndRefresh(() =>
                                    trpc.current!.tasks.archive.mutate({
                                      archiveState: "wont_do",
                                      taskId: task.id,
                                    }),
                                  )
                                }
                                type="button"
                              >
                                Won&apos;t do
                              </button>
                              {status?.archiveState && (
                                <button
                                  className="secondary"
                                  disabled={!snapshot.canMutate || busy}
                                  onClick={() =>
                                    void mutateAndRefresh(() =>
                                      trpc.current!.tasks.restore.mutate({
                                        taskId: task.id,
                                      }),
                                    )
                                  }
                                  type="button"
                                >
                                  Restore
                                </button>
                              )}
                            </div>
                          </details>
                        </div>
                      </div>
                      <details className="task-tracker">
                        <summary>Link external tracker</summary>
                        <form
                          className="inline-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            if (
                              !linkInput.stableId.trim() ||
                              !linkInput.url.trim() ||
                              !trpc.current
                            )
                              return;
                            void mutateAndRefresh(async () => {
                              await trpc.current!.tasks.link.mutate({
                                ...linkInput,
                                stableId: linkInput.stableId.trim(),
                                title: linkInput.title.trim() || undefined,
                                taskId: task.id,
                                url: linkInput.url.trim(),
                              });
                              setProjectLinkInputs((current) => ({
                                ...current,
                                [task.id]: {
                                  ...linkInput,
                                  stableId: "",
                                  title: "",
                                  url: "",
                                },
                              }));
                            });
                          }}
                        >
                          <select
                            aria-label="Tracker system"
                            disabled={!snapshot.canMutate || busy}
                            onChange={(event) =>
                              setProjectLinkInputs((current) => ({
                                ...current,
                                [task.id]: {
                                  ...linkInput,
                                  system: event.target.value as
                                    | "linear"
                                    | "notion",
                                },
                              }))
                            }
                            value={linkInput.system}
                          >
                            <option value="linear">Linear</option>
                            <option value="notion">Notion</option>
                          </select>
                          <input
                            aria-label="Tracker ID"
                            disabled={!snapshot.canMutate || busy}
                            onChange={(event) =>
                              setProjectLinkInputs((current) => ({
                                ...current,
                                [task.id]: {
                                  ...linkInput,
                                  stableId: event.target.value,
                                },
                              }))
                            }
                            placeholder="GRA-123"
                            value={linkInput.stableId}
                          />
                          <input
                            aria-label="Tracker URL"
                            disabled={!snapshot.canMutate || busy}
                            onChange={(event) =>
                              setProjectLinkInputs((current) => ({
                                ...current,
                                [task.id]: {
                                  ...linkInput,
                                  url: event.target.value,
                                },
                              }))
                            }
                            placeholder="https://…"
                            value={linkInput.url}
                          />
                          <button
                            disabled={
                              !snapshot.canMutate ||
                              busy ||
                              !linkInput.stableId.trim() ||
                              !linkInput.url.trim()
                            }
                            type="submit"
                          >
                            Link
                          </button>
                        </form>
                      </details>

                      {taskDetail?.trackerLinks.length ? (
                        <div className="links" aria-label="Tracker links">
                          {taskDetail.trackerLinks.map((link) => (
                            <a
                              href={link.url}
                              key={link.id}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {link.system}: {link.stableId}
                            </a>
                          ))}
                        </div>
                      ) : null}

                      {taskDetail &&
                      (taskDetail.objective ||
                        taskDetail.acceptanceCriteria.length > 0 ||
                        taskDetail.priority ||
                        taskDetail.owner ||
                        taskDetail.dependencies.length > 0 ||
                        taskDetail.repositoryLinks.length > 0 ||
                        taskDetail.branchName) ? (
                        <details className="task-details">
                          <summary>Details and planning metadata</summary>
                          <div className="task-metadata">
                            {taskDetail.objective && (
                              <p>
                                <strong>Objective:</strong>{" "}
                                {taskDetail.objective}
                              </p>
                            )}
                            {taskDetail.branchName && (
                              <p>
                                <strong>Branch:</strong> {taskDetail.branchName}
                              </p>
                            )}
                            {taskDetail.owner && (
                              <p>
                                <strong>Owner:</strong> {taskDetail.owner}
                              </p>
                            )}
                            {taskDetail.priority && (
                              <p>
                                <strong>Priority:</strong> {taskDetail.priority}
                              </p>
                            )}
                            {taskDetail.acceptanceCriteria.length > 0 && (
                              <p>
                                <strong>Acceptance:</strong>{" "}
                                {taskDetail.acceptanceCriteria.join(" · ")}
                              </p>
                            )}
                            {taskDetail.dependencies.length > 0 && (
                              <p>
                                <strong>Dependencies:</strong>{" "}
                                {taskDetail.dependencies.join(" · ")}
                              </p>
                            )}
                            {taskDetail.repositoryLinks.length > 0 && (
                              <p>
                                <strong>Repositories:</strong>{" "}
                                {taskDetail.repositoryLinks.map((link) => (
                                  <a
                                    href={link}
                                    key={link}
                                    rel="noreferrer"
                                    target="_blank"
                                  >
                                    {link}
                                  </a>
                                ))}
                              </p>
                            )}
                          </div>
                        </details>
                      ) : null}

                      {!subtasksCollapsed && (
                        <>
                          <div className="subtask-list">
                            {task.subtasks.map((subtask, index) => {
                              const subtaskStatus = status?.subtasks[index];
                              const history = subtaskHistories[subtask.id];
                              const subtaskArchived = Boolean(
                                subtaskStatus?.archiveState,
                              );
                              return (
                                <div className="subtask" key={subtask.id}>
                                  <div>
                                    <strong>{subtask.name}</strong>
                                    {subtask.description && (
                                      <p className="subtask-description">
                                        {subtask.description}
                                      </p>
                                    )}
                                    <span className="subtask-state">
                                      {subtaskStatus?.archiveState
                                        ? formatWorkState(
                                            subtaskStatus.archiveState,
                                          )
                                        : `${subtaskStatus?.reportedState ?? "not_started"} · ${subtaskStatus?.verificationState ?? "unreported"}`}
                                    </span>
                                    {subtaskStatus?.evidence && (
                                      <p className="evidence">
                                        {subtaskStatus.evidence}
                                      </p>
                                    )}
                                  </div>
                                  <div className="subtask-actions">
                                    <input
                                      aria-label={`Evidence for ${subtask.name}`}
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        subtaskArchived
                                      }
                                      onChange={(event) =>
                                        setEvidence((current) => ({
                                          ...current,
                                          [subtask.id]: event.target.value,
                                        }))
                                      }
                                      placeholder="Evidence (optional)"
                                      value={evidence[subtask.id] ?? ""}
                                    />
                                    <button
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        subtaskArchived
                                      }
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.report.mutate({
                                            evidence: evidence[subtask.id],
                                            reportedState: "in_progress",
                                            reporter: "kevin",
                                            subtaskId: subtask.id,
                                          }),
                                        )
                                      }
                                      type="button"
                                    >
                                      Report active
                                    </button>
                                    <button
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        subtaskArchived
                                      }
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.report.mutate({
                                            evidence: evidence[subtask.id],
                                            reportedState: "complete",
                                            reporter: "codex",
                                            subtaskId: subtask.id,
                                          }),
                                        )
                                      }
                                      type="button"
                                    >
                                      Report complete
                                    </button>
                                    <button
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        subtaskArchived
                                      }
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.report.mutate({
                                            evidence: evidence[subtask.id],
                                            reportedState: "blocked",
                                            reporter: "kevin",
                                            subtaskId: subtask.id,
                                          }),
                                        )
                                      }
                                      type="button"
                                    >
                                      Report blocked
                                    </button>
                                    <button
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        subtaskArchived
                                      }
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.report.mutate({
                                            evidence: evidence[subtask.id],
                                            reportedState: "not_started",
                                            reporter: "kevin",
                                            subtaskId: subtask.id,
                                          }),
                                        )
                                      }
                                      type="button"
                                    >
                                      Reset planned
                                    </button>
                                    <button
                                      className="secondary"
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        subtaskArchived
                                      }
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.archive.mutate(
                                            {
                                              archiveState: "released",
                                              subtaskId: subtask.id,
                                            },
                                          ),
                                        )
                                      }
                                      type="button"
                                    >
                                      Released
                                    </button>
                                    <button
                                      className="danger"
                                      disabled={
                                        !snapshot.canMutate ||
                                        busy ||
                                        subtaskArchived
                                      }
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.archive.mutate(
                                            {
                                              archiveState: "wont_do",
                                              subtaskId: subtask.id,
                                            },
                                          ),
                                        )
                                      }
                                      type="button"
                                    >
                                      Won&apos;t do
                                    </button>
                                    {subtaskArchived && (
                                      <button
                                        className="secondary"
                                        disabled={!snapshot.canMutate || busy}
                                        onClick={() =>
                                          void mutateAndRefresh(() =>
                                            trpc.current!.subtasks.restore.mutate(
                                              {
                                                subtaskId: subtask.id,
                                              },
                                            ),
                                          )
                                        }
                                        type="button"
                                      >
                                        Restore
                                      </button>
                                    )}
                                    <button
                                      className="secondary"
                                      onClick={() =>
                                        void loadSubtaskHistory(subtask.id)
                                      }
                                      type="button"
                                    >
                                      History
                                    </button>
                                    {subtaskStatus?.reportId &&
                                      subtaskStatus.verificationState ===
                                        "awaiting_verification" && (
                                        <>
                                          <button
                                            className="verify"
                                            disabled={
                                              !snapshot.canMutate ||
                                              busy ||
                                              subtaskArchived
                                            }
                                            onClick={() =>
                                              void mutateAndRefresh(() =>
                                                trpc.current!.subtasks.verify.mutate(
                                                  {
                                                    decision: "accepted",
                                                    reportId:
                                                      subtaskStatus.reportId!,
                                                    verifier: "kevin",
                                                  },
                                                ),
                                              )
                                            }
                                            type="button"
                                          >
                                            Accept
                                          </button>
                                          <button
                                            className="danger"
                                            disabled={
                                              !snapshot.canMutate ||
                                              busy ||
                                              subtaskArchived
                                            }
                                            onClick={() =>
                                              void mutateAndRefresh(() =>
                                                trpc.current!.subtasks.verify.mutate(
                                                  {
                                                    decision: "rejected",
                                                    reportId:
                                                      subtaskStatus.reportId!,
                                                    verifier: "kevin",
                                                  },
                                                ),
                                              )
                                            }
                                            type="button"
                                          >
                                            Reject
                                          </button>
                                        </>
                                      )}
                                  </div>
                                  {history && (
                                    <div className="history">
                                      <strong>History</strong>
                                      {history.reports.map((report) => (
                                        <p key={report.id}>
                                          {report.reportedState} by{" "}
                                          {report.reporter}
                                          {report.evidence
                                            ? " · " + report.evidence
                                            : ""}
                                        </p>
                                      ))}
                                      {history.verifications.map(
                                        (verification) => (
                                          <p key={verification.id}>
                                            {verification.decision} by{" "}
                                            {verification.verifier}
                                          </p>
                                        ),
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <form
                            className="subtask-create"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const name = subtaskNames[task.id]?.trim();
                              if (!name || !trpc.current) return;
                              void mutateAndRefresh(async () => {
                                await trpc.current!.subtasks.create.mutate({
                                  description:
                                    subtaskDescriptions[task.id]?.trim() ||
                                    undefined,
                                  name,
                                  taskId: task.id,
                                });
                                setSubtaskNames((current) => ({
                                  ...current,
                                  [task.id]: "",
                                }));
                                setSubtaskDescriptions((current) => ({
                                  ...current,
                                  [task.id]: "",
                                }));
                              });
                            }}
                          >
                            <input
                              aria-label={`New subtask for ${task.name}`}
                              disabled={!snapshot.canMutate || busy}
                              onChange={(event) =>
                                setSubtaskNames((current) => ({
                                  ...current,
                                  [task.id]: event.target.value,
                                }))
                              }
                              placeholder="New subtask"
                              value={subtaskNames[task.id] ?? ""}
                            />
                            <input
                              aria-label={`Description for new subtask of ${task.name}`}
                              disabled={!snapshot.canMutate || busy}
                              onChange={(event) =>
                                setSubtaskDescriptions((current) => ({
                                  ...current,
                                  [task.id]: event.target.value,
                                }))
                              }
                              placeholder="Description (optional)"
                              value={subtaskDescriptions[task.id] ?? ""}
                            />
                            <button
                              disabled={
                                !snapshot.canMutate ||
                                busy ||
                                !subtaskNames[task.id]?.trim()
                              }
                              type="submit"
                            >
                              Add subtask
                            </button>
                          </form>
                        </>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
    </main>
  );
}

function ConnectionIndicator({ snapshot }: { snapshot: ConnectionSnapshot }) {
  const lastConnected = snapshot.lastSuccessfulConnection?.toLocaleTimeString();
  return (
    <div aria-live="polite" className={`connection ${snapshot.state}`}>
      <span aria-hidden="true" className="connection-dot" />
      <span>
        {snapshot.state === "connected"
          ? "Connected"
          : snapshot.state === "reconnecting"
            ? "Reconnecting"
            : snapshot.state === "disconnected"
              ? "Disconnected"
              : "Connecting"}
        {lastConnected && snapshot.state !== "connected"
          ? ` · last connected ${lastConnected}`
          : ""}
      </span>
    </div>
  );
}

function formatWorkState(state: string): string {
  return state
    .replaceAll("_", " ")
    .replace(/(^| )\w/g, (character) => character.toUpperCase());
}

createRoot(document.getElementById("root")!).render(<Dashboard />);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js?v=6");
}
