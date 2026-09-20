import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createFactoryApplication } from "../../src/application";
import { createMachineCredentialStore } from "../../src/machine-credential";
import { createFactoryServer } from "../../src/server";

const operator = { name: "Kevin", secret: "operator-secret" };
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAABAAAAAQBPJcTWAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC",
  "base64",
).toString("base64");

type TRPCBody = {
  error?: { data?: { code?: string }; message?: string };
  result?: { data?: unknown };
};

async function apiRequest(
  server: { url: URL },
  path: string,
  options: { cookie?: string; token?: string; input?: unknown } = {},
) {
  const response = await fetch(new URL(`/api/${path}`, server.url), {
    ...(options.input === undefined
      ? {}
      : { body: JSON.stringify(options.input), method: "POST" }),
    headers: {
      ...(options.input === undefined
        ? {}
        : { "Content-Type": "application/json" }),
      ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
      ...(options.token === undefined
        ? {}
        : { Authorization: `Bearer ${options.token}` }),
    },
  });
  return {
    body: (await response.json()) as TRPCBody,
    response,
  };
}

async function queryRequest(
  server: { url: URL },
  path: string,
  input: unknown,
  options: { cookie?: string; token?: string },
) {
  const response = await fetch(
    new URL(
      `/api/${path}?input=${encodeURIComponent(JSON.stringify(input))}`,
      server.url,
    ),
    {
      headers: {
        ...(options.cookie === undefined ? {} : { Cookie: options.cookie }),
        ...(options.token === undefined
          ? {}
          : { Authorization: `Bearer ${options.token}` }),
      },
    },
  );
  return {
    body: (await response.json()) as TRPCBody,
    response,
  };
}

describe("screenshot evidence API", () => {
  test("uploads once for a retried request, serves metadata and bytes, and enforces Project scope", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-screenshot-api-"));
    const databasePath = join(directory, "factory.sqlite");
    const application = createFactoryApplication({ databasePath });
    const allowed = application.createProject({ name: "Allowed" });
    const denied = application.createProject({ name: "Denied" });
    const allowedTask = application.createTask({
      name: "Allowed task",
      projectId: allowed.id,
    });
    const deniedTask = application.createTask({
      name: "Denied task",
      projectId: denied.id,
    });
    const credentialStore = createMachineCredentialStore({ databasePath });
    const credential = credentialStore.create({
      machineId: "mac-mini",
      projectIds: [allowed.id],
    });
    const server = createFactoryServer({
      databasePath,
      operator,
      port: 0,
    });
    try {
      const login = await fetch(new URL("/session/login", server.url), {
        body: JSON.stringify({ secret: operator.secret }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
      expect(cookie).toBeTruthy();

      const input = {
        caption: "Desktop proof",
        contentType: "image/png",
        dataBase64: PNG,
        requestKey: "screenshot-upload-1",
        taskId: allowedTask.id,
        testedRevision: "6158623",
      };
      const first = await apiRequest(server, "screenshots.upload", {
        cookie,
        input,
      });
      const second = await apiRequest(server, "screenshots.upload", {
        cookie,
        input,
      });
      expect(first.response.status).toBe(200);
      expect(second.response.status).toBe(200);
      const firstEvidence = first.body.result?.data as { id: string };
      const secondEvidence = second.body.result?.data as { id: string };
      expect(secondEvidence.id).toBe(firstEvidence.id);

      const machineUpload = await apiRequest(server, "screenshots.upload", {
        input: {
          caption: "Machine proof",
          contentType: "image/png",
          dataBase64: PNG,
          requestKey: "screenshot-machine-1",
          taskId: allowedTask.id,
        },
        token: credential.token,
      });
      expect(machineUpload.response.status).toBe(200);
      expect(machineUpload.body.result?.data).toEqual(
        expect.objectContaining({
          uploader: "mac-mini",
          uploaderKind: "machine",
        }),
      );

      const listed = await queryRequest(
        server,
        "screenshots.list",
        { taskId: allowedTask.id },
        { token: credential.token },
      );
      expect(listed.response.status).toBe(200);
      expect(listed.body.result?.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            caption: "Desktop proof",
            testedRevision: "6158623",
          }),
          expect.objectContaining({
            caption: "Machine proof",
            uploaderKind: "machine",
          }),
        ]),
      );
      expect(JSON.stringify(listed.body.result?.data)).not.toContain(PNG);

      const fetched = await queryRequest(
        server,
        "screenshots.get",
        { screenshotId: firstEvidence.id },
        { token: credential.token },
      );
      expect(fetched.response.status).toBe(200);
      expect(fetched.body.result?.data).toEqual(
        expect.objectContaining({ dataBase64: PNG }),
      );

      const deniedRead = await queryRequest(
        server,
        "screenshots.list",
        { taskId: deniedTask.id },
        { token: credential.token },
      );
      expect(deniedRead.response.status).toBe(403);
      expect(deniedRead.body.error?.data?.code).toBe("FORBIDDEN");

      const invalid = await apiRequest(server, "screenshots.upload", {
        cookie,
        input: {
          ...input,
          caption: "SVG disguised as PNG",
          dataBase64: Buffer.from("<svg />").toString("base64"),
          requestKey: "screenshot-upload-2",
        },
      });
      expect(invalid.response.status).toBe(400);
      expect(
        application.listScreenshotEvidence({ taskId: allowedTask.id }),
      ).toHaveLength(2);
      expect(application.getTaskStatus(allowedTask.id).taskState).toBe(
        "planned",
      );

      await server.stop();
      const restartedServer = createFactoryServer({
        databasePath,
        operator,
        port: 0,
      });
      try {
        const afterRestart = await queryRequest(
          restartedServer,
          "screenshots.get",
          { screenshotId: firstEvidence.id },
          { token: credential.token },
        );
        expect(afterRestart.response.status).toBe(200);
        expect(afterRestart.body.result?.data).toEqual(
          expect.objectContaining({ dataBase64: PNG }),
        );
      } finally {
        await restartedServer.stop();
      }
    } finally {
      await server.stop();
      credentialStore.close();
      application.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
