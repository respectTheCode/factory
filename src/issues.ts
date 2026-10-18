import { createHash, randomUUID } from "node:crypto";

import { Database } from "bun:sqlite";

import { parseGitHubPullRequestUrl } from "./github";

export const ISSUE_STATUSES = [
  "todo",
  "in_progress",
  "needs_attention",
  "done",
  "wont_do",
] as const;

export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export type IssuePullRequest = {
  url: string;
  state: "open" | "merged" | "closed" | "unavailable";
  merged: boolean;
  updatedAt?: string;
  mergedAt?: string;
};

export type Issue = {
  id: string;
  simpleId: string;
  projectId: string;
  title: string;
  description: string;
  labels: string[];
  branches: string[];
  pullRequestUrls: string[];
  pullRequests: IssuePullRequest[];
  status: IssueStatus;
  createdAt: string;
  updatedAt: string;
};

export type IssueMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
};

export type IssueThread = {
  sourceId: string;
  threadId: string;
  title: string;
  branch?: string;
  repository?: string;
  state: "working" | "stopped";
  current: boolean;
  messages?: IssueMessage[];
  messageError?: string;
  canSend?: boolean;
};

export type IssueConnection = {
  sourceId: string;
  state: string;
  error?: string;
};

export type IssueDetail = {
  issue: Issue;
  threads: IssueThread[];
  connections: IssueConnection[];
};

export type IssueCreateInput = {
  projectId: string;
  title: string;
  description?: string;
  labels?: string[];
  branches?: string[];
  pullRequestUrls?: string[];
};

export type IssueUpdateInput = {
  id: string;
  title?: string;
  description?: string;
  labels?: string[];
  branches?: string[];
  pullRequestUrls?: string[];
  status?: IssueStatus;
};

export type IssueMoveInput = {
  id: string;
  status: IssueStatus;
  beforeId?: string;
};

export type IssueThreadObservation = {
  sourceId: string;
  threadId: string;
  title: string;
  branch?: string;
  linkedPullRequestUrl?: string;
  linkedPullRequestUrls?: string[];
  parentThreadId?: string;
  rootThreadId?: string;
  createdAt?: string;
  repository?: string;
  state: "working" | "stopped";
  current: boolean;
  updatedAt: string;
};

export type IssuePullRequestObservation = {
  url: string;
  ok: boolean;
  state?: "open" | "closed";
  mergedAt?: string;
  updatedAt?: string;
};

type IssueRow = {
  id: string;
  simpleId: string;
  projectId: string;
  title: string;
  description: string;
  labelsJson: string;
  branchesJson: string;
  pullRequestUrlsJson: string;
  status: IssueStatus;
  manualStatus: IssueStatus | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
};

type IssueThreadRow = {
  issueId: string;
  sourceId: string;
  threadId: string;
  title: string;
  branch: string | null;
  repository: string | null;
  state: "working" | "stopped";
  current: number;
  updatedAt: string;
  eventFingerprint: string | null;
};

type PullRequestRow = {
  issueId: string;
  url: string;
  state: "open" | "closed";
  merged: number;
  updatedAt: string;
  mergedAt: string | null;
  eventFingerprint: string;
};

export type IssueStore = {
  close(): void;
  list(input?: { projectId?: string }): Issue[];
  detail(id: string): IssueDetail | null;
  create(input: IssueCreateInput): Issue;
  update(input: IssueUpdateInput): Issue;
  move(input: IssueMoveInput): Issue;
  remove(id: string): { id: string };
  discoverThreads(input: {
    projectId: string;
    threads: IssueThreadObservation[];
    freshSourceIds: string[];
    notBefore: string;
  }): string[];
  observeThreads(input: {
    projectId: string;
    threads: IssueThreadObservation[];
    freshSourceIds?: string[];
  }): string[];
  reconcileProject(input: {
    projectId: string;
    pullRequests: IssuePullRequestObservation[];
    pullRequestPassComplete: boolean;
    freshSourceIds?: string[];
  }): void;
};

const ISSUE_COLUMNS = `id, simple_id AS simpleId, project_id AS projectId,
  title, description, labels_json AS labelsJson, branches_json AS branchesJson,
  pull_request_urls_json AS pullRequestUrlsJson, status,
  manual_status AS manualStatus,
  order_index AS orderIndex, created_at AS createdAt, updated_at AS updatedAt`;

function cleanList(values: string[] | undefined): string[] {
  if (!values) return [];
  const unique = new Set<string>();
  for (const value of values) {
    const cleaned = value.trim();
    if (cleaned) unique.add(cleaned);
  }
  return [...unique];
}

function cleanPullRequestUrls(values: string[] | undefined): string[] {
  return cleanList(values).map((value) => parseGitHubPullRequestUrl(value).url);
}

function threadPullRequestUrls(thread: IssueThreadObservation): string[] {
  return cleanPullRequestUrls([
    ...(thread.linkedPullRequestUrl ? [thread.linkedPullRequestUrl] : []),
    ...(thread.linkedPullRequestUrls ?? []),
  ]);
}

function isDefaultOrEmptyBranch(branch: string | null): boolean {
  return (
    branch === null ||
    ["main", "master", "develop", "trunk"].includes(branch.toLowerCase())
  );
}

function parseJsonList(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string")
  ) {
    throw new Error("Factory issue data is invalid.");
  }
  return parsed;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readIssueRow(database: Database, id: string): IssueRow | null {
  return database
    .query(`SELECT ${ISSUE_COLUMNS} FROM factory_issues WHERE id = $id`)
    .get({ $id: id }) as IssueRow | null;
}

function readIssueRows(database: Database, projectId?: string): IssueRow[] {
  const rows =
    projectId === undefined
      ? database
          .query(
            `SELECT ${ISSUE_COLUMNS} FROM factory_issues
              ORDER BY CASE status
                WHEN 'todo' THEN 0
                WHEN 'in_progress' THEN 1
                WHEN 'needs_attention' THEN 2
                WHEN 'done' THEN 3
                ELSE 4 END,
                order_index, created_at, simple_id`,
          )
          .all()
      : database
          .query(
            `SELECT ${ISSUE_COLUMNS} FROM factory_issues WHERE project_id = $projectId
              ORDER BY CASE status
                WHEN 'todo' THEN 0
                WHEN 'in_progress' THEN 1
                WHEN 'needs_attention' THEN 2
                WHEN 'done' THEN 3
                ELSE 4 END,
                order_index, created_at, simple_id`,
          )
          .all({ $projectId: projectId });
  return rows as IssueRow[];
}

