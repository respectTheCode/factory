import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

import {
  createT3ActivityReader,
  normalizeT3BaseUrl,
  type T3ActivityReader,
} from "./t3";
import { resolveT3AccessToken } from "./t3-credential";
import { LEGACY_T3_SOURCE_ID } from "./t3-source-identity";

export { LEGACY_T3_SOURCE_ID } from "./t3-source-identity";

/** The source identity exposed to Factory and the coordinator. */
export type T3SourceConfig = {
  sourceId: string;
  machineId: string;
  label?: string;
  baseUrl: string;
  accessTokenFile: string;
};

/** A server-side source. Credentials are intentionally absent from this type. */
export type T3Source = T3SourceConfig & {
  reader: T3ActivityReader;
  /** Do not infer this config's last success from observations made before it was saved. */
  suppressPersistedLastSuccess?: boolean;
  /** Internal capability used to rebuild this reader for an edited endpoint. */
  [T3_SOURCE_READER_FACTORY]?: (baseUrl: string) => T3ActivityReader;
  /** Internal flag for redacted management summaries. */
  [T3_SOURCE_HAS_TOKEN]?: boolean;
};

/** Not included in JSON; keeps the resolved credential inside the server process. */
export const T3_SOURCE_READER_FACTORY: unique symbol = Symbol(
  "t3-source-reader-factory",
);
export const T3_SOURCE_HAS_TOKEN: unique symbol = Symbol("t3-source-has-token");

export const DEFAULT_T3_MACHINE_ID = "mac-mini";
export const MAX_T3_SOURCES_FILE_BYTES = 256 * 1024;

type SourceEnvironment = Record<string, string | undefined>;

/**
 * Load configured T3 sources. The file is the authoritative multi-source
 * configuration; legacy T3_* variables are used only when the file is absent.
 * Access tokens are resolved here, on the server/CLI process, and never become
 * part of the returned source metadata or an API response.
 */
export function resolveT3Sources(
  environment: SourceEnvironment,
  options: { timeoutMs?: number } = {},
): T3Source[] {
  const configuredFile = environment.FACTORY_T3_SOURCES_FILE?.trim();
  if (configuredFile) {
    const configs = readT3SourceConfigFile(configuredFile);
    return configs.map((config) => createSource(config, options.timeoutMs));
  }

  const hasLegacyConfiguration = Boolean(
    environment.T3_BASE_URL?.trim() ||
    environment.T3_ACCESS_TOKEN?.trim() ||
    environment.T3_ACCESS_TOKEN_FILE?.trim(),
  );
  if (!hasLegacyConfiguration) return [];

  const baseUrl = environment.T3_BASE_URL?.trim()
    ? normalizeT3BaseUrl(environment.T3_BASE_URL)
    : undefined;
  const token = resolveT3AccessToken({
    T3_ACCESS_TOKEN: environment.T3_ACCESS_TOKEN,
    T3_ACCESS_TOKEN_FILE: environment.T3_ACCESS_TOKEN_FILE,
  });
  const source: T3SourceConfig = {
    accessTokenFile:
      environment.T3_ACCESS_TOKEN_FILE?.trim() || "<legacy-inline-token>",
    baseUrl: baseUrl ?? "http://127.0.0.1:3773",
    label: "Legacy T3",
    machineId:
      environment.FACTORY_T3_MACHINE_ID?.trim() || DEFAULT_T3_MACHINE_ID,
    sourceId: LEGACY_T3_SOURCE_ID,
  };
  return [
    {
      ...source,
      reader: createT3ActivityReader({
        baseUrl: source.baseUrl,
        timeoutMs: options.timeoutMs,
        token,
      }),
    },
  ];
}

