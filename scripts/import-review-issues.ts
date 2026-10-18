import { existsSync, realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { Database } from "bun:sqlite";

import { createIssueStore } from "../src/issues";

const ISSUE_STATUSES = new Set([
  "todo",
  "in_progress",
  "needs_attention",
  "done",
  "wont_do",
]);

const TABLES = {
  issues: "factory_issues",
  counter: "factory_issue_counter",
  threads: "factory_issue_threads",
  pullRequests: "factory_issue_pull_requests",
} as const;

const EXPECTED_COLUMNS: Record<
  (typeof TABLES)[keyof typeof TABLES],
  Array<{ name: string; type: string; primaryKeyPosition?: number }>
> = {
  factory_issues: [
    { name: "id", type: "TEXT", primaryKeyPosition: 1 },
    { name: "simple_id", type: "TEXT" },
    { name: "project_id", type: "TEXT" },
    { name: "title", type: "TEXT" },
    { name: "description", type: "TEXT" },
    { name: "labels_json", type: "TEXT" },
    { name: "branches_json", type: "TEXT" },
    { name: "pull_request_urls_json", type: "TEXT" },
    { name: "status", type: "TEXT" },
    { name: "manual_status", type: "TEXT" },
    { name: "order_index", type: "INTEGER" },
    { name: "created_at", type: "TEXT" },
    { name: "updated_at", type: "TEXT" },
  ],
  factory_issue_counter: [
    { name: "id", type: "INTEGER", primaryKeyPosition: 1 },
    { name: "next_number", type: "INTEGER" },
  ],
  factory_issue_threads: [
    { name: "issue_id", type: "TEXT", primaryKeyPosition: 1 },
    { name: "source_id", type: "TEXT", primaryKeyPosition: 2 },
    { name: "thread_id", type: "TEXT", primaryKeyPosition: 3 },
    { name: "title", type: "TEXT" },
    { name: "branch", type: "TEXT" },
    { name: "repository", type: "TEXT" },
    { name: "state", type: "TEXT" },
    { name: "current", type: "INTEGER" },
    { name: "updated_at", type: "TEXT" },
    { name: "event_fingerprint", type: "TEXT" },
  ],
  factory_issue_pull_requests: [
    { name: "issue_id", type: "TEXT", primaryKeyPosition: 1 },
    { name: "url", type: "TEXT", primaryKeyPosition: 2 },
    { name: "state", type: "TEXT" },
    { name: "merged", type: "INTEGER" },
    { name: "updated_at", type: "TEXT" },
    { name: "merged_at", type: "TEXT" },
    { name: "event_fingerprint", type: "TEXT" },
  ],
};

type IssueRecord = {
  id: string;
  simple_id: string;
  project_id: string;
  title: string;
  description: string;
  labels_json: string;
  branches_json: string;
  pull_request_urls_json: string;
  status: string;
  manual_status: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
};

type CounterRecord = { id: number; next_number: number };
type ThreadRecord = {
  issue_id: string;
  source_id: string;
  thread_id: string;
  title: string;
  branch: string | null;
  repository: string | null;
  state: string;
  current: number;
  updated_at: string;
  event_fingerprint: string | null;
};
type PullRequestRecord = {
  issue_id: string;
  url: string;
  state: string;
  merged: number;
  updated_at: string;
  merged_at: string | null;
  event_fingerprint: string;
};

export type ReviewIssueImportCounts = {
  issues: number;
  threads: number;
  pullRequests: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function databasePath(path: string, name: string): string {
  if (!path.trim()) fail(`${name} snapshot path is required.`);
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    fail(`${name} snapshot must be an existing file.`);
  }
  if (existsSync(`${absolutePath}-wal`) || existsSync(`${absolutePath}-shm`)) {
    fail(`${name} must be an offline, standalone SQLite snapshot.`);
  }
  return absolutePath;
}

function openReadonly(path: string, name: string): Database {
  try {
    return new Database(path, { readonly: true });
  } catch {
    return fail(`${name} snapshot could not be opened read-only.`);
  }
}

function tableExists(database: Database, table: string): boolean {
  return Boolean(
    database
      .query(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = $name",
      )
      .get({ $name: table }),
  );
}

function assertIntegrity(database: Database, name: string): void {
  const rows = database.query("PRAGMA integrity_check").all() as Array<{
    integrity_check: string;
  }>;
  if (rows.length !== 1 || rows[0]?.integrity_check !== "ok") {
    fail(`${name} snapshot failed SQLite integrity validation.`);
  }
  const foreignKeyErrors = database.query("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length) {
    fail(`${name} snapshot has a foreign-key integrity error.`);
  }
}

function assertSchema(
  database: Database,
  table: (typeof TABLES)[keyof typeof TABLES],
  { allowMissingOrderIndex = false }: { allowMissingOrderIndex?: boolean } = {},
): void {
  const actual = database.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
    pk: number;
  }>;
  const actualByName = new Map(actual.map((column) => [column.name, column]));
  const expected = EXPECTED_COLUMNS[table].filter(
    (column) => !(allowMissingOrderIndex && column.name === "order_index"),
  );
  if (
    actual.length !== expected.length ||
    expected.some((column) => {
      const found = actualByName.get(column.name);
      return (
        !found ||
        found.type.toUpperCase() !== column.type ||
        found.pk !== (column.primaryKeyPosition ?? 0)
      );
    })
  ) {
    fail(`Database has an unsupported ${table} schema.`);
  }
}

