import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);

describe("Factory brand navigation", () => {
  test("reloads the dashboard when the Factory mark is clicked", () => {
    expect(source).toContain('aria-label="Factory dashboard"');
    expect(source).toContain('className="brand-link"');
    expect(source).toContain('href="/"');
    expect(source).toContain('window.location.assign("/")');
  });
});
