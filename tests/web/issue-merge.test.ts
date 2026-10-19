import { describe, expect, test } from "bun:test";

import type { Issue } from "../../src/issues";
import {
  issueMergeCandidates,
  issueMergeConfirmation,
} from "../../src/web/issue-merge";

function issue(
  id: string,
  projectId: string,
  title: string,
  simpleId: string,
): Issue {
  return {
    branches: [],
    createdAt: "2026-10-16T12:00:00.000Z",
    description: "",
    id,
    labels: [],
    projectId,
    pullRequestUrls: [],
    pullRequests: [],
    simpleId,
    status: "todo",
    title,
    updatedAt: "2026-10-16T12:00:00.000Z",
  };
}

describe("issue merging UI helpers", () => {
  test("offers every other issue in the same project regardless of board filters", () => {
    const source = issue("source", "project-a", "Source issue", "F-1");
    const sameProject = issue("same-project", "project-a", "Keep this", "F-2");
    const otherProject = issue(
      "other-project",
      "project-b",
      "Other project",
      "F-3",
    );

    expect(
      issueMergeCandidates([source, sameProject, otherProject], source),
    ).toEqual([sameProject]);
  });

  test("confirmation says the source is removed and target is kept", () => {
    const source = issue("source", "project-a", "Source issue", "F-1");
    const target = issue("target", "project-a", "Kept issue", "F-2");
    const message = issueMergeConfirmation(source, target);

    expect(message).toContain("F-1 will be removed");
    expect(message).toContain("F-2 will be kept");
    expect(message).toContain("issue details, links, and activity");
  });
});