function assertIssueForeignKeys(database: Database): void {
  for (const table of [TABLES.threads, TABLES.pullRequests]) {
    const foreignKeys = database
      .query(`PRAGMA foreign_key_list(${table})`)
      .all() as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    if (
      !foreignKeys.some(
        (foreignKey) =>
          foreignKey.table === TABLES.issues &&
          foreignKey.from === "issue_id" &&
          foreignKey.to === "id",
      )
    ) {
      fail(`Database has an unsupported ${table} foreign-key schema.`);
    }
  }
}

function parseStringList(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fail("Review issue snapshot contains invalid issue data.");
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string") ||
    new Set(parsed).size !== parsed.length
  ) {
    fail("Review issue snapshot contains invalid issue data.");
  }
  return parsed;
}

function readProjectIds(database: Database, name: string): Set<string> {
  if (!tableExists(database, "factory_state")) {
    fail(`${name} snapshot is missing Factory project state.`);
  }
  const rows = database
    .query("SELECT state FROM factory_state WHERE id = 1")
    .all() as Array<{ state: string }>;
  if (rows.length !== 1) {
    fail(`${name} snapshot has invalid Factory project state.`);
  }

  try {
    const parsed = JSON.parse(rows[0]!.state) as { projects?: unknown };
    if (!Array.isArray(parsed.projects)) {
      fail(`${name} snapshot has invalid Factory project state.`);
    }
    const ids = new Set<string>();
    for (const project of parsed.projects) {
      if (
        !project ||
        typeof project !== "object" ||
        typeof (project as { id?: unknown }).id !== "string" ||
        !(project as { id: string }).id
      ) {
        fail(`${name} snapshot has invalid Factory project state.`);
      }
      ids.add((project as { id: string }).id);
    }
    return ids;
  } catch {
    return fail(`${name} snapshot has invalid Factory project state.`);
  }
}

