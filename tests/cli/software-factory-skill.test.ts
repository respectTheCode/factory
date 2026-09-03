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
    expect(skill).toContain('--workspace-root "$REPO_CHECKOUT"');
    expect(skill).toContain("remote get-url origin 2>/dev/null || true");
    expect(skill).toContain(
      "Immediately after `project context` resolves exactly one Project and Task",
    );
    expect(skill).toContain(
      "If it returns `unmatched` or `ambiguous`, create no association",
    );
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
