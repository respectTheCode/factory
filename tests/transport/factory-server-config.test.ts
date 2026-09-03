import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { getFactoryServerOptions } from "../../src/server";

describe("Factory server configuration", () => {
  test("keeps the established local defaults", () => {
    expect(getFactoryServerOptions({})).toEqual({
      databasePath: "factory.sqlite",
      hostname: "127.0.0.1",
      port: 3000,
    });
  });

  test("accepts explicit service and development settings", () => {
    expect(
      getFactoryServerOptions({
        FACTORY_DB: "/tmp/factory-dev.sqlite",
        FACTORY_HOST: "0.0.0.0",
        FACTORY_PORT: "3001",
      }),
    ).toEqual({
      databasePath: "/tmp/factory-dev.sqlite",
      hostname: "0.0.0.0",
      port: 3001,
    });
  });

  test("passes a private GitHub token to the server without changing defaults", () => {
    expect(
      getFactoryServerOptions({
        FACTORY_PORT: "3001",
        GH_TOKEN: "server-only-token",
      }),
    ).toMatchObject({
      githubToken: "server-only-token",
      port: 3001,
    });
  });

  test("normalizes the optional T3 read-only configuration", () => {
    expect(
      getFactoryServerOptions({
        T3_ACCESS_TOKEN: "fixture-t3-access-token",
        T3_BASE_URL: "http://127.0.0.1:3773/",
        T3_TIMEOUT_MS: "7500",
      }),
    ).toMatchObject({
      t3AccessToken: "fixture-t3-access-token",
      t3BaseUrl: "http://127.0.0.1:3773",
      t3TimeoutMs: 7500,
    });
  });

  test("loads the T3 token from the configured secret file", () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-server-config-"));
    const tokenFile = join(directory, "t3-read-token");

    try {
      writeFileSync(tokenFile, "file-backed-server-token\n", { mode: 0o600 });

      expect(
        getFactoryServerOptions({
          T3_ACCESS_TOKEN: "inline-token-must-not-win",
          T3_ACCESS_TOKEN_FILE: tokenFile,
          T3_BASE_URL: "http://127.0.0.1:3773",
        }),
      ).toMatchObject({
        t3AccessToken: "file-backed-server-token",
        t3BaseUrl: "http://127.0.0.1:3773",
      });
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  test.each([
    "file:///tmp/t3",
    "http://user:password@127.0.0.1:3773",
    "http://127.0.0.1:3773?token=fixture",
    "http://127.0.0.1:3773#token=fixture",
  ])("rejects unsafe T3 base URL %p", (baseUrl) => {
    expect(() => getFactoryServerOptions({ T3_BASE_URL: baseUrl })).toThrow(
      "T3_BASE_URL must be an absolute http:// or https:// URL",
    );
  });

  test.each(["249", "60001", "1.5", "not-a-timeout"])(
    "rejects invalid T3 timeout %p",
    (timeout) => {
      expect(() => getFactoryServerOptions({ T3_TIMEOUT_MS: timeout })).toThrow(
        "T3_TIMEOUT_MS must be an integer from 250 through 60000",
      );
    },
  );

  test.each(["", "0", "3000.5", "65536", "not-a-port"])(
    "rejects invalid port %p",
    (configuredPort) => {
      expect(() =>
        getFactoryServerOptions({ FACTORY_PORT: configuredPort }),
      ).toThrow("FACTORY_PORT must be an integer from 1 through 65535");
    },
  );
});