function assertTargetIssueStoreEmpty(database: Database): void {
  for (const table of [
    TABLES.issues,
    TABLES.threads,
    TABLES.pullRequests,
  ] as const) {
    if (!tableExists(database, table)) continue;
    const hasOrderIndexException =
      table === TABLES.issues &&
      !(
        database.query("PRAGMA table_info(factory_issues)").all() as Array<{
          name: string;
        }>
      ).some((column) => column.name === "order_index");
    assertSchema(database, table, {
      allowMissingOrderIndex: hasOrderIndexException,
    });
    const count = database
      .query(`SELECT COUNT(*) AS count FROM ${table}`)
      .get() as { count: number };
    if (count.count !== 0) {
      fail("Target issue store is not empty.");
    }
  }

  if (tableExists(database, TABLES.counter)) {
    assertSchema(database, TABLES.counter);
    const counters = database
      .query("SELECT id, next_number FROM factory_issue_counter")
      .all() as CounterRecord[];
    if (
      counters.length !== 1 ||
      counters[0]?.id !== 1 ||
      counters[0]?.next_number !== 1
    ) {
      fail("Target issue counter is not pristine.");
    }
  }
}

function readAndValidateSource(database: Database): {
  counter: CounterRecord;
  issues: IssueRecord[];
  threads: ThreadRecord[];
  pullRequests: PullRequestRecord[];
  projectIds: Set<string>;
} {
  assertIntegrity(database, "Review");
  for (const table of Object.values(TABLES)) {
    if (!tableExists(database, table)) {
      fail("Review snapshot is missing an issue table.");
    }
    assertSchema(database, table);
  }
  assertIssueForeignKeys(database);

  const counterRows = database
    .query("SELECT id, next_number FROM factory_issue_counter")
    .all() as CounterRecord[];
  if (
    counterRows.length !== 1 ||
    counterRows[0]?.id !== 1 ||
    !Number.isSafeInteger(counterRows[0]?.next_number) ||
    counterRows[0]!.next_number < 1
  ) {
    fail("Review snapshot has an invalid issue counter.");
  }
  const counter = counterRows[0]!;
  const issues = database
    .query(
      `SELECT id, simple_id, project_id, title, description, labels_json,
              branches_json, pull_request_urls_json, status, manual_status,
              order_index, created_at, updated_at
         FROM factory_issues ORDER BY status, order_index, created_at, simple_id`,
    )
    .all() as IssueRecord[];
  const threads = database
    .query(
      `SELECT issue_id, source_id, thread_id, title, branch, repository, state,
              current, updated_at, event_fingerprint
         FROM factory_issue_threads ORDER BY issue_id, source_id, thread_id`,
    )
    .all() as ThreadRecord[];
  const pullRequests = database
    .query(
      `SELECT issue_id, url, state, merged, updated_at, merged_at,
              event_fingerprint
         FROM factory_issue_pull_requests ORDER BY issue_id, url`,
    )
    .all() as PullRequestRecord[];
  if (issues.length === 0) {
    fail("Review snapshot contains no issues to import.");
  }

  const issueIds = new Set<string>();
  const simpleIds = new Set<string>();
  const issueUrls = new Map<string, Set<string>>();
  const orderSlots = new Set<string>();
  let maxSimpleNumber = 0;
  for (const issue of issues) {
    if (
      !issue.id ||
      !issue.project_id ||
      !issue.title ||
      typeof issue.description !== "string" ||
      !issue.created_at ||
      !issue.updated_at ||
      !ISSUE_STATUSES.has(issue.status) ||
      (issue.manual_status !== null &&
        !ISSUE_STATUSES.has(issue.manual_status)) ||
      !Number.isSafeInteger(issue.order_index) ||
      issue.order_index < 0
    ) {
      fail("Review snapshot contains invalid issue data.");
    }
    const simpleIdMatch = /^F-(\d+)$/.exec(issue.simple_id);
    if (
      !simpleIdMatch ||
      issueIds.has(issue.id) ||
      simpleIds.has(issue.simple_id)
    ) {
      fail("Review snapshot contains invalid issue identifiers.");
    }
    issueIds.add(issue.id);
    simpleIds.add(issue.simple_id);
    maxSimpleNumber = Math.max(maxSimpleNumber, Number(simpleIdMatch[1]));
    const slot = `${issue.status}\u0000${issue.order_index}`;
    if (orderSlots.has(slot)) {
      fail("Review snapshot contains invalid issue ordering.");
    }
    orderSlots.add(slot);
    issueUrls.set(
      issue.id,
      new Set(parseStringList(issue.pull_request_urls_json)),
    );
    parseStringList(issue.labels_json);
    parseStringList(issue.branches_json);
  }
  if (counter.next_number <= maxSimpleNumber) {
    fail("Review snapshot issue counter conflicts with issue identifiers.");
  }

  for (const thread of threads) {
    if (
      !issueIds.has(thread.issue_id) ||
      !thread.source_id ||
      !thread.thread_id ||
      !thread.title ||
      (thread.branch !== null && typeof thread.branch !== "string") ||
      (thread.repository !== null && typeof thread.repository !== "string") ||
      !["working", "stopped"].includes(thread.state) ||
      ![0, 1].includes(thread.current) ||
      !thread.updated_at ||
      (thread.event_fingerprint !== null &&
        typeof thread.event_fingerprint !== "string")
    ) {
      fail("Review snapshot contains invalid thread data.");
    }
  }
  for (const pullRequest of pullRequests) {
    if (
      !issueIds.has(pullRequest.issue_id) ||
      !issueUrls.get(pullRequest.issue_id)?.has(pullRequest.url) ||
      !pullRequest.url ||
      !["open", "closed"].includes(pullRequest.state) ||
      ![0, 1].includes(pullRequest.merged) ||
      !pullRequest.updated_at ||
      (pullRequest.merged_at !== null &&
        typeof pullRequest.merged_at !== "string") ||
      !pullRequest.event_fingerprint
    ) {
      fail("Review snapshot contains invalid pull-request data.");
    }
  }

  const sourceProjectIds = readProjectIds(database, "Review");
  for (const issue of issues) {
    if (!sourceProjectIds.has(issue.project_id)) {
      fail("Review issue refers to a missing source project.");
    }
  }

  return {
    counter,
    issues,
    threads,
    pullRequests,
    projectIds: new Set(issues.map((issue) => issue.project_id)),
  };
}

