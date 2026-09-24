import {
  chmodSync,
  lstatSync,
  mkdirSync,
  unlinkSync,
  openSync,
  readFileSync,
  renameSync,
  closeSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  createT3ActivityReader,
  DEFAULT_T3_SERVER_VERSION,
  type T3ActivityReader,
  type T3TransportState,
} from "./t3";
import {
  normalizeT3SourceBaseUrl,
  createT3SourceFromToken,
  T3_SOURCE_HAS_TOKEN,
  T3_SOURCE_READER_FACTORY,
  type T3Source,
} from "./t3-sources";
import { MAX_T3_ACCESS_TOKEN_BYTES } from "./t3-credential";

const MANAGED_FILE_NAME = "managed-sources.json";
const MAX_MANAGED_FILE_BYTES = 256 * 1024;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type T3ConnectionSummary = {
  sourceId: string;
  machineId: string;
  label?: string;
  baseUrl: string;
  tokenConfigured: boolean;
};

export type T3ConnectionState = T3TransportState | "connected";

export type T3ConnectionStatus = T3ConnectionSummary & {
  state: T3ConnectionState;
  observedAt?: string;
  lastSuccessfulFetchAt?: string;
  sourceVersion?: string;
  projectCount?: number;
  threadCount?: number;
  error?: string;
};

export type T3ConnectionDraft = {
  sourceId?: string;
  machineId: string;
  label: string;
  baseUrl: string;
  accessToken?: string;
};

type PersistedSource = {
  sourceId: string;
  machineId: string;
  label?: string;
  baseUrl: string;
  accessToken?: string;
};

type PersistedDocument = {
  schemaVersion: 1;
  sources: PersistedSource[];
};

export type T3ConnectionStore = ReturnType<typeof createT3ConnectionStore>;

/**
 * Owns the writable overlay for operator-managed sources. The environment or
 * mounted source list remains the base; saved rows override it by sourceId.
 * The overlay is one private, atomically replaced document so metadata and
 * write-only credentials cannot become inconsistent across two files.
 */
