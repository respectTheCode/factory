import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  FACTORY_IDEMPOTENCY_RETENTION_MS,
  canonicalPayloadDigest,
  createIdempotencyStore,
} from "../../src/idempotency";

describe("Factory idempotency store", () => {
  test("canonicalizes payloads, purges old receipts on insert, and persists", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-idempotency-store-"));
    const databasePath = join(directory, "factory.sqlite");
    const now = new Date("2026-09-13T12:00:00.000Z");
    const store = createIdempotencyStore({
      clock: () => now,
      databasePath,
    });

    try {
      expect(canonicalPayloadDigest({ a: 1, b: [2, 3] })).toBe(
        canonicalPayloadDigest({ b: [2, 3], a: 1 }),
      );
      store.put({
        createdAt: new Date(
          now.getTime() - FACTORY_IDEMPOTENCY_RETENTION_MS - 1,
        ).toISOString(),
        payloadDigest: "old-digest",
        requestKey: "old-key-1",
        response: '{"id":"old"}',
        scope: "machine-old",
      });
      store.put({
        createdAt: now.toISOString(),
        payloadDigest: "new-digest",
        requestKey: "new-key-1",
        response: '{"id":"new"}',
        scope: "machine-new",
      });

      expect(store.get("machine-old", "old-key-1")).toBeNull();
      expect(store.get("machine-new", "new-key-1")).toMatchObject({
        payloadDigest: "new-digest",
      });
    } finally {
      store.close();
    }

    const reopened = createIdempotencyStore({ databasePath });
    try {
      expect(reopened.get("machine-new", "new-key-1")).toMatchObject({
        response: '{"id":"new"}',
      });
    } finally {
      reopened.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
