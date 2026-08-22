import { createTRPCProxyClient, createWSClient, wsLink } from "@trpc/client";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { FactoryRouter } from "../server";
import { ConnectionState, type ConnectionSnapshot } from "./connection-state";
import "./styles.css";

function Dashboard() {
  const [connection] = useState(() => new ConnectionState());
  const [snapshot, setSnapshot] = useState<ConnectionSnapshot>(
    connection.snapshot(),
  );
  const [projectCount, setProjectCount] = useState<number | null>(null);

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
    const trpc = createTRPCProxyClient<FactoryRouter>({
      links: [wsLink({ client })],
    });

    void trpc.projects.list.query().then((projects) => {
      setProjectCount(projects.length);
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
            {projectCount === null
              ? "Loading projects…"
              : `${projectCount} projects`}
          </h2>
        </div>
        <button disabled={!snapshot.canMutate} type="button">
          New project
        </button>
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
