import { describe, expect, test } from "bun:test";

import {
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
});
