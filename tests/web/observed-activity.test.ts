import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  formatObservedTime,
  observedConnectionLabel,
  observedFindingLabel,
} from "../../src/web/observed-activity";

const source = readFileSync(
  join(import.meta.dir, "../../src/web/observed-activity.tsx"),
  "utf8",
);
const stylesheet = readFileSync(
  join(import.meta.dir, "../../src/web/styles.css"),
  "utf8",
);
const mainSource = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);

describe("observed activity presentation", () => {
  test("keeps transport state language explicit and stable", () => {
    expect(observedConnectionLabel("connected")).toBe("Connected");
    expect(observedConnectionLabel("authentication_failed")).toBe(
      "Authentication failed",
    );
    expect(observedConnectionLabel("invalid_response")).toBe(
      "Invalid T3 response",
    );
    expect(observedFindingLabel("planned_but_running")).toBe(
      "Planned but running",
    );
    expect(observedFindingLabel("source_unavailable")).toBe(
      "Source unavailable",
    );
  });

  test("formats valid timestamps and fails closed for malformed values", () => {
    expect(formatObservedTime("not-a-date")).toBeNull();
    expect(formatObservedTime(undefined)).toBeNull();
    expect(formatObservedTime("2026-09-02T12:00:00.000Z")).toContain("2026");
  });

  test("shows T3 as read-only evidence without replacing Factory authority", () => {
    expect(source).toContain('data-observed-activity="true"');
    expect(source).toContain("T3 activity is read-only evidence");
    expect(source).toContain("Factory remains the planning and");
    expect(source).toContain(
      "This does not represent current execution state.",
    );
    expect(source).toContain("Observation only. It does not change Factory");
    expect(source).toContain("Linking changes Factory metadata only");
    expect(source).toContain("onLinkThread");
    expect(source).toContain("onUnlinkThread");
  });

  test("renders explicit details and association controls for thread rows", () => {
    expect(source).toContain("View details");
    expect(source).toContain("Choose Factory target");
    expect(source).toContain(
      "aria-label={`Factory target for ${thread.title}`}",
    );
    expect(source).toContain('{linked ? "Change link" : "Link"}');
    expect(source).toContain(
      ">\n                      Unlink\n                    </button>",
    );
    expect(source).toContain("threadDetailLoadingIds");
    expect(source).toContain("candidateLabels");
    expect(source).toContain("Metadata only; transcript text is intentionally");
  });

  test("wires project-open and explicit-refresh reads to the planned T3 routes", () => {
    expect(mainSource).toContain("ObservedActivitySection");
    expect(mainSource).toContain("client.t3.status.query({ projectId })");
    expect(mainSource).toContain(
      "client.t3.projectActivity.query({ projectId })",
    );
    expect(mainSource).toContain("void refreshT3Project(projectId)");
    expect(mainSource).toContain(
      "onRefresh={() => refreshT3Project(projectDetail.id)}",
    );
    expect(mainSource).toContain("client.t3.threadDetail.query");
  });

  test("keeps link and unlink actions explicit and maps Factory target kinds", () => {
    expect(mainSource).toContain("client.t3.linkThread.mutate");
    expect(mainSource).toContain("client.t3.unlinkThread.mutate");
    expect(mainSource).toContain('target.kind === "task"');
    expect(mainSource).toContain("{ taskId: target.id }");
    expect(mainSource).toContain("{ subtaskId: target.id }");
    expect(source).toContain(
      "Linking changes Factory metadata only; it does not control T3",
    );
  });

  test("keeps the observation panel compact at 390px-oriented mobile width", () => {
    expect(stylesheet).toContain(".observed-activity");
    expect(stylesheet).toContain(".observed-counts");
    expect(stylesheet).toContain("grid-template-columns: repeat(5");
    expect(stylesheet).toContain("@media (max-width: 540px)");
    expect(stylesheet).toContain(".observed-link-control");
    expect(stylesheet).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(stylesheet).toContain("overflow-wrap: anywhere");
  });
});
