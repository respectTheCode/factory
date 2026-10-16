import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppHeader } from "../../src/web/app-header";
import {
  dashboardPath,
  dashboardViewFromPath,
  homeView,
  taskView,
} from "../../src/web/navigation";

describe("Factory app navigation", () => {
  test("round-trips a task route with encoded project and task IDs", () => {
    const view = taskView("project / alpha", "task #7");
    const path = dashboardPath(view);

    expect(path).toBe("/projects/project%20%2F%20alpha/tasks/task%20%237");
    expect(dashboardViewFromPath(path)).toEqual(view);
  });

  test("keeps the Home route canonical and fails closed on invalid encodings", () => {
    expect(dashboardPath(homeView())).toBe("/");
    expect(dashboardViewFromPath("/")).toEqual(homeView());
    expect(dashboardViewFromPath("/projects/%E0%A4%A/tasks/task-1")).toEqual(
      homeView(),
    );
    expect(dashboardViewFromPath("/projects/project-1/tasks/%ZZ")).toEqual(
      homeView(),
    );
  });

  test("round-trips the direct All tasks route", () => {
    expect(dashboardPath({ screen: "all_tasks" })).toBe("/tasks");
    expect(dashboardViewFromPath("/tasks")).toEqual({ screen: "all_tasks" });
  });

  test("renders the Factory chrome with the active primary destination", () => {
    const html = renderToStaticMarkup(
      createElement(AppHeader, {
        activePage: "home",
        onOpenHome: () => {},
        onOpenAllTasks: () => {},
        onOpenBackups: () => {},
        children: "Connections",
      }),
    );

    expect(html).toContain('aria-label="Factory dashboard"');
    expect(html).toContain('src="/icon.svg"');
    expect(html).toContain("Project operations");
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain(
      '<a aria-current="page" class="global-nav-link selected" href="/">Home</a>',
    );
    expect(html).toContain(
      'class="global-nav-link" href="/tasks">All tasks</a>',
    );
    expect(html).toContain(
      'class="global-nav-link" href="/backups">Backups</a>',
    );
    expect(html).toContain("Connections");
  });

  test("selects each existing primary destination", () => {
    for (const [activePage, href] of [
      ["tasks", "/tasks"],
      ["backups", "/backups"],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(AppHeader, {
          activePage,
          onOpenHome: () => {},
          onOpenAllTasks: () => {},
          onOpenBackups: () => {},
          children: null,
        }),
      );
      expect(html).toContain(
        `aria-current="page" class="global-nav-link selected" href="${href}"`,
      );
    }
  });
});
