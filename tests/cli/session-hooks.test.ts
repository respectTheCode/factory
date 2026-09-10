import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, test } from "bun:test";
import {
  FACTORY_SESSION_HOOK_MATCHER,
  factorySessionHookCommand,
  mergeSessionStartHook,
} from "../../src/session-hooks";

const repositoryRoot = join(import.meta.dir, "../..");
const hookScript = join(
  repositoryRoot,
  "scripts/factory-session-brief-hook.sh",
);
const installerScript = join(
  repositoryRoot,
  "scripts/install-session-hooks.ts",
);

function runHook(
  client: "claude" | "codex",
  payload: string,
  environment: Record<string, string>,
) {
  return spawnSync("bash", [hookScript, client], {
    env: { ...process.env, ...environment },
    input: payload,
    encoding: "utf8",
  });
}

function runInstaller(args: string[]) {
  return spawnSync(process.execPath, ["run", installerScript, ...args], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function makeFakeCheckout(): { directory: string; database: string } {
  const directory = mkdtempSync(
    join(tmpdir(), "factory-session-hook-checkout-"),
  );
  const sourceDirectory = join(directory, "src");
  const database = join(directory, "factory.sqlite");
  const fakeCli = [
    'if (process.env.FAKE_BRIEF_FAIL === "1") {',
    '  console.error("brief failed");',
    "  process.exit(1);",
    "}",
    'process.stdout.write(process.env.FAKE_BRIEF ?? "# Factory brief\\n\\nTracked project");',
    "",
  ].join("\n");

  mkdirSync(sourceDirectory, { recursive: true });
  writeFileSync(join(sourceDirectory, "cli.ts"), fakeCli);
  writeFileSync(database, "fixture database");
  return { database, directory };
}

function makeInstallerFixtures(): {
  directory: string;
  claudeSettings: string;
  codexHooks: string;
} {
  const directory = mkdtempSync(
    join(tmpdir(), "factory-session-hook-install-"),
  );
  const claudeSettings = join(directory, "claude-settings.json");
  const codexHooks = join(directory, "codex-hooks.json");
  const settings = {
    theme: "dark",
    hooks: {
      SessionStart: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: "bash /usr/local/bin/herdr-agent-state.sh session",
            },
          ],
        },
        {
          hooks: [
            {
              type: "command",
              command: "bash /usr/local/bin/moshi-hook.sh",
            },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
    },
  };

  writeFileSync(claudeSettings, JSON.stringify(settings, null, 2) + "\n");
  writeFileSync(codexHooks, JSON.stringify(settings, null, 2) + "\n");
  return { claudeSettings, codexHooks, directory };
}

describe("session-start hook configuration", () => {
  test("adds a group while preserving unrelated settings and groups", () => {
    const settings = {
      unrelated: { enabled: true },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
        SessionStart: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "echo existing" }],
          },
        ],
      },
    };

    const merged = mergeSessionStartHook(settings, {
      command: "bash '/tmp/factory-session-brief-hook.sh' claude",
      matcher: FACTORY_SESSION_HOOK_MATCHER,
      additionalContextLimit: 4000,
    });

    expect(settings).toEqual({
      unrelated: { enabled: true },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
        SessionStart: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "echo existing" }],
          },
        ],
      },
    });
    expect(merged).toMatchObject({ unrelated: { enabled: true } });
    expect(merged.hooks).toMatchObject({
      Stop: [{ hooks: [{ type: "command", command: "echo stop" }] }],
      SessionStart: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "echo existing" }],
        },
        {
          matcher: FACTORY_SESSION_HOOK_MATCHER,
          hooks: [
            {
              type: "command",
              command: "bash '/tmp/factory-session-brief-hook.sh' claude",
              timeout: 10,
              additionalContextLimit: 4000,
            },
          ],
        },
      ],
    });
  });

  test("is idempotent across two runs", () => {
    const command = factorySessionHookCommand(
      "codex",
      "/tmp/factory scripts/factory-session-brief-hook.sh",
    );
    const first = mergeSessionStartHook(
      {},
      {
        command,
        matcher: FACTORY_SESSION_HOOK_MATCHER,
      },
    );
    const second = mergeSessionStartHook(first, {
      command,
      matcher: FACTORY_SESSION_HOOK_MATCHER,
    });

    expect(second).toEqual(first);
    expect((second.hooks as Record<string, unknown>).SessionStart).toHaveLength(
      1,
    );
  });

  test("replaces a stale Factory command in place", () => {
    const settings = {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "echo before" }] },
          {
            matcher: "startup",
            hooks: [
              {
                type: "command",
                timeout: 3,
                command: "bash '/old/factory-session-brief-hook.sh' claude",
              },
            ],
          },
        ],
      },
    };
    const command = "bash '/new/factory-session-brief-hook.sh' codex";
    const merged = mergeSessionStartHook(settings, {
      command,
      matcher: FACTORY_SESSION_HOOK_MATCHER,
    });
    const groups = (merged.hooks as Record<string, unknown>)
      .SessionStart as Array<Record<string, unknown>>;

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual(settings.hooks.SessionStart[0]);
    expect(groups[1]).toEqual({
      matcher: FACTORY_SESSION_HOOK_MATCHER,
      hooks: [{ type: "command", timeout: 3, command }],
    });
  });
});

