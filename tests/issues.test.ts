import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

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

  test("allows manual done for PR-backed issues only with merged evidence", () => {
    const store = makeStore();
    try {
      const issue = store.create({
        projectId,
        title: "PR-backed manual completion",
        pullRequestUrls: [prOne, prTwo],
      });

      expect(() => store.update({ id: issue.id, status: "done" })).toThrow(
        "every Pull Request is confirmed merged",
      );
      reconcile(store, [
        pullRequest(prOne, "open"),
        pullRequest(prTwo, "closed"),
      ]);
      expect(() => store.update({ id: issue.id, status: "done" })).toThrow(
        "every Pull Request is confirmed merged",
      );
      expect(() =>
        store.update({
          id: issue.id,
          pullRequestUrls: [prOne, prTwo, "https://github.com/acme/app/pull/3"],
          status: "done",
        }),
      ).toThrow("every Pull Request is confirmed merged");
      expect(store.detail(issue.id)?.issue.pullRequestUrls).toEqual([
        prOne,
        prTwo,
      ]);

      reconcile(store, [
        pullRequest(prOne, "closed", {
          mergedAt: "2026-10-16T11:00:00.000Z",
        }),
        pullRequest(prTwo, "closed", {
          mergedAt: "2026-10-16T11:05:00.000Z",
        }),
      ]);
      expect(store.update({ id: issue.id, status: "done" }).status).toBe(
        "done",
      );
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
        "every Pull Request is confirmed merged",
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
});
