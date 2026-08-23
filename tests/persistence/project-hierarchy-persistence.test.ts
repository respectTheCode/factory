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
      const subtask = firstApplication.createSubtask({
        name: "Verify the production build",
        taskId: task.id,
      });

      const reopenedApplication = createFactoryApplication({ databasePath });

      expect(reopenedApplication.getProjectHierarchy(project.id)).toMatchObject(
        {
          id: project.id,
          name: "Website refresh",
          tasks: [
            {
              id: task.id,
              name: "Publish the refreshed site",
              projectId: project.id,
              subtasks: [
                {
                  id: subtask.id,
                  name: "Verify the production build",
                  taskId: task.id,
                },
              ],
            },
          ],
        },
      );
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
