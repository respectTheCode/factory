import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);
const banner = source.match(/function PilotBanner\([\s\S]*?\n}\n/)?.[0];

describe("review deployment banner", () => {
  test("keeps pilot identity while describing the isolated review deployment", () => {
    expect(banner).toContain('aria-label="Pilot environment"');
    expect(banner).toContain('data-deployment-environment="pilot"');
    expect(banner).toContain('role="status"');
    expect(banner).toContain("Review environment — isolated data");
    expect(banner).not.toContain("isolated test data");
  });
});
