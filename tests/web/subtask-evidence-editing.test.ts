import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const workflow = readFileSync(
  new URL("../../src/web/task-workflow.tsx", import.meta.url),
  "utf8",
);
const controls = readFileSync(
  new URL("../../src/web/workflow-panel.tsx", import.meta.url),
  "utf8",
);
describe("Step evidence editing", () => {
  test("preserves Description and Evidence fields in the Step detail editor", () => {
    expect(workflow).toContain("Step title");
    expect(workflow).toMatch(/<label>\s*Description/);
    expect(workflow).toMatch(/<label>\s*Evidence/);
    expect(workflow).toMatch(/onEditStep\(step,\s*patch\)/);
  });
  test("keeps notes below the Step row with distinct direct state and detail controls", () => {
    expect(controls).toContain('className="step-dial-button"');
    expect(controls).toContain('className="step-name"');
    expect(controls).toContain('className="step-detail"');
    expect(controls).toContain("Add a note");
    expect(controls).not.toContain("CountersignSlot");
  });
});
