import { describe, expect, test } from "bun:test";

import { FactoryApplication } from "../../src/application";
import { matchReconciliationTarget } from "../../src/reconciliation";
import { resolveT3Project } from "../../src/t3-coordinator";

describe("workspace identity across public seams", () => {
  test("accepts equivalent absolute roots through resolution, matching, and observation persistence", () => {
    const root = "/tmp/factory-workspace-normalization-repro/project";
    const equivalentRoot = `${root}/./nested/..`;

    const factoryProject = {
      createdAt: new Date("2026-09-04T12:00:00Z"),
      id: "factory-project-1",
      name: "Factory workspace normalization repro",
      workspaceRoot: equivalentRoot,
    };
    const t3Project = {
      createdAt: "2026-09-04T12:00:00.000Z",
      id: "t3-project-1",
      title: factoryProject.name,
      updatedAt: "2026-09-04T12:00:00.000Z",
      workspaceRoot: root,
    };

    const projectResolution = resolveT3Project(t3Project, [factoryProject]);
    const targetMatch = matchReconciliationTarget(
      {
        branch: "feature/workspace-normalization",
        externalProjectId: t3Project.id,
        externalThreadId: "t3-thread-1",
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        observedAt: new Date("2026-09-04T12:00:00Z"),
        projectId: factoryProject.id,
        provider: "t3",
        sourceUpdatedAt: new Date("2026-09-04T12:00:00Z"),
        workspaceRoot: t3Project.workspaceRoot,
      },
      [
        {
          branchName: "feature/workspace-normalization",
          projectId: factoryProject.id,
          taskId: "factory-task-1",
          taskName: "Reconcile equivalent workspace roots",
          workState: "planned",
          workspaceRoot: factoryProject.workspaceRoot,
        },
      ],
    );

    const application = new FactoryApplication({
      clock: () => new Date("2026-09-04T12:00:00Z"),
      idGenerator: (() => {
        let nextId = 0;
        return () => `id-${++nextId}`;
      })(),
    });
    const persistedProject = application.createProject({
      name: factoryProject.name,
      workspaceRoot: factoryProject.workspaceRoot,
    });
    let applicationRefresh = "accepted";
    try {
      application.refreshT3Observations({
        observations: [
          {
            branch: "feature/workspace-normalization",
            externalProjectId: t3Project.id,
            externalThreadId: "t3-thread-1",
            hasPendingApprovals: false,
            hasPendingUserInput: false,
            latestSessionState: "running",
            latestTurnState: "running",
            observedAt: new Date("2026-09-04T12:00:00Z"),
            projectId: persistedProject.id,
            provider: "t3",
            sourceDigest: "digest-1",
            sourceSequence: 1,
            sourceStream: "shell",
            sourceUpdatedAt: new Date("2026-09-04T12:00:00Z"),
            title: "Equivalent workspace root",
            workspaceRoot: t3Project.workspaceRoot,
          },
        ],
      });
    } catch (error) {
      applicationRefresh =
        error instanceof Error ? error.message : String(error);
    }

    expect(projectResolution.status).toBe("matched");
    expect(targetMatch.status).toBe("matched");
    expect(applicationRefresh).toBe("accepted");
    expect(
      resolveT3Project(t3Project, [
        factoryProject,
        { ...factoryProject, id: "duplicate", workspaceRoot: root },
      ]).status,
    ).toBe("ambiguous");
    expect(
      resolveT3Project({ ...t3Project, workspaceRoot: root + "-other" }, [
        factoryProject,
      ]).status,
    ).toBe("unmatched");
  });
  test("does not treat missing or relative roots as a shared identity", () => {
    const project = { id: "p", name: "P", createdAt: new Date() };
    const source = {
      id: "external",
      title: "P",
      createdAt: "2026-09-04T00:00:00Z",
      updatedAt: "2026-09-04T00:00:00Z",
      workspaceRoot: "relative/path",
    };
    expect(
      resolveT3Project(source, [{ ...project, workspaceRoot: "relative/path" }])
        .status,
    ).toBe("unmatched");
  });
});
