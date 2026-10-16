import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const skillDirectory = join(import.meta.dir, "../../skills/software-factory");
const skill = readFileSync(join(skillDirectory, "SKILL.md"), "utf8");
const routine = readFileSync(
  join(skillDirectory, "references/routine-workflow.md"),
  "utf8",
);
const installation = readFileSync(
  join(skillDirectory, "references/installation.md"),
  "utf8",
);
const compactSkill = skill.replace(/\s+/g, " ");
const compactRoutine = routine.replace(/\s+/g, " ");

describe("Software Factory skill", () => {
  test("routes users to existing references for the work they need", () => {
    const links = [...skill.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map((match) => match[1])
      .filter((link): link is string => link !== undefined);

    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).not.toMatch(/^(https?:|#)/);
      expect(existsSync(join(skillDirectory, link))).toBe(true);
    }
    expect(skill).toContain("references/routine-workflow.md");
    expect(skill).toContain("references/cli-and-maintenance.md");
    expect(skill).toContain("references/reviewer-acceptance.md");
    expect(skill).toContain("references/installation.md");
  });

  test("keeps execution, requirements, evidence, and acceptance with their owners", () => {
    expect(compactSkill).toMatch(/T3.*GitHub.*Linear and Notion/);
    expect(compactSkill).toContain(
      "Factory records work and evidence; it does not claim deployment",
    );
    expect(compactSkill).toMatch(/human check is opt-in.*human/);
    expect(compactSkill).toContain("Session association is optional metadata");
  });

  test("uses Task reports and does not require session association or report-only Steps", () => {
    expect(compactRoutine).toContain("workflowEpoch");
    expect(compactRoutine).toContain("--state in_progress");
    expect(compactRoutine).toContain("blocked with a clear reason");
    expect(compactRoutine).toContain("finished with concrete evidence");
    expect(compactRoutine).toContain("unchanged observations are no-ops");
    expect(compactRoutine).toContain("Steps still open");
    expect(compactRoutine).toContain("metadata, not a reporting prerequisite");
    expect(compactRoutine).not.toMatch(/Immediately after.*session auto-link/i);
  });

  test("documents exact-copy installation for both clients without client reconfiguration", () => {
    expect(installation).toContain("CODEX_HOME");
    expect(installation).toContain("~/.codex/skills/software-factory");
    expect(installation).toContain("~/.claude/skills/software-factory");
    expect(installation).toContain("rsync -a --delete");
    expect(installation).toContain("diff -qr");
    expect(installation).toContain("both machines");
    expect(installation).toContain(
      "do not use scripts/install-agent-client.sh",
    );
  });
});
