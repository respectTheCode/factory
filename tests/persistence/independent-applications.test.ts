import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";

describe("independently opened application persistence", () => {
  test("preserves records across two application instances sharing one database", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-independent-applications-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const applicationA = createFactoryApplication({ databasePath });
      const applicationB = createFactoryApplication({ databasePath });

      const projectA = applicationA.createProject({ name: "Project A" });
      const projectB = applicationB.createProject({ name: "Project B" });

      expect(applicationA.listProjects()).toEqual([
        { id: projectA.id, name: "Project A" },
        { id: projectB.id, name: "Project B" },
      ]);

      const taskInProjectB = applicationA.createTask({
        name: "Task in Project B",
        projectId: projectB.id,
      });

      expect(applicationA.getProjectHierarchy(projectB.id)).toMatchObject({
        id: projectB.id,
        name: "Project B",
        tasks: [
          {
            id: taskInProjectB.id,
            name: "Task in Project B",
            projectId: projectB.id,
          },
        ],
      });

      const reopenedApplication = createFactoryApplication({ databasePath });

      expect(reopenedApplication.listProjects()).toEqual([
        { id: projectA.id, name: "Project A" },
        { id: projectB.id, name: "Project B" },
      ]);
      expect(
        reopenedApplication.getProjectHierarchy(projectB.id),
      ).toMatchObject({
        id: projectB.id,
        name: "Project B",
        tasks: [
          {
            id: taskInProjectB.id,
            name: "Task in Project B",
            projectId: projectB.id,
          },
        ],
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
