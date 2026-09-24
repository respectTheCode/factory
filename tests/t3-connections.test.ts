import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createT3ConnectionStore,
  testT3Connection,
  t3ManagedDirectoryForDatabase,
} from "../src/t3-connections";
import type { T3ActivityReader } from "../src/t3";
import { resolveT3Sources } from "../src/t3-sources";

const token = "t3-read-secret-for-test";

describe("managed T3 connections", () => {
  test("persists a private overlay, redacts its token, and keeps IDs stable on edits", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-t3-connections-"));
    const directory = join(root, "managed");
    try {
      const store = createT3ConnectionStore({
        baseSources: [],
        directory,
      });
      const created = store.save({
        accessToken: token,
        baseUrl: "http://192.168.6.51:3773/",
        label: "New Mac mini",
        machineId: "mac-mini-new",
      });
      const firstReader = store.getSources()[0]?.reader;

      expect(created).toMatchObject({
        baseUrl: "http://192.168.6.51:3773",
        label: "New Mac mini",
        machineId: "mac-mini-new",
        tokenConfigured: true,
      });
      expect(created.sourceId).toMatch(/^t3-/);
      expect(
        JSON.stringify([created, store.list(), store.getSources()]),
      ).not.toContain(token);

      const edited = store.save({
        baseUrl: "http://192.168.6.51:3773",
        label: "Studio Mac mini",
        machineId: "mac-mini-new",
        sourceId: created.sourceId,
      });
      expect(edited.sourceId).toBe(created.sourceId);
      expect(store.getSources()[0]?.reader).toBe(firstReader);

      const changedEndpoint = store.save({
        baseUrl: "http://192.168.6.52:3773",
        label: "Studio Mac mini",
        machineId: "mac-mini-new",
        sourceId: created.sourceId,
      });
      expect(changedEndpoint.sourceId).toBe(created.sourceId);
      expect(store.getSources()[0]?.reader).not.toBe(firstReader);

      const registryPath = join(directory, "managed-sources.json");
      const reloaded = createT3ConnectionStore({
        baseSources: [],
        directory,
      });
      expect(reloaded.list()).toEqual([
        expect.objectContaining({
          baseUrl: "http://192.168.6.52:3773",
          label: "Studio Mac mini",
          machineId: "mac-mini-new",
          sourceId: created.sourceId,
          tokenConfigured: true,
        }),
      ]);
      expect(readFileSync(registryPath, "utf8")).toContain(token);
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      expect(statSync(registryPath).mode & 0o777).toBe(0o600);
      expect(JSON.stringify(reloaded.list())).not.toContain(token);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("requires a token for new sources and preserves a mounted source token on edits", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-t3-mounted-source-"));
    const directory = join(root, "managed");
    try {
      const tokenFile = join(root, "mounted-token");
      const sourcesFile = join(root, "mounted-sources.json");
      writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
      writeFileSync(
        sourcesFile,
        JSON.stringify([
          {
            accessTokenFile: tokenFile,
            baseUrl: "http://192.168.6.51:3773",
            label: "Mac",
            machineId: "mac-mini",
            sourceId: "mac",
          },
        ]),
      );
      const baseSources = resolveT3Sources({
        FACTORY_T3_SOURCES_FILE: sourcesFile,
      });
      const baseReader = baseSources[0]?.reader;
      const store = createT3ConnectionStore({
        baseSources,
        directory,
      });
      expect(() =>
        store.save({
          baseUrl: "http://192.168.6.52:3773",
          label: "No token",
          machineId: "mac-mini-2",
        }),
      ).toThrow("Enter the read-only T3 token when adding a source.");

      const updated = store.save({
        baseUrl: "http://192.168.6.52:3773",
        label: "Mac office",
        machineId: "mac-mini",
        sourceId: "mac",
      });
      expect(updated).toMatchObject({
        sourceId: "mac",
        tokenConfigured: true,
      });
      expect(store.getSources()[0]?.reader).not.toBe(baseReader);
      expect(JSON.stringify(store.list())).not.toContain(tokenFile);
      expect(JSON.stringify(store.list())).not.toContain(token);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("keeps unaffected readers live and leaves disk unchanged after rejected saves", () => {
    const root = mkdtempSync(join(tmpdir(), "factory-t3-save-rollback-"));
    const directory = join(root, "managed");
    try {
      const store = createT3ConnectionStore({ baseSources: [], directory });
      const first = store.save({
        accessToken: "first-secret",
        baseUrl: "http://127.0.0.1:37731",
        label: "Mac one",
        machineId: "mac-one",
      });
      const second = store.save({
        accessToken: "second-secret",
        baseUrl: "http://127.0.0.1:37732",
        label: "Mac two",
        machineId: "mac-two",
      });
      const firstReader = store
        .getSources()
        .find((source) => source.sourceId === first.sourceId)?.reader;
      const secondReader = store
        .getSources()
        .find((source) => source.sourceId === second.sourceId)?.reader;
      const registryPath = join(directory, "managed-sources.json");
      const beforeList = store.list();
      const beforeFile = readFileSync(registryPath, "utf8");

      expect(() =>
        store.save({
          accessToken: "third-secret",
          baseUrl: "http://127.0.0.1:37732",
          label: "Duplicate endpoint",
          machineId: "mac-three",
        }),
      ).toThrow("Each T3 source must use a distinct endpoint.");
      expect(() =>
        store.save({
          accessToken: "third-secret",
          baseUrl: "http://factory.example:3773",
          label: "Unsafe endpoint",
          machineId: "mac-three",
        }),
      ).toThrow(
        "may use http:// only with a literal loopback or RFC1918 IP address",
      );
      expect(store.list()).toEqual(beforeList);
      expect(readFileSync(registryPath, "utf8")).toBe(beforeFile);

      store.save({
        baseUrl: "http://127.0.0.1:37732",
        label: "Mac two renamed",
        machineId: "mac-two",
        sourceId: second.sourceId,
      });
      expect(
        store.getSources().find((source) => source.sourceId === first.sourceId)
          ?.reader,
      ).toBe(firstReader);
      expect(
        store.getSources().find((source) => source.sourceId === second.sourceId)
          ?.reader,
      ).toBe(secondReader);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("uses the database directory for persistence and skips in-memory databases", () => {
    expect(t3ManagedDirectoryForDatabase(":memory:")).toBeUndefined();
    expect(t3ManagedDirectoryForDatabase("/data/factory.sqlite")).toBe(
      "/data/t3-connections",
    );
  });

  test("returns safe errors from draft connection tests", async () => {
    const reader: T3ActivityReader = {
      readShell: async () => {
        throw new Error(`request failed with ${token}`);
      },
      readThread: async () => ({
        error: "unused",
        fetchedAt: new Date().toISOString(),
        ok: false,
        status: "unavailable",
      }),
    };
    const result = await testT3Connection(
      {
        baseUrl: "http://127.0.0.1:3773",
        machineId: "mac-mini",
        sourceId: "draft",
        tokenConfigured: true,
      },
      reader,
    );
    expect(result).toMatchObject({
      error: "T3 could not be reached. Check the endpoint and LAN access.",
      state: "unreachable",
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
