import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const stylesheet = readFileSync(
  join(import.meta.dir, "../../src/web/styles.css"),
  "utf8",
);

describe("expanded task row layout", () => {
  test("lets the task summary fill the header between the handle and actions", () => {
    expect(stylesheet).toMatch(
      /\.task-card-header\s+\.task-summary\s*\{[\s\S]*?flex:\s*1\s+1\s+auto;/,
    );
  });
});
