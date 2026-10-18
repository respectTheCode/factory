import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database } from "bun:sqlite";
import { afterEach, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createIssueStore } from "../../src/issues";
import { importReviewIssues } from "../../scripts/import-review-issues";

const directories: string[] = [];
const prUrl = "https://github.com/acme/factory/pull/41";

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "factory-review-issue-import-"));
  directories.push(directory);
  return directory;
}

function readState(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    return (
      database.query("SELECT state FROM factory_state WHERE id = 1").get() as {
        state: string;
      }
    ).state;
  } finally {
    database.close();
  }
}

function readIssueTables(databasePath: string) {
  const database = new Database(databasePath, { readonly: true });
  try {
    const exists = (table: string) =>
      Boolean(
        database
          .query(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name",
          )
          .get({ $name: table }),
      );
    return {
      counter: exists("factory_issue_counter")
        ? database
            .query(
              "SELECT id, next_number FROM factory_issue_counter ORDER BY id",
            )
            .all()
        : null,
      issues: exists("factory_issues")
        ? database
            .query(
              "SELECT id, simple_id, project_id, title, description, labels_json, branches_json, pull_request_urls_json, status, manual_status, order_index, created_at, updated_at FROM factory_issues ORDER BY id",
            )
            .all()
        : null,
      threads: exists("factory_issue_threads")
        ? database
            .query(
              "SELECT issue_id, source_id, thread_id, title, branch, repository, state, current, updated_at, event_fingerprint FROM factory_issue_threads ORDER BY issue_id, source_id, thread_id",
            )
            .all()
        : null,
      pullRequests: exists("factory_issue_pull_requests")
        ? database
            .query(
              "SELECT issue_id, url, state, merged, updated_at, merged_at, event_fingerprint FROM factory_issue_pull_requests ORDER BY issue_id, url",
            )
            .all()
        : null,
    };
  } finally {
    database.close();
  }
}

function createReviewSnapshot(
  directory: string,
  {
    legacyOrderIndex = false,
    wontDo = false,
  }: { legacyOrderIndex?: boolean; wontDo?: boolean } = {},
) {
  const databasePath = join(directory, "review.sqlite");
  const application = createFactoryApplication({ databasePath });
  const store = createIssueStore({ databasePath });
  let fixture: { databasePath: string; projectId: string; issueId: string };
  try {
    const project = application.createProject({ name: "Review project" });
    const issue = store.create({
      projectId: project.id,
      title: "Keep the reviewed issue",
      description: "Issue data copied exactly from the review store.",
      labels: ["release", "migration"],
      branches: ["release/issue-import"],
      pullRequestUrls: [prUrl],
    });
    const secondIssue = store.create({
      projectId: project.id,
      title: "Second reviewed issue",
    });
    const thirdIssue = store.create({
      projectId: project.id,
      title: "Third reviewed issue",
    });
    store.move({
      id: thirdIssue.id,
      status: "todo",
      beforeId: secondIssue.id,
    });
    store.observeThreads({
      projectId: project.id,
      threads: [
        {
          sourceId: "m4",
          threadId: "thread-41",
          title: "Review issue implementation",
          branch: "release/issue-import",
          repository: "acme/factory",
          state: "stopped",
          current: true,
          updatedAt: "2026-10-16T18:30:00.000Z",
        },
      ],
    });
    store.reconcileProject({
      projectId: project.id,
      pullRequests: [
        {
          url: prUrl,
          ok: true,
          state: wontDo ? "closed" : "open",
          updatedAt: "2026-10-16T18:31:00.000Z",
        },
      ],
      pullRequestPassComplete: true,
      freshSourceIds: ["m4"],
    });
    store.update({ id: issue.id, status: "todo" });
    fixture = { databasePath, projectId: project.id, issueId: issue.id };
  } finally {
    store.close();
    application.close();
  }
  if (legacyOrderIndex) {
    const database = new Database(databasePath);
    database.exec("PRAGMA foreign_keys = OFF");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(`
        CREATE TABLE factory_issues_legacy (
          id TEXT PRIMARY KEY,
          simple_id TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          labels_json TEXT NOT NULL,
          branches_json TEXT NOT NULL,
          pull_request_urls_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'needs_attention', 'done')),
          manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('todo', 'in_progress', 'needs_attention', 'done')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO factory_issues_legacy
          (id, simple_id, project_id, title, description, labels_json,
           branches_json, pull_request_urls_json, status, manual_status,
           created_at, updated_at)
        SELECT id, simple_id, project_id, title, description, labels_json,
               branches_json, pull_request_urls_json, status, manual_status,
               created_at, updated_at
          FROM factory_issues;
        DROP TABLE factory_issues;
        ALTER TABLE factory_issues_legacy RENAME TO factory_issues;
      `);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    } finally {
      database.close();
    }
    const migratedStore = createIssueStore({ databasePath });
    migratedStore.close();
  }
  if (wontDo) {
    const wontDoStore = createIssueStore({ databasePath });
    wontDoStore.update({ id: fixture!.issueId, status: "wont_do" });
    wontDoStore.close();
  }
  return fixture!;
}

