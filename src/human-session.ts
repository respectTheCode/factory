import { Buffer } from "node:buffer";
import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { Database } from "bun:sqlite";

export const HUMAN_SESSION_COOKIE = "factory_session";
export const HUMAN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_OPERATOR_SECRET_BYTES = 16 * 1024;

export type FactoryOperator = {
  name: string;
  secret: string;
};

export type HumanIdentity = {
  name: string;
};

export type HumanSessionStore = {
  create: (name: string) => string;
  get: (token: string | undefined) => HumanIdentity | null;
  delete: (token: string | undefined) => void;
  invalidateAll: () => void;
  close: () => void;
};

export function createHumanSessionStore({
  clock = () => new Date(),
  databasePath,
}: {
  clock?: () => Date;
  databasePath: string;
}): HumanSessionStore {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS factory_sessions (
      token_hash TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);

  return {
    create(name) {
      const token = randomBytes(32).toString("base64url");
      const createdAt = clock();
      const expiresAt = new Date(createdAt.getTime() + HUMAN_SESSION_TTL_MS);
      database
        .query("DELETE FROM factory_sessions WHERE expires_at <= $expiresAt")
        .run({ $expiresAt: createdAt.toISOString() });
      database
        .query(
          "INSERT INTO factory_sessions (token_hash, name, created_at, expires_at) VALUES ($tokenHash, $name, $createdAt, $expiresAt)",
        )
        .run({
          $createdAt: createdAt.toISOString(),
          $expiresAt: expiresAt.toISOString(),
          $name: name,
          $tokenHash: hashValue(token),
        });
      return token;
    },

    get(token) {
      if (!token) return null;

      const row = database
        .query(
          "SELECT name, expires_at AS expiresAt FROM factory_sessions WHERE token_hash = $tokenHash",
        )
        .get({ $tokenHash: hashValue(token) }) as {
        name: string;
        expiresAt: string;
      } | null;
      if (!row) return null;

      const now = clock();
      if (
        !Number.isFinite(Date.parse(row.expiresAt)) ||
        Date.parse(row.expiresAt) <= now.getTime()
      ) {
        database
          .query("DELETE FROM factory_sessions WHERE token_hash = $tokenHash")
          .run({ $tokenHash: hashValue(token) });
        return null;
      }

      return { name: row.name };
    },

    delete(token) {
      if (!token) return;
      database
        .query("DELETE FROM factory_sessions WHERE token_hash = $tokenHash")
        .run({ $tokenHash: hashValue(token) });
    },

    invalidateAll() {
      database.exec("DELETE FROM factory_sessions");
    },

    close() {
      database.close();
    },
  };
}

export function getHumanSessionToken(
  cookieHeader: string | string[] | undefined,
): string | undefined {
  const cookie = Array.isArray(cookieHeader)
    ? cookieHeader.join(";")
    : cookieHeader;
  if (!cookie) return undefined;

  for (const part of cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== HUMAN_SESSION_COOKIE) continue;
    return part.slice(separator + 1).trim() || undefined;
  }
  return undefined;
}

export function resolveFactoryOperator(
  environment: Record<string, string | undefined>,
): FactoryOperator | undefined {
  const name = environment.FACTORY_OPERATOR_NAME?.trim();
  const secretFile = environment.FACTORY_OPERATOR_SECRET_FILE?.trim();
  if (!name && !secretFile) return undefined;

  // Verification is the human's only path, so a half-configured operator must
  // stop startup instead of silently disabling verification.
  if (!name || !secretFile) {
    throw new Error(
      "FACTORY_OPERATOR_NAME and FACTORY_OPERATOR_SECRET_FILE must be set together.",
    );
  }
  if (!isAbsolute(secretFile)) {
    throw new Error("FACTORY_OPERATOR_SECRET_FILE must be an absolute path.");
  }

  const secret = readSecretFile(secretFile);
  if (!secret) {
    throw new Error(
      `FACTORY_OPERATOR_SECRET_FILE must be a readable non-empty file of at most ${MAX_OPERATOR_SECRET_BYTES} bytes: ${secretFile}`,
    );
  }
  return { name, secret };
}

export function secretsMatch(provided: string, configured: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const configuredDigest = createHash("sha256").update(configured).digest();
  return timingSafeEqual(providedDigest, configuredDigest);
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readSecretFile(path: string): string | undefined {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, "r");
    const metadata = fstatSync(descriptor);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size > MAX_OPERATOR_SECRET_BYTES
    ) {
      return undefined;
    }

    const buffer = Buffer.alloc(MAX_OPERATOR_SECRET_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead !== metadata.size) return undefined;
    const secret = buffer.toString("utf8", 0, bytesRead).trim();
    return secret || undefined;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
