import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);
const editorStart = source.indexOf('view.screen === "edit_project" &&');
const editorEnd = source.indexOf('view.screen === "project" &&', editorStart);
const editor = source.slice(editorStart, editorEnd);
const projectTabs = source.match(
  /\{projects &&[\s\S]*?<nav aria-label="Projects"[\s\S]*?<\/nav>/,
)?.[0];

describe("project settings from Issues", () => {
  test("returns to Issues and only edits repository context", () => {
    expect(editor).toContain("Back to issues");
    expect(editor).toContain("onClick={openHome}");
    expect(editor).toContain('aria-label="Git origin URL"');
    expect(editor).toContain("Save Git URL");
    expect(editor).not.toContain("Project tracker system");
    expect(editor).not.toContain("Project tracker links");
    expect(editor).not.toContain("Linear project");
    expect(editor).not.toContain("Notion project");
    expect(editor).not.toContain("Link project");
    expect(editor).not.toContain("New task");
    expect(editor).not.toContain("Add task");
    expect(projectTabs).not.toContain('view.screen === "edit_project"');
  });
});
