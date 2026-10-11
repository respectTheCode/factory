import { describe, expect, test } from "bun:test";
import {
  focusFinishRuleEditor,
  focusWorkflowControl,
} from "../../src/web/workflow-focus";
describe("workflow focus handoff", () => {
  test("Mark not required focuses its own draft checkbox and scrolls it into view, with legend fallback", () => {
    const calls: string[] = [];
    const control = (name: string, url?: string) => ({
      dataset: { prUrl: url },
      focus: () => calls.push(`focus ${name}`),
      scrollIntoView: () => calls.push(`scroll ${name}`),
    });
    const first = control("PR 18", "https://github.com/e/r/pull/18"),
      second = control("PR 19", "https://github.com/e/r/pull/19"),
      legend = control("legend");
    const editor = {
      querySelectorAll: () => [first, second],
      querySelector: () => legend,
    } as unknown as HTMLElement;
    focusFinishRuleEditor(editor, "https://github.com/e/r/pull/19");
    expect(calls).toEqual(["focus PR 19", "scroll PR 19"]);
    calls.length = 0;
    focusFinishRuleEditor(editor, "https://github.com/e/r/pull/missing");
    expect(calls).toEqual(["focus legend", "scroll legend"]);
  });
  test("revealed link input receives focus without requiring a hidden button to exist", () => {
    const calls: string[] = [];
    focusWorkflowControl({
      focus: () => calls.push("focus input"),
      scrollIntoView: () => calls.push("scroll input"),
    });
    expect(calls).toEqual(["focus input", "scroll input"]);
    expect(() => focusWorkflowControl(null)).not.toThrow();
  });
});
