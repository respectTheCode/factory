import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";

describe("git context metadata", () => {
  test("persists a project's git origin and a task's branch across reopen", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-git-context-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const firstApplication = createFactoryApplication({ databasePath });
      const project = firstApplication.createProject({
        gitOriginUrl: "git@github.com:app-press/grail.git",
        name: "Grail",
      });
      const task = firstApplication.createTask({
        branchName: "GRA-143-preview-environments",
        name: "Build preview environments",
        projectId: project.id,
      });

      expect(firstApplication.getProjectDetail(project.id)).toMatchObject({
        id: project.id,
        gitOriginUrl: "git@github.com:app-press/grail.git",
      });
      expect(firstApplication.getTaskDetail(task.id)).toMatchObject({
        branchName: "GRA-143-preview-environments",
      });

      firstApplication.updateTask({
        branchName: "GRA-143-preview-environments-v2",
        taskId: task.id,
      });
      expect(firstApplication.getTaskDetail(task.id)).toMatchObject({
        branchName: "GRA-143-preview-environments-v2",
      });

      firstApplication.updateProject({
        gitOriginUrl: "https://github.com/app-press/grail.git",
        projectId: project.id,
      });
      expect(firstApplication.getProjectDetail(project.id)).toMatchObject({
        gitOriginUrl: "https://github.com/app-press/grail.git",
      });

      const reopenedApplication = createFactoryApplication({ databasePath });

      expect(reopenedApplication.getProjectDetail(project.id)).toMatchObject({
        id: project.id,
        gitOriginUrl: "https://github.com/app-press/grail.git",
      });
      expect(reopenedApplication.getTaskDetail(task.id)).toMatchObject({
        branchName: "GRA-143-preview-environments-v2",
      });

      reopenedApplication.updateProject({
        gitOriginUrl: null,
        projectId: project.id,
      });
      expect(
        reopenedApplication.getProjectDetail(project.id).gitOriginUrl,
      ).toBe(undefined);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
