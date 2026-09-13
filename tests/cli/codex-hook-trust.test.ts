import { describe, expect, test } from "bun:test";

import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  installCodexHookTrust,
  type CodexAppServerProcess,
} from "../../src/codex-hook-trust-install";
import {
  findFactoryCodexHook,
  upsertTrustedHash,
} from "../../src/codex-hook-trust";

const factoryKey = "/Users/agent/.codex/hooks.json:session_start:2:0";
const factoryHash =
  "sha256:adf3c281deba3a8ae271d845e82ac40de839b6ceabdb053631e529704bdeb5d3";

function hooksListFixture() {
  return {
    jsonrpc: "2.0",
    id: 2,
    result: {
      data: [
        {
          eventName: "session_start",
          hooks: [
            {
              key: "/Users/agent/.codex/hooks.json:session_start:0:0",
              eventName: "session_start",
              command: "bash /usr/local/bin/moshi-hook.sh",
              enabled: true,
              isManaged: false,
              currentHash: "sha256:unrelated",
              trustStatus: "trusted",
              additionalContextLimit: null,
              sourcePath: "/Users/agent/.codex/hooks.json",
            },
            {
              key: factoryKey,
              eventName: "session_start",
              command:
                "bash '/Users/agent/Projects/factory/scripts/factory-session-brief-hook.sh' codex",
              enabled: true,
              isManaged: false,
              currentHash: factoryHash,
              trustStatus: "untrusted",
              additionalContextLimit: 4000,
              sourcePath: "/Users/agent/.codex/hooks.json",
            },
            {
              key: "/Users/agent/.codex/hooks.json:session_start:3:0",
              eventName: "session_start",
              command: "echo unrelated",
              enabled: false,
              isManaged: true,
              currentHash: "sha256:managed",
              trustStatus: "trusted",
              additionalContextLimit: null,
              sourcePath: "/Users/agent/.codex/hooks.json",
            },
          ],
        },
      ],
    },
  };
}

function appServerStub(transcript: string) {
  const state = { killed: false, request: "" };
  const stdout = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(transcript));
      controller.close();
    },
  });
  const process: CodexAppServerProcess = {
    stdin: {
      write(input) {
        state.request += input;
        return input.length;
      },
      flush() {
        return 0;
      },
    },
    stdout,
    get killed() {
      return state.killed;
    },
    kill() {
      state.killed = true;
    },
  };

  return { process, state };
}

describe("Codex hook trust helpers", () => {
  test("finds the Factory hook among unrelated hooks", () => {
    expect(findFactoryCodexHook(hooksListFixture())).toEqual({
      key: factoryKey,
      currentHash: factoryHash,
      trustStatus: "untrusted",
      enabled: true,
    });
  });

  test("reports a changed hook as modified so its new hash is recorded", () => {
    const fixture = hooksListFixture();
    const factory = fixture.result.data[0]?.hooks.find((hook) =>
      hook.command.includes("factory-session-brief-hook.sh"),
    );
    if (!factory) throw new Error("fixture lost the Factory hook");
    factory.trustStatus = "modified";

    expect(findFactoryCodexHook(fixture)?.trustStatus).toBe("modified");
  });

  test("rejects an ambiguous Factory hook list", () => {
    const fixture = hooksListFixture();
    fixture.result.data[0]?.hooks.push({
      command: "bash another/factory-session-brief-hook.sh codex",
      enabled: true,
      eventName: "session_start",
      isManaged: false,
      key: "/another/hooks.json:session_start:0:0",
      currentHash: "sha256:another",
      trustStatus: "untrusted",
      additionalContextLimit: 4000,
      sourcePath: "/another/hooks.json",
    });

    expect(() => findFactoryCodexHook(fixture)).toThrow(
      "Found 2 Factory Codex hooks; expected exactly one.",
    );
  });

  test("appends a new table after existing hook and skills tables", () => {
    const config = `[hooks.state."/other/hooks.json:session_start:0:0"]
trusted_hash = "sha256:other"
enabled = false

[[skills.config]]
name = "example"
`;

    expect(upsertTrustedHash(config, factoryKey, factoryHash)).toBe(
      `${config}
[hooks.state."${factoryKey}"]
trusted_hash = "${factoryHash}"
`,
    );
  });

  test("replaces the hash in place and keeps enabled false", () => {
    const config = `[hooks.state."${factoryKey}"]
trusted_hash = "sha256:old"
enabled = false

[[skills.config]]
name = "example"
`;

    expect(upsertTrustedHash(config, factoryKey, factoryHash)).toBe(
      `[hooks.state."${factoryKey}"]
trusted_hash = "${factoryHash}"
enabled = false

[[skills.config]]
name = "example"
`,
    );
  });

  test("is idempotent", () => {
    const first = upsertTrustedHash("[hooks]\n", factoryKey, factoryHash);
    expect(upsertTrustedHash(first, factoryKey, factoryHash)).toBe(first);
  });

  test("trusts the current hash from a stubbed app-server transcript", async () => {
    const directory = mkdtempSync(join(tmpdir(), "factory-codex-hook-trust-"));
    const configPath = join(directory, "config.toml");
    const config = `[hooks.state."${factoryKey}"]
trusted_hash = "sha256:old"
enabled = false
`;
    writeFileSync(configPath, config);
    const stub = appServerStub(
      [
        JSON.stringify({ jsonrpc: "2.0", method: "notification" }),
        JSON.stringify(hooksListFixture()),
      ].join("\n") + "\n",
    );

    try {
      const trust = await installCodexHookTrust({
        codexBin: "/stub/codex",
        codexConfigPath: configPath,
        cwd: directory,
        dryRun: true,
        spawnAppServer: () => stub.process,
      });

      expect(trust).toEqual({
        path: configPath,
        key: factoryKey,
        hash: factoryHash,
        previousStatus: "untrusted",
        changed: true,
        dryRun: true,
      });
      expect(readFileSync(configPath, "utf8")).toBe(config);
      expect(stub.state.killed).toBe(true);

      const requests = stub.state.request
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(requests.map((request) => request.method)).toEqual([
        "initialize",
        "initialized",
        "hooks/list",
      ]);
      expect(requests[2]?.params).toEqual({ cwd: directory });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
