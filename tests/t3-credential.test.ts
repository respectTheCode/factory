import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  MAX_T3_ACCESS_TOKEN_BYTES,
  resolveT3AccessToken,
} from "../src/t3-credential";

describe("T3 credential resolution", () => {
  test("reads a bounded token from an operator-managed file", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-t3-credential-"));
    const tokenFile = join(directory, "t3-read-token");

    try {
      writeFileSync(tokenFile, "file-backed-token\n", { mode: 0o600 });
      chmodSync(tokenFile, 0o600);

      expect(resolveT3AccessToken({ T3_ACCESS_TOKEN_FILE: tokenFile })).toBe(
        "file-backed-token",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("supports read-only and symlinked container secret mounts", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-t3-credential-"));
    const tokenFile = join(directory, "projected-token");
    const mountedPath = join(directory, "t3-read-token");

    try {
      writeFileSync(tokenFile, "projected-token", { mode: 0o400 });
      chmodSync(tokenFile, 0o400);
      symlinkSync(tokenFile, mountedPath);

      expect(resolveT3AccessToken({ T3_ACCESS_TOKEN_FILE: mountedPath })).toBe(
        "projected-token",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test("uses an inline token only when no file is configured", () => {
    expect(resolveT3AccessToken({ T3_ACCESS_TOKEN: " inline-token " })).toBe(
      "inline-token",
    );
  });

  test("does not fall back when the configured file is unavailable", () => {
    expect(
      resolveT3AccessToken({
        T3_ACCESS_TOKEN: "must-not-be-used",
        T3_ACCESS_TOKEN_FILE: "/path/that/does/not/exist",
      }),
    ).toBeUndefined();
  });

  test("fails closed for a relative secret path", () => {
    expect(
      resolveT3AccessToken({
        T3_ACCESS_TOKEN: "must-not-be-used",
        T3_ACCESS_TOKEN_FILE: "secrets/t3-read-token",
      }),
    ).toBeUndefined();
  });

  test("fails closed for empty, malformed, oversized, and non-regular files", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-t3-credential-"));
    const emptyFile = join(directory, "empty");
    const malformedFile = join(directory, "malformed");
    const nonAsciiFile = join(directory, "non-ascii");
    const oversizedFile = join(directory, "oversized");
    const nestedDirectory = join(directory, "directory");

    try {
      writeFileSync(emptyFile, "", { mode: 0o600 });
      writeFileSync(malformedFile, "token with spaces", { mode: 0o600 });
      writeFileSync(nonAsciiFile, "token-\u0000-value", { mode: 0o600 });
      writeFileSync(oversizedFile, "x".repeat(MAX_T3_ACCESS_TOKEN_BYTES + 1), {
        mode: 0o600,
      });
      mkdirSync(nestedDirectory);

      for (const path of [
        emptyFile,
        malformedFile,
        nonAsciiFile,
        oversizedFile,
        nestedDirectory,
      ]) {
        expect(
          resolveT3AccessToken({ T3_ACCESS_TOKEN_FILE: path }),
        ).toBeUndefined();
      }
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
