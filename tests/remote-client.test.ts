import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  MAX_FACTORY_ACCESS_TOKEN_BYTES,
  resolveFactoryAccessToken,
  validateFactoryUrl,
} from "../src/remote-client";

describe("Factory remote client policy", () => {
  test("allows HTTPS and private LAN HTTP addresses", () => {
    expect(validateFactoryUrl("https://factory.example.com/")).toBe(
      "https://factory.example.com",
    );
    expect(validateFactoryUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
    expect(validateFactoryUrl("http://127.42.0.1:3000")).toBe(
      "http://127.42.0.1:3000",
    );
    expect(validateFactoryUrl("http://[::1]:3000/")).toBe("http://[::1]:3000");
    expect(validateFactoryUrl("http://172.20.0.5:3000")).toBe(
      "http://172.20.0.5:3000",
    );
    expect(validateFactoryUrl("http://factory.home.arpa:3000")).toBe(
      "http://factory.home.arpa:3000",
    );
  });

  test("rejects public cleartext URLs and URL credentials/query state", () => {
    expect(() => validateFactoryUrl("http://factory.example.com:3000")).toThrow(
      "machine tokens travel in the clear",
    );
    expect(() =>
      validateFactoryUrl("https://user:pass@factory.example.com"),
    ).toThrow("credentials");
    expect(() =>
      validateFactoryUrl("https://factory.example.com?token=secret"),
    ).toThrow("query string");
    expect(() =>
      validateFactoryUrl("https://factory.example.com#fragment"),
    ).toThrow("fragment");
  });

  test("reads only an absolute regular token file within the size limit", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-remote-policy-"));
    const tokenPath = join(directory, "token");
    const oversizedPath = join(directory, "oversized");
    try {
      writeFileSync(tokenPath, " fmc_test-token \n", { mode: 0o600 });
      writeFileSync(
        oversizedPath,
        "x".repeat(MAX_FACTORY_ACCESS_TOKEN_BYTES + 1),
      );
      expect(resolveFactoryAccessToken(tokenPath)).toBe("fmc_test-token");
      expect(resolveFactoryAccessToken("relative-token")).toBeUndefined();
      expect(resolveFactoryAccessToken(oversizedPath)).toBeUndefined();
      expect(
        resolveFactoryAccessToken(join(directory, "missing")),
      ).toBeUndefined();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
