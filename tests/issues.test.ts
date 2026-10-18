import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";

import { createFactoryApplication } from "../src/application";
import {
  createIssueStore,
  type IssuePullRequestObservation,
  type IssueThreadObservation,
} from "../src/issues";

const directories: string[] = [];
const projectId = "project-1";
const prOne = "https://github.com/acme/app/pull/1";
const prTwo = "https://github.com/acme/app/pull/2";

function makeStore() {
  const directory = mkdtempSync(join(tmpdir(), "factory-issues-"));
  directories.push(directory);
  return createIssueStore({ databasePath: join(directory, "factory.sqlite") });
}

function thread(
  input: Partial<IssueThreadObservation> &
    Pick<IssueThreadObservation, "threadId">,
): IssueThreadObservation {
  return {
    current: true,
    sourceId: "source-a",
    state: "working",
    title: "Build issue support",
    updatedAt: "2026-10-16T10:00:00.000Z",
    ...input,
  };
}

function pullRequest(
  url: string,
  state: "open" | "closed",
  options: { mergedAt?: string; updatedAt?: string } = {},
): IssuePullRequestObservation {
  return {
    ok: true,
    state,
    updatedAt: options.updatedAt ?? "2026-10-16T10:00:00.000Z",
    url,
    ...(options.mergedAt ? { mergedAt: options.mergedAt } : {}),
  };
}

