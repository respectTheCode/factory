import { Buffer } from "node:buffer";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;
export const MAX_GITHUB_TOKEN_BYTES = 16 * 1024;
export const MAX_REVISION_BYTES = 256;

export type FactoryEnvironment = "development" | "pilot" | "production";

export function resolveFactoryEnvironment(
  environment: Record<string, string | undefined>,
): FactoryEnvironment {
  const configured = environment.FACTORY_ENVIRONMENT?.trim();
  if (!configured) return "development";
  if (
    configured !== "development" &&
    configured !== "pilot" &&
    configured !== "production"
  ) {
    throw new Error(
      `FACTORY_ENVIRONMENT must be one of development, pilot, or production; received ${JSON.stringify(configured)}.`,
    );
  }
  return configured;
}

export function resolveRequireExistingDatabase(
  environment: Record<string, string | undefined>,
): boolean {
  const configured = environment.FACTORY_REQUIRE_EXISTING_DB?.trim();
  if (!configured) return false;
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error(
    `FACTORY_REQUIRE_EXISTING_DB must be true or false; received ${JSON.stringify(configured)}.`,
  );
}

export function resolveShutdownTimeout(
  environment: Record<string, string | undefined>,
): number {
  const configured = environment.FACTORY_SHUTDOWN_TIMEOUT_MS?.trim();
  if (!configured) return DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const timeoutMs = Number(configured);
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000 ||
    String(timeoutMs) !== configured
  ) {
    throw new Error(
      `FACTORY_SHUTDOWN_TIMEOUT_MS must be an integer from 100 through 60000; received ${JSON.stringify(configured)}.`,
    );
  }
  return timeoutMs;
}

export function resolveRevision(
  environment: Record<string, string | undefined>,
): string | undefined {
  const explicit = environment.FACTORY_REVISION?.trim();
  if (explicit) return explicit;

  const configuredFile = environment.FACTORY_REVISION_FILE?.trim();
  if (!configuredFile) return undefined;
  if (!isAbsolute(configuredFile)) {
    throw new Error("FACTORY_REVISION_FILE must be an absolute path.");
  }

  let descriptor: number | undefined;
  try {
    descriptor = openSync(configuredFile, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > MAX_REVISION_BYTES
    ) {
      throw new Error("invalid file");
    }
    const buffer = Buffer.alloc(MAX_REVISION_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) throw new Error("invalid file");
    const revision = buffer.toString("utf8", 0, bytesRead).trim();
    if (
      !revision ||
      revision.length > 100 ||
      (!/^[0-9a-f]{40}$/i.test(revision) &&
        !/^[A-Za-z0-9._-]{1,100}$/.test(revision))
    ) {
      throw new Error("invalid revision");
    }
    return revision;
  } catch {
    throw new Error(
      `FACTORY_REVISION_FILE must be a readable file containing a 40-character commit hash or a safe build label: ${configuredFile}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Resolve an optional server-side GitHub token. A mounted file is authoritative
 * when configured, and malformed or missing files fail startup explicitly.
 */
export function resolveGitHubToken(
  environment: Record<string, string | undefined>,
): string | undefined {
  const configuredFile = environment.GITHUB_TOKEN_FILE?.trim();
  if (configuredFile) {
    if (!isAbsolute(configuredFile)) {
      throw new Error("GITHUB_TOKEN_FILE must be an absolute path.");
    }
    return readGitHubTokenFile(configuredFile);
  }

  const inline = environment.GITHUB_TOKEN || environment.GH_TOKEN;
  return inline?.trim() || undefined;
}

function readGitHubTokenFile(path: string): string {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > MAX_GITHUB_TOKEN_BYTES
    ) {
      throw new Error("invalid file");
    }

    const buffer = Buffer.alloc(MAX_GITHUB_TOKEN_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) throw new Error("invalid file");

    const token = buffer.toString("utf8", 0, bytesRead).trim();
    if (!token || !/^[\x21-\x7e]+$/.test(token)) {
      throw new Error("invalid token");
    }
    return token;
  } catch {
    throw new Error(
      `GITHUB_TOKEN_FILE must be a readable non-empty file of at most ${MAX_GITHUB_TOKEN_BYTES} bytes: ${path}`,
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation exceeded ${timeoutMs}ms shutdown timeout.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
