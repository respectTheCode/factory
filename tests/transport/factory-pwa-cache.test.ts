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
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/apple-touch-icon.png",
        "/fonts/ibm-plex-sans-latin-400-normal.woff2",
        "/fonts/ibm-plex-sans-latin-500-normal.woff2",
        "/fonts/ibm-plex-sans-latin-600-normal.woff2",
        "/fonts/ibm-plex-sans-latin-700-normal.woff2",
        "/fonts/ibm-plex-mono-latin-400-normal.woff2",
        "/fonts/ibm-plex-mono-latin-500-normal.woff2",
        "/fonts/ibm-plex-mono-latin-600-normal.woff2",
      ]) {
        const response = await fetch(new URL(path, server.url));

        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-cache");
      }
    } finally {
      server.stop();
    }
  });

  test("serves the Ledger PWA metadata and bundled font assets", async () => {
    const server = createFactoryServer({ databasePath: ":memory:", port: 0 });

    try {
      const shell = await fetch(new URL("/", server.url));
      const shellMarkup = await shell.text();
      expect(shellMarkup).toContain('content="#141210"');
      expect(shellMarkup).toContain(
        "/fonts/ibm-plex-sans-latin-400-normal.woff2?v=20",
      );
      expect(shellMarkup).toContain("apple-touch-icon");
      expect(shellMarkup).toContain("/icons/apple-touch-icon.png?v=20");

      const manifestResponse = await fetch(
        new URL("/manifest.webmanifest", server.url),
      );
      const manifest = (await manifestResponse.json()) as Record<
        string,
        unknown
      >;
      expect(manifest.background_color).toBe("#141210");
      expect(manifest.theme_color).toBe("#141210");
      expect(manifest.icons).toEqual([
        {
          purpose: "any",
          sizes: "any",
          src: "/icon.svg",
          type: "image/svg+xml",
        },
        {
          purpose: "maskable",
          sizes: "192x192",
          src: "/icons/icon-192.png",
          type: "image/png",
        },
        {
          purpose: "maskable",
          sizes: "512x512",
          src: "/icons/icon-512.png",
          type: "image/png",
        },
      ]);
    } finally {
      server.stop();
    }
  });

  test("keeps the document asset version aligned with the service-worker shell", async () => {
    const server = createFactoryServer({ databasePath: ":memory:", port: 0 });

    try {
      const [shellMarkup, workerSource] = await Promise.all([
        fetch(new URL("/", server.url)).then((response) => response.text()),
        fetch(new URL("/service-worker.js", server.url)).then((response) =>
          response.text(),
        ),
      ]);
      const documentVersion = /\/main\.js\?v=(\d+)/.exec(shellMarkup)?.[1];
      const workerVersion = /\/main\.js\?v=(\d+)/.exec(workerSource)?.[1];

      expect(documentVersion).toBeDefined();
      expect(documentVersion).toBe(workerVersion);
    } finally {
      server.stop();
    }
  });
});
