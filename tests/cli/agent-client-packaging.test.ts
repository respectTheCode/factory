import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { describe, expect, test } from "bun:test";

const repositoryRoot = join(import.meta.dir, "../..");
const installerPath = join(repositoryRoot, "scripts/install-agent-client.sh");
const builderPath = join(repositoryRoot, "scripts/build-client.sh");

function writeExecutable(path: string, content: string) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

describe("agent client packaging", () => {
  test("installs the CLI and credentials without installing agent reporting", () => {
    const fixture = mkdtempSync(join(tmpdir(), "factory-agent-installer-"));
    const home = join(fixture, "home");
    const prefix = join(fixture, "prefix");
    const binarySource = join(fixture, "source/factory");
    const tokenFile = join(fixture, "input-token");
    const callLog = join(fixture, "calls.log");
    writeExecutable(
      binarySource,
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$FACTORY_TEST_CALL_LOG"\n',
    );
    writeFileSync(tokenFile, "fixture-token\n", { mode: 0o600 });

    try {
      const result = spawnSync(
        "sh",
        [
          installerPath,
          "--url",
          "https://factory.example.com",
          "--token-file",
          tokenFile,
          "--prefix",
          prefix,
          "--machine-id",
          "test-agent",
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            HOME: home,
            FACTORY_BINARY: binarySource,
            FACTORY_TEST_CALL_LOG: callLog,
            // These stale overrides must no longer be required or consumed.
            FACTORY_SKILL_SOURCE: join(fixture, "missing-skill"),
            FACTORY_HOOK_SOURCE: join(fixture, "missing-hook"),
          },
        },
      );

      expect(result.status).toBe(0);
      expect(readFileSync(callLog, "utf8")).toBe("doctor\n");
      expect(existsSync(join(prefix, "bin/factory"))).toBe(true);
      const configDirectory = join(home, ".config/factory");
      const tokenDestination = join(configDirectory, "access-token");
      const environmentFile = readFileSync(
        join(configDirectory, "env"),
        "utf8",
      );
      expect(readFileSync(tokenDestination, "utf8")).toBe("fixture-token");
      expect(statSync(tokenDestination).mode & 0o777).toBe(0o600);
      expect(statSync(join(configDirectory, "env")).mode & 0o777).toBe(0o600);
      expect(environmentFile).toContain(
        "FACTORY_URL='https://factory.example.com'",
      );
      expect(environmentFile).toContain(
        `FACTORY_ACCESS_TOKEN_FILE='${tokenDestination}'`,
      );
      expect(environmentFile).toContain(
        `FACTORY_CLI='${join(prefix, "bin/factory")}'`,
      );
      expect(environmentFile).toContain("FACTORY_MACHINE_ID='test-agent'");

      expect(existsSync(join(home, ".codex/skills/software-factory"))).toBe(
        false,
      );
      expect(existsSync(join(home, ".claude/skills/software-factory"))).toBe(
        false,
      );
      expect(existsSync(join(home, ".codex/hooks.json"))).toBe(false);
      expect(existsSync(join(home, ".claude/settings.json"))).toBe(false);
      expect(
        existsSync(join(configDirectory, "factory-session-brief-hook.sh")),
      ).toBe(false);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("builds tarballs containing only the CLI and installer", () => {
    const fixture = mkdtempSync(join(tmpdir(), "factory-client-build-"));
    const fakeBun = join(fixture, "bin/bun");
    const outputDirectory = join(fixture, "client-output");
    writeExecutable(
      fakeBun,
      '#!/bin/sh\noutput=\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = --outfile ]; then shift; output=$1; fi\n  shift\ndone\n[ -n "$output" ] || exit 2\nprintf \'fixture binary\\n\' > "$output"\nchmod 755 "$output"\n',
    );

    try {
      const result = spawnSync("bash", [builderPath], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          BUN_BIN: fakeBun,
          FACTORY_CLIENT_OUTPUT_DIRECTORY: outputDirectory,
        },
      });
      expect(result.status).toBe(0);

      for (const target of [
        "darwin-arm64",
        "darwin-x64",
        "linux-x64",
        "linux-arm64",
      ]) {
        const archive = join(outputDirectory, `factory-${target}.tar.gz`);
        const listing = spawnSync("tar", ["-tzf", archive], {
          encoding: "utf8",
        });
        expect(listing.status).toBe(0);
        expect(listing.stdout.trim().split("\n").sort()).toEqual([
          "factory",
          "scripts/install-agent-client.sh",
        ]);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
