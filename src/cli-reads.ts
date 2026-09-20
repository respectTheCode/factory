import { Buffer } from "node:buffer";

export type ReadPage<T> = {
  items: T[];
  totalCount: number;
  truncated: boolean;
  nextCursor: string | null;
};

type OffsetCursor = {
  kind: "offset";
  offset: number;
  scope: string;
  version: 1;
};

type HistoryCursor = {
  createdAt: string;
  direction: "backward" | "forward";
  id: string;
  kind: "history";
  scope: string;
  version: 1;
};

export const CLI_READ_CAPS = {
  attention: 100,
  credentials: 50,
  githubRuns: 50,
  history: 100,
  projectContextTasks: 50,
  projectList: 50,
  portfolioProjects: 50,
  sessionFindings: 50,
  statusSubtasks: 100,
  t3Sources: 20,
} as const;

function encode(value: OffsetCursor | HistoryCursor): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new Error(
      "--cursor must be a valid cursor returned by a previous read.",
    );
  }
}

function offsetCursor(
  value: string | undefined,
  expectedScope: string,
): number {
  if (value === undefined) return 0;
  const decoded = decode(value);
  if (
    !decoded ||
    typeof decoded !== "object" ||
    (decoded as Partial<OffsetCursor>).kind !== "offset" ||
    (decoded as Partial<OffsetCursor>).scope !== expectedScope ||
    (decoded as Partial<OffsetCursor>).version !== 1 ||
    !Number.isSafeInteger((decoded as Partial<OffsetCursor>).offset) ||
    ((decoded as Partial<OffsetCursor>).offset ?? -1) < 0
  ) {
    throw new Error("--cursor is not valid for this list read.");
  }
  return (decoded as OffsetCursor).offset;
}

export function parseReadLimit(
  flags: Map<string, string>,
  defaultLimit: number,
  maximum = defaultLimit,
): number {
  const configured = flags.get("limit");
  if (configured === undefined) return defaultLimit;
  const value = Number(configured);
  if (
    !/^\d+$/.test(configured) ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > maximum
  ) {
    throw new Error(`--limit must be an integer from 1 through ${maximum}.`);
  }
  return value;
}

export function paginateOffset<T>(
  items: readonly T[],
  limit: number,
  cursor: string | undefined,
  scope: string,
): ReadPage<T> {
  const offset = offsetCursor(cursor, scope);
  if (offset > items.length) {
    throw new Error("--cursor points past the end of this list read.");
  }
  const page = items.slice(offset, offset + limit);
  const truncated = offset + page.length < items.length;
  return {
    items: page,
    nextCursor: truncated
      ? encode({
          kind: "offset",
          offset: offset + page.length,
          scope,
          version: 1,
        })
      : null,
    totalCount: items.length,
    truncated,
  };
}

function historyDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("History contains an invalid timestamp.");
  }
  return date.toISOString();
}

function compareHistoryKey(
  left: { createdAt: Date | string; id: string },
  right: { createdAt: Date | string; id: string },
): number {
  return (
    historyDate(left.createdAt).localeCompare(historyDate(right.createdAt)) ||
    left.id.localeCompare(right.id)
  );
}

function historyCursor(
  value: string | undefined,
  expectedDirection: HistoryCursor["direction"],
  expectedScope: string,
): HistoryCursor | undefined {
  if (value === undefined) return undefined;
  const decoded = decode(value);
  if (
    !decoded ||
    typeof decoded !== "object" ||
    (decoded as Partial<HistoryCursor>).kind !== "history" ||
    (decoded as Partial<HistoryCursor>).scope !== expectedScope ||
    (decoded as Partial<HistoryCursor>).version !== 1 ||
    (decoded as Partial<HistoryCursor>).direction !== expectedDirection ||
    typeof (decoded as Partial<HistoryCursor>).createdAt !== "string" ||
    typeof (decoded as Partial<HistoryCursor>).id !== "string"
  ) {
    throw new Error("--cursor is not valid for this history read.");
  }
  return decoded as HistoryCursor;
}

export function paginateHistory<
  T extends { createdAt: Date | string; id: string },
>(
  items: readonly T[],
  options: {
    cursor?: string;
    direction: HistoryCursor["direction"];
    limit: number;
    since?: string;
    scope: string;
  },
): ReadPage<T> {
  const cursor = historyCursor(
    options.cursor,
    options.direction,
    options.scope,
  );
  const since =
    options.since === undefined ? undefined : historyDate(options.since);
  const sorted = [...items].sort(compareHistoryKey);
  const candidates = sorted.filter((item) => {
    const key = { createdAt: historyDate(item.createdAt), id: item.id };
    if (since !== undefined && key.createdAt <= since) return false;
    if (cursor === undefined) return true;
    const cursorKey = {
      createdAt: cursor.createdAt,
      id: cursor.id,
    };
    return options.direction === "backward"
      ? compareHistoryKey(key, cursorKey) < 0
      : compareHistoryKey(key, cursorKey) > 0;
  });

  const page =
    options.direction === "backward"
      ? candidates.slice(Math.max(0, candidates.length - options.limit))
      : candidates.slice(0, options.limit);
  const truncated = candidates.length > page.length;
  const cursorItem =
    options.direction === "backward" ? page[0] : page[page.length - 1];
  return {
    items: page,
    nextCursor:
      truncated && cursorItem
        ? encode({
            createdAt: historyDate(cursorItem.createdAt),
            direction: options.direction,
            id: cursorItem.id,
            kind: "history",
            scope: options.scope,
            version: 1,
          })
        : null,
    totalCount: candidates.length,
    truncated,
  };
}

export function warnIfTruncated(label: string, page: ReadPage<unknown>): void {
  if (!page.truncated || page.nextCursor === null) return;
  console.error(
    `[Factory] Warning: ${label} output truncated at ${page.items.length} of ${page.totalCount}; continue with --cursor ${page.nextCursor}.`,
  );
}

export function includePageMetadata(
  page: ReadPage<unknown>,
  includeWhenComplete = false,
): {
  truncated: boolean;
  nextCursor: string | null;
  totalCount: number;
} | null {
  if (!page.truncated && !includeWhenComplete) return null;
  return {
    nextCursor: page.nextCursor,
    totalCount: page.totalCount,
    truncated: page.truncated,
  };
}