export function createT3ConnectionStore(input: {
  directory?: string;
  baseSources: readonly T3Source[];
  timeoutMs?: number;
}) {
  if (input.directory && !isAbsolute(input.directory)) {
    throw new Error("T3 managed directory must be an absolute path.");
  }

  const baseSources = new Map(
    input.baseSources.map((source) => [source.sourceId, source]),
  );
  let savedSources = input.directory ? readManagedSources(input.directory) : [];
  let sources = materializeSources(savedSources, baseSources, input.timeoutMs);
  validateUniqueSources(sources);

  const persist = (next: PersistedSource[]) => {
    if (!input.directory) {
      throw new Error(
        "T3 connection changes cannot be saved with an in-memory Factory database.",
      );
    }
    writeManagedSources(input.directory, next);
  };

  return {
    getSources(): T3Source[] {
      return [...sources];
    },

    list(): T3ConnectionSummary[] {
      return sources.map((source) => summaryFor(source, savedSources));
    },

    save(draft: T3ConnectionDraft): T3ConnectionSummary {
      const machineId = requiredText(draft.machineId, "Machine ID", 200);
      const label = requiredText(draft.label, "Label", 100);
      const sourceId = draft.sourceId?.trim() || `t3-${randomUUID()}`;
      if (!SOURCE_ID_PATTERN.test(sourceId)) {
        throw new Error(
          "T3 source ID must use letters, numbers, dot, dash, or underscore.",
        );
      }
      const oldSource = sources.find(
        (candidate) => candidate.sourceId === sourceId,
      );
      if (draft.sourceId && !oldSource) {
        throw new Error(
          "The T3 source no longer exists. Refresh and try again.",
        );
      }
      const requestedBaseUrl = draft.baseUrl.trim();
      const baseUrl =
        oldSource && requestedBaseUrl === oldSource.baseUrl
          ? oldSource.baseUrl
          : normalizeT3SourceBaseUrl(requestedBaseUrl);
      const accessToken = normalizeAccessToken(draft.accessToken);
      if (!oldSource && !accessToken) {
        throw new Error("Enter the read-only T3 token when adding a source.");
      }
      const priorPersisted = savedSources.find(
        (candidate) => candidate.sourceId === sourceId,
      );
      const nextPersisted: PersistedSource = {
        sourceId,
        machineId,
        label,
        baseUrl,
        ...(accessToken
          ? { accessToken }
          : priorPersisted?.accessToken
            ? { accessToken: priorPersisted.accessToken }
            : {}),
      };
      const nextSaved = [
        ...savedSources.filter((candidate) => candidate.sourceId !== sourceId),
        nextPersisted,
      ];
      const nextSources = materializeSources(
        nextSaved,
        new Map(sources.map((source) => [source.sourceId, source])),
        input.timeoutMs,
        new Map([
          [
            sourceId,
            {
              oldSource,
              forceNewReader: Boolean(accessToken),
            },
          ],
        ]),
      );
      validateUniqueSources(nextSources);
      persist(nextSaved);
      savedSources = nextSaved;
      sources = nextSources;
      const saved = sources.find(
        (candidate) => candidate.sourceId === sourceId,
      );
      if (!saved) throw new Error("The saved T3 source was not loaded.");
      return summaryFor(saved, savedSources);
    },

    async testDraft(
      draft: Omit<T3ConnectionDraft, "sourceId"> & { sourceId?: string },
    ): Promise<T3ConnectionStatus> {
      const machineId = requiredText(draft.machineId, "Machine ID", 200);
      const label = requiredText(draft.label, "Label", 100);
      const token = normalizeAccessToken(draft.accessToken);
      const current = draft.sourceId
        ? sources.find((source) => source.sourceId === draft.sourceId)
        : undefined;
      if (draft.sourceId && !current) {
        throw new Error(
          "The T3 source no longer exists. Refresh and try again.",
        );
      }
      const requestedBaseUrl = draft.baseUrl.trim();
      const baseUrl =
        current && requestedBaseUrl === current.baseUrl
          ? current.baseUrl
          : normalizeT3SourceBaseUrl(requestedBaseUrl);
      if (!token && !current) {
        throw new Error(
          "Enter the read-only T3 access token to test this connection.",
        );
      }
      const readerFactory = current?.[T3_SOURCE_READER_FACTORY];
      if (!token && current && current.baseUrl !== baseUrl && !readerFactory) {
        throw new Error(
          "Enter the read-only T3 token when testing a different endpoint.",
        );
      }
      const reader = token
        ? createT3ActivityReader({ baseUrl, timeoutMs: input.timeoutMs, token })
        : current && current.baseUrl === baseUrl
          ? current.reader
          : readerFactory?.(baseUrl);
      if (!reader) {
        throw new Error(
          "Enter the read-only T3 token to test this connection.",
        );
      }
      return testReader(
        {
          sourceId: draft.sourceId ?? "draft",
          machineId,
          label,
          baseUrl,
          tokenConfigured:
            Boolean(token) || Boolean(current?.[T3_SOURCE_HAS_TOKEN]),
        },
        reader,
      );
    },
  };
}

export async function testT3Connection(
  summary: T3ConnectionSummary,
  reader: T3ActivityReader,
): Promise<T3ConnectionStatus> {
  return testReader(summary, reader);
}

async function testReader(
  summary: T3ConnectionSummary,
  reader: T3ActivityReader,
): Promise<T3ConnectionStatus> {
  let result: Awaited<ReturnType<T3ActivityReader["readShell"]>>;
  try {
    result = await reader.readShell();
  } catch {
    return {
      ...summary,
      state: "unreachable",
      observedAt: new Date().toISOString(),
      error: stateMessage("unreachable"),
    };
  }
  if (result.ok) {
    return {
      ...summary,
      state: "connected",
      observedAt: result.fetchedAt,
      lastSuccessfulFetchAt: result.fetchedAt,
      sourceVersion: DEFAULT_T3_SERVER_VERSION,
      projectCount: result.projects.length,
      threadCount: result.threads.length,
    };
  }
  return {
    ...summary,
    state: result.status,
    observedAt: result.fetchedAt,
    error: stateMessage(result.status),
  };
}

export function safeT3ConnectionError(
  state: T3ConnectionState,
): string | undefined {
  return state === "connected" ? undefined : stateMessage(state);
}

function stateMessage(state: T3ConnectionState): string {
  switch (state) {
    case "connected":
      return "Connected to T3.";
    case "not_configured":
      return "T3 is not configured on this endpoint.";
    case "unreachable":
      return "T3 could not be reached. Check the endpoint and LAN access.";
    case "authentication_failed":
      return "T3 rejected the read-only token.";
    case "permission_denied":
      return "The token does not allow Factory's read-only T3 requests.";
    case "incompatible":
      return "This T3 version is not compatible with Factory.";
    case "invalid_response":
      return "T3 returned an invalid response.";
    case "unavailable":
      return "The T3 connection is unavailable.";
  }
}

