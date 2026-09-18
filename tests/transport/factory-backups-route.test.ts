import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";

describe("Factory backup document routes", () => {
  test("serves the SPA shell for direct and trailing-slash backup navigations", async () => {
    const server = createFactoryServer({ databasePath: ":memory:", port: 0 });

    try {
      const shell = await fetch(new URL("/", server.url));
      const shellMarkup = await shell.text();
      expect(shell.status).toBe(200);

      for (const pathname of ["/backups", "/backups/"]) {
        const response = await fetch(new URL(pathname, server.url));

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
        expect(await response.text()).toBe(shellMarkup);
      }
    } finally {
      await server.stop();
    }
  });
});
