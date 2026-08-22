import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";

describe("project persistence", () => {
  test("retrieves a project hierarchy after opening the same SQLite database again", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-persistence-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const firstApplication = createFactoryApplication({ databasePath });
      const project = firstApplication.createProject({
        name: "Website refresh",
      });
      const task = firstApplication.createTask({
        name: "Publish the refreshed site",
        projectId: project.id,
      });
      firstApplication.createSubtask({
        name: "Verify the production build",
        taskId: task.id,
      });

      const reopenedApplication = createFactoryApplication({ databasePath });

      expect(reopenedApplication.getProjectHierarchy(project.id)).toEqual({
        name: "Website refresh",
        tasks: [
          {
            name: "Publish the refreshed site",
            subtasks: [{ name: "Verify the production build" }],
          },
        ],
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
