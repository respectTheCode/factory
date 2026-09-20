import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const mainSource = readFileSync(
  join(import.meta.dir, "../../src/web/main.tsx"),
  "utf8",
);
const proofSource = readFileSync(
  join(import.meta.dir, "../../src/web/screenshot-proof.tsx"),
  "utf8",
);
const stylesheet = readFileSync(
  join(import.meta.dir, "../../src/web/styles.css"),
  "utf8",
);

describe("screenshot proof dashboard", () => {
  test("attaches proof to expanded Task and Subtask rows through scoped tRPC routes", () => {
    expect(mainSource).toContain("trpc.current!.screenshots.upload.mutate");
    expect(mainSource).toContain("trpc.current.screenshots.get.query");
    expect(mainSource).toContain("ownerLabel={`Task ${task.simpleId}`}");
    expect(mainSource).toContain("ownerLabel={`Subtask ${subtask.simpleId}`}");
    expect(proofSource).toContain(
      "Evidence supplements reports and never verifies work.",
    );
    expect(proofSource).toContain("Open full-size screenshot");
    expect(proofSource).toContain("Before / After comparison");
  });

  test("shows unavailable capture metadata and keeps the upload form responsive", () => {
    expect(proofSource).toContain("captured {formatDate(summary.capturedAt)}");
    expect(proofSource).toContain('type="datetime-local"');
    expect(proofSource).toContain(
      'revision {summary.testedRevision ?? "Unavailable"}',
    );
    expect(proofSource).toContain("image/png,image/jpeg,image/webp");
    expect(stylesheet).toContain(".screenshot-proof-form-grid {");
    expect(stylesheet).toContain("@media (max-width: 540px)");
  });
});
