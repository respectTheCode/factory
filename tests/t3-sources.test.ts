import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  createLegacyT3SourceFromToken,
  normalizeT3SourceBaseUrl,
  readT3SourceConfigFile,
  resolveT3Sources,
} from "../src/t3-sources";

describe("T3 source configuration", () => {
  test("keeps legacy environment URL compatibility while managed URLs stay strict", () => {
    const legacy = createLegacyT3SourceFromToken(
      {
        accessTokenFile: "<legacy-server-config>",
        baseUrl: "http://localhost:3773/",
        machineId: "mac-mini",
        sourceId: "legacy",
      },
      "legacy-token",
    );
    expect(legacy.baseUrl).toBe("http://localhost:3773");
    expect(() => normalizeT3SourceBaseUrl("http://localhost:3773")).toThrow();
    expect(JSON.stringify(legacy)).not.toContain("legacy-token");
  });

  test("loads a strict registry without returning credentials", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-t3-sources-"));
    const tokenA = join(directory, "a-token");
    const tokenB = join(directory, "b-token");
    const registry = join(directory, "sources.json");
    writeFileSync(tokenA, "token-a\n", { mode: 0o600 });
    writeFileSync(tokenB, "token-b\n", { mode: 0o600 });
    writeFileSync(
      registry,
      JSON.stringify([
        {
          accessTokenFile: tokenA,
          baseUrl: "http://127.0.0.1:3773/",
          label: "Mac",
          machineId: "mac-mini",
          sourceId: "legacy",
        },
        {
          accessTokenFile: tokenB,
          baseUrl: "http://192.168.6.51:3773",
          label: "Ubuntu",
          machineId: "agent-ubuntu",
          sourceId: "ubuntu",
        },
      ]),
    );
    try {
      const sources = resolveT3Sources({ FACTORY_T3_SOURCES_FILE: registry });
      expect(
        sources.map(({ sourceId, machineId, label }) => ({
          sourceId,
          machineId,
          label,
        })),
      ).toEqual([
        { label: "Mac", machineId: "mac-mini", sourceId: "legacy" },
        { label: "Ubuntu", machineId: "agent-ubuntu", sourceId: "ubuntu" },
      ]);
      expect(JSON.stringify(sources)).not.toContain("token-a");
      expect(JSON.stringify(sources)).not.toContain("token-b");
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("keeps an unreadable source available for per-source failure reporting", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-t3-source-failure-"));
    const registry = join(directory, "sources.json");
    writeFileSync(
      registry,
      JSON.stringify([
        {
          accessTokenFile: join(directory, "missing-token"),
          baseUrl: "http://127.0.0.1:3773",
          machineId: "mac-mini",
          sourceId: "legacy",
        },
      ]),
    );
    try {
      expect(
        resolveT3Sources({ FACTORY_T3_SOURCES_FILE: registry }),
      ).toHaveLength(1);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test.each([
    "http://factory.example:3773",
    "http://factory.home.arpa:3773",
    "http://8.8.8.8:3773",
    "https://user:pass@factory.example:3773",
    "https://factory.example:3773?token=secret",
  ])("rejects unsafe source URL %s", (url) => {
    expect(() => normalizeT3SourceBaseUrl(url)).toThrow();
  });

  test("rejects duplicate source IDs and duplicate backends", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "factory-t3-source-duplicates-"),
    );
    const token = join(directory, "token");
    const registry = join(directory, "sources.json");
    writeFileSync(token, "token\n", { mode: 0o600 });
    try {
      for (const entries of [
        [
          {
            accessTokenFile: token,
            baseUrl: "https://t3-a.example",
            machineId: "a",
            sourceId: "same",
          },
          {
            accessTokenFile: token,
            baseUrl: "https://t3-b.example",
            machineId: "b",
            sourceId: "same",
          },
        ],
        [
          {
            accessTokenFile: token,
            baseUrl: "https://t3.example/",
            machineId: "a",
            sourceId: "a",
          },
          {
            accessTokenFile: token,
            baseUrl: "https://t3.example",
            machineId: "b",
            sourceId: "b",
          },
        ],
      ]) {
        writeFileSync(registry, JSON.stringify(entries));
        expect(() => readT3SourceConfigFile(registry)).toThrow();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("rejects an empty registry instead of falling back to legacy T3", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-t3-source-empty-"));
    const registry = join(directory, "sources.json");
    writeFileSync(registry, "[]");
    try {
      expect(() => readT3SourceConfigFile(registry)).toThrow(
        "at least one T3 source",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
