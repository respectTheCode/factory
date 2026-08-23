import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  checkFactoryDatabase,
  createFactoryApplication,
} from "../../src/application";

describe("project removal", () => {
  test("removes a project and its records while preserving an unrelated project", () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-removal-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const app = createFactoryApplication({ databasePath });
      const remainingProject = app.createProject({ name: "Grail roadmap" });
      const removedProject = app.createProject({ name: "Old launch plan" });

      const remainingTask = app.createTask({
        name: "Ship the current roadmap",
        projectId: remainingProject.id,
      });
      const remainingSubtask = app.createSubtask({
        name: "Verify the current release",
        taskId: remainingTask.id,
      });
      const remainingReport = app.reportSubtaskStatus({
        evidence: "Current release is ready.",
        reporter: "codex",
        reportedState: "complete",
        subtaskId: remainingSubtask.id,
      });
      app.verifyStatusReport({
        decision: "accepted",
        reportId: remainingReport.id,
        verifier: "kevin",
      });
      app.addProjectTrackerLink({
        projectId: remainingProject.id,
        stableId: "GRAIL-ROADMAP",
        system: "notion",
        url: "https://www.notion.so/grail/roadmap",
      });
      app.addTaskTrackerLink({
        taskId: remainingTask.id,
        stableId: "GRA-123",
        system: "linear",
        url: "https://linear.app/grail/issue/GRA-123",
      });

      const removedTask = app.createTask({
        name: "Archive the old plan",
        projectId: removedProject.id,
      });
      const removedSubtask = app.createSubtask({
        name: "Confirm the archive",
        taskId: removedTask.id,
      });
      const removedReport = app.reportSubtaskStatus({
        evidence: "Archive confirmed.",
        reporter: "codex",
        reportedState: "complete",
        subtaskId: removedSubtask.id,
      });
      app.verifyStatusReport({
        decision: "accepted",
        reportId: removedReport.id,
        verifier: "kevin",
      });
      app.addProjectTrackerLink({
        projectId: removedProject.id,
        stableId: "OLD-LAUNCH-PLAN",
        system: "notion",
        url: "https://www.notion.so/grail/old-launch-plan",
      });
      app.addTaskTrackerLink({
        taskId: removedTask.id,
        stableId: "GRA-999",
        system: "linear",
        url: "https://linear.app/grail/issue/GRA-999",
      });

      expect(checkFactoryDatabase({ databasePath }).counts).toEqual({
        projects: 2,
        tasks: 2,
        subtasks: 2,
        statusReports: 2,
        verifications: 2,
        trackerLinks: 4,
      });

      app.removeProject(removedProject.id);

      expect(app.listProjects()).toEqual([
        { id: remainingProject.id, name: "Grail roadmap" },
      ]);
      expect(app.getProjectHierarchy(remainingProject.id)).toMatchObject({
        id: remainingProject.id,
        tasks: [
          {
            id: remainingTask.id,
            subtasks: [{ id: remainingSubtask.id }],
          },
        ],
      });
      expect(app.getTaskStatus(remainingTask.id)).toMatchObject({
        taskCompleted: true,
        subtasks: [
          {
            reportId: remainingReport.id,
            reportedState: "complete",
            verificationState: "accepted",
          },
        ],
      });
      expect(
        app.getProjectDetail(remainingProject.id).trackerLinks,
      ).toHaveLength(1);
      expect(app.getTaskDetail(remainingTask.id).trackerLinks).toHaveLength(1);

      expect(() => app.getProjectHierarchy(removedProject.id)).toThrow(
        `Project ${removedProject.id} does not exist.`,
      );
      expect(() => app.getTaskStatus(removedTask.id)).toThrow(
        `Task ${removedTask.id} does not exist.`,
      );
      expect(() => app.getSubtaskReportHistory(removedSubtask.id)).toThrow(
        `Subtask ${removedSubtask.id} does not exist.`,
      );
      expect(() =>
        app.getSubtaskVerificationHistory(removedSubtask.id),
      ).toThrow(`Subtask ${removedSubtask.id} does not exist.`);
      expect(() =>
        app.verifyStatusReport({
          decision: "accepted",
          reportId: removedReport.id,
          verifier: "kevin",
        }),
      ).toThrow(`Status Report ${removedReport.id} does not exist.`);

      expect(checkFactoryDatabase({ databasePath }).counts).toEqual({
        projects: 1,
        tasks: 1,
        subtasks: 1,
        statusReports: 1,
        verifications: 1,
        trackerLinks: 2,
      });

      const reopenedApp = createFactoryApplication({ databasePath });
      expect(reopenedApp.listProjects()).toEqual([
        { id: remainingProject.id, name: "Grail roadmap" },
      ]);
      expect(
        reopenedApp.getProjectHierarchy(remainingProject.id),
      ).toMatchObject({
        tasks: [{ id: remainingTask.id }],
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
