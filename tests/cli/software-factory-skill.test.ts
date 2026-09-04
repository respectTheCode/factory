import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const skill = readFileSync(
  join(import.meta.dir, "../../skills/software-factory/SKILL.md"),
  "utf8",
);

describe("Software Factory skill", () => {
  test("directs agents to auto-associate the current T3 session", () => {
    expect(skill).toContain("session auto-link");
    expect(skill).toContain(
      'export T3_BASE_URL="${T3_BASE_URL:-http://127.0.0.1:3773}"',
    );
    expect(skill).toContain(
      'export T3_ACCESS_TOKEN_FILE="${T3_ACCESS_TOKEN_FILE:-$HOME/Library/Application Support/Factory/secrets/t3-read-token}"',
    );
    expect(skill).toContain("project t3-status --project-id ... --json");
    expect(skill).toContain('--workspace-root "$REPO_CHECKOUT"');
    expect(skill).toContain("remote get-url origin 2>/dev/null || true");
    expect(skill).toContain(
      "Immediately after `project context` resolves exactly one Project and Task",
    );
    expect(skill).toContain(
      "If it returns `unmatched` or `ambiguous`, create no association",
    );
  });

  test("fails closed when T3 is not configured or unavailable", () => {
    expect(skill).toContain("Any transport state (`not_configured`");
    expect(skill).toContain("report the exact status string");
    expect(skill).toContain(
      "handoff so Kevin can fix the service or credential",
    );
    expect(skill).toContain("never retry by guessing a thread ID");
    expect(skill).toContain("using `session link` to work around it");
  });

  test("preserves zero-to-many association and human authority boundaries", () => {
    expect(skill).toContain(
      "A Code Session may have zero, one, or many Work Associations",
    );
    expect(skill).toContain(
      "never change T3, Work State, Status Reports, or Verification",
    );
    expect(skill).toContain("only as a fallback");
  });
});
