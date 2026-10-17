import { describe, expect, test } from "bun:test";

import type { Issue } from "../../src/issues";
import {
  groupIssues,
  ISSUE_STATUSES,
  readCollapsedStatuses,
  writeCollapsedStatuses,
} from "../../src/web/issue-board";

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
    expect(groupIssues([])).toEqual([
      ["done", []],
      ["needs_attention", []],
      ["in_progress", []],
      ["todo", []],
    ]);
  });

  test("places visible issues into their status while retaining empty groups", () => {
    const todo = issue("todo-1", "todo");
    const done = issue("done-1", "done");

    expect(groupIssues([todo, done])).toEqual([
      ["done", [done]],
      ["needs_attention", []],
      ["in_progress", []],
      ["todo", [todo]],
    ]);
    expect(ISSUE_STATUSES).toEqual([
      "done",
      "needs_attention",
      "in_progress",
      "todo",
    ]);
  });

  test("loads only valid saved collapsed statuses", () => {
    const storage = {
      getItem: () => JSON.stringify(["todo", "done", "todo", "unknown"]),
    };

    expect(readCollapsedStatuses(storage)).toEqual(["todo", "done"]);
  });

  test("treats malformed or unavailable storage as all groups expanded", () => {
    expect(readCollapsedStatuses({ getItem: () => "{" })).toEqual([]);
    expect(
      readCollapsedStatuses({ getItem: () => JSON.stringify({}) }),
    ).toEqual([]);
    expect(readCollapsedStatuses(null)).toEqual([]);
    expect(
      readCollapsedStatuses({
        getItem: () => {
          throw new Error("storage blocked");
        },
      }),
    ).toEqual([]);
  });

  test("saves collapsed statuses and tolerates blocked storage", () => {
    let saved: string | null = null;
    writeCollapsedStatuses(["todo", "done"], {
      setItem: (_key, value) => {
        saved = value;
      },
    });

    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!)).toEqual(["done", "todo"]);
    expect(() => writeCollapsedStatuses(["done"], null)).not.toThrow();
    expect(() =>
      writeCollapsedStatuses(["done"], {
        setItem: () => {
          throw new Error("storage blocked");
        },
      }),
    ).not.toThrow();
  });
});
