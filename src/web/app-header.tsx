import type { ReactNode } from "react";

export type AppHeaderPage = "home" | "tasks" | "backups" | null;

type Props = {
  activePage: AppHeaderPage;
  onOpenHome: () => void;
  onOpenAllTasks: () => void;
  onOpenBackups: () => void;
  children: ReactNode;
};

function PrimaryLink({
  active,
  children,
  href,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  href: string;
  onClick: () => void;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={active ? "global-nav-link selected" : "global-nav-link"}
      href={href}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </a>
  );
}

export function AppHeader({
  activePage,
  onOpenHome,
  onOpenAllTasks,
  onOpenBackups,
  children,
}: Props) {
  return (
    <header className="app-header">
      <a
        aria-label="Factory dashboard"
        className="brand-link"
        href="/"
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return;
          event.preventDefault();
          window.location.assign("/");
        }}
      >
        <div className="brand-lockup">
          <img alt="Factory" className="brand-mark" src="/icon.svg" />
          <div>
            <div className="wordmark">FACTORY</div>
            <p className="eyebrow">Project operations</p>
          </div>
        </div>
      </a>
      <nav aria-label="Primary" className="global-nav">
        <PrimaryLink
          active={activePage === "home"}
          href="/"
          onClick={onOpenHome}
        >
          Home
        </PrimaryLink>
        <PrimaryLink
          active={activePage === "tasks"}
          href="/tasks"
          onClick={onOpenAllTasks}
        >
          All tasks
        </PrimaryLink>
        <PrimaryLink
          active={activePage === "backups"}
          href="/backups"
          onClick={onOpenBackups}
        >
          Backups
        </PrimaryLink>
      </nav>
      <div className="header-status">{children}</div>
      <a className="app-skip-link" href="#main-content">
        Skip to main content
      </a>
    </header>
  );
}