function assertTargetProjects(
  database: Database,
  sourceProjectIds: Set<string>,
): void {
  const targetProjectIds = readProjectIds(database, "Target");
  if (
    [...sourceProjectIds].some((projectId) => !targetProjectIds.has(projectId))
  ) {
    fail("Target is missing a project used by a review issue.");
  }
}

/** Import only the Factory issue tables from offline SQLite snapshots. */
export function importReviewIssues({
  sourceDatabasePath,
  targetDatabasePath,
}: {
  sourceDatabasePath: string;
  targetDatabasePath: string;
}): ReviewIssueImportCounts {
  const sourcePath = databasePath(sourceDatabasePath, "Review");
  const targetPath = databasePath(targetDatabasePath, "Target");
  if (realpathSync(sourcePath) === realpathSync(targetPath)) {
    fail("Review and target snapshots must be different files.");
  }

  const source = openReadonly(sourcePath, "Review");
  const target = openReadonly(targetPath, "Target");
  let sourceData: ReturnType<typeof readAndValidateSource>;
  try {
    assertIntegrity(target, "Target");
    sourceData = readAndValidateSource(source);
    assertTargetIssueStoreEmpty(target);
    assertTargetProjects(target, sourceData.projectIds);
  } finally {
    source.close();
    target.close();
  }

  // createIssueStore performs Factory's supported additive schema setup.
  const issueStore = createIssueStore({ databasePath: targetPath });
  issueStore.close();

  const database = new Database(targetPath);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("BEGIN IMMEDIATE");
  try {
    assertIntegrity(database, "Target");
    assertTargetIssueStoreEmpty(database);
    assertTargetProjects(database, sourceData.projectIds);

    const insertIssue = database.query(
      `INSERT INTO factory_issues
         (id, simple_id, project_id, title, description, labels_json,
          branches_json, pull_request_urls_json, status, manual_status,
          order_index, created_at, updated_at)
       VALUES ($id, $simple_id, $project_id, $title, $description, $labels_json,
               $branches_json, $pull_request_urls_json, $status, $manual_status,
               $order_index, $created_at, $updated_at)`,
    );
    const insertThread = database.query(
      `INSERT INTO factory_issue_threads
         (issue_id, source_id, thread_id, title, branch, repository, state,
          current, updated_at, event_fingerprint)
       VALUES ($issue_id, $source_id, $thread_id, $title, $branch, $repository,
               $state, $current, $updated_at, $event_fingerprint)`,
    );
    const insertPullRequest = database.query(
      `INSERT INTO factory_issue_pull_requests
         (issue_id, url, state, merged, updated_at, merged_at, event_fingerprint)
       VALUES ($issue_id, $url, $state, $merged, $updated_at, $merged_at,
               $event_fingerprint)`,
    );
    for (const issue of sourceData.issues) {
      insertIssue.run({
        $id: issue.id,
        $simple_id: issue.simple_id,
        $project_id: issue.project_id,
        $title: issue.title,
        $description: issue.description,
        $labels_json: issue.labels_json,
        $branches_json: issue.branches_json,
        $pull_request_urls_json: issue.pull_request_urls_json,
        $status: issue.status,
        $manual_status: issue.manual_status,
        $order_index: issue.order_index,
        $created_at: issue.created_at,
        $updated_at: issue.updated_at,
      });
    }
    for (const thread of sourceData.threads) {
      insertThread.run({
        $issue_id: thread.issue_id,
        $source_id: thread.source_id,
        $thread_id: thread.thread_id,
        $title: thread.title,
        $branch: thread.branch,
        $repository: thread.repository,
        $state: thread.state,
        $current: thread.current,
        $updated_at: thread.updated_at,
        $event_fingerprint: thread.event_fingerprint,
      });
    }
    for (const pullRequest of sourceData.pullRequests) {
      insertPullRequest.run({
        $issue_id: pullRequest.issue_id,
        $url: pullRequest.url,
        $state: pullRequest.state,
        $merged: pullRequest.merged,
        $updated_at: pullRequest.updated_at,
        $merged_at: pullRequest.merged_at,
        $event_fingerprint: pullRequest.event_fingerprint,
      });
    }
    database
      .query(
        `UPDATE factory_issue_counter SET next_number = $next_number WHERE id = 1`,
      )
      .run({ $next_number: sourceData.counter.next_number });

    const counts = {
      issues: (
        database
          .query("SELECT COUNT(*) AS count FROM factory_issues")
          .get() as { count: number }
      ).count,
      threads: (
        database
          .query("SELECT COUNT(*) AS count FROM factory_issue_threads")
          .get() as { count: number }
      ).count,
      pullRequests: (
        database
          .query("SELECT COUNT(*) AS count FROM factory_issue_pull_requests")
          .get() as { count: number }
      ).count,
    };
    if (
      counts.issues !== sourceData.issues.length ||
      counts.threads !== sourceData.threads.length ||
      counts.pullRequests !== sourceData.pullRequests.length
    ) {
      fail("Imported issue counts do not match the review snapshot.");
    }
    const foreignKeyErrors = database.query("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) {
      fail("Imported issue data failed foreign-key validation.");
    }
    database.exec("COMMIT");
    return counts;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.close();
  }
}

function main(): void {
  const [sourceDatabasePath, targetDatabasePath, ...extraArguments] =
    process.argv.slice(2);
  if (!sourceDatabasePath || !targetDatabasePath || extraArguments.length) {
    console.error(
      "Usage: bun scripts/import-review-issues.ts <review-snapshot.sqlite> <target-snapshot.sqlite>",
    );
    process.exitCode = 2;
    return;
  }
  try {
    console.log(
      JSON.stringify(
        importReviewIssues({ sourceDatabasePath, targetDatabasePath }),
      ),
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Review issue import failed.",
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) main();
