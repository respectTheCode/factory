import { describe, expect, test } from "bun:test";

import {
  dispositionStatusOptions,
  liveWorkStatusOrder,
  requiresStateReason,
  statusDefinitions,
  taskStatusOrder,
  workStatusForReportedState,
} from "../../src/web/status-presentation";

describe("status presentation", () => {
  test("assigns a Ledger dial, signal color, and label to every Factory work state", () => {
    expect(Object.keys(statusDefinitions)).toEqual([
      "completed",
      "blocked",
      "awaiting_verification",
      "active",
      "planned",
      "backlog",
      "released",
      "wont_do",
    ]);

    const definitions = Object.values(statusDefinitions);
    expect(new Set(definitions.map((definition) => definition.color))).toEqual(
      new Set([
        "#A2988A",
        "#4AA3E0",
        "#F0B429",
        "#2FBE6B",
        "#E5484D",
        "#746B5D",
        "#635A4D",
      ]),
    );
    expect(new Set(definitions.map((definition) => definition.dial)).size).toBe(
      definitions.length,
    );

    for (const definition of definitions) {
      expect(definition.dial).toBeDefined();
      expect(definition.color).toMatch(/^#/);
      expect(definition.label.length).toBeGreaterThan(0);
    }
  });

  test("maps report and verification state to the visible Factory status", () => {
    expect(workStatusForReportedState("backlog")).toBe("backlog");
    expect(workStatusForReportedState("not_started")).toBe("planned");
    expect(workStatusForReportedState("in_progress")).toBe("active");
    expect(workStatusForReportedState("blocked")).toBe("blocked");
    expect(
      workStatusForReportedState("complete", "awaiting_verification"),
    ).toBe("awaiting_verification");
    expect(workStatusForReportedState("complete", "accepted")).toBe(
      "completed",
    );
  });

  test("keeps terminal dispositions in the status menu contract", () => {
    expect(dispositionStatusOptions.map((option) => option.workStatus)).toEqual(
      ["released", "wont_do"],
    );
  });

  test("keeps live work states in canonical top-to-bottom order", () => {
    expect(liveWorkStatusOrder).toEqual([
      "completed",
      "blocked",
      "awaiting_verification",
      "active",
      "planned",
      "backlog",
    ]);
  });

  test("keeps completed out of direct task state mutation choices", () => {
    expect(taskStatusOrder).toEqual([
      "blocked",
      "awaiting_verification",
      "active",
      "planned",
      "backlog",
    ]);
    expect(taskStatusOrder).not.toContain("completed");
  });

  test("requires an explicit reason for blocked and awaiting verification", () => {
    expect(requiresStateReason("blocked")).toBe(true);
    expect(requiresStateReason("awaiting_verification")).toBe(true);
    expect(requiresStateReason("active")).toBe(false);
    expect(requiresStateReason("completed")).toBe(false);
  });
});
