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

  test("serves the PWA shell for project routes so reloads can restore the view", async () => {
    const server = createFactoryServer({
      databasePath: ":memory:",
      port: 0,
    });

    try {
      const response = await fetch(new URL("/projects/project-1", server.url));
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Software Factory");
    } finally {
      server.stop();
    }
  });
});
