import { describe, expect, test } from "bun:test";

import {
  backupsView,
  dashboardPath,
  dashboardViewFromPath,
  connectionsView,
  editProjectView,
  homeView,
  projectView,
} from "../../src/web/navigation";

describe("dashboard navigation", () => {
  test("starts on the home dashboard", () => {
    expect(homeView()).toEqual({ screen: "home" });
  });

  test("opens the global backups page and preserves it on reload", () => {
    expect(backupsView()).toEqual({ screen: "backups" });
    expect(dashboardViewFromPath("/backups")).toEqual(backupsView());
    expect(dashboardPath(backupsView())).toBe("/backups");
  });

  test("opens the global T3 connections page and preserves it on reload", () => {
    expect(connectionsView()).toEqual({ screen: "connections" });
    expect(dashboardViewFromPath("/connections")).toEqual(connectionsView());
    expect(dashboardPath(connectionsView())).toBe("/connections");
  });

  test("resolves the retired Ledger route to Floor", () => {
    expect(dashboardViewFromPath("/ledger")).toEqual(homeView());
    expect(dashboardPath(homeView())).toBe("/");
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
