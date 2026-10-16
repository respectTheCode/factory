import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createFactoryApplication } from "../../src/application";
import {
  backupFactorySnapshot,
  verifyFactorySnapshot,
} from "../../src/backup-snapshot";
import { createIssueStore } from "../../src/issues";

test("the existing online backup captures issue records and their thread associations", () => {
  const directory = mkdtempSync(join(tmpdir(), "factory-issue-backup-"));
  const databasePath = join(directory, "factory.sqlite");
  const outputPath = join(directory, "snapshot.sqlite");
  const application = createFactoryApplication({ databasePath });
  const issues = createIssueStore({ databasePath });
  let restored: ReturnType<typeof createIssueStore> | undefined;
  try {
    const project = application.createProject({ name: "Factory backup check" });
    const issue = issues.create({
      projectId: project.id,
      title: "Retain issue history",
      branches: ["feature/backup"],
      labels: ["backup"],
    });
    issues.observeThreads({
      projectId: project.id,
      threads: [
        {
          sourceId: "m4",
          threadId: "thread-a",
          title: "Implement backup",
          branch: "feature/backup",
          state: "stopped",
          current: true,
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    issues.update({ id: issue.id, status: "done" });
    const before = issues.detail(issue.id);
    backupFactorySnapshot({ databasePath, outputPath });
    verifyFactorySnapshot({
      databasePath: outputPath,
      manifestPath: `${outputPath}.manifest.json`,
    });
    restored = createIssueStore({ databasePath: outputPath });
    expect(restored.detail(issue.id)).toEqual(before);
    expect(
      restored.create({ projectId: project.id, title: "Next issue" }).simpleId,
    ).toBe("F-2");
  } finally {
    restored?.close();
    issues.close();
    application.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
