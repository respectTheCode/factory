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

describe("subtask evidence editing", () => {
  test("renders evidence below the description and keeps its field in the edit form", () => {
    const readModeStart = source.indexOf('className="subtask-copy"');
    const readModeEnd = source.indexOf("</div>", readModeStart);
    const readMode = source.slice(readModeStart, readModeEnd);
    expect(readMode.indexOf('className="subtask-description"')).toBeLessThan(
      readMode.indexOf('className="evidence"'),
    );

    const formStart = source.indexOf('className="subtask-edit-form"');
    const actionsStart = source.indexOf('className="edit-actions"', formStart);
    const editForm = source.slice(formStart, actionsStart);
    expect(editForm).toContain("<span>Evidence</span>");
    expect(editForm).toContain("subtaskEdit.evidence");
  });

  test("does not expose an always-visible evidence field beside status actions", () => {
    const actionsStart = source.indexOf('className="subtask-actions"');
    const actionsEnd = source.indexOf("</div>", actionsStart);
    expect(source.slice(actionsStart, actionsEnd)).not.toContain(
      "Evidence (optional)",
    );
  });

  test("keeps the status control inline with the title and uses icon actions", () => {
    const titleStart = source.indexOf('className="subtask-title-row"');
    expect(source.indexOf("<ReportStatusMenu", titleStart)).toBeLessThan(
      source.indexOf("{subtask.name}", titleStart),
    );

    const actionsStart = source.indexOf('className="subtask-actions"');
    const actionsEnd = source.indexOf("</div>", actionsStart);
    const actions = source.slice(actionsStart, actionsEnd);
    expect(actions).not.toContain("<ReportStatusMenu");
    expect(actions).toContain('aria-label="Edit subtask"');
    expect(actions).toContain("aria-label={`Delete subtask");
    expect(actions).toContain("<SubtaskActionIcon");
  });

  test("does not render the legacy left status state or countersign slot", () => {
    expect(source).not.toContain('className="subtask-state"');
    expect(source).not.toContain("<CountersignSlot");
  });

  test("uses a grid row so the dial and title share a row", () => {
    expect(stylesheet).toContain(".subtask-content {");
    expect(stylesheet).toContain(
      "grid-template-columns: max-content minmax(0, 1fr)",
    );
    expect(stylesheet).toContain(".subtask-title-row {");
    expect(stylesheet).toContain("display: contents");
    expect(stylesheet).toContain(".subtask-copy {");
    expect(stylesheet).toContain("grid-row: 2");
  });
});