describe("session-start hook installer", () => {
  test("dry-run reports changes without writing", () => {
    const fixtures = makeInstallerFixtures();
    try {
      const beforeClaude = readFileSync(fixtures.claudeSettings, "utf8");
      const beforeCodex = readFileSync(fixtures.codexHooks, "utf8");
      const result = runInstaller([
        "--claude-settings",
        fixtures.claudeSettings,
        "--codex-hooks",
        fixtures.codexHooks,
        "--dry-run",
        "--json",
      ]);

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout) as {
        schemaVersion: number;
        install: {
          claude: { path: string; changed: boolean; dryRun: boolean };
          codex: { path: string; changed: boolean; dryRun: boolean };
          scriptPath: string;
          matcher: string;
        };
      };
      expect(report).toMatchObject({
        schemaVersion: 1,
        install: {
          claude: {
            path: fixtures.claudeSettings,
            changed: true,
            dryRun: true,
          },
          codex: { path: fixtures.codexHooks, changed: true, dryRun: true },
          matcher: FACTORY_SESSION_HOOK_MATCHER,
        },
      });
      expect(report.install.scriptPath).toBe(hookScript);
      expect(readFileSync(fixtures.claudeSettings, "utf8")).toBe(beforeClaude);
      expect(readFileSync(fixtures.codexHooks, "utf8")).toBe(beforeCodex);
    } finally {
      rmSync(fixtures.directory, { force: true, recursive: true });
    }
  });

  test("writes merged files, then reports no change on a second run", () => {
    const fixtures = makeInstallerFixtures();
    try {
      const argumentsForInstaller = [
        "--claude-settings",
        fixtures.claudeSettings,
        "--codex-hooks",
        fixtures.codexHooks,
        "--json",
      ];
      const first = runInstaller(argumentsForInstaller);
      expect(first.status).toBe(0);
      const firstReport = JSON.parse(first.stdout) as {
        install: {
          claude: { path: string; changed: boolean; dryRun: boolean };
          codex: { path: string; changed: boolean; dryRun: boolean };
          matcher: string;
        };
      };
      expect(firstReport.install.claude).toEqual({
        path: fixtures.claudeSettings,
        changed: true,
        dryRun: false,
      });
      expect(firstReport.install.codex).toEqual({
        path: fixtures.codexHooks,
        changed: true,
        dryRun: false,
      });
      expect(firstReport.install.matcher).toBe(FACTORY_SESSION_HOOK_MATCHER);

      const writtenClaude = JSON.parse(
        readFileSync(fixtures.claudeSettings, "utf8"),
      ) as {
        hooks: {
          SessionStart: Array<{
            matcher?: string;
            hooks: Array<{ command?: string }>;
          }>;
        };
      };
      expect(writtenClaude.hooks.SessionStart).toHaveLength(3);
      expect(writtenClaude.hooks.SessionStart[2]?.matcher).toBe(
        FACTORY_SESSION_HOOK_MATCHER,
      );
      expect(writtenClaude.hooks.SessionStart[2]?.hooks[0]?.command).toBe(
        factorySessionHookCommand("claude", hookScript),
      );
      expect(writtenClaude.hooks.SessionStart[2]?.hooks[0]).not.toHaveProperty(
        "additionalContextLimit",
      );
      expect(existsSync(fixtures.codexHooks)).toBe(true);
      const writtenCodex = JSON.parse(
        readFileSync(fixtures.codexHooks, "utf8"),
      ) as {
        hooks: {
          SessionStart: Array<{
            matcher?: string;
            hooks: Array<{ command?: string; additionalContextLimit?: number }>;
          }>;
        };
      };
      expect(writtenCodex.hooks.SessionStart[2]?.matcher).toBe(
        FACTORY_SESSION_HOOK_MATCHER,
      );
      expect(writtenCodex.hooks.SessionStart[2]?.hooks[0]).toMatchObject({
        command: factorySessionHookCommand("codex", hookScript),
        additionalContextLimit: 4000,
      });

      const second = runInstaller(argumentsForInstaller);
      expect(second.status).toBe(0);
      const secondReport = JSON.parse(second.stdout) as {
        install: {
          claude: { changed: boolean };
          codex: { changed: boolean };
        };
      };
      expect(secondReport.install.claude.changed).toBe(false);
      expect(secondReport.install.codex.changed).toBe(false);
    } finally {
      rmSync(fixtures.directory, { force: true, recursive: true });
    }
  });
});