function createTargetSnapshot(
  directory: string,
  projectId: string,
  { includeIssue = false }: { includeIssue?: boolean } = {},
) {
  const databasePath = join(directory, "target.sqlite");
  const application = createFactoryApplication({ databasePath });
  const project = application.createProject({ name: "Production project" });
  const task = application.createTask({
    name: "Historical task that must stay put",
    projectId: project.id,
  });
  application.close();

  const database = new Database(databasePath);
  const persisted = database
    .query("SELECT state FROM factory_state WHERE id = 1")
    .get() as { state: string };
  const state = JSON.parse(persisted.state) as {
    projects: Array<{ id: string }>;
    tasks: Array<{ id: string; projectId: string }>;
  };
  state.projects[0]!.id = projectId;
  state.tasks[0]!.projectId = projectId;
  database
    .query("UPDATE factory_state SET state = $state WHERE id = 1")
    .run({ $state: JSON.stringify(state) });
  database.close();

  if (includeIssue) {
    const issueStore = createIssueStore({ databasePath });
    issueStore.create({ projectId, title: "Pre-existing target issue" });
    issueStore.close();
  }
  return { databasePath, projectId };
}

function afterAllCleanup() {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

afterEach(afterAllCleanup);

test("imports a legacy-migrated issue store and leaves target state byte-for-byte intact", () => {
  const directory = temporaryDirectory();
  const review = createReviewSnapshot(directory, { legacyOrderIndex: true });
  const target = createTargetSnapshot(directory, review.projectId);
  const expectedIssueRows = readIssueTables(review.databasePath);
  const legacyState = readState(target.databasePath);

  const counts = importReviewIssues({
    sourceDatabasePath: review.databasePath,
    targetDatabasePath: target.databasePath,
  });

  expect(counts).toEqual({ issues: 3, threads: 1, pullRequests: 1 });
  expect(readIssueTables(target.databasePath)).toEqual(expectedIssueRows);
  expect(readState(target.databasePath)).toBe(legacyState);
});

test("imports Won't do as a valid persisted issue status", () => {
  const directory = temporaryDirectory();
  const review = createReviewSnapshot(directory, { wontDo: true });
  const target = createTargetSnapshot(directory, review.projectId);
  const expectedIssueRows = readIssueTables(review.databasePath);

  const counts = importReviewIssues({
    sourceDatabasePath: review.databasePath,
    targetDatabasePath: target.databasePath,
  });

  expect(counts).toEqual({ issues: 3, threads: 1, pullRequests: 1 });
  expect(readIssueTables(target.databasePath)).toEqual(expectedIssueRows);
  const targetStore = createIssueStore({ databasePath: target.databasePath });
  try {
    expect(targetStore.detail(review.issueId)?.issue.status).toBe("wont_do");
  } finally {
    targetStore.close();
  }
});

test("rejects a nonempty target before changing its issue rows or legacy state", () => {
  const directory = temporaryDirectory();
  const review = createReviewSnapshot(directory);
  const target = createTargetSnapshot(directory, review.projectId, {
    includeIssue: true,
  });
  const issueTables = readIssueTables(target.databasePath);
  const legacyState = readState(target.databasePath);

  expect(() =>
    importReviewIssues({
      sourceDatabasePath: review.databasePath,
      targetDatabasePath: target.databasePath,
    }),
  ).toThrow("Target issue store is not empty.");
  expect(readIssueTables(target.databasePath)).toEqual(issueTables);
  expect(readState(target.databasePath)).toBe(legacyState);
});

test("rejects missing target projects without creating issue tables or changing state", () => {
  const directory = temporaryDirectory();
  const review = createReviewSnapshot(directory);
  const target = createTargetSnapshot(directory, "production-only-project");
  const legacyState = readState(target.databasePath);

  expect(() =>
    importReviewIssues({
      sourceDatabasePath: review.databasePath,
      targetDatabasePath: target.databasePath,
    }),
  ).toThrow("Target is missing a project used by a review issue.");
  expect(readIssueTables(target.databasePath)).toEqual({
    counter: null,
    issues: null,
    threads: null,
    pullRequests: null,
  });
  expect(readState(target.databasePath)).toBe(legacyState);
});
