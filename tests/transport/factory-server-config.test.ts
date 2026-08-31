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

  test.each(["", "0", "3000.5", "65536", "not-a-port"])(
    "rejects invalid port %p",
    (configuredPort) => {
      expect(() =>
        getFactoryServerOptions({ FACTORY_PORT: configuredPort }),
      ).toThrow("FACTORY_PORT must be an integer from 1 through 65535");
    },
  );
});