function readIssueIdsForStatus(
  database: Database,
  status: IssueStatus,
  excludedId?: string,
): string[] {
  const rows = database
    .query(
      `SELECT id FROM factory_issues
        WHERE status = $status AND ($excludedId IS NULL OR id <> $excludedId)
        ORDER BY order_index, created_at, simple_id`,
    )
    .all({ $excludedId: excludedId ?? null, $status: status }) as Array<{
    id: string;
  }>;
  return rows.map(({ id }) => id);
}

function writeStatusOrder(
  database: Database,
  status: IssueStatus,
  issueIds: string[],
): void {
  const update = database.query(
    "UPDATE factory_issues SET order_index = $orderIndex WHERE id = $id AND status = $status",
  );
  issueIds.forEach((id, orderIndex) => {
    update.run({ $id: id, $orderIndex: orderIndex, $status: status });
  });
}

function appendToStatusOrder(
  database: Database,
  issueId: string,
  oldStatus: IssueStatus,
  nextStatus: IssueStatus,
): void {
  if (oldStatus === nextStatus) return;
  writeStatusOrder(
    database,
    oldStatus,
    readIssueIdsForStatus(database, oldStatus, issueId),
  );
  const nextIds = readIssueIdsForStatus(database, nextStatus, issueId);
  nextIds.push(issueId);
  writeStatusOrder(database, nextStatus, nextIds);
}

function assertDoneStatusAllowed(
  database: Database,
  issueId: string,
  pullRequestUrls: string[],
): void {
  if (pullRequestUrls.length === 0) return;
  const mergedRows = database
    .query(
      `SELECT url, merged FROM factory_issue_pull_requests
        WHERE issue_id = $issueId AND url IN (${pullRequestUrls
          .map((_, index) => `$url${index}`)
          .join(", ")})`,
    )
    .all(
      Object.fromEntries([
        ["$issueId", issueId],
        ...pullRequestUrls.map((url, index) => [`$url${index}`, url]),
      ]),
    ) as Array<{ url: string; merged: number }>;
  if (
    mergedRows.length !== pullRequestUrls.length ||
    mergedRows.some((pullRequest) => pullRequest.merged !== 1)
  ) {
    throw new Error(
      "An issue with linked Pull Requests can be marked done only after every Pull Request is confirmed merged.",
    );
  }
}

function mapIssue(database: Database, row: IssueRow): Issue {
  const prRows = database
    .query(
      `SELECT url, state, merged, updated_at AS updatedAt, merged_at AS mergedAt
         FROM factory_issue_pull_requests WHERE issue_id = $id ORDER BY url`,
    )
    .all({ $id: row.id }) as Array<{
    url: string;
    state: "open" | "closed";
    merged: number;
    updatedAt: string;
    mergedAt: string | null;
  }>;
  const snapshots = new Map(prRows.map((item) => [item.url, item]));
  const pullRequestUrls = parseJsonList(row.pullRequestUrlsJson);
  return {
    branches: parseJsonList(row.branchesJson),
    createdAt: row.createdAt,
    description: row.description,
    id: row.id,
    labels: parseJsonList(row.labelsJson),
    projectId: row.projectId,
    pullRequestUrls,
    pullRequests: pullRequestUrls.map((url) => {
      const snapshot = snapshots.get(url);
      return snapshot
        ? {
            merged: snapshot.merged === 1,
            ...(snapshot.mergedAt === null
              ? {}
              : { mergedAt: snapshot.mergedAt }),
            state: snapshot.merged === 1 ? "merged" : snapshot.state,
            updatedAt: snapshot.updatedAt,
            url,
          }
        : { merged: false, state: "unavailable", url };
    }),
    simpleId: row.simpleId,
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt,
  };
}

function readThreadRows(database: Database, issueId: string): IssueThreadRow[] {
  return database
    .query(
      `SELECT issue_id AS issueId, source_id AS sourceId, thread_id AS threadId,
              title, branch, repository, state, current, updated_at AS updatedAt,
              event_fingerprint AS eventFingerprint
         FROM factory_issue_threads WHERE issue_id = $issueId
        ORDER BY source_id, updated_at DESC, thread_id`,
    )
    .all({ $issueId: issueId }) as IssueThreadRow[];
}

function statusFromObservations(
  currentStatus: IssueStatus,
  pullRequestUrls: string[],
  pullRequests: PullRequestRow[],
  threads: IssueThreadRow[],
): IssueStatus {
  if (
    pullRequestUrls.length > 0 &&
    pullRequests.length === pullRequestUrls.length &&
    pullRequests.every((pullRequest) => pullRequest.merged === 1)
  ) {
    return "done";
  }
  if (
    threads.some((thread) => thread.state === "working" && thread.current === 1)
  ) {
    return "in_progress";
  }
  if (
    threads.some((thread) => thread.state === "working" && thread.current === 0)
  ) {
    return currentStatus;
  }
  if (
    threads.some((thread) => thread.state === "stopped" && thread.current === 1)
  ) {
    return "needs_attention";
  }
  return currentStatus;
}

function statusAfterPullRequestEvent(
  currentStatus: IssueStatus,
  pullRequestUrls: string[],
  pullRequests: PullRequestRow[],
  threads: IssueThreadRow[],
): IssueStatus {
  const derived = statusFromObservations(
    currentStatus,
    pullRequestUrls,
    pullRequests,
    threads,
  );
  if (
    derived !== currentStatus ||
    threads.some((thread) => thread.state === "working") ||
    threads.some((thread) => thread.state === "stopped")
  ) {
    return derived;
  }
  return "in_progress";
}

