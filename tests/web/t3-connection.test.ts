import { describe, expect, test } from "bun:test";

import {
  summarizeT3Connections,
  t3ConnectionLabel,
} from "../../src/web/t3-connection";

function source(connectionState: string, status = "unmatched") {
  return {
    connection: { state: connectionState },
    status,
  } as never;
}

describe("T3 connection summary", () => {
  test("counts connected transport sources even when project matching is unresolved", () => {
    const summary = summarizeT3Connections({
      sources: [source("connected", "unmatched"), source("unreachable")],
    } as never);

    expect(summary).toEqual({ connected: 1, state: "ready", total: 2 });
    expect(t3ConnectionLabel(summary)).toBe("T3 1/2");
  });

  test("reports no configured servers for the not-configured fallback", () => {
    const summary = summarizeT3Connections({
      sources: [source("not_configured")],
    } as never);

    expect(summary).toEqual({ connected: 0, state: "ready", total: 0 });
    expect(t3ConnectionLabel(summary)).toBe("T3 0/0");
  });

  test("keeps the count unknown before a read succeeds", () => {
    const summary = summarizeT3Connections(undefined);

    expect(summary).toEqual({ state: "unknown" });
    expect(t3ConnectionLabel(summary)).toBe("T3 ?/?");
  });
});
