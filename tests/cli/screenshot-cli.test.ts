import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFactoryApplication } from "../../src/application";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAABAAAAAQBPJcTWAAAADElEQVR4nGP8x8AAAAMCAQBFsWYPAAAAAElFTkSuQmCC",
  "base64",
);

async function runCli(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, "run", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, "../.."),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

describe("screenshot CLI reads", () => {
  test("bounds metadata list reads and requires an explicit output for bytes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-cli-screenshot-"));
    const databasePath = join(directory, "factory.sqlite");
    const sourcePath = join(directory, "proof.png");
    const outputPath = join(directory, "downloaded.png");
    writeFileSync(sourcePath, PNG);
    const application = createFactoryApplication({ databasePath });
    const project = application.createProject({ name: "Screenshot CLI" });
    const task = application.createTask({
      name: "Screenshot task",
      projectId: project.id,
    });
    application.close();

    try {
      for (const caption of ["First proof", "Second proof"]) {
        const uploaded = await runCli([
          "screenshot",
          "upload",
          "--task-id",
          task.simpleId ?? task.id,
          "--file",
          sourcePath,
          "--content-type",
          "image/png",
          "--caption",
          caption,
          "--database",
          databasePath,
        ]);
        expect(uploaded.exitCode).toBe(0);
      }

      const first = await runCli([
        "screenshot",
        "list",
        "--task-id",
        task.simpleId ?? task.id,
        "--limit",
        "1",
        "--database",
        databasePath,
      ]);
      expect(first.exitCode).toBe(0);
      expect(first.stderr).toContain("screenshot evidence output truncated");
      const firstPayload = JSON.parse(first.stdout) as {
        screenshots: Array<{ dataBase64?: string; id: string }>;
        nextCursor: string;
        totalCount: number;
        truncated: boolean;
      };
      expect(firstPayload.screenshots).toHaveLength(1);
      expect(firstPayload.screenshots[0]).not.toHaveProperty("dataBase64");
      expect(firstPayload.truncated).toBe(true);
      expect(firstPayload.totalCount).toBe(2);
      expect(firstPayload.nextCursor).toEqual(expect.any(String));

      const second = await runCli([
        "screenshot",
        "list",
        "--task-id",
        task.simpleId ?? task.id,
        "--limit",
        "1",
        "--cursor",
        firstPayload.nextCursor,
        "--database",
        databasePath,
      ]);
      expect(second.exitCode).toBe(0);
      const secondPayload = JSON.parse(second.stdout) as {
        screenshots: Array<{ id: string }>;
        nextCursor: null;
        truncated: boolean;
      };
      expect(secondPayload.screenshots).toHaveLength(1);
      expect(secondPayload.screenshots[0]!.id).not.toBe(
        firstPayload.screenshots[0]!.id,
      );
      expect(secondPayload.truncated).toBe(false);
      expect(secondPayload.nextCursor).toBeNull();

      const metadata = await runCli([
        "screenshot",
        "get",
        "--screenshot-id",
        firstPayload.screenshots[0]!.id,
        "--database",
        databasePath,
      ]);
      expect(metadata.exitCode).toBe(0);
      const metadataPayload = JSON.parse(metadata.stdout) as {
        screenshot: { dataBase64?: string; id: string; sizeBytes: number };
      };
      expect(metadataPayload.screenshot.id).toBe(
        firstPayload.screenshots[0]!.id,
      );
      expect(metadataPayload.screenshot.sizeBytes).toBe(PNG.length);
      expect(metadataPayload.screenshot).not.toHaveProperty("dataBase64");

      const downloaded = await runCli([
        "screenshot",
        "get",
        "--screenshot-id",
        firstPayload.screenshots[0]!.id,
        "--output",
        outputPath,
        "--database",
        databasePath,
      ]);
      expect(downloaded.exitCode).toBe(0);
      expect(readFileSync(outputPath)).toEqual(PNG);
      expect(downloaded.stdout).toContain(outputPath);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
