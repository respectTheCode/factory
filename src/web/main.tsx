import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { FactoryRouter } from "../server";
import { ConnectionState, type ConnectionSnapshot } from "./connection-state";
import { createProjectAndRefresh } from "./project-actions";
import "./styles.css";

type ProjectSummary = { id: string; name: string };
type ProjectDetail = {
  id: string;
  name: string;
  tasks: Array<{
    id: string;
    name: string;
    projectId: string;
    subtasks: Array<{ id: string; name: string; taskId: string }>;
  }>;
};
type TaskStatus = {
  taskCompleted: boolean;
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
  }>;
};
type TaskDetail = {
  name: string;
  trackerLinks: Array<{
    id: string;
    system: "linear" | "notion";
    stableId: string;
    title?: string;
    url: string;
  }>;
};

type TRPCClient = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;

function Dashboard() {
  const [connection] = useState(() => new ConnectionState());
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(
    connection.snapshot(),
  );
  const [projectName, setProjectName] = useState("");
  const [taskName, setTaskName] = useState("");
  const [subtaskNames, setSubtaskNames] = useState<Record<string, string>>({});
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
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(
    null,
  );
  const [taskDetails, setTaskDetails] = useState<Record<string, TaskDetail>>(
    {},
  );
  const [taskStatuses, setTaskStatuses] = useState<Record<string, TaskStatus>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const trpc = useRef<TRPCClient | null>(null);

  useEffect(() => {
    const client = createWSClient({
      onClose: () => {
        connection.markDisconnected();
        setProjects(null);
        setProjectDetail(null);
        setTaskDetails({});
        setTaskStatuses({});
        setSnapshot(connection.snapshot());
      },
      onOpen: () => {
        connection.markConnected(new Date());
        setSnapshot(connection.snapshot());
        void trpc.current?.projects.list.query().then((nextProjects) => {
          setProjects(nextProjects);
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
      void client.close();
    };
  }, [connection]);

  const refreshProject = async (projectId: string) => {
    const client = trpc.current;
    if (!client) return;
    const detail = (await client.projects.detail.query({
      projectId,
    })) as ProjectDetail;
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

  const createTask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!taskName.trim() || !projectDetail || !trpc.current) return;
    await mutateAndRefresh(async () => {
      await trpc.current!.tasks.create.mutate({
        name: taskName.trim(),
        projectId: projectDetail.id,
      });
      setTaskName("");
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

      <section className="hero" aria-labelledby="portfolio-title">
        <p className="eyebrow">Portfolio</p>
        <h2 id="portfolio-title">Your project work, in one clear place.</h2>
        <p>
          Factory keeps native work, agent reports, and Kevin’s verification
          visible without replacing Notion or Linear.
        </p>
      </section>

      <section className="panel" aria-live="polite">
        <div>
          <p className="eyebrow">Projects</p>
          <h2>
            {projects === null
              ? "Loading projects…"
              : `${projects.length} projects`}
          </h2>
        </div>
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

      {projects && projects.length > 0 && (
        <nav aria-label="Projects" className="project-tabs">
          {projects.map((project) => (
            <button
              className={
                project.id === projectDetail?.id ? "selected" : "secondary"
              }
              key={project.id}
              onClick={() => void refreshProject(project.id)}
              type="button"
            >
              {project.name}
            </button>
          ))}
        </nav>
      )}

      {projectDetail && (
        <section className="detail" aria-labelledby="project-detail-title">
          <div className="detail-heading">
            <div>
              <p className="eyebrow">Project detail</p>
              <h2 id="project-detail-title">{projectDetail.name}</h2>
            </div>
            <form onSubmit={createTask}>
              <label>
                <span className="visually-hidden">Task name</span>
                <input
                  disabled={!snapshot.canMutate || busy}
                  onChange={(event) => setTaskName(event.target.value)}
                  placeholder="New task"
                  value={taskName}
                />
              </label>
              <button
                disabled={!snapshot.canMutate || busy || !taskName.trim()}
                type="submit"
              >
                Add task
              </button>
            </form>
          </div>

          {projectDetail.tasks.length === 0 ? (
            <p className="empty">
              No tasks yet. Add the first piece of work above.
            </p>
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
                return (
                  <article className="task-card" key={task.id}>
                    <div className="task-heading">
                      <div>
                        <h3>{task.name}</h3>
                        <span
                          className={`status-pill ${status?.taskCompleted ? "complete" : "pending"}`}
                        >
                          {status?.taskCompleted ? "Complete" : "In progress"}
                        </span>
                      </div>
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
                    </div>

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

                    <div className="subtask-list">
                      {task.subtasks.map((subtask, index) => {
                        const subtaskStatus = status?.subtasks[index];
                        return (
                          <div className="subtask" key={subtask.id}>
                            <div>
                              <strong>{subtask.name}</strong>
                              <span className="subtask-state">
                                {subtaskStatus?.reportedState ?? "not_started"}{" "}
                                ·{" "}
                                {subtaskStatus?.verificationState ??
                                  "unreported"}
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
                                disabled={!snapshot.canMutate || busy}
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
                                disabled={!snapshot.canMutate || busy}
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
                                disabled={!snapshot.canMutate || busy}
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
                              {subtaskStatus?.reportId &&
                                subtaskStatus.verificationState ===
                                  "awaiting_verification" && (
                                  <>
                                    <button
                                      className="verify"
                                      disabled={!snapshot.canMutate || busy}
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.verify.mutate({
                                            decision: "accepted",
                                            reportId: subtaskStatus.reportId!,
                                            verifier: "kevin",
                                          }),
                                        )
                                      }
                                      type="button"
                                    >
                                      Accept
                                    </button>
                                    <button
                                      className="danger"
                                      disabled={!snapshot.canMutate || busy}
                                      onClick={() =>
                                        void mutateAndRefresh(() =>
                                          trpc.current!.subtasks.verify.mutate({
                                            decision: "rejected",
                                            reportId: subtaskStatus.reportId!,
                                            verifier: "kevin",
                                          }),
                                        )
                                      }
                                      type="button"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                            </div>
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
                            name,
                            taskId: task.id,
                          });
                          setSubtaskNames((current) => ({
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

createRoot(document.getElementById("root")!).render(<Dashboard />);

if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/service-worker.js");
}