function reconcile(
  store: ReturnType<typeof createIssueStore>,
  pullRequests: IssuePullRequestObservation[] = [],
  pullRequestPassComplete = true,
  freshSourceIds?: string[],
) {
  store.reconcileProject({
    ...(freshSourceIds === undefined ? {} : { freshSourceIds }),
    projectId,
    pullRequests,
    pullRequestPassComplete,
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("Factory issue store", () => {
  test("migrates existing issues in deterministic status-local order", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-migration-"));
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    const legacy = new Database(databasePath);
    legacy.exec(`
      CREATE TABLE factory_issues (
        id TEXT PRIMARY KEY,
        simple_id TEXT NOT NULL UNIQUE,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        labels_json TEXT NOT NULL,
        branches_json TEXT NOT NULL,
        pull_request_urls_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'needs_attention', 'done')),
        manual_status TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE factory_issue_counter (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        next_number INTEGER NOT NULL CHECK (next_number > 0)
      );
      INSERT INTO factory_issue_counter (id, next_number) VALUES (1, 4);
    `);
    const insert = legacy.query(
      `INSERT INTO factory_issues
        (id, simple_id, project_id, title, description, labels_json,
         branches_json, pull_request_urls_json, status, created_at, updated_at)
       VALUES ($id, $simpleId, $projectId, $title, '', '[]', '[]', '[]',
         $status, $createdAt, $createdAt)`,
    );
    insert.run({
      $createdAt: "2026-10-16T10:02:00.000Z",
      $id: "legacy-later",
      $projectId: projectId,
      $simpleId: "F-2",
      $status: "todo",
      $title: "Later",
    });
    insert.run({
      $createdAt: "2026-10-16T10:01:00.000Z",
      $id: "legacy-progress",
      $projectId: projectId,
      $simpleId: "F-3",
      $status: "in_progress",
      $title: "Progress",
    });
    insert.run({
      $createdAt: "2026-10-16T10:01:00.000Z",
      $id: "legacy-earlier",
      $projectId: projectId,
      $simpleId: "F-1",
      $status: "todo",
      $title: "Earlier",
    });
    legacy.close();

    const store = createIssueStore({ databasePath });
    try {
      expect(store.list({ projectId }).map(({ id }) => id)).toEqual([
        "legacy-earlier",
        "legacy-later",
        "legacy-progress",
      ]);
      const appended = store.create({ projectId, title: "Appended" });
      expect(store.list({ projectId }).map(({ id }) => id)).toEqual([
        "legacy-earlier",
        "legacy-later",
        appended.id,
        "legacy-progress",
      ]);
    } finally {
      store.close();
    }
  });

  test("adds Won't do without losing issue order, observations, links, receipts, or legacy state", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-issues-status-migration-"),
    );
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    let store = createIssueStore({ databasePath });
    const project = application.createProject({ name: "Migration project" });
    application.createTask({ name: "Historical task", projectId: project.id });
    const linked = store.create({
      projectId: project.id,
      title: "Linked issue",
      branches: ["feature/migration"],
      pullRequestUrls: [prOne],
    });
    const other = store.create({ projectId: project.id, title: "Other issue" });
    store.move({ id: other.id, status: "in_progress" });
    const observedThread = thread({
      sourceId: "m4",
      threadId: "thread-migration",
      branch: "feature/migration",
      updatedAt: "2026-10-16T10:00:00.000Z",
    });
    store.observeThreads({ projectId: project.id, threads: [observedThread] });
    store.reconcileProject({
      projectId: project.id,
      pullRequests: [pullRequest(prOne, "open")],
      pullRequestPassComplete: true,
    });
    expect(
      store.discoverThreads({
        projectId: project.id,
        freshSourceIds: ["m4"],
        notBefore: "2026-10-15T00:00:00.000Z",
        threads: [observedThread],
      }),
    ).toEqual([]);

    const capture = () => {
      const database = new Database(databasePath, { readonly: true });
      try {
        return {
          issues: database
            .query(
              `SELECT id, simple_id, project_id, title, description, labels_json,
                      branches_json, pull_request_urls_json, status, manual_status,
                      order_index, created_at, updated_at
                 FROM factory_issues ORDER BY id`,
            )
            .all(),
          threads: database
            .query(
              `SELECT issue_id, source_id, thread_id, title, branch, repository,
                      state, current, updated_at, event_fingerprint
                 FROM factory_issue_threads ORDER BY issue_id, source_id, thread_id`,
            )
            .all(),
          pullRequests: database
            .query(
              `SELECT issue_id, url, state, merged, updated_at, merged_at,
                      event_fingerprint
                 FROM factory_issue_pull_requests ORDER BY issue_id, url`,
            )
            .all(),
          receipts: database
            .query(
              `SELECT project_id, source_id, thread_id, issue_id, branch,
                      discovered_at
                 FROM factory_issue_discovery_receipts
                ORDER BY project_id, source_id, thread_id`,
            )
            .all(),
          legacyState: (
            database
              .query("SELECT state FROM factory_state WHERE id = 1")
              .get() as { state: string }
          ).state,
          threadForeignKeys: database
            .query("PRAGMA foreign_key_list(factory_issue_threads)")
            .all(),
          pullRequestForeignKeys: database
            .query("PRAGMA foreign_key_list(factory_issue_pull_requests)")
            .all(),
        };
      } finally {
        database.close();
      }
    };
    const before = capture();
    const listOrderBefore = store
      .list({ projectId: project.id })
      .map(({ id }) => id);

    store.close();
    application.close();
    const legacy = new Database(databasePath);
    legacy.exec("PRAGMA foreign_keys = OFF");
    legacy.exec("BEGIN IMMEDIATE");
    try {
      legacy.exec(`
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
          order_index INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO factory_issues_legacy
          (id, simple_id, project_id, title, description, labels_json,
           branches_json, pull_request_urls_json, status, manual_status,
           order_index, created_at, updated_at)
        SELECT id, simple_id, project_id, title, description, labels_json,
               branches_json, pull_request_urls_json, status, manual_status,
               order_index, created_at, updated_at
          FROM factory_issues;
        DROP TABLE factory_issues;
        ALTER TABLE factory_issues_legacy RENAME TO factory_issues;
      `);
      legacy.exec("COMMIT");
    } catch (error) {
      legacy.exec("ROLLBACK");
      throw error;
    } finally {
      legacy.close();
    }

    store = createIssueStore({ databasePath });
    try {
      expect(capture()).toEqual(before);
      expect(store.list({ projectId: project.id }).map(({ id }) => id)).toEqual(
        [other.id, linked.id],
      );
      expect(store.list({ projectId: project.id }).map(({ id }) => id)).toEqual(
        listOrderBefore,
      );
      expect(store.detail(linked.id)).toMatchObject({
        issue: {
          pullRequestUrls: [prOne],
          status: "in_progress",
        },
        threads: [expect.objectContaining({ threadId: "thread-migration" })],
      });
      expect(
        store.discoverThreads({
          projectId: project.id,
          freshSourceIds: ["m4"],
          notBefore: "2026-10-15T00:00:00.000Z",
          threads: [observedThread],
        }),
      ).toEqual([]);
      const check = new Database(databasePath, { readonly: true });
      try {
        expect(check.query("PRAGMA foreign_key_check").all()).toEqual([]);
      } finally {
        check.close();
      }
    } finally {
      store.close();
    }
  });

  test("persists manual order and appends issues when their status changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-order-"));
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    let store = createIssueStore({ databasePath });
    const first = store.create({ projectId, title: "First" });
    const second = store.create({ projectId, title: "Second" });
    const third = store.create({ projectId, title: "Third" });
    store.create({ projectId: "project-2", title: "Hidden project issue" });
    try {
      store.move({ id: third.id, status: "todo", beforeId: first.id });
      store.move({ id: second.id, status: "in_progress" });
      expect(store.list({ projectId }).map(({ id }) => id)).toEqual([
        third.id,
        first.id,
        second.id,
      ]);

      store.close();
      store = createIssueStore({ databasePath });
      expect(store.list({ projectId }).map(({ id }) => id)).toEqual([
        third.id,
        first.id,
        second.id,
      ]);
      const fourth = store.create({ projectId, title: "Fourth" });
      expect(store.list({ projectId }).map(({ id }) => id)).toEqual([
        third.id,
        first.id,
        fourth.id,
        second.id,
      ]);
    } finally {
      store.close();
    }
  });

  test("rejects invalid move anchors without changing status or order", () => {
    const store = makeStore();
    try {
      const first = store.create({ projectId, title: "First" });
      const second = store.create({ projectId, title: "Second" });
      const otherStatus = store.create({ projectId, title: "Other status" });
      store.move({ id: otherStatus.id, status: "in_progress" });

      expect(() =>
        store.move({ id: first.id, status: "todo", beforeId: otherStatus.id }),
      ).toThrow("destination status");
      expect(store.list({ projectId }).map(({ id }) => id)).toEqual([
        first.id,
        second.id,
        otherStatus.id,
      ]);
      expect(store.detail(first.id)?.issue.status).toBe("todo");
    } finally {
      store.close();
    }
  });

  test("keeps status and persisted order unchanged when Done evidence is incomplete", () => {
    const store = makeStore();
    try {
      const first = store.create({ projectId, title: "First" });
      const linked = store.create({
        projectId,
        pullRequestUrls: [prOne],
        title: "Unmerged PR",
      });
      const last = store.create({ projectId, title: "Last" });
      reconcile(store, [pullRequest(prOne, "open")]);
      const before = store.list({ projectId }).map(({ id, status }) => ({
        id,
        status,
      }));

      expect(() => store.move({ id: linked.id, status: "done" })).toThrow(
        "every Pull Request is confirmed closed or merged",
      );
      expect(
        store.list({ projectId }).map(({ id, status }) => ({ id, status })),
      ).toEqual(before);
      expect(before.map(({ id }) => id)).toContain(first.id);
      expect(before.map(({ id }) => id)).toContain(last.id);
      expect(before.find(({ id }) => id === linked.id)?.status).not.toBe(
        "done",
      );
    } finally {
      store.close();
    }
  });

  test("starts empty, persists records, and allocates stable F simple IDs", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-"));
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    const store = createIssueStore({ databasePath });
    let reopened: ReturnType<typeof createIssueStore> | undefined;
    let storeClosed = false;
    try {
      expect(store.list()).toEqual([]);
      const first = store.create({
        projectId,
        title: "  Add issue tracking  ",
        description: "  Track work separately. ",
        labels: ["backend", "backend", " ", "product"],
        branches: ["feature/issues", "feature/issues"],
        pullRequestUrls: ["https://github.com/acme/app/pull/1?tab=files"],
      });
      const second = store.create({ projectId: "project-2", title: "Second" });

      expect(first).toMatchObject({
        simpleId: "F-1",
        title: "Add issue tracking",
        description: "Track work separately.",
        labels: ["backend", "product"],
        branches: ["feature/issues"],
        pullRequestUrls: [prOne],
        status: "todo",
      });
      expect(second.simpleId).toBe("F-2");
      expect(store.list({ projectId })).toHaveLength(1);
      expect(store.detail(first.id)?.issue.id).toBe(first.id);
      store.close();
      storeClosed = true;

      const legacyApplication = createFactoryApplication({ databasePath });
      legacyApplication.createProject({ name: "Legacy application state" });
      legacyApplication.close();

      reopened = createIssueStore({ databasePath });
      expect(reopened.list({ projectId })[0]).toMatchObject({
        id: first.id,
        simpleId: "F-1",
        pullRequestUrls: [prOne],
      });
    } finally {
      if (!storeClosed) store.close();
      if (reopened) reopened.close();
    }
  });

  test("derives working and attention from every associated branch thread", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "Two linked branches",
        branches: ["feature/a", "feature/b"],
      });
      store.observeThreads({
        projectId,
        threads: [
          thread({ threadId: "thread-a", branch: "feature/a" }),
          thread({
            sourceId: "source-b",
            threadId: "thread-b",
            branch: "feature/b",
            state: "stopped",
            updatedAt: "2026-10-16T10:05:00.000Z",
          }),
        ],
      });
      reconcile(store);
      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");

      store.observeThreads({
        projectId,
        threads: [
          thread({
            threadId: "thread-a",
            branch: "feature/a",
            state: "stopped",
            updatedAt: "2026-10-16T10:06:00.000Z",
          }),
          thread({
            sourceId: "source-b",
            threadId: "thread-b",
            branch: "feature/b",
            state: "stopped",
            updatedAt: "2026-10-16T10:05:00.000Z",
          }),
        ],
      });
      reconcile(store);
      expect(store.detail(issue.id)?.issue.status).toBe("needs_attention");
      expect(store.detail(issue.id)?.threads).toHaveLength(2);
      expect(
        store.detail(issue.id)?.threads.map(({ sourceId }) => sourceId),
      ).toEqual(["source-a", "source-b"]);
    } finally {
      store.close();
    }
  });

  test("lets fresh working evidence win while another associated source is uncertain", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "Fresh work with an unavailable source",
        branches: ["feature/a", "feature/b"],
      });
      store.observeThreads({
        projectId,
        threads: [
          thread({ threadId: "thread-a", branch: "feature/a" }),
          thread({
            sourceId: "source-b",
            threadId: "thread-b",
            branch: "feature/b",
            state: "stopped",
          }),
        ],
      });
      reconcile(store);
      store.update({ id: issue.id, status: "todo" });

      store.observeThreads({
        freshSourceIds: ["source-a"],
        projectId,
        threads: [
          thread({
            threadId: "thread-a",
            branch: "feature/a",
            state: "working",
            updatedAt: "2026-10-16T10:10:00.000Z",
          }),
        ],
      });
      reconcile(store, [], true, ["source-a"]);

      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");

      store.observeThreads({
        freshSourceIds: ["source-a"],
        projectId,
        threads: [
          thread({
            threadId: "thread-a",
            branch: "feature/a",
            state: "working",
            updatedAt: "2026-10-16T10:10:00.000Z",
          }),
        ],
      });
      reconcile(store, [], true, ["source-a"]);

      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");
    } finally {
      store.close();
    }
  });

  test("preserves manual status and ignores stale stopped rows during source outage", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "Uncertain stopped thread",
        branches: ["feature/a"],
      });
      store.observeThreads({
        projectId,
        threads: [
          thread({
            threadId: "thread-a",
            branch: "feature/a",
            state: "stopped",
          }),
        ],
      });
      reconcile(store);
      store.update({ id: issue.id, status: "todo" });

      store.observeThreads({
        freshSourceIds: [],
        projectId,
        threads: [],
      });
      reconcile(store, [], true, []);

      expect(store.detail(issue.id)?.issue.status).toBe("todo");
      expect(store.detail(issue.id)?.threads[0]?.current).toBe(false);
    } finally {
      store.close();
    }
  });

  test("keeps a manual status until a later thread event, and keeps done sticky", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "Manual status",
        branches: ["feature/a"],
      });
      const firstObservation = thread({
        threadId: "thread-a",
        branch: "feature/a",
      });
      store.observeThreads({ projectId, threads: [firstObservation] });
      reconcile(store);
      store.update({ id: issue.id, status: "todo" });
      store.observeThreads({ projectId, threads: [firstObservation] });
      reconcile(store);
      expect(store.detail(issue.id)?.issue.status).toBe("todo");

      store.update({ id: issue.id, status: "done" });
      store.observeThreads({
        projectId,
        threads: [
          thread({
            threadId: "thread-a",
            branch: "feature/a",
            updatedAt: "2026-10-16T10:10:00.000Z",
          }),
        ],
      });
      reconcile(store);
      expect(store.detail(issue.id)?.issue.status).toBe("done");
    } finally {
      store.close();
    }
  });

  test("keeps Won't do through reloads, new thread and PR activity, and merge reconciliation until manually reopened", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-wont-do-"));
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    let store = createIssueStore({ databasePath });
    const issue = store.create({
      projectId,
      title: "Intentionally not doing this",
      branches: ["feature/wont-do"],
      pullRequestUrls: [prOne],
    });
    const firstThread = thread({
      threadId: "thread-wont-do",
      branch: "feature/wont-do",
    });
    store.observeThreads({ projectId, threads: [firstThread] });
    reconcile(store, [pullRequest(prOne, "closed")]);
    store.move({ id: issue.id, status: "wont_do" });
    store.close();

    store = createIssueStore({ databasePath });
    try {
      expect(store.detail(issue.id)?.issue.status).toBe("wont_do");
      store.observeThreads({
        projectId,
        threads: [
          thread({
            ...firstThread,
            updatedAt: "2026-10-16T10:10:00.000Z",
          }),
        ],
      });
      store.update({ id: issue.id, pullRequestUrls: [prOne, prTwo] });
      reconcile(store, [
        pullRequest(prOne, "open"),
        pullRequest(prTwo, "open"),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("wont_do");

      reconcile(store, [
        pullRequest(prOne, "closed", {
          mergedAt: "2026-10-16T11:00:00.000Z",
          updatedAt: "2026-10-16T11:00:00.000Z",
        }),
        pullRequest(prTwo, "closed", {
          updatedAt: "2026-10-16T11:00:00.000Z",
        }),
      ]);
      reconcile(store, [
        pullRequest(prOne, "closed", {
          mergedAt: "2026-10-16T11:00:00.000Z",
          updatedAt: "2026-10-16T11:00:00.000Z",
        }),
        pullRequest(prTwo, "open", {
          updatedAt: "2026-10-16T11:10:00.000Z",
        }),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("wont_do");

      reconcile(store, [
        pullRequest(prOne, "closed", {
          mergedAt: "2026-10-16T11:00:00.000Z",
          updatedAt: "2026-10-16T11:00:00.000Z",
        }),
        pullRequest(prTwo, "closed", {
          mergedAt: "2026-10-16T11:20:00.000Z",
          updatedAt: "2026-10-16T11:20:00.000Z",
        }),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("wont_do");

      store.move({ id: issue.id, status: "todo" });
      store.observeThreads({
        projectId,
        threads: [
          thread({
            ...firstThread,
            updatedAt: "2026-10-16T10:20:00.000Z",
          }),
        ],
      });
      reconcile(store, [
        pullRequest(prOne, "closed", {
          mergedAt: "2026-10-16T11:00:00.000Z",
          updatedAt: "2026-10-16T11:00:00.000Z",
        }),
        pullRequest(prTwo, "open", {
          updatedAt: "2026-10-16T11:30:00.000Z",
        }),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");
    } finally {
      store.close();
    }
  });

  test("marks done only when every linked PR is merged; closed-unmerged stays open work", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "All linked PRs",
        pullRequestUrls: [prOne, prTwo],
      });
      reconcile(store, [
        pullRequest(prOne, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
        pullRequest(prTwo, "closed"),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");
      expect(store.detail(issue.id)?.issue.pullRequests).toEqual([
        expect.objectContaining({ url: prOne, state: "merged", merged: true }),
        expect.objectContaining({ url: prTwo, state: "closed", merged: false }),
      ]);

      reconcile(store, [
        pullRequest(prOne, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
        pullRequest(prTwo, "closed", { mergedAt: "2026-10-16T11:05:00.000Z" }),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("done");
    } finally {
      store.close();
    }
  });

  test("blocks terminal transitions until every linked PR is confirmed closed", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "PR-backed manual completion",
        pullRequestUrls: [prOne],
      });

      const expectBlocked = () => {
        for (const status of ["done", "wont_do"] as const) {
          expect(() => store.update({ id: issue.id, status })).toThrow(
            "every Pull Request is confirmed closed or merged",
          );
          expect(() => store.move({ id: issue.id, status })).toThrow(
            "every Pull Request is confirmed closed or merged",
          );
        }
      };

      expectBlocked();
      expect(store.detail(issue.id)?.issue.pullRequests).toEqual([
        expect.objectContaining({ url: prOne, state: "unavailable" }),
      ]);

      expect(() =>
        store.update({
          id: issue.id,
          title: "Must roll back",
          pullRequestUrls: [],
          status: "done",
        }),
      ).toThrow("every Pull Request is confirmed closed or merged");
      expect(() =>
        store.update({
          id: issue.id,
          title: "Must also roll back",
          pullRequestUrls: [],
          status: "wont_do",
        }),
      ).toThrow("every Pull Request is confirmed closed or merged");
      expect(store.detail(issue.id)?.issue).toMatchObject({
        pullRequestUrls: [prOne],
        status: "todo",
        title: "PR-backed manual completion",
      });

      reconcile(store, [
        {
          url: prOne,
          ok: true,
          state: "open",
          updatedAt: "2026-10-16T11:00:00.000Z",
        },
      ]);
      const before = store.list({ projectId }).map(({ id, status }) => ({
        id,
        status,
      }));
      expectBlocked();
      expect(
        store.list({ projectId }).map(({ id, status }) => ({ id, status })),
      ).toEqual(before);
      for (const status of ["done", "wont_do"] as const) {
        expect(() =>
          store.update({ id: issue.id, pullRequestUrls: [], status }),
        ).toThrow("every Pull Request is confirmed closed or merged");
      }
      expect(store.detail(issue.id)?.issue).toMatchObject({
        pullRequestUrls: [prOne],
        status: "in_progress",
      });

      reconcile(store, [pullRequest(prOne, "closed")]);
      expect(() =>
        store.update({
          id: issue.id,
          pullRequestUrls: [prOne, prTwo],
          status: "done",
        }),
      ).toThrow("every Pull Request is confirmed closed or merged");
      expect(store.detail(issue.id)?.issue).toMatchObject({
        pullRequestUrls: [prOne],
        status: "in_progress",
      });

      const mixedDoneIssue = store.create({
        projectId,
        title: "Mixed closed and merged PRs",
        pullRequestUrls: [prOne, prTwo],
      });
      const mixedMoveIssue = store.create({
        projectId,
        title: "Move to Done after closed PRs",
        pullRequestUrls: [prOne, prTwo],
      });
      const mixedWontDoIssue = store.create({
        projectId,
        title: "Move to Won't do after closed PRs",
        pullRequestUrls: [prOne, prTwo],
      });
      reconcile(store, [
        pullRequest(prOne, "closed"),
        pullRequest(prTwo, "closed", {
          mergedAt: "2026-10-16T11:05:00.000Z",
        }),
      ]);
      for (const mixedIssue of [
        mixedDoneIssue,
        mixedMoveIssue,
        mixedWontDoIssue,
      ]) {
        expect(store.detail(mixedIssue.id)?.issue.status).not.toBe("done");
      }
      expect(
        store.update({ id: mixedDoneIssue.id, status: "done" }).status,
      ).toBe("done");
      expect(store.move({ id: mixedMoveIssue.id, status: "done" }).status).toBe(
        "done",
      );
      expect(
        store.move({ id: mixedWontDoIssue.id, status: "wont_do" }).status,
      ).toBe("wont_do");
    } finally {
      store.close();
    }
  });

  test("keeps a stopped associated thread in needs attention with a closed-unmerged PR", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "Unmerged work needs attention",
        branches: ["feature/a"],
        pullRequestUrls: [prOne],
      });
      store.observeThreads({
        projectId,
        threads: [
          thread({
            threadId: "thread-a",
            branch: "feature/a",
            state: "stopped",
          }),
        ],
      });
      reconcile(store, [pullRequest(prOne, "closed")]);

      expect(store.detail(issue.id)?.issue).toMatchObject({
        status: "needs_attention",
        pullRequests: [{ state: "closed", merged: false }],
      });
    } finally {
      store.close();
    }
  });

  test("completes from a fresh merged snapshot and lets a later merge override manual work", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "Merge lifecycle",
        pullRequestUrls: [prOne],
      });
      const merged = pullRequest(prOne, "closed", {
        mergedAt: "2026-10-16T11:00:00.000Z",
        updatedAt: "2026-10-16T11:01:00.000Z",
      });
      reconcile(store, [merged]);
      expect(store.detail(issue.id)?.issue.status).toBe("done");

      store.update({ id: issue.id, status: "todo" });
      reconcile(store, [merged]);
      expect(store.detail(issue.id)?.issue.status).toBe("todo");

      store.update({ id: issue.id, status: "in_progress" });
      reconcile(store, [
        pullRequest(prOne, "closed", {
          mergedAt: "2026-10-16T11:00:00.000Z",
          updatedAt: "2026-10-16T12:00:00.000Z",
        }),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("done");
    } finally {
      store.close();
    }
  });

  test("preserves status on outage and reconciles unrelated issues independently", () => {
    const store = makeStore();
    try {
      const first = store.create({
        projectId,
        title: "Unavailable PR",
        pullRequestUrls: [prOne],
      });
      const second = store.create({
        projectId,
        title: "Healthy PR",
        pullRequestUrls: [prTwo],
      });
      store.update({ id: first.id, status: "in_progress" });
      reconcile(store, [
        { url: prOne, ok: false },
        pullRequest(prTwo, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
      ]);
      expect(store.detail(first.id)?.issue.status).toBe("in_progress");
      expect(store.detail(second.id)?.issue.status).toBe("done");

      reconcile(store, [], false);
      expect(store.detail(first.id)?.issue.status).toBe("in_progress");
    } finally {
      store.close();
    }
  });

  test("reopens for a newly linked or reopened PR and preserves discovered links", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "Discovered PR",
        branches: ["feature/a"],
        pullRequestUrls: [prOne],
      });
      reconcile(store, [
        pullRequest(prOne, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("done");

      store.observeThreads({
        projectId,
        threads: [
          thread({
            threadId: "thread-a",
            branch: "feature/a",
            linkedPullRequestUrl: prTwo,
          }),
        ],
      });
      reconcile(store, [
        pullRequest(prOne, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
        pullRequest(prTwo, "open"),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");
      expect(store.detail(issue.id)?.issue.pullRequestUrls).toEqual([
        prOne,
        prTwo,
      ]);

      expect(() => store.update({ id: issue.id, status: "done" })).toThrow(
        "every Pull Request is confirmed closed or merged",
      );
      reconcile(store, [
        pullRequest(prOne, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
        pullRequest(prTwo, "closed"),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");
      reconcile(store, [
        pullRequest(prOne, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
        pullRequest(prTwo, "open", { updatedAt: "2026-10-16T13:00:00.000Z" }),
      ]);
      expect(store.detail(issue.id)?.issue.status).toBe("in_progress");

      store.observeThreads({
        projectId,
        threads: [thread({ threadId: "thread-a", branch: "renamed/branch" })],
      });
      reconcile(store, [
        pullRequest(prOne, "closed", { mergedAt: "2026-10-16T11:00:00.000Z" }),
        pullRequest(prTwo, "open", { updatedAt: "2026-10-16T13:00:00.000Z" }),
      ]);
      expect(store.detail(issue.id)?.threads).toContainEqual(
        expect.objectContaining({
          threadId: "thread-a",
          branch: "renamed/branch",
        }),
      );
      expect(store.detail(issue.id)?.issue.pullRequestUrls).toEqual([
        prOne,
        prTwo,
      ]);
    } finally {
      store.close();
    }
  });

  test("discovers fresh work only and groups recent threads by non-default branch", () => {
    const store = makeStore();
    try {
      expect(store.list({ projectId })).toEqual([]);
      const created = store.discoverThreads({
        freshSourceIds: ["source-a", "source-b"],
        notBefore: "2026-10-15T00:00:00.000Z",
        projectId,
        threads: [
          thread({
            threadId: "old-thread",
            branch: "feature/old",
            updatedAt: "2026-10-14T23:59:59.999Z",
          }),
          thread({
            threadId: "stale-source-thread",
            sourceId: "source-stale",
            branch: "feature/stale",
          }),
          thread({
            threadId: "archived-thread",
            sourceId: "source-a",
            branch: "feature/archived",
            current: false,
          }),
          thread({
            threadId: "thread-a",
            sourceId: "source-a",
            branch: "feature/shared",
            title: "Older shared thread",
            updatedAt: "2026-10-16T09:00:00.000Z",
          }),
          thread({
            threadId: "thread-b",
            sourceId: "source-b",
            branch: "feature/shared",
            linkedPullRequestUrl: prOne,
            title: "Most recent shared thread",
            updatedAt: "2026-10-16T11:00:00.000Z",
          }),
        ],
      });

      expect(created).toHaveLength(1);
      const issue = store.detail(created[0]!)!;
      expect(issue.issue).toMatchObject({
        branches: ["feature/shared"],
        pullRequestUrls: [prOne],
        title: "Most recent shared thread",
      });
      expect(
        issue.threads.map(({ sourceId, threadId }) => [sourceId, threadId]),
      ).toEqual([
        ["source-a", "thread-a"],
        ["source-b", "thread-b"],
      ]);
    } finally {
      store.close();
    }
  });

  test("reuses a manual issue with the same branch", () => {
    const store = makeStore();
    try {
      const manual = store.create({
        projectId,
        title: "Manually planned work",
        branches: ["feature/shared"],
      });

      expect(
        store.discoverThreads({
          freshSourceIds: ["source-a"],
          notBefore: "2026-10-15T00:00:00.000Z",
          projectId,
          threads: [thread({ threadId: "thread-a", branch: "feature/shared" })],
        }),
      ).toEqual([]);
      expect(store.detail(manual.id)?.threads).toEqual([
        expect.objectContaining({ threadId: "thread-a", sourceId: "source-a" }),
      ]);
      expect(store.list({ projectId })).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("reuses a done branch issue without reopening it for a new thread", () => {
    const store = makeStore();
    try {
      const done = store.create({
        projectId,
        title: "Completed branch work",
        branches: ["feature/shared"],
      });
      store.move({ id: done.id, status: "done" });
      const discoveredThread = thread({
        threadId: "new-thread",
        branch: "feature/shared",
        updatedAt: "2026-10-16T11:00:00.000Z",
      });

      expect(
        store.discoverThreads({
          freshSourceIds: ["source-a"],
          notBefore: "2026-10-15T00:00:00.000Z",
          projectId,
          threads: [discoveredThread],
        }),
      ).toEqual([]);
      store.observeThreads({
        freshSourceIds: ["source-a"],
        projectId,
        threads: [discoveredThread],
      });
      reconcile(store, [], true, ["source-a"]);

      expect(store.detail(done.id)?.issue.status).toBe("done");
      expect(store.detail(done.id)?.threads).toContainEqual(
        expect.objectContaining({ threadId: "new-thread" }),
      );
    } finally {
      store.close();
    }
  });

  test("creates separate default-branch and branchless issues with stable links", () => {
    const store = makeStore();
    try {
      const created = store.discoverThreads({
        freshSourceIds: ["source-a", "source-b"],
        notBefore: "2026-10-15T00:00:00.000Z",
        projectId,
        threads: [
          thread({
            threadId: "main-a",
            sourceId: "source-a",
            branch: "main",
            title: "Main A",
          }),
          thread({
            threadId: "main-b",
            sourceId: "source-b",
            branch: "main",
            title: "Main B",
          }),
          thread({
            threadId: "develop-a",
            branch: "develop",
            title: "Develop A",
          }),
          thread({
            threadId: "develop-b",
            branch: "develop",
            title: "Develop B",
          }),
          thread({ threadId: "trunk", branch: "trunk", title: "Trunk" }),
          thread({ threadId: "master", branch: "master", title: "Master" }),
          thread({
            threadId: "branchless",
            branch: undefined,
            title: "Branchless",
          }),
        ],
      });

      expect(created).toHaveLength(7);
      expect(new Set(created).size).toBe(7);
      for (const id of created) {
        expect(store.detail(id)?.issue.branches).toEqual([]);
        expect(store.detail(id)?.threads).toHaveLength(1);
      }
      const issuesByTitle = new Map(
        created.map((id) => [store.detail(id)?.issue.title, store.detail(id)]),
      );
      expect(issuesByTitle.get("Main A")?.threads[0]?.threadId).toBe("main-a");
      expect(issuesByTitle.get("Main B")?.threads[0]?.threadId).toBe("main-b");
    } finally {
      store.close();
    }
  });

  test("groups fresh default-branch children under their root and unions PR links", () => {
    const store = makeStore();
    try {
      const root = thread({
        threadId: "root-thread",
        rootThreadId: "root-thread",
        branch: "main",
        title: "Root work title",
        linkedPullRequestUrl: prOne,
        updatedAt: "2026-10-10T10:00:00.000Z",
      });
      const child = thread({
        threadId: "child-thread",
        parentThreadId: "root-thread",
        rootThreadId: "root-thread",
        branch: undefined,
        title: "Subagent work title",
        linkedPullRequestUrls: [prTwo],
        updatedAt: "2026-10-16T10:00:00.000Z",
      });
      const created = store.discoverThreads({
        freshSourceIds: ["source-a"],
        notBefore: "2026-10-15T00:00:00.000Z",
        projectId,
        threads: [root, child],
      });

      expect(created).toHaveLength(1);
      const issueId = created[0]!;
      const issue = store.detail(issueId)?.issue;
      expect(issue).toMatchObject({ branches: [], title: "Root work title" });
      expect([...issue!.pullRequestUrls].sort()).toEqual([prOne, prTwo].sort());
      expect(
        issue!.pullRequests.every(
          ({ state, merged }) => state === "unavailable" && !merged,
        ),
      ).toBe(true);
      expect(
        store.detail(issueId)?.threads.map(({ threadId }) => threadId),
      ).toEqual(["child-thread", "root-thread"]);

      const thirdPr = "https://github.com/acme/app/pull/3";
      expect(
        store.observeThreads({
          freshSourceIds: ["source-a"],
          projectId,
          threads: [
            root,
            { ...child, linkedPullRequestUrls: [prTwo, thirdPr] },
          ],
        }),
      ).toEqual([thirdPr]);
      expect([...store.detail(issueId)!.issue.pullRequestUrls].sort()).toEqual(
        [prOne, prTwo, thirdPr].sort(),
      );

      store.remove(issueId);
      expect(
        store.discoverThreads({
          freshSourceIds: ["source-a"],
          notBefore: "2026-10-15T00:00:00.000Z",
          projectId,
          threads: [
            {
              ...child,
              threadId: "another-child",
              title: "Later child",
              updatedAt: "2026-10-16T12:00:00.000Z",
            },
          ],
        }),
      ).toEqual([]);
      expect(store.list({ projectId })).toEqual([]);
    } finally {
      store.close();
    }
  });

  test("keeps discovery receipts across restarts and issue deletion", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-issues-discovery-"));
    directories.push(directory);
    const databasePath = join(directory, "factory.sqlite");
    let store = createIssueStore({ databasePath });
    const input = {
      freshSourceIds: ["source-a"],
      notBefore: "2026-10-15T00:00:00.000Z",
      projectId,
      threads: [thread({ threadId: "thread-a", branch: "feature/a" })],
    };
    try {
      const [issueId] = store.discoverThreads(input);
      expect(issueId).toBeDefined();
      store.close();
      store = createIssueStore({ databasePath });
      expect(store.discoverThreads(input)).toEqual([]);
      store.remove(issueId!);
      expect(store.discoverThreads(input)).toEqual([]);
      expect(store.list({ projectId })).toEqual([]);
    } finally {
      store.close();
    }
  });
});
