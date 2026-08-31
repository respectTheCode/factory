import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);
const stylesheet = readFileSync(
  join(import.meta.dir, "../../src/web/styles.css"),
  "utf8",
);

describe("PWA GitHub status presentation", () => {
  test("loads Task and Subtask PR status without coupling it to Factory state", () => {
    expect(source).toContain("tasks.githubStatus.query");
    expect(source).toContain("subtasks.githubStatus.query");
    expect(source).toContain("refreshGitHubStatuses");
    expect(source).toContain("60_000");
    expect(source).toContain("GitHubStatusBadge");
    expect(source).toContain("summarizeGitHubActions");
    expect(source).toContain("actionsSummary={taskActionsSummary}");
    expect(source).toContain("subtaskActionsSummary");
    expect(source).toContain("GitHubActionsSummaryBadge");
    expect(source).toContain('<span className="row-title">');
    expect(source).toContain('<span className="row-title-text">{name}</span>');
    expect(stylesheet).toContain(".row-title-text");
    expect(stylesheet).toContain(".github-actions-running");
    expect(stylesheet).toContain(".github-actions-passing");
    expect(stylesheet).toContain(".github-actions-failing");
    expect(stylesheet).toContain(".github-actions-skipped");
    expect(source).toContain("Actions passing");
    expect(source).toContain("Actions failing");
    expect(source).toContain('github-status-${status?.status ?? "loading"}');
    expect(source).not.toContain(
      "tasks.setState.mutate({\n        taskId: task.id",
    );
  });
});
