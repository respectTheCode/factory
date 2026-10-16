import { describe, expect, test } from "bun:test";

import type { Issue } from "../../src/issues";
import { groupIssues, ISSUE_STATUSES } from "../../src/web/issue-board";

function issue(id: string, status: Issue["status"]): Issue {
  return {
    branches: [],
    createdAt: "2026-10-16T12:00:00.000Z",
    description: "",
    id,
    labels: [],
    projectId: "project-1",
    pullRequestUrls: [],
    pullRequests: [],
    simpleId: id,
    status,
    title: id,
    updatedAt: "2026-10-16T12:00:00.000Z",
  };
}

describe("issue status groups", () => {
  test("keeps all four groups present when the board is empty", () => {
    expect(groupIssues([])).toEqual(
      ISSUE_STATUSES.map((status) => [status, []]),
    );
  });

  test("places visible issues into their status while retaining empty groups", () => {
    const todo = issue("todo-1", "todo");
    const done = issue("done-1", "done");

    expect(groupIssues([todo, done])).toEqual([
      ["todo", [todo]],
      ["in_progress", []],
      ["needs_attention", []],
      ["done", [done]],
    ]);
  });
});
