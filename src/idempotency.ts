import { createHash } from "node:crypto";

import { Database } from "bun:sqlite";

export const FACTORY_IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type IdempotencyReceipt = {
  scope: string;
  requestKey: string;
  payloadDigest: string;
  response: string;
  createdAt: string;
};

export type IdempotencyStore = {
  get: (scope: string, requestKey: string) => IdempotencyReceipt | null;
  purgeExpired: () => void;
  put: (receipt: IdempotencyReceipt) => void;
  close: () => void;
};

export function createIdempotencyStore({
  clock = () => new Date(),
  databasePath,
}: {
  clock?: () => Date;
  databasePath: string;
}): IdempotencyStore {
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE IF NOT EXISTS factory_idempotency_receipts (
      scope TEXT NOT NULL,
      request_key TEXT NOT NULL,
      payload_digest TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (scope, request_key)
    )
  `);

  const purgeExpired = (): void => {
    const cutoff = new Date(
      clock().getTime() - FACTORY_IDEMPOTENCY_RETENTION_MS,
    ).toISOString();
    database
      .query(
        "DELETE FROM factory_idempotency_receipts WHERE created_at <= $cutoff",
      )
      .run({ $cutoff: cutoff });
  };

  return {
    get(scope, requestKey) {
      const row = database
        .query(
          `SELECT scope, request_key AS requestKey,
                  payload_digest AS payloadDigest, response,
                  created_at AS createdAt
             FROM factory_idempotency_receipts
            WHERE scope = $scope AND request_key = $requestKey`,
        )
        .get({
          $requestKey: requestKey,
          $scope: scope,
        }) as IdempotencyReceipt | null;
      return row;
    },

    purgeExpired,

    put(receipt) {
      purgeExpired();
      database
        .query(
          `INSERT INTO factory_idempotency_receipts
             (scope, request_key, payload_digest, response, created_at)
           VALUES ($scope, $requestKey, $payloadDigest, $response, $createdAt)`,
        )
        .run({
          $createdAt: receipt.createdAt,
          $payloadDigest: receipt.payloadDigest,
          $requestKey: receipt.requestKey,
          $response: receipt.response,
          $scope: receipt.scope,
        });
    },

    close() {
      database.close();
    },
  };
}

export function canonicalPayloadDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalize(record[key])]),
  );
}