describe("factory session brief hook", () => {
  test("stays silent when the brief command fails", () => {
    const fixture = makeFakeCheckout();
    try {
      const result = runHook(
        "claude",
        JSON.stringify({
          session_id: "session-fail",
          cwd: fixture.directory,
          hook_event_name: "SessionStart",
          source: "startup",
        }),
        {
          FACTORY_CHECKOUT: fixture.directory,
          FACTORY_DB: fixture.database,
          FAKE_BRIEF_FAIL: "1",
        },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });

  test("injects the expected context for Claude and Codex", () => {
    const fixture = makeFakeCheckout();
    try {
      const payload = JSON.stringify({
        session_id: "session-brief",
        cwd: fixture.directory,
        hook_event_name: "SessionStart",
        source: "startup",
      });
      const environment = {
        FACTORY_CHECKOUT: fixture.directory,
        FACTORY_DB: fixture.database,
        FAKE_BRIEF: "# Factory project brief\n\nTracked project",
      };
      const expectedContext =
        "Factory brief for this checkout (SessionStart hook). Act on it; full rules are in the software-factory skill.\n\n# Factory project brief\n\nTracked project";

      const claudeResult = runHook("claude", payload, environment);
      expect(claudeResult.status).toBe(0);
      expect(JSON.parse(claudeResult.stdout)).toEqual({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: expectedContext,
        },
      });

      const codexResult = runHook("codex", payload, environment);
      expect(codexResult.status).toBe(0);
      expect(codexResult.stdout).toBe(`${expectedContext}\n`);
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });

  test("stays silent for resumed and compacted session sources", () => {
    const fixture = makeFakeCheckout();
    try {
      for (const source of ["resume", "compact"] as const) {
        const result = runHook(
          "claude",
          JSON.stringify({
            session_id: `session-${source}`,
            cwd: fixture.directory,
            hook_event_name: "SessionStart",
            source,
          }),
          {
            FACTORY_CHECKOUT: fixture.directory,
            FACTORY_DB: fixture.database,
            FAKE_BRIEF: "should not appear",
          },
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("");
        expect(result.stderr).toBe("");
      }
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });

  test("injects when the source field is absent", () => {
    const fixture = makeFakeCheckout();
    try {
      const result = runHook(
        "codex",
        JSON.stringify({
          session_id: "session-without-source",
          cwd: fixture.directory,
          hook_event_name: "SessionStart",
        }),
        {
          FACTORY_CHECKOUT: fixture.directory,
          FACTORY_DB: fixture.database,
          FAKE_BRIEF: "# Factory project brief\n\nTracked project",
        },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(
        "Factory brief for this checkout (SessionStart hook). Act on it; full rules are in the software-factory skill.\n\n# Factory project brief\n\nTracked project\n",
      );
      expect(result.stderr).toBe("");
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });

  test("stays silent for a Claude subagent payload", () => {
    const fixture = makeFakeCheckout();
    try {
      const result = runHook(
        "claude",
        JSON.stringify({
          session_id: "subagent",
          agent_id: "agent-123",
          cwd: fixture.directory,
          hook_event_name: "SessionStart",
          source: "startup",
        }),
        {
          FACTORY_CHECKOUT: fixture.directory,
          FACTORY_DB: fixture.database,
          FAKE_BRIEF: "should not appear",
        },
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    } finally {
      rmSync(fixture.directory, { force: true, recursive: true });
    }
  });
});
