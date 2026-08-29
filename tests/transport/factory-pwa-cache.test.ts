import { describe, expect, test } from "bun:test";

import { createFactoryServer } from "../../src/server";

describe("Factory PWA cache policy", () => {
  test("marks the shell, worker, and manifest for revalidation", async () => {
    const server = createFactoryServer({ databasePath: ":memory:", port: 0 });

    try {
      for (const path of [
        "/",
        "/projects/project-1",
        "/main.js",
        "/main.css",
        "/service-worker.js",
        "/manifest.webmanifest",
      ]) {
        const response = await fetch(new URL(path, server.url));

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
      }
    } finally {
      server.stop();
    }
  });
});
