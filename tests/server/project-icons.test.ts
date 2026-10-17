import { mkdtempSync, rmSync } from "node:fs";
import { createTRPCProxyClient, httpLink } from "@trpc/client";
import { expect, test } from "bun:test";
import { createFactoryApplication } from "../../src/application";
import { createFactoryServer, type FactoryRouter } from "../../src/server";
import { createMachineCredentialStore } from "../../src/machine-credential";
import type { T3ActivityReader } from "../../src/t3";

test("serves mapped T3 icon metadata locally and shares lazy favicon reads", async () => {
  const dir = mkdtempSync("/tmp/factory-project-icons-");
  const databasePath = dir + "/factory.sqlite";
  const app = createFactoryApplication({ databasePath });
  const project = app.createProject({
    name: "Icons",
    t3Mappings: [
      {
        sourceId: "icons",
        t3ProjectId: "t3-icons",
        workspaceRoot: "/work/icons",
      },
    ],
  });
  app.close();
  const credentials = createMachineCredentialStore({ databasePath });
  const unauthorized = credentials.create({
    machineId: "mini",
    projectIds: ["other-project"],
  });
  credentials.close();
  let shells = 0;
  let assets = 0;
  const now = new Date().toISOString();
  const reader: T3ActivityReader = {
    async readShell() {
      shells++;
      return {
        ok: true,
        status: "ok",
        fetchedAt: now,
        sourceSequence: 1,
        sourceStream: "shell",
        sourceUpdatedAt: now,
        sourceDigest: "icons",
        threads: [],
        projects: [
          {
            id: "t3-icons",
            title: "Icons",
            workspaceRoot: "/work/icons",
            createdAt: now,
            updatedAt: now,
            faviconPath: "icon.svg",
          },
        ],
      };
    },
    async readThread() {
      throw new Error("not used");
    },
    async readProjectFavicon(input) {
      assets++;
      expect(input.workspaceRoot).toBe("/work/icons");
      return {
        mimeType: "image/svg+xml",
        data: Buffer.from("<svg/>").toString("base64"),
      };
    },
  };
  const server = createFactoryServer({
    databasePath,
    port: 0,
    operator: { name: "test", secret: "test-only-secret" },
    t3Sources: [
      {
        sourceId: "icons",
        machineId: "mini",
        baseUrl: "http://127.0.0.1:3773",
        accessTokenFile: "unused-test-token",
        reader,
      },
    ],
  });
  try {
    const login = await fetch(new URL("/session/login", server.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: "test-only-secret" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const client = createTRPCProxyClient<FactoryRouter>({
      links: [
        httpLink({
          url: new URL("/api", server.url).href,
          headers: { cookie },
        }),
      ],
    });
    let projects = await client.projects.list.query();
    const deadline = Date.now() + 2000;
    while (!projects[0]?.t3FaviconAvailable && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      projects = await client.projects.list.query();
    }
    expect(projects.find((p) => p.id === project.id)?.t3FaviconAvailable).toBe(
      true,
    );
    expect(assets).toBe(0);
    const restricted = createTRPCProxyClient<FactoryRouter>({
      links: [
        httpLink({
          url: new URL("/api", server.url).href,
          headers: { Authorization: `Bearer ${unauthorized.token}` },
        }),
      ],
    });
    await expect(
      restricted.projects.favicon.query({ projectId: project.id }),
    ).rejects.toThrow("not scoped to this Project");
    expect(assets).toBe(0);
    const reads = shells;
    await client.projects.list.query();
    expect(shells).toBe(reads);
    const values = await Promise.all([
      client.projects.favicon.query({ projectId: project.id }),
      client.projects.favicon.query({ projectId: project.id }),
    ]);
    expect(values[0]?.mimeType).toBe("image/svg+xml");
    expect(values[1]).toEqual(values[0]);
    expect(assets).toBe(1);
    expect(
      await client.projects.favicon.query({ projectId: "unknown" }),
    ).toBeNull();
  } finally {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