function summaryFor(
  source: T3Source,
  saved: readonly PersistedSource[],
): T3ConnectionSummary {
  return {
    baseUrl: source.baseUrl,
    machineId: source.machineId,
    ...(source.label === undefined ? {} : { label: source.label }),
    sourceId: source.sourceId,
    tokenConfigured:
      Boolean(
        saved.find((candidate) => candidate.sourceId === source.sourceId)
          ?.accessToken,
      ) || Boolean(source[T3_SOURCE_HAS_TOKEN]),
  };
}

function materializeSources(
  saved: readonly PersistedSource[],
  base: ReadonlyMap<string, T3Source>,
  timeoutMs?: number,
  changed?: Map<string, { oldSource?: T3Source; forceNewReader: boolean }>,
): T3Source[] {
  const sources = new Map(base);
  for (const config of saved) {
    const changedSource = changed?.get(config.sourceId);
    const prior = changedSource?.oldSource ?? sources.get(config.sourceId);
    if (
      prior &&
      !changedSource &&
      prior.baseUrl === config.baseUrl &&
      prior.machineId === config.machineId &&
      prior.label === config.label &&
      (!config.accessToken || prior.accessTokenFile === "<managed-t3-token>")
    ) {
      sources.set(config.sourceId, prior);
      continue;
    }
    let source: T3Source;
    if (config.accessToken) {
      if (
        prior &&
        !changedSource?.forceNewReader &&
        prior.accessTokenFile === "<managed-t3-token>"
      ) {
        const readerFactory = prior[T3_SOURCE_READER_FACTORY];
        let reader = prior.reader;
        if (prior.baseUrl !== config.baseUrl) {
          if (!readerFactory) {
            throw new Error(
              "Enter the read-only T3 token when changing this source endpoint.",
            );
          }
          reader = readerFactory(config.baseUrl);
        }
        source = {
          ...prior,
          baseUrl: config.baseUrl,
          label: config.label,
          machineId: config.machineId,
          reader,
          sourceId: config.sourceId,
        };
        copySourceCapabilities(source, prior);
      } else {
        source = createT3SourceFromToken(
          {
            accessTokenFile: "<managed-t3-token>",
            baseUrl: config.baseUrl,
            ...(config.label === undefined ? {} : { label: config.label }),
            machineId: config.machineId,
            sourceId: config.sourceId,
          },
          config.accessToken,
          timeoutMs,
        );
      }
    } else if (prior) {
      const priorBaseUrl = prior.baseUrl;
      const readerFactory = prior[T3_SOURCE_READER_FACTORY];
      let reader = prior.reader;
      if (priorBaseUrl !== config.baseUrl) {
        if (!readerFactory) {
          throw new Error(
            "Enter the read-only T3 token when changing this source endpoint.",
          );
        }
        reader = readerFactory(config.baseUrl);
      }
      source = {
        ...prior,
        baseUrl: config.baseUrl,
        label: config.label,
        machineId: config.machineId,
        reader,
        sourceId: config.sourceId,
      };
      copySourceCapabilities(source, prior);
    } else {
      // Keep incomplete overlays visible and isolated after their base mount is
      // removed; the coordinator will report permission_denied on refresh.
      source = createT3SourceFromToken(
        {
          accessTokenFile: "<managed-t3-token-missing>",
          baseUrl: config.baseUrl,
          ...(config.label === undefined ? {} : { label: config.label }),
          machineId: config.machineId,
          sourceId: config.sourceId,
        },
        undefined,
        timeoutMs,
      );
    }
    source.suppressPersistedLastSuccess = true;
    sources.set(config.sourceId, source);
  }
  return [...sources.values()];
}

function validateUniqueSources(sources: readonly T3Source[]): void {
  const ids = new Set<string>();
  const endpoints = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.sourceId)) {
      throw new Error(
        `T3 source ${source.sourceId} is configured more than once.`,
      );
    }
    ids.add(source.sourceId);
    if (endpoints.has(source.baseUrl)) {
      throw new Error("Each T3 source must use a distinct endpoint.");
    }
    endpoints.add(source.baseUrl);
  }
}