function withTransaction<T>(database: Database, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function migrateIssueStatusConstraints(database: Database): void {
  const schema = database
    .query(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'factory_issues'",
    )
    .get() as { sql: string | null } | null;
  if (!schema?.sql) throw new Error("Factory issue schema is unavailable.");
  if ((schema.sql.match(/'wont_do'/g) ?? []).length >= 2) return;

  const replacementTable = "factory_issues_status_migration";
  const replacementExists = database
    .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name")
    .get({ $name: replacementTable });
  if (replacementExists) {
    throw new Error("Factory issue status migration is already in progress.");
  }

  // SQLite has no ALTER CHECK constraint operation. Keep child-table FK text
  // pointed at factory_issues while rebuilding its rows, then validate every
  // relationship before re-enabling enforcement.
  database.exec("PRAGMA foreign_keys = OFF");
  try {
    withTransaction(database, () => {
      database.exec(`
        CREATE TABLE ${replacementTable} (
          id TEXT PRIMARY KEY,
          simple_id TEXT NOT NULL UNIQUE,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          labels_json TEXT NOT NULL,
          branches_json TEXT NOT NULL,
          pull_request_urls_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'needs_attention', 'done', 'wont_do')),
          manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('todo', 'in_progress', 'needs_attention', 'done', 'wont_do')),
          order_index INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO ${replacementTable}
          (id, simple_id, project_id, title, description, labels_json,
           branches_json, pull_request_urls_json, status, manual_status,
           order_index, created_at, updated_at)
        SELECT id, simple_id, project_id, title, description, labels_json,
               branches_json, pull_request_urls_json, status, manual_status,
               order_index, created_at, updated_at
          FROM factory_issues;
        DROP TABLE factory_issues;
        ALTER TABLE ${replacementTable} RENAME TO factory_issues;
        CREATE INDEX factory_issues_project_idx
          ON factory_issues(project_id, created_at, simple_id);
        CREATE INDEX factory_issues_status_order_idx
          ON factory_issues(status, order_index, created_at, simple_id);
      `);

      const foreignKeyErrors = database.query("PRAGMA foreign_key_check").all();
      if (foreignKeyErrors.length) {
        throw new Error("Factory issue migration found broken references.");
      }
    });
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}

export function createIssueStore({
  clock = () => new Date(),
  databasePath,
}: {
  clock?: () => Date;
  databasePath: string;
}): IssueStore {
  const database = new Database(databasePath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec(`
    CREATE TABLE IF NOT EXISTS factory_issues (
      id TEXT PRIMARY KEY,
      simple_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      labels_json TEXT NOT NULL,
      branches_json TEXT NOT NULL,
      pull_request_urls_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'needs_attention', 'done', 'wont_do')),
      manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('todo', 'in_progress', 'needs_attention', 'done', 'wont_do')),
      order_index INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS factory_issues_project_idx
      ON factory_issues(project_id, created_at, simple_id);
    CREATE TABLE IF NOT EXISTS factory_issue_counter (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_number INTEGER NOT NULL CHECK (next_number > 0)
    );
    INSERT OR IGNORE INTO factory_issue_counter (id, next_number) VALUES (1, 1);
    CREATE TABLE IF NOT EXISTS factory_issue_threads (
      issue_id TEXT NOT NULL REFERENCES factory_issues(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      title TEXT NOT NULL,
      branch TEXT,
      repository TEXT,
      state TEXT NOT NULL CHECK (state IN ('working', 'stopped')),
      current INTEGER NOT NULL CHECK (current IN (0, 1)),
      updated_at TEXT NOT NULL,
      event_fingerprint TEXT,
      PRIMARY KEY (issue_id, source_id, thread_id)
    );
    CREATE TABLE IF NOT EXISTS factory_issue_discovery_receipts (
      project_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      issue_id TEXT NOT NULL,
      branch TEXT,
      discovered_at TEXT NOT NULL,
      PRIMARY KEY (project_id, source_id, thread_id)
    );
    CREATE INDEX IF NOT EXISTS factory_issue_threads_lookup_idx
      ON factory_issue_threads(source_id, thread_id);
    CREATE TABLE IF NOT EXISTS factory_issue_pull_requests (
      issue_id TEXT NOT NULL REFERENCES factory_issues(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
      merged INTEGER NOT NULL CHECK (merged IN (0, 1)),
      updated_at TEXT NOT NULL,
      merged_at TEXT,
      event_fingerprint TEXT NOT NULL,
      PRIMARY KEY (issue_id, url)
    );
  `);

  const issueColumns = database
    .query("PRAGMA table_info(factory_issues)")
    .all() as Array<{ name: string }>;
  if (!issueColumns.some(({ name }) => name === "order_index")) {
    withTransaction(database, () => {
      database.exec(
        "ALTER TABLE factory_issues ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0",
      );
      const existing = database
        .query(
          "SELECT id, status FROM factory_issues ORDER BY created_at, simple_id",
        )
        .all() as Array<{ id: string; status: IssueStatus }>;
      const nextOrderByStatus = new Map<IssueStatus, number>();
      for (const issue of existing) {
        const orderIndex = nextOrderByStatus.get(issue.status) ?? 0;
        database
          .query(
            "UPDATE factory_issues SET order_index = $orderIndex WHERE id = $id",
          )
          .run({ $id: issue.id, $orderIndex: orderIndex });
        nextOrderByStatus.set(issue.status, orderIndex + 1);
      }
    });
  }
  migrateIssueStatusConstraints(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS factory_issues_status_order_idx
      ON factory_issues(status, order_index, created_at, simple_id);
  `);

  const get = (id: string): Issue => {
    const row = readIssueRow(database, id);
    if (!row) throw new Error(`Issue ${id} does not exist.`);
    return mapIssue(database, row);
  };

  const createInTransaction = (input: IssueCreateInput): string => {
    const projectId = input.projectId.trim();
    const title = input.title.trim();
    if (!projectId) throw new Error("An issue requires a project.");
    if (!title) throw new Error("An issue title is required.");
    const createdAt = clock().toISOString();
    const id = randomUUID();
    const counter = database
      .query(
        "SELECT next_number AS nextNumber FROM factory_issue_counter WHERE id = 1",
      )
      .get() as { nextNumber: number } | null;
    if (!counter) throw new Error("Factory issue counter is unavailable.");
    const number = counter.nextNumber;
    const orderRow = database
      .query(
        "SELECT COALESCE(MAX(order_index), -1) + 1 AS orderIndex FROM factory_issues WHERE status = 'todo'",
      )
      .get() as { orderIndex: number };
    database
      .query(
        "UPDATE factory_issue_counter SET next_number = $nextNumber WHERE id = 1",
      )
      .run({ $nextNumber: number + 1 });
    database
      .query(
        `INSERT INTO factory_issues
          (id, simple_id, project_id, title, description, labels_json,
           branches_json, pull_request_urls_json, status, order_index,
           created_at, updated_at)
         VALUES ($id, $simpleId, $projectId, $title, $description, $labels,
           $branches, $pullRequests, 'todo', $orderIndex, $createdAt, $updatedAt)`,
      )
      .run({
        $branches: JSON.stringify(cleanList(input.branches)),
        $createdAt: createdAt,
        $description: input.description?.trim() ?? "",
        $id: id,
        $labels: JSON.stringify(cleanList(input.labels)),
        $projectId: projectId,
        $pullRequests: JSON.stringify(
          cleanPullRequestUrls(input.pullRequestUrls),
        ),
        $orderIndex: orderRow.orderIndex,
        $simpleId: `F-${number}`,
        $title: title,
        $updatedAt: createdAt,
      });
    return id;
  };

  return {
    close() {
      database.close();
    },

    list({ projectId } = {}) {
      return readIssueRows(database, projectId).map((row) =>
        mapIssue(database, row),
      );
    },

    detail(id) {
      const row = readIssueRow(database, id);
      if (!row) return null;
      const threads = readThreadRows(database, id).map((thread) => ({
        branch: thread.branch ?? undefined,
        current: thread.current === 1,
        repository: thread.repository ?? undefined,
        sourceId: thread.sourceId,
        state: thread.state,
        threadId: thread.threadId,
        title: thread.title,
      }));
      return { connections: [], issue: mapIssue(database, row), threads };
    },

    create(input) {
      const id = withTransaction(database, () => createInTransaction(input));
      return get(id);
    },

    update(input) {
      const row = readIssueRow(database, input.id);
      if (!row) throw new Error(`Issue ${input.id} does not exist.`);
      const title = input.title?.trim();
      if (input.title !== undefined && !title)
        throw new Error("An issue title is required.");
      const previousUrls = parseJsonList(row.pullRequestUrlsJson);
      const nextUrls =
        input.pullRequestUrls === undefined
          ? previousUrls
          : cleanPullRequestUrls(input.pullRequestUrls);
      if (input.status === "done") {
        assertDoneStatusAllowed(database, input.id, nextUrls);
      }
      const removedUrls = previousUrls.filter((url) => !nextUrls.includes(url));
      const addedUrls = nextUrls.filter((url) => !previousUrls.includes(url));
      const now = clock().toISOString();
      const nextStatus =
        input.status ??
        (row.status === "done" && addedUrls.length
          ? "in_progress"
          : row.status);
      withTransaction(database, () => {
        database
          .query(
            `UPDATE factory_issues SET
               title = $title, description = $description, labels_json = $labels,
               branches_json = $branches, pull_request_urls_json = $pullRequests,
               status = $status, manual_status = $manualStatus,
               updated_at = $updatedAt WHERE id = $id`,
          )
          .run({
            $branches: JSON.stringify(
              input.branches === undefined
                ? parseJsonList(row.branchesJson)
                : cleanList(input.branches),
            ),
            $description:
              input.description === undefined
                ? row.description
                : input.description.trim(),
            $id: input.id,
            $labels: JSON.stringify(
              input.labels === undefined
                ? parseJsonList(row.labelsJson)
                : cleanList(input.labels),
            ),
            $manualStatus:
              input.status ??
              (addedUrls.length && row.status === "done"
                ? null
                : row.manualStatus),
            $pullRequests: JSON.stringify(nextUrls),
            $status: nextStatus,
            $title: title ?? row.title,
            $updatedAt: now,
          });
        if (nextStatus !== row.status) {
          appendToStatusOrder(database, input.id, row.status, nextStatus);
        }
        for (const url of removedUrls) {
          database
            .query(
              "DELETE FROM factory_issue_pull_requests WHERE issue_id = $id AND url = $url",
            )
            .run({ $id: input.id, $url: url });
        }
        if (input.status !== undefined) {
          for (const thread of readThreadRows(database, input.id)) {
            const fingerprint = digest({
              branch: thread.branch,
              current: thread.current,
              state: thread.state,
              title: thread.title,
              updatedAt: thread.updatedAt,
            });
            database
              .query(
                `UPDATE factory_issue_threads SET event_fingerprint = $fingerprint
                  WHERE issue_id = $issueId AND source_id = $sourceId AND thread_id = $threadId`,
              )
              .run({
                $fingerprint: fingerprint,
                $issueId: input.id,
                $sourceId: thread.sourceId,
                $threadId: thread.threadId,
              });
          }
        }
      });
      return get(input.id);
    },

    move(input) {
      const now = clock().toISOString();
      withTransaction(database, () => {
        const row = readIssueRow(database, input.id);
        if (!row) throw new Error(`Issue ${input.id} does not exist.`);

        if (input.beforeId !== undefined) {
          const anchor = readIssueRow(database, input.beforeId);
          if (!anchor)
            throw new Error(`Issue ${input.beforeId} does not exist.`);
          if (anchor.status !== input.status) {
            throw new Error(
              "An issue can only be placed before an issue in the destination status.",
            );
          }
          if (input.beforeId === input.id) return;
        }

        const changesStatus = row.status !== input.status;
        const pullRequestUrls = parseJsonList(row.pullRequestUrlsJson);
        if (changesStatus && input.status === "done") {
          assertDoneStatusAllowed(database, input.id, pullRequestUrls);
        }

        const targetIds = readIssueIdsForStatus(
          database,
          input.status,
          input.id,
        );
        let insertionIndex = targetIds.length;
        if (input.beforeId !== undefined) {
          insertionIndex = targetIds.indexOf(input.beforeId);
          if (insertionIndex < 0) {
            throw new Error(
              "The destination issue could not be found in the requested status.",
            );
          }
        }
        targetIds.splice(insertionIndex, 0, input.id);

        if (changesStatus) {
          database
            .query(
              `UPDATE factory_issues SET status = $status,
                  manual_status = $manualStatus, updated_at = $updatedAt
                WHERE id = $id`,
            )
            .run({
              $id: input.id,
              $manualStatus: input.status,
              $status: input.status,
              $updatedAt: now,
            });
          writeStatusOrder(
            database,
            row.status,
            readIssueIdsForStatus(database, row.status),
          );
          for (const thread of readThreadRows(database, input.id)) {
            const fingerprint = digest({
              branch: thread.branch,
              current: thread.current,
              state: thread.state,
              title: thread.title,
              updatedAt: thread.updatedAt,
            });
            database
              .query(
                `UPDATE factory_issue_threads SET event_fingerprint = $fingerprint
                  WHERE issue_id = $issueId AND source_id = $sourceId AND thread_id = $threadId`,
              )
              .run({
                $fingerprint: fingerprint,
                $issueId: input.id,
                $sourceId: thread.sourceId,
                $threadId: thread.threadId,
              });
          }
        }
        writeStatusOrder(database, input.status, targetIds);
      });
      return get(input.id);
    },

    remove(id) {
      withTransaction(database, () => {
        const row = readIssueRow(database, id);
        if (!row) throw new Error(`Issue ${id} does not exist.`);
        database.query("DELETE FROM factory_issues WHERE id = $id").run({
          $id: id,
        });
        writeStatusOrder(
          database,
          row.status,
          readIssueIdsForStatus(database, row.status),
        );
      });
      return { id };
    },

    discoverThreads({ projectId, threads, freshSourceIds, notBefore }) {
      const normalizedProjectId = projectId.trim();
      if (!normalizedProjectId)
        throw new Error("Thread discovery requires a project.");
      const cutoff = Date.parse(notBefore);
      if (!Number.isFinite(cutoff)) {
        throw new Error("Thread discovery requires a valid ISO cutoff.");
      }
      const freshSources = new Set(cleanList(freshSourceIds));
      const currentFreshThreads = threads
        .filter((thread) => {
          const updatedAt = Date.parse(thread.updatedAt);
          return (
            freshSources.has(thread.sourceId) &&
            thread.current &&
            thread.sourceId.trim().length > 0 &&
            thread.threadId.trim().length > 0 &&
            thread.title.trim().length > 0 &&
            Number.isFinite(updatedAt)
          );
        })
        .sort((left, right) => {
          const byRecency =
            Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
          if (byRecency !== 0) return byRecency;
          if (left.sourceId !== right.sourceId) {
            return left.sourceId < right.sourceId ? -1 : 1;
          }
          if (left.threadId !== right.threadId) {
            return left.threadId < right.threadId ? -1 : 1;
          }
          return 0;
        });
      const latestByThread = new Map<string, IssueThreadObservation>();
      for (const thread of currentFreshThreads) {
        const identity = JSON.stringify([thread.sourceId, thread.threadId]);
        if (!latestByThread.has(identity)) latestByThread.set(identity, thread);
      }
      const recentThreads = [...latestByThread.values()].filter(
        (thread) => Date.parse(thread.updatedAt) >= cutoff,
      );
      if (recentThreads.length === 0) return [];

      const rootIdForThread = (thread: IssueThreadObservation): string =>
        thread.rootThreadId?.trim() ||
        thread.parentThreadId?.trim() ||
        thread.threadId;
      const isRootGroupedThread = (thread: IssueThreadObservation): boolean =>
        isDefaultOrEmptyBranch(thread.branch?.trim() || null);
      const rootGroupKey = (thread: IssueThreadObservation): string =>
        JSON.stringify([thread.sourceId, rootIdForThread(thread)]);
      const recentRootGroups = new Set(
        recentThreads
          .filter(isRootGroupedThread)
          .map((thread) => rootGroupKey(thread)),
      );
      const rootThreads = new Map<string, IssueThreadObservation>();
      for (const thread of currentFreshThreads) {
        if (
          thread.threadId !== rootIdForThread(thread) ||
          !recentRootGroups.has(rootGroupKey(thread))
        ) {
          continue;
        }
        const groupKey = rootGroupKey(thread);
        if (!rootThreads.has(groupKey)) rootThreads.set(groupKey, thread);
      }
      const titleByRootGroup = new Map<string, string>();
      for (const thread of recentThreads) {
        if (!isRootGroupedThread(thread)) continue;
        const groupKey = rootGroupKey(thread);
        if (rootThreads.has(groupKey)) continue;
        if (!titleByRootGroup.has(groupKey)) {
          titleByRootGroup.set(groupKey, thread.title.trim());
        }
      }
      for (const [groupKey, root] of rootThreads) {
        titleByRootGroup.set(groupKey, root.title.trim());
      }

      const candidatesByIdentity = new Map<string, IssueThreadObservation>();
      for (const thread of recentThreads) {
        candidatesByIdentity.set(
          JSON.stringify([thread.sourceId, thread.threadId]),
          thread,
        );
      }
      for (const root of rootThreads.values()) {
        candidatesByIdentity.set(
          JSON.stringify([root.sourceId, root.threadId]),
          root,
        );
      }
      const candidates = [...candidatesByIdentity.values()];

      return withTransaction(database, () => {
        const createdIds: string[] = [];
        const issueByRootGroup = new Map<string, string | null>();
        const issues = readIssueRows(database, normalizedProjectId);
        const issueByBranch = new Map<string, string>();
        for (const issue of issues) {
          for (const branch of parseJsonList(issue.branchesJson)) {
            if (!issueByBranch.has(branch)) issueByBranch.set(branch, issue.id);
          }
        }

        const readReceipt = (
          sourceId: string,
          threadId: string,
        ): { issueId: string } | null =>
          database
            .query(
              `SELECT issue_id AS issueId FROM factory_issue_discovery_receipts
                WHERE project_id = $projectId AND source_id = $sourceId
                  AND thread_id = $threadId`,
            )
            .get({
              $projectId: normalizedProjectId,
              $sourceId: sourceId,
              $threadId: threadId,
            }) as { issueId: string } | null;

        const readStableLink = (
          sourceId: string,
          threadId: string,
        ): { issueId: string } | null =>
          database
            .query(
              `SELECT threads.issue_id AS issueId
                 FROM factory_issue_threads AS threads
                 JOIN factory_issues AS issues ON issues.id = threads.issue_id
                WHERE issues.project_id = $projectId
                  AND threads.source_id = $sourceId
                  AND threads.thread_id = $threadId
                ORDER BY threads.issue_id LIMIT 1`,
            )
            .get({
              $projectId: normalizedProjectId,
              $sourceId: sourceId,
              $threadId: threadId,
            }) as { issueId: string } | null;

        const attachPullRequestUrls = (
          issueId: string,
          urls: string[],
          updatedAt: string,
        ) => {
          if (urls.length === 0) return;
          const issue = readIssueRow(database, issueId);
          if (!issue) return;
          const existing = parseJsonList(issue.pullRequestUrlsJson);
          const next = [...existing];
          for (const url of urls) {
            if (!next.includes(url)) next.push(url);
          }
          if (next.length === existing.length) return;
          database
            .query(
              `UPDATE factory_issues SET pull_request_urls_json = $urls,
                 updated_at = $updatedAt WHERE id = $id`,
            )
            .run({
              $id: issueId,
              $updatedAt: updatedAt,
              $urls: JSON.stringify(next),
            });
        };

        const recordReceipt = (
          sourceId: string,
          threadId: string,
          issueId: string,
          branch: string | null,
          discoveredAt: string,
        ) => {
          database
            .query(
              `INSERT OR IGNORE INTO factory_issue_discovery_receipts
                 (project_id, source_id, thread_id, issue_id, branch, discovered_at)
               VALUES ($projectId, $sourceId, $threadId, $issueId, $branch, $discoveredAt)`,
            )
            .run({
              $branch: branch,
              $discoveredAt: discoveredAt,
              $issueId: issueId,
              $projectId: normalizedProjectId,
              $sourceId: sourceId,
              $threadId: threadId,
            });
        };

        for (const thread of candidates) {
          const branch = thread.branch?.trim() || null;
          const rootGrouped = isRootGroupedThread(thread);
          const rootGroup = rootGrouped ? rootGroupKey(thread) : undefined;
          const rootId = rootGrouped ? rootIdForThread(thread) : undefined;
          const receipt = readReceipt(thread.sourceId, thread.threadId);
          const rootReceipt =
            rootGrouped && rootId ? readReceipt(thread.sourceId, rootId) : null;
          let issueId: string | null | undefined;
          let newlyCreated = false;
          if (rootGrouped && rootGroup && issueByRootGroup.has(rootGroup)) {
            issueId = issueByRootGroup.get(rootGroup);
          } else if (rootGrouped) {
            const groupKey = rootGroup!;
            const rememberedReceipt = rootReceipt ?? receipt;
            if (rememberedReceipt) {
              issueId = readIssueRow(database, rememberedReceipt.issueId)
                ? rememberedReceipt.issueId
                : null;
            } else {
              const stableLink =
                (rootId ? readStableLink(thread.sourceId, rootId) : null) ??
                readStableLink(thread.sourceId, thread.threadId);
              issueId = stableLink?.issueId;
            }
            if (issueId === undefined) {
              const title =
                titleByRootGroup.get(groupKey) ?? thread.title.trim();
              issueId = createInTransaction({
                projectId: normalizedProjectId,
                title,
                branches: [],
              });
              newlyCreated = true;
            }
            issueByRootGroup.set(groupKey, issueId);
          } else {
            if (receipt) continue;
            issueId = readStableLink(thread.sourceId, thread.threadId)?.issueId;
            if (!issueId && branch) issueId = issueByBranch.get(branch);
            if (!issueId) {
              issueId = createInTransaction({
                projectId: normalizedProjectId,
                title: thread.title,
                branches: branch ? [branch] : [],
              });
              newlyCreated = true;
            }
            if (branch && !issueByBranch.has(branch)) {
              issueByBranch.set(branch, issueId);
            }
          }
          if (!issueId) continue;
          if (newlyCreated) createdIds.push(issueId);

          const now = clock().toISOString();
          database
            .query(
              `INSERT INTO factory_issue_threads
                 (issue_id, source_id, thread_id, title, branch, repository,
                  state, current, updated_at)
               VALUES ($issueId, $sourceId, $threadId, $title, $branch,
                  $repository, $state, 1, $updatedAt)
               ON CONFLICT(issue_id, source_id, thread_id) DO UPDATE SET
                  title = excluded.title, branch = excluded.branch,
                  repository = excluded.repository, state = excluded.state,
                  current = excluded.current, updated_at = excluded.updated_at`,
            )
            .run({
              $branch: branch,
              $issueId: issueId,
              $repository: thread.repository?.trim() || null,
              $sourceId: thread.sourceId,
              $state: thread.state,
              $threadId: thread.threadId,
              $title: thread.title.trim(),
              $updatedAt: thread.updatedAt,
            });

          attachPullRequestUrls(issueId, threadPullRequestUrls(thread), now);
          recordReceipt(thread.sourceId, thread.threadId, issueId, branch, now);
          if (rootGrouped && rootId && rootGroup) {
            recordReceipt(thread.sourceId, rootId, issueId, null, now);
            const root = rootThreads.get(rootGroup);
            if (root && root.threadId !== thread.threadId) {
              const rootBranch = root.branch?.trim() || null;
              database
                .query(
                  `INSERT INTO factory_issue_threads
                     (issue_id, source_id, thread_id, title, branch, repository,
                      state, current, updated_at)
                   VALUES ($issueId, $sourceId, $threadId, $title, $branch,
                      $repository, $state, 1, $updatedAt)
                   ON CONFLICT(issue_id, source_id, thread_id) DO UPDATE SET
                      title = excluded.title, branch = excluded.branch,
                      repository = excluded.repository, state = excluded.state,
                      current = excluded.current, updated_at = excluded.updated_at`,
                )
                .run({
                  $branch: rootBranch,
                  $issueId: issueId,
                  $repository: root.repository?.trim() || null,
                  $sourceId: root.sourceId,
                  $state: root.state,
                  $threadId: root.threadId,
                  $title: root.title.trim(),
                  $updatedAt: root.updatedAt,
                });
              attachPullRequestUrls(issueId, threadPullRequestUrls(root), now);
              recordReceipt(
                root.sourceId,
                root.threadId,
                issueId,
                rootBranch,
                now,
              );
            }
          }
        }
        return createdIds;
      });
    },

    observeThreads({ projectId, threads, freshSourceIds }) {
      const issues = readIssueRows(database, projectId);
      if (issues.length === 0) return [];
      const issueBranches = new Map(
        issues.map((issue) => [
          issue.id,
          new Set(parseJsonList(issue.branchesJson)),
        ]),
      );
      const newlyLinkedPullRequestUrls = new Set<string>();
      const now = clock().toISOString();
      withTransaction(database, () => {
        database
          .query(
            `UPDATE factory_issue_threads SET current = 0
              WHERE issue_id IN (SELECT id FROM factory_issues WHERE project_id = $projectId)`,
          )
          .run({ $projectId: projectId });
        if (freshSourceIds !== undefined) {
          const freshSources = new Set(freshSourceIds);
          for (const issue of issues) {
            for (const previous of readThreadRows(database, issue.id)) {
              if (freshSources.has(previous.sourceId)) continue;
              const fingerprint = digest({
                branch: previous.branch,
                current: 0,
                state: previous.state,
                title: previous.title,
                updatedAt: previous.updatedAt,
              });
              database
                .query(
                  `UPDATE factory_issue_threads SET event_fingerprint = $fingerprint
                    WHERE issue_id = $issueId AND source_id = $sourceId AND thread_id = $threadId`,
                )
                .run({
                  $fingerprint: fingerprint,
                  $issueId: issue.id,
                  $sourceId: previous.sourceId,
                  $threadId: previous.threadId,
                });
            }
          }
        }
        for (const thread of threads) {
          const stableLinks = database
            .query(
              `SELECT issue_id AS issueId FROM factory_issue_threads
                WHERE source_id = $sourceId AND thread_id = $threadId
                  AND issue_id IN (SELECT id FROM factory_issues WHERE project_id = $projectId)`,
            )
            .all({
              $projectId: projectId,
              $sourceId: thread.sourceId,
              $threadId: thread.threadId,
            }) as Array<{ issueId: string }>;
          const matchedByBranch = thread.branch
            ? issues.filter((issue) =>
                issueBranches.get(issue.id)?.has(thread.branch!),
              )
            : [];
          const issueIds = new Set([
            ...stableLinks.map((link) => link.issueId),
            ...matchedByBranch.map((issue) => issue.id),
          ]);
          const linkedUrls = threadPullRequestUrls(thread);
          for (const issueId of issueIds) {
            database
              .query(
                `INSERT INTO factory_issue_threads
                   (issue_id, source_id, thread_id, title, branch, repository,
                    state, current, updated_at)
                 VALUES ($issueId, $sourceId, $threadId, $title, $branch,
                    $repository, $state, $current, $updatedAt)
                 ON CONFLICT(issue_id, source_id, thread_id) DO UPDATE SET
                    title = excluded.title, branch = excluded.branch,
                    repository = excluded.repository, state = excluded.state,
                    current = excluded.current, updated_at = excluded.updated_at`,
              )
              .run({
                $branch: thread.branch ?? null,
                $current: thread.current ? 1 : 0,
                $issueId: issueId,
                $repository: thread.repository ?? null,
                $sourceId: thread.sourceId,
                $state: thread.state,
                $threadId: thread.threadId,
                $title: thread.title,
                $updatedAt: thread.updatedAt || now,
              });
            for (const linkedUrl of linkedUrls) {
              const issue = readIssueRow(database, issueId);
              if (!issue) continue;
              const urls = parseJsonList(issue.pullRequestUrlsJson);
              if (!urls.includes(linkedUrl)) {
                urls.push(linkedUrl);
                database
                  .query(
                    "UPDATE factory_issues SET pull_request_urls_json = $urls, updated_at = $updatedAt WHERE id = $id",
                  )
                  .run({
                    $id: issueId,
                    $updatedAt: now,
                    $urls: JSON.stringify(urls),
                  });
                newlyLinkedPullRequestUrls.add(linkedUrl);
              }
            }
          }
        }
      });
      return [...newlyLinkedPullRequestUrls];
    },

    reconcileProject({
      projectId,
      pullRequests,
      pullRequestPassComplete,
      freshSourceIds,
    }) {
      if (!pullRequestPassComplete) return;
      const rows = readIssueRows(database, projectId);
      const observedByUrl = new Map(
        pullRequests.map((pullRequest) => [
          parseGitHubPullRequestUrl(pullRequest.url).url,
          pullRequest,
        ]),
      );
      const now = clock().toISOString();
      const freshSources =
        freshSourceIds === undefined ? undefined : new Set(freshSourceIds);
      withTransaction(database, () => {
        for (const issue of rows) {
          const urls = parseJsonList(issue.pullRequestUrlsJson);
          const snapshots = urls.map((url) => observedByUrl.get(url));
          if (
            snapshots.some(
              (snapshot) =>
                !snapshot?.ok || !snapshot.state || !snapshot.updatedAt,
            )
          ) {
            continue;
          }
          const previousSnapshots = new Map(
            (
              database
                .query(
                  `SELECT url, state, merged, event_fingerprint AS eventFingerprint
                     FROM factory_issue_pull_requests WHERE issue_id = $id`,
                )
                .all({ $id: issue.id }) as Array<{
                url: string;
                state: "open" | "closed";
                merged: number;
                eventFingerprint: string;
              }>
            ).map((item) => [item.url, item]),
          );
          const pullRows: PullRequestRow[] = [];
          let newPullRequest = false;
          let reopenedPullRequest = false;
          let pullRequestChanged = false;
          for (const snapshot of snapshots) {
            if (!snapshot?.state || !snapshot.updatedAt) continue;
            const url = parseGitHubPullRequestUrl(snapshot.url).url;
            const merged = Boolean(snapshot.mergedAt);
            const previous = previousSnapshots.get(url);
            if (!previous) {
              newPullRequest = true;
              pullRequestChanged = true;
            }
            if (
              previous &&
              previous.state === "closed" &&
              snapshot.state === "open"
            ) {
              reopenedPullRequest = true;
            }
            const eventFingerprint = digest({
              merged,
              mergedAt: snapshot.mergedAt ?? null,
              state: snapshot.state,
              updatedAt: snapshot.updatedAt,
            });
            if (previous && previous.eventFingerprint !== eventFingerprint) {
              pullRequestChanged = true;
            }
            database
              .query(
                `INSERT INTO factory_issue_pull_requests
                   (issue_id, url, state, merged, updated_at, merged_at, event_fingerprint)
                 VALUES ($issueId, $url, $state, $merged, $updatedAt, $mergedAt, $eventFingerprint)
                 ON CONFLICT(issue_id, url) DO UPDATE SET
                   state = excluded.state, merged = excluded.merged,
                   updated_at = excluded.updated_at, merged_at = excluded.merged_at,
                   event_fingerprint = excluded.event_fingerprint`,
              )
              .run({
                $eventFingerprint: eventFingerprint,
                $issueId: issue.id,
                $merged: merged ? 1 : 0,
                $mergedAt: snapshot.mergedAt ?? null,
                $state: snapshot.state,
                $updatedAt: snapshot.updatedAt,
                $url: url,
              });
            const stored = database
              .query(
                `SELECT issue_id AS issueId, url, state, merged,
                        updated_at AS updatedAt, merged_at AS mergedAt,
                        event_fingerprint AS eventFingerprint
                   FROM factory_issue_pull_requests WHERE issue_id = $issueId AND url = $url`,
              )
              .get({ $issueId: issue.id, $url: url }) as PullRequestRow | null;
            if (stored) pullRows.push(stored);
          }

          const threadRows = readThreadRows(database, issue.id);
          const allPullRequestsMerged =
            urls.length > 0 &&
            pullRows.length === urls.length &&
            pullRows.every((pullRequest) => pullRequest.merged === 1);
          const hasUncertainThreadSource =
            freshSources !== undefined &&
            threadRows.some((thread) => !freshSources.has(thread.sourceId));
          const hasFreshWorkingThread = threadRows.some(
            (thread) =>
              thread.state === "working" &&
              thread.current === 1 &&
              (freshSources === undefined || freshSources.has(thread.sourceId)),
          );
          let newThreadEvent = false;
          for (const thread of threadRows) {
            const fingerprint = digest({
              branch: thread.branch,
              current: thread.current,
              state: thread.state,
              title: thread.title,
              updatedAt: thread.updatedAt,
            });
            if (thread.eventFingerprint !== fingerprint) newThreadEvent = true;
            database
              .query(
                `UPDATE factory_issue_threads SET event_fingerprint = $fingerprint
                  WHERE issue_id = $issueId AND source_id = $sourceId AND thread_id = $threadId`,
              )
              .run({
                $fingerprint: fingerprint,
                $issueId: issue.id,
                $sourceId: thread.sourceId,
                $threadId: thread.threadId,
              });
          }

          const linkedPullRequestEvent = newPullRequest || reopenedPullRequest;
          const isWontDo =
            issue.status === "wont_do" || issue.manualStatus === "wont_do";
          const manualExpired =
            !isWontDo &&
            issue.manualStatus !== null &&
            (pullRequestChanged ||
              (issue.manualStatus !== "done" && newThreadEvent));
          const wasDone = issue.status === "done";
          let nextStatus = issue.status;
          let nextManualStatus = manualExpired ? null : issue.manualStatus;
          if (isWontDo) {
            nextStatus = "wont_do";
            nextManualStatus = "wont_do";
          } else if (wasDone) {
            if (linkedPullRequestEvent) {
              nextStatus = allPullRequestsMerged ? "done" : "in_progress";
              if (!allPullRequestsMerged) nextManualStatus = null;
            }
          } else if (issue.manualStatus !== null && !manualExpired) {
            nextStatus = issue.manualStatus;
          } else if (allPullRequestsMerged) {
            nextStatus = "done";
          } else if (hasFreshWorkingThread) {
            nextStatus = "in_progress";
          } else if (hasUncertainThreadSource) {
            // An unresolved or unavailable source may have a newer state than
            // the last persisted thread row. Preserve the last issue status
            // until every associated source has fresh evidence, unless a
            // fresh working thread or complete merged-PR observation resolves
            // it.
            nextStatus = issue.status;
          } else if (manualExpired) {
            nextManualStatus = null;
            nextStatus = linkedPullRequestEvent
              ? statusAfterPullRequestEvent(
                  issue.status,
                  urls,
                  pullRows,
                  threadRows,
                )
              : statusFromObservations(
                  issue.status,
                  urls,
                  pullRows,
                  threadRows,
                );
          } else if (linkedPullRequestEvent) {
            nextStatus = statusAfterPullRequestEvent(
              issue.status,
              urls,
              pullRows,
              threadRows,
            );
          } else if (newThreadEvent || pullRequestChanged) {
            nextStatus = statusFromObservations(
              issue.status,
              urls,
              pullRows,
              threadRows,
            );
          }
          if (
            nextStatus !== issue.status ||
            nextManualStatus !== issue.manualStatus
          ) {
            database
              .query(
                `UPDATE factory_issues SET status = $status, manual_status = $manualStatus,
                    updated_at = $updatedAt WHERE id = $id`,
              )
              .run({
                $id: issue.id,
                $manualStatus: nextManualStatus,
                $status: nextStatus,
                $updatedAt: now,
              });
            if (nextStatus !== issue.status) {
              appendToStatusOrder(database, issue.id, issue.status, nextStatus);
            }
          }
        }
      });
    },
  };
}
