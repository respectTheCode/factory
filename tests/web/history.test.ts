import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatHistoryReportAttribution,
  historyThreadsForTarget,
} from "../../src/web/history";
import type { ObservedThread } from "../../src/web/observed-activity";

const historyThreadSource = readFileSync(
  join(import.meta.dir, "../../src/web/history-thread-links.tsx"),
  "utf8",
);
const stylesheet = readFileSync(
  join(import.meta.dir, "../../src/web/styles.css"),
  "utf8",
);

describe("status report history attribution", () => {
  test("shows machine identity beside the reporter when present", () => {
    expect(
      formatHistoryReportAttribution({
        machineId: "mac-mini",
        reporter: "codex",
      }),
    ).toBe("codex · mac-mini");
  });

  test("preserves legacy history without an undefined machine label", () => {
    expect(formatHistoryReportAttribution({ reporter: "kevin" })).toBe("kevin");
  });

  test("selects only source-aware associated threads for the current target", () => {
    const threads = [
      {
        association: {
          links: [
            {
              linkId: "association-1",
              target: {
                id: "subtask-1",
                kind: "subtask",
                label: "Task / Subtask",
              },
            },
          ],
          state: "linked",
        },
        threadId: "thread-1",
        title: "First thread",
      },
      {
        association: {
          links: [
            {
              linkId: "association-2",
              target: {
                id: "task-1",
                kind: "task",
                label: "Task",
              },
            },
          ],
          state: "linked",
        },
        sourceId: "ubuntu",
        threadId: "thread-1",
        title: "Second thread",
      },
    ] as ObservedThread[];

    expect(
      historyThreadsForTarget({ threads }, "subtask-1").map(
        (thread) => `${thread.sourceId ?? "legacy"}:${thread.threadId}`,
      ),
    ).toEqual(["legacy:thread-1"]);
    expect(historyThreadsForTarget({ threads }, "missing")).toEqual([]);
  });

  test("renders source-aware thread detail actions and ownership labels", () => {
    expect(historyThreadSource).toContain("Associated T3 threads");
    expect(historyThreadSource).toContain("View T3 thread details for");
    expect(historyThreadSource).toContain("targetKindLabel(target.kind)");
    expect(historyThreadSource).toContain("${target.label}");
    expect(historyThreadSource).toContain("thread.sourceId");
  });

  test("places expanded History below the row and wraps long values", () => {
    expect(stylesheet).toMatch(
      /\.subtask\.row-expanded\s*\{[\s\S]*?flex-wrap:\s*wrap;/,
    );
    expect(stylesheet).toMatch(
      /\.subtask\.row-expanded\s*>\s*\.history\s*\{[\s\S]*?flex-basis:\s*100%;/,
    );
    expect(stylesheet).toContain(".history-thread-list");
    expect(stylesheet).toContain("overflow-wrap: anywhere");
  });
});
