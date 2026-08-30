import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const retiredPalette = [
  "#111827",
  "#0f172a",
  "#172033",
  "#1e293b",
  "#334155",
  "#475569",
  "#38bdf8",
  "#7dd3fc",
  "#bae6fd",
  "#e0f2fe",
  "#0c4a6e",
  "#cbd5e1",
  "#94a3b8",
  "#64748b",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#ef4444",
  "#818cf8",
  "#6366f1",
  "#f87171",
  "#4ade80",
  "#fb923c",
] as const;

describe("Ledger stylesheet", () => {
  test("contains no retired pre-Ledger palette colors", () => {
    const stylesheet = readFileSync(
      join(import.meta.dir, "../../src/web/styles.css"),
      "utf8",
    ).toLowerCase();
    const remaining = retiredPalette.filter((color) =>
      stylesheet.includes(color),
    );

    expect(remaining).toEqual([]);
  });
});