/** Parse and validate a source configuration without exposing any token. */
export function readT3SourceConfigFile(path: string): T3SourceConfig[] {
  const trimmedPath = path.trim();
  if (!trimmedPath || !isAbsolute(trimmedPath)) {
    throw new Error(
      "FACTORY_T3_SOURCES_FILE must be an absolute path to a readable JSON file.",
    );
  }

  let descriptor: number | undefined;
  let payload: string;
  try {
    descriptor = openSync(trimmedPath, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 2 ||
      metadata.size > MAX_T3_SOURCES_FILE_BYTES
    ) {
      throw new Error("invalid file");
    }
    const buffer = Buffer.alloc(MAX_T3_SOURCES_FILE_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) throw new Error("invalid file");
    payload = buffer.toString("utf8", 0, bytesRead);
  } catch {
    throw new Error(
      `FACTORY_T3_SOURCES_FILE must be a readable JSON file of at most ${MAX_T3_SOURCES_FILE_BYTES} bytes.`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("FACTORY_T3_SOURCES_FILE must contain a JSON array.");
  }
  if (!Array.isArray(value)) {
    throw new Error("FACTORY_T3_SOURCES_FILE must contain a JSON array.");
  }

  const configs = value.map((entry, index) => parseSourceConfig(entry, index));
  if (configs.length === 0) {
    throw new Error(
      "FACTORY_T3_SOURCES_FILE must contain at least one T3 source.",
    );
  }
  const sourceIds = new Set<string>();
  const backends = new Set<string>();
  for (const config of configs) {
    if (sourceIds.has(config.sourceId)) {
      throw new Error(
        `FACTORY_T3_SOURCES_FILE contains duplicate sourceId ${JSON.stringify(config.sourceId)}.`,
      );
    }
    sourceIds.add(config.sourceId);
    if (backends.has(config.baseUrl)) {
      throw new Error(
        `FACTORY_T3_SOURCES_FILE registers the T3 backend ${config.baseUrl} more than once.`,
      );
    }
    backends.add(config.baseUrl);
  }
  return configs;
}

function parseSourceConfig(value: unknown, index: number): T3SourceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`T3 source ${index + 1} must be an object.`);
  }
  const candidate = value as Record<string, unknown>;
  const allowedFields = new Set([
    "accessTokenFile",
    "baseUrl",
    "label",
    "machineId",
    "sourceId",
  ]);
  const unknownField = Object.keys(candidate).find(
    (field) => !allowedFields.has(field),
  );
  if (unknownField) {
    throw new Error(`T3 source ${index + 1} has an unknown field.`);
  }
  const sourceId = requiredField(candidate.sourceId, "sourceId", index);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sourceId)) {
    throw new Error(
      `T3 source ${index + 1} sourceId must start with an alphanumeric character and then use [A-Za-z0-9._-].`,
    );
  }
  const machineId = requiredField(candidate.machineId, "machineId", index);
  const label = optionalField(candidate.label, "label", index);
  const configuredBaseUrl = requiredField(candidate.baseUrl, "baseUrl", index);
  const accessTokenFile = requiredField(
    candidate.accessTokenFile,
    "accessTokenFile",
    index,
  );
  if (!isAbsolute(accessTokenFile)) {
    throw new Error(`T3 source ${index + 1} accessTokenFile must be absolute.`);
  }

  const baseUrl = normalizeT3SourceBaseUrl(configuredBaseUrl);
  return {
    accessTokenFile,
    baseUrl,
    ...(label === undefined ? {} : { label }),
    machineId,
    sourceId,
  };
}

function requiredField(value: unknown, name: string, index: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `T3 source ${index + 1} ${name} must be a non-empty string.`,
    );
  }
  return value.trim();
}

function optionalField(
  value: unknown,
  name: string,
  index: number,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredField(value, name, index);
}

/**
 * Source files use a stricter HTTP rule than the historical single-source
 * variable: cleartext may target only literal loopback or RFC1918 addresses.
 * In particular, a DNS name is never treated as private merely by its suffix.
 */
export function normalizeT3SourceBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(
      "T3 source baseUrl must be an absolute http:// or https:// URL.",
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "T3 source baseUrl must be an absolute http:// or https:// URL without credentials, query, or fragment.",
    );
  }
  if (
    parsed.protocol === "http:" &&
    !isLiteralPrivateHttpHost(parsed.hostname)
  ) {
    throw new Error(
      "T3 source baseUrl may use http:// only with a literal loopback or RFC1918 IP address; use https:// for other hosts.",
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  return parsed.toString().replace(/\/$/, "");
}

function isLiteralPrivateHttpHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::1" || isIpv4(host, (octets) => octets[0] === 127))
    return true;
  if (!isIpv4(host, () => true)) return false;
  const octets = host.split(".").map(Number);
  const first = octets[0] ?? -1;
  const second = octets[1] ?? -1;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isIpv4(
  host: string,
  predicate: (octets: number[]) => boolean,
): boolean {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part)))
    return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  return predicate(octets);
}

export function createT3SourceFromToken(
  config: T3SourceConfig,
  token: string | undefined,
  timeoutMs?: number,
): T3Source {
  const baseUrl = normalizeT3SourceBaseUrl(config.baseUrl);
  const makeReader = (nextBaseUrl: string) =>
    createT3ActivityReader({
      baseUrl: normalizeT3SourceBaseUrl(nextBaseUrl),
      timeoutMs,
      token,
    });
  const source = {
    ...config,
    baseUrl,
    reader: makeReader(baseUrl),
  } as T3Source;
  Object.defineProperty(source, T3_SOURCE_READER_FACTORY, {
    value: makeReader,
  });
  Object.defineProperty(source, T3_SOURCE_HAS_TOKEN, { value: Boolean(token) });
  return source;
}

/** Preserve the looser URL behavior of the historical T3_* environment variables. */
export function createLegacyT3SourceFromToken(
  config: T3SourceConfig,
  token: string | undefined,
  timeoutMs?: number,
): T3Source {
  const makeReader = (baseUrl: string) =>
    createT3ActivityReader({
      baseUrl: normalizeT3BaseUrl(baseUrl),
      timeoutMs,
      token,
    });
  const baseUrl = normalizeT3BaseUrl(config.baseUrl);
  const source = {
    ...config,
    baseUrl,
    reader: makeReader(baseUrl),
  } as T3Source;
  Object.defineProperty(source, T3_SOURCE_READER_FACTORY, {
    value: makeReader,
  });
  Object.defineProperty(source, T3_SOURCE_HAS_TOKEN, { value: Boolean(token) });
  return source;
}

function createSource(config: T3SourceConfig, timeoutMs?: number): T3Source {
  const token = resolveT3AccessToken({
    T3_ACCESS_TOKEN_FILE: config.accessTokenFile,
  });
  return createT3SourceFromToken(config, token, timeoutMs);
}
