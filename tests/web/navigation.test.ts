import { describe, expect, test } from "bun:test";

import {
  dashboardPath,
  dashboardViewFromPath,
  editProjectView,
  homeView,
  projectView,
} from "../../src/web/navigation";

describe("dashboard navigation", () => {
  test("starts on the home dashboard", () => {
    expect(homeView()).toEqual({ screen: "home" });
  });

  test("a project link opens that project's task page", () => {
    expect(projectView("project-1")).toEqual({
      projectId: "project-1",
      screen: "project",
    });
  });

  test("editing a project opens its dedicated edit page", () => {
    expect(editProjectView("project-1")).toEqual({
      projectId: "project-1",
      screen: "edit_project",
    });
  });

  test("maps browser paths to dashboard views", () => {
    expect(dashboardViewFromPath("/")).toEqual(homeView());
    expect(dashboardViewFromPath("/projects/project-1")).toEqual(
      projectView("project-1"),
    );
    expect(dashboardViewFromPath("/projects/project-1/edit")).toEqual(
      editProjectView("project-1"),
    );
    expect(dashboardViewFromPath("/not-a-dashboard-route")).toEqual(homeView());
  });

  test("serializes dashboard views to reloadable browser paths", () => {
    expect(dashboardPath(homeView())).toBe("/");
    expect(dashboardPath(projectView("project 1"))).toBe(
      "/projects/project%201",
    );
    expect(dashboardPath(editProjectView("project 1"))).toBe(
      "/projects/project%201/edit",
    );
  });
});
