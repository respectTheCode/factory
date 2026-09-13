import { describe, expect, test } from "bun:test";

import { join } from "node:path";

import { parseCodexTrustArgs } from "../../src/client";

async function runClient(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "src/client.ts", ...args], {
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

describe("compiled client entry", () => {
  test("prints the API version", async () => {
    const result = await runClient(["--version"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Factory API version: 1");
    expect(result.stdout).toContain("Factory client revision: dev");
  });

  test("parses the Codex hook trust subcommand flags", () => {
    expect(
      parseCodexTrustArgs([
        "hooks",
        "trust-codex",
        "--codex-config",
        "/tmp/codex/config.toml",
        "--dry-run",
        "--json",
      ]),
    ).toEqual({
      codexConfigPath: "/tmp/codex/config.toml",
      dryRun: true,
      json: true,
    });
    expect(() =>
      parseCodexTrustArgs(["hooks", "trust-codex", "--unexpected"]),
    ).toThrow("Unknown or incomplete flag: --unexpected");
  });
});
