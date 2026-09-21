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

  test("gives expanded mobile subtask copy the full row below its title", () => {
    expect(stylesheet).toMatch(
      /\.subtask\.row-expanded\s+\.subtask-copy\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;[\s\S]*?grid-row:\s*2;/,
    );
    expect(stylesheet).toContain(
      ".subtask-content:not(:has(.reorder-handle))\n    .subtask-copy {\n    grid-column: 1 / -1;",
    );
  });
});