function copySourceCapabilities(target: T3Source, source: T3Source): void {
  const readerFactory = source[T3_SOURCE_READER_FACTORY];
  if (readerFactory) {
    Object.defineProperty(target, T3_SOURCE_READER_FACTORY, {
      value: readerFactory,
    });
  }
  const hasToken = source[T3_SOURCE_HAS_TOKEN];
  if (hasToken !== undefined) {
    Object.defineProperty(target, T3_SOURCE_HAS_TOKEN, { value: hasToken });
  }
}

function requiredText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} must contain 1 to ${maximum} characters.`);
  }
  return normalized;
}

function normalizeAccessToken(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const token = value.trim();
  if (
    Buffer.byteLength(token, "utf8") > MAX_T3_ACCESS_TOKEN_BYTES ||
    !/^[\x21-\x7e]+$/.test(token)
  ) {
    throw new Error(
      "The read-only T3 token must be printable and at most 16 KiB.",
    );
  }
  return token;
}

function readManagedSources(directory: string): PersistedSource[] {
  ensurePrivateDirectory(directory);
  const path = join(directory, MANAGED_FILE_NAME);
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw new Error("The managed T3 source file could not be read.");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("The managed T3 source file must be a regular file.");
  }
  if (metadata.size < 2 || metadata.size > MAX_MANAGED_FILE_BYTES) {
    throw new Error("The managed T3 source file has an invalid size.");
  }
  chmodSync(path, 0o600);
  const descriptor = openSync(path, "r");
  let contents: string;
  try {
    const opened = lstatSync(path);
    if (!opened.isFile() || opened.isSymbolicLink()) {
      throw new Error("The managed T3 source file must be a regular file.");
    }
    contents = readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error("The managed T3 source file is invalid JSON.");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).sources)
  ) {
    throw new Error("The managed T3 source file has an unsupported format.");
  }
  const sources = (parsed as PersistedDocument).sources.map(
    parsePersistedSource,
  );
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.sourceId)) {
      throw new Error(
        "The managed T3 source file contains duplicate source IDs.",
      );
    }
    ids.add(source.sourceId);
  }
  return sources;
}

function parsePersistedSource(value: unknown): PersistedSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A managed T3 source entry must be an object.");
  }
  const candidate = value as Record<string, unknown>;
  const allowed = new Set([
    "accessToken",
    "baseUrl",
    "label",
    "machineId",
    "sourceId",
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key))) {
    throw new Error("A managed T3 source entry has an unknown field.");
  }
  const sourceId = requiredText(
    String(candidate.sourceId ?? ""),
    "Source ID",
    100,
  );
  if (!SOURCE_ID_PATTERN.test(sourceId)) {
    throw new Error("A managed T3 source ID is invalid.");
  }
  const machineId = requiredText(
    String(candidate.machineId ?? ""),
    "Machine ID",
    200,
  );
  const label =
    candidate.label === undefined
      ? undefined
      : requiredText(String(candidate.label), "Label", 100);
  if (typeof candidate.baseUrl !== "string") {
    throw new Error("A managed T3 endpoint is invalid.");
  }
  const accessToken = normalizeAccessToken(
    typeof candidate.accessToken === "string"
      ? candidate.accessToken
      : undefined,
  );
  if (candidate.accessToken !== undefined && accessToken === undefined) {
    throw new Error("A managed T3 token is invalid.");
  }
  return {
    sourceId,
    machineId,
    ...(label === undefined ? {} : { label }),
    baseUrl: normalizeT3SourceBaseUrl(candidate.baseUrl),
    ...(accessToken === undefined ? {} : { accessToken }),
  };
}

function writeManagedSources(
  directory: string,
  sources: readonly PersistedSource[],
): void {
  ensurePrivateDirectory(directory);
  const path = join(directory, MANAGED_FILE_NAME);
  const temporary = join(
    directory,
    `.${MANAGED_FILE_NAME}.${randomUUID()}.tmp`,
  );
  const document: PersistedDocument = {
    schemaVersion: 1,
    sources: [...sources],
  };
  const contents = `${JSON.stringify(document, null, 2)}\n`;
  if (Buffer.byteLength(contents, "utf8") > MAX_MANAGED_FILE_BYTES) {
    throw new Error("The managed T3 source registry is full.");
  }
  try {
    writeFileSync(temporary, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file is absent or already renamed.
    }
    throw error;
  }
}

function ensurePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("The managed T3 directory must be a real directory.");
  }
  chmodSync(directory, 0o700);
}

export function t3ManagedDirectoryForDatabase(
  databasePath: string,
): string | undefined {
  if (databasePath === ":memory:") return undefined;
  return join(dirname(resolve(databasePath)), "t3-connections");
}
