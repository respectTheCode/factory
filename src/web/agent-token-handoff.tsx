import { createContext, useContext, useEffect, useRef, useState } from "react";

export type AgentTokenNotice = {
  kind: "created" | "rotated";
  machineId: string;
  token: string;
};

export type AgentTokenHandoff = {
  notice: AgentTokenNotice | null;
  pending: boolean;
  issue: (notice: AgentTokenNotice) => void;
  dismiss: () => void;
  setPending: (pending: boolean) => void;
};

export const AgentTokenHandoffContext = createContext<AgentTokenHandoff>({
  notice: null,
  pending: false,
  issue: () => {},
  dismiss: () => {},
  setPending: () => {},
});

export const useAgentTokenHandoff = () => useContext(AgentTokenHandoffContext);

export function agentTokenNoticeAnnouncement(notice: AgentTokenNotice): string {
  return `${notice.kind === "created" ? "New agent token created" : "Agent token rotated"} for ${notice.machineId}. Copy or save it now; it will not be shown again.`;
}

// The provider outlives Connections so a committed mutation can deliver its
// one-time token even if the operator changes pages while the request is pending.
export function AgentTokenProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [notice, setNotice] = useState<AgentTokenNotice | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!pending && !notice) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [pending, notice]);

  return (
    <AgentTokenHandoffContext.Provider
      value={{
        notice,
        pending,
        issue: setNotice,
        dismiss: () => setNotice(null),
        setPending,
      }}
    >
      {children}
    </AgentTokenHandoffContext.Provider>
  );
}

export function AgentTokenBanner() {
  const { notice, pending, dismiss } = useAgentTokenHandoff();
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const bannerRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => setCopyMessage(null), [notice]);
  useEffect(() => {
    if (!notice) return;
    const frame = window.requestAnimationFrame(() => {
      bannerRef.current?.scrollIntoView({ block: "nearest" });
      headingRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [notice]);
  if (!notice) {
    return pending ? (
      <p className="connections-empty" role="status">
        Issuing agent token… Keep this tab open until it arrives.
      </p>
    ) : null;
  }

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(notice.token);
      setCopyMessage("Copied.");
    } catch {
      setCopyMessage("Copy failed; select the token and copy it manually.");
    }
  };

  return (
    <aside
      aria-labelledby="agent-token-notice-title"
      className="agent-token-notice"
      ref={bannerRef}
    >
      <div className="visually-hidden" role="status">
        {agentTokenNoticeAnnouncement(notice)}
      </div>
      <div className="agent-token-notice-heading">
        <h2 id="agent-token-notice-title" ref={headingRef} tabIndex={-1}>
          {notice.kind === "created" ? "Credential created" : "Token rotated"}
          {" — "}
          {notice.machineId}
        </h2>
      </div>
      <p>
        Copy this token now. It will not be shown again. Store it in the agent’s{" "}
        <code>FACTORY_ACCESS_TOKEN_FILE</code> with owner-only permissions (
        <code>0600</code>). Choose “I’ve saved it” after saving the token.
      </p>
      <code className="agent-token-value">{notice.token}</code>
      <div className="connections-heading-actions">
        <button
          className="secondary"
          onClick={() => void copyToken()}
          type="button"
        >
          Copy token
        </button>
        {copyMessage && (
          <span className="connections-success" role="status">
            {copyMessage}
          </span>
        )}
        <button className="secondary" onClick={dismiss} type="button">
          I’ve saved it
        </button>
      </div>
    </aside>
  );
}
