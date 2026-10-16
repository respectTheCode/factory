import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mainSource = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);
const issuesSource = readFileSync(
  join(import.meta.dir, "../../src/web/issues.tsx"),
  "utf8",
);

describe("Factory brand navigation", () => {
  test("opens the Issues home when the Factory mark is clicked", () => {
    const brandLink = mainSource.match(
      /<a\s+aria-label="Factory issues"[\s\S]*?<\/a>/,
    )?.[0];
    expect(brandLink).toBeDefined();
    expect(brandLink).toContain('className="brand-link"');
    expect(brandLink).toContain('<img alt="Factory"');
    expect(brandLink).toContain('href="/"');
    expect(brandLink).toContain('window.location.assign("/")');
    expect(mainSource).toMatch(
      /view\.screen === "home" && \([\s\S]*?<IssuesPage\b/,
    );
    expect(issuesSource).toContain("<h1>Issues</h1>");
  });
});
