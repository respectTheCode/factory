import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";

describe("Factory server bind address", () => {
  test("accepts an explicit network bind host", () => {
    const server = createFactoryServer({
      databasePath: ":memory:",
      hostname: "0.0.0.0",
      port: 0,
    });

    try {
      expect(new URL(server.url).hostname).toBe("0.0.0.0");
    } finally {
      server.stop();
    }
  });
});
