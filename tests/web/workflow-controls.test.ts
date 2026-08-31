import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);
const stylesheet = readFileSync(
  join(import.meta.dir, "../../src/web/styles.css"),
  "utf8",
);

describe("PWA workflow controls", () => {
  test("uses live state and ordering mutations from accessible controls", () => {
    expect(source).toContain("tasks.setState.mutate");
    expect(source).toContain("tasks.reorder.mutate");
    expect(source).toContain("subtasks.reorder.mutate");
    expect(source).toContain("orderedTaskIds: taskIds");
    expect(source).toContain("orderedSubtaskIds: subtaskIds");
    expect(source).toContain("reason: stateReason");
    expect(source).toContain("...(reason ? { reason } : {})");
    expect(source).not.toContain("type PwaTRPCClient");
    expect(source).toContain("aria-label={`Reorder ${kind}");
    expect(source).toContain("onPointerDown");
    expect(source).toContain("onPointerMove");
    expect(source).toContain("taskStatusOrder.map");
    expect(source).not.toContain("liveWorkStatusOrder.map((candidateState)");
    expect(source).toContain('data-reorder-tail="true"');
    expect(source).toContain("DRAG_TAIL");
    expect(stylesheet).toContain("touch-action: none");
  });

  test("collects required state reasons and renders them in task and subtask copy", () => {
    expect(source).toContain("Why blocked / what unblocks it");
    expect(source).toContain("What to verify");
    expect(source).toContain("taskStateReason");
    expect(source).toContain("subtaskStateReason");
    expect(source).toContain('className="state-reason"');
  });

  test("keeps archived groups separate from canonical live groups", () => {
    expect(source).toContain("archiveStatusOrder");
    expect(source).toContain("groupSubtasksByStatus");
    expect(source).toContain('className="subtask-group-heading"');
  });

  test("uses one-line task and subtask disclosures on every viewport", () => {
    expect(source).toContain("expandedRows");
    expect(source).toContain("<RowToggle");
    expect(source).toContain('kind="task"');
    expect(source).toContain('kind="subtask"');
    expect(source).toContain("row-expanded");
    expect(source).toContain("row-collapsed");
    expect(source).toContain("aria-expanded={expanded}");
    expect(source).not.toContain("expandedMobileRows");
    expect(source).not.toContain("MobileRowToggle");
    expect(stylesheet).toContain("/* Shared task and subtask disclosures. */");
    expect(stylesheet).toContain(".row-toggle {");
    expect(stylesheet).toContain("text-overflow: ellipsis");
    expect(stylesheet).toContain(
      ".task-row.row-collapsed > :not(.task-card-header)",
    );
    expect(stylesheet).toContain(".subtask.row-collapsed .subtask-copy");
  });

  test("uses task expansion as the only subtask visibility control", () => {
    expect(source).not.toContain("collapsedTasks");
    expect(source).not.toContain("setCollapsedTasks");
    expect(source).not.toContain("subtasksCollapsed");
    expect(source).not.toContain("Hide subtasks");
    expect(source).not.toContain("Show ${progress.totalSubtasks} subtasks");
    expect(source).toContain("{taskRowExpanded && (");
    expect(source).toContain('className="subtask-list"');
    expect(source).toContain('className="subtask-create"');
  });

  test("dismisses More and status menus only when a pointer lands outside them", () => {
    expect(source).toContain(
      '"details.task-menu[open], details.status-menu[open]"',
    );
    expect(source).toContain(
      'document.addEventListener("pointerdown", dismissOpenMenus)',
    );
    expect(source).toContain(
      'document.removeEventListener("pointerdown", dismissOpenMenus)',
    );
    expect(source).toContain("if (!menu.contains(event.target))");
    expect(source).toContain('menu.removeAttribute("open")');
  });
});
