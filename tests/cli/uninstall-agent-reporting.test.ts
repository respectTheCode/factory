import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, test } from "bun:test";

const repositoryRoot = join(import.meta.dir, "../..");
const scriptPath = join(repositoryRoot, "scripts/uninstall-agent-reporting.sh");

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runUninstall(home: string, backupRoot: string) {
  return spawnSync(
    "bash",
    [scriptPath, "--home", home, "--backup-root", backupRoot],
    { encoding: "utf8" },
  );
}

describe("agent reporting uninstall", () => {
  test("backs up only Factory reporting installs and preserves unrelated hooks", () => {
    const fixture = mkdtempSync(join(tmpdir(), "factory-reporting-uninstall-"));
    const home = join(fixture, "home");
    const backupRoot = join(fixture, "backups");
    const skillRoots = [
      join(home, ".agents/skills"),
      join(home, ".codex/skills"),
      join(home, ".claude/skills"),
    ];
    const codexHooks = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|clear",
            hooks: [
              {
                type: "command",
                command:
                  "bash '/Users/agent/.config/factory/factory-session-brief-hook.sh' codex",
              },
            ],
          },
          {
            hooks: [{ type: "command", command: "keep-codex-session-hook" }],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command:
                  "bash '/Users/agent/.config/factory/factory-session-brief-hook.sh' codex",
              },
            ],
          },
        ],
      },
      otherSetting: { keep: true },
    };
    const claudeSettings = {
      hooks: {
        SessionStart: [
          {
            matcher: "startup|clear",
            hooks: [
              {
                type: "command",
                command:
                  "bash '/Users/agent/.config/factory/factory-session-brief-hook.sh' claude",
              },
            ],
          },
          {
            hooks: [{ type: "command", command: "keep-claude-session-hook" }],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [{ type: "command", command: "keep-prompt-hook" }],
          },
        ],
      },
      theme: "keep-me",
    };

    try {
      for (const root of skillRoots) {
        const skill = join(root, "software-factory");
        mkdirSync(skill, { recursive: true });
        writeFileSync(join(skill, "SKILL.md"), "Factory reporting skill\n");
        mkdirSync(join(root, "unrelated-skill"), { recursive: true });
      }
      writeJson(join(home, ".codex/hooks.json"), codexHooks);
      writeJson(join(home, ".claude/settings.json"), claudeSettings);

      const first = runUninstall(home, backupRoot);
      expect(first.status).toBe(0);
      const result = JSON.parse(first.stdout) as {
        changed: boolean;
        backup_dir: string;
        removed_skills: string[];
        changed_configs: string[];
      };
      expect(result.changed).toBe(true);
      expect(result.removed_skills).toHaveLength(3);
      expect(result.changed_configs).toHaveLength(2);

      for (const root of skillRoots) {
        expect(existsSync(join(root, "software-factory"))).toBe(false);
        expect(existsSync(join(root, "unrelated-skill"))).toBe(true);
        expect(
          readFileSync(
            join(
              result.backup_dir,
              "skills",
              root.includes(".agents")
                ? "agents"
                : root.includes(".codex")
                  ? "codex"
                  : "claude",
              "software-factory/SKILL.md",
            ),
            "utf8",
          ),
        ).toBe("Factory reporting skill\n");
      }

      const codexAfter = JSON.parse(
        readFileSync(join(home, ".codex/hooks.json"), "utf8"),
      );
      expect(codexAfter.otherSetting).toEqual({ keep: true });
      expect(codexAfter.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "keep-codex-session-hook" }] },
      ]);
      expect(codexAfter.hooks.Stop).toEqual(codexHooks.hooks.Stop);

      const claudeAfter = JSON.parse(
        readFileSync(join(home, ".claude/settings.json"), "utf8"),
      );
      expect(claudeAfter.theme).toBe("keep-me");
      expect(claudeAfter.hooks.SessionStart).toEqual([
        { hooks: [{ type: "command", command: "keep-claude-session-hook" }] },
      ]);
      expect(claudeAfter.hooks.UserPromptSubmit).toEqual(
        claudeSettings.hooks.UserPromptSubmit,
      );

      const second = runUninstall(home, backupRoot);
      expect(second.status).toBe(0);
      expect(JSON.parse(second.stdout).changed).toBe(false);
      expect(requireDirectoryEntries(backupRoot)).toEqual([
        basename(result.backup_dir),
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

function requireDirectoryEntries(path: string): string[] {
  return readdirSync(path).sort();
}
