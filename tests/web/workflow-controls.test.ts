import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const source = readFileSync(
  new URL("../../src/web/main.tsx", import.meta.url),
  "utf8",
);
const workflow = readFileSync(
  new URL("../../src/web/task-workflow.tsx", import.meta.url),
  "utf8",
);
const controls = readFileSync(
  new URL("../../src/web/workflow-panel.tsx", import.meta.url),
  "utf8",
);
describe("PWA workflow wiring", () => {
  test("applies canonical mutation snapshots and retains scoped status/order updates", () => {
    expect(source).toContain("applyDashboardSnapshot(result.dashboard)");
    expect(source).toContain("client.projects.snapshot.query");
    expect(source).toContain("tasks.setState.mutate");
    expect(source).toContain("tasks.reorder.mutate");
    expect(source).toContain("subtasks.reorder.mutate");
  });
  test("uses finish-rule, check, override and reopen APIs without routine approvals", () => {
    for (const route of ["updateFinishRule", "check", "reopen", "markDone"])
      expect(source).toContain(`tasks.${route}.mutate`);
    expect(source).not.toContain("tasks.accept.mutate");
    expect(source).not.toContain("subtasks.verify.mutate");
    expect(source).not.toContain("Use subtask status");
    expect(source).toMatch(/expectedRevision:\s*status!\.taskRevision/);
  });
  test("Steps are in author order with separate dial and detail controls", () => {
    expect(workflow).toContain("orderedSteps(task.subtasks)");
    expect(controls).toContain("Change state");
    expect(controls).toContain('className="step-name"');
    expect(controls).toContain('role="radiogroup"');
    expect(controls).toContain('event.key === "Escape"');
    expect(controls).toContain("radios[next]?.focus()");
  });
  test("collects blocked reasons and uses server readiness for optional check", () => {
    expect(controls).toContain("What's in the way?");
    expect(controls).toContain("Who can unblock it?");
    expect(workflow).toContain("status?.humanCheckReady");
    expect(controls).toContain("Mark checked");
    expect(controls).toContain("Send back");
  });
  test("More and status menus dismiss only after a pointer lands outside them", () => {
    expect(source).toContain(
      'document.addEventListener("pointerdown", dismissOpenMenus)',
    );
    expect(source).toContain("if (!menu.contains(event.target))");
  });
});
