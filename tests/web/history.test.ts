import { describe, expect, test } from "bun:test";

import { formatHistoryReportAttribution } from "../../src/web/history";

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
});
