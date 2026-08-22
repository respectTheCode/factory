import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type { FactoryRouter } from "../server";
import { ConnectionState, type ConnectionSnapshot } from "./connection-state";
import { createProjectAndRefresh } from "./project-actions";
import "./styles.css";

function Dashboard() {
  const [connection] = useState(() => new ConnectionState());
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(
    connection.snapshot(),
  );
  const [projectName, setProjectName] = useState("");
  const [projects, setProjects] = useState<Array<{
    id: string;
    name: string;
  }> | null>(null);
  const trpc = useRef<ReturnType<
    typeof createTRPCProxyClient<FactoryRouter>
  > | null>(null);

  useEffect(() => {
    const client = createWSClient({
      onClose: () => {
        connection.markDisconnected();
        setSnapshot(connection.snapshot());
      },
      onOpen: () => {
        connection.markConnected(new Date());
        setSnapshot(connection.snapshot());
      },
      url: `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/trpc`,
    });
    trpc.current = createTRPCProxyClient<FactoryRouter>({
      links: [wsLink({ client })],
    });

    void trpc.current.projects.list.query().then((nextProjects) => {
      setProjects(nextProjects);
    });

    return () => {
      void client.close();
    };
  }, [connection]);

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
            if (!projectName.trim() || !trpc.current) return;

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
