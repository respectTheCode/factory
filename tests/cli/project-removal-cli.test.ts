import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

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

describe("project removal CLI", () => {
  test("removes the requested project and preserves unrelated projects", async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), "software-factory-project-removal-cli-"),
    );
    const databasePath = join(temporaryDirectory, "factory.sqlite");

    try {
      const first = await runCli([
        "project",
        "create",
        "--name",
        "Keep this",
        "--database",
        databasePath,
      ]);
      const second = await runCli([
        "project",
        "create",
        "--name",
        "Remove this",
        "--database",
        databasePath,
      ]);
      const removed = JSON.parse(second.stdout) as { project: { id: string } };

      const removal = await runCli([
        "project",
        "remove",
        "--project-id",
        removed.project.id,
        "--confirm",
        "--database",
        databasePath,
      ]);

      expect(removal.exitCode).toBe(0);
      expect(JSON.parse(removal.stdout)).toMatchObject({
        schemaVersion: 1,
        removed: { projectId: removed.project.id },
      });

      const listed = await runCli([
        "project",
        "list",
        "--database",
        databasePath,
        "--json",
      ]);
      expect(JSON.parse(listed.stdout)).toMatchObject({
        projects: [JSON.parse(first.stdout).project],
      });
    } finally {
      rmSync(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
