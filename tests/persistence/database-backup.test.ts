import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  backupFactoryDatabase,
  createFactoryApplication,
} from "../../src/application";

describe("database backups", () => {
  test("copies project and task data into a fresh SQLite destination", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-backup-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const backupPath = join(temporaryDirectory, "factory-backup.sqlite");

    try {
      const sourceApplication = createFactoryApplication({ databasePath });
      const project = sourceApplication.createProject({
        name: "Website refresh",
      });
      const task = sourceApplication.createTask({
        acceptanceCriteria: ["The refreshed site is published"],
        name: "Publish the refreshed site",
        objective: "Make the new site available to visitors",
        projectId: project.id,
      });

      backupFactoryDatabase({ databasePath, destinationPath: backupPath });

      const reopenedBackup = createFactoryApplication({
        databasePath: backupPath,
      });

      expect(reopenedBackup.getProjectHierarchy(project.id)).toMatchObject({
        id: project.id,
        name: "Website refresh",
        tasks: [
          {
            id: task.id,
            name: "Publish the refreshed site",
            projectId: project.id,
          },
        ],
      });
      expect(reopenedBackup.getTaskDetail(task.id)).toMatchObject({
        acceptanceCriteria: ["The refreshed site is published"],
        objective: "Make the new site available to visitors",
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("rejects an existing destination without changing its data", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-backup-existing-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const destinationPath = join(temporaryDirectory, "existing.sqlite");

    try {
      const sourceApplication = createFactoryApplication({ databasePath });
      const sourceProject = sourceApplication.createProject({
        name: "Source project",
      });
      sourceApplication.createTask({
        name: "Source task",
        projectId: sourceProject.id,
      });

      const destinationApplication = createFactoryApplication({
        databasePath: destinationPath,
      });
      const existingProject = destinationApplication.createProject({
        name: "Keep this project",
      });

      expect(() =>
        backupFactoryDatabase({ databasePath, destinationPath }),
      ).toThrow();

      const reopenedDestination = createFactoryApplication({
        databasePath: destinationPath,
      });
      expect(reopenedDestination.listProjects()).toEqual([
        { id: existingProject.id, name: "Keep this project" },
      ]);
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });

  test("overwrites an existing destination only when explicitly allowed", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-backup-overwrite-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");
    const destinationPath = join(temporaryDirectory, "existing.sqlite");

    try {
      const sourceApplication = createFactoryApplication({ databasePath });
      const sourceProject = sourceApplication.createProject({
        name: "Source project",
      });
      const sourceTask = sourceApplication.createTask({
        name: "Source task",
        projectId: sourceProject.id,
      });

      const destinationApplication = createFactoryApplication({
        databasePath: destinationPath,
      });
      destinationApplication.createProject({ name: "Replace this project" });

      backupFactoryDatabase({
        allowOverwrite: true,
        databasePath,
        destinationPath,
      });

      const reopenedDestination = createFactoryApplication({
        databasePath: destinationPath,
      });
      expect(
        reopenedDestination.getProjectHierarchy(sourceProject.id),
      ).toMatchObject({
        id: sourceProject.id,
        name: "Source project",
        tasks: [
          {
            id: sourceTask.id,
            name: "Source task",
            projectId: sourceProject.id,
          },
        ],
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
