import type { T3StatusResult } from "../t3-coordinator";

export type T3ConnectionSummary =
  | {
      state: "unknown";
    }
  | {
      connected: number;
      state: "ready";
      total: number;
    };

/**
 * Summarize source transport state for the global connection badge.
 *
 * Project matching status is deliberately ignored here. A source can be
 * connected while its projects are unmatched or ambiguous. The legacy
 * not-configured source is the coordinator's empty configuration fallback,
 * so it does not represent a configured server.
 */
export function summarizeT3Connections(
  result: T3StatusResult | undefined,
): T3ConnectionSummary {
  if (!result) return { state: "unknown" };

  const sources = result.sources.filter(
    (source) => source.connection.state !== "not_configured",
  );
  return {
    connected: sources.filter(
      (source) => source.connection.state === "connected",
    ).length,
    state: "ready",
    total: sources.length,
  };
}

export function t3ConnectionLabel(summary: T3ConnectionSummary): string {
  return summary.state === "unknown"
    ? "T3 ?/?"
    : `T3 ${summary.connected}/${summary.total}`;
}
