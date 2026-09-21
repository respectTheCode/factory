import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { screenshotUploadRequest } from "../../src/web/screenshot-proof";

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
  test("reuses a request key for retries and rotates on changed or completed uploads", () => {
    const initial = { key: "request-1" };
    const firstAttempt = screenshotUploadRequest(
      initial,
      "payload-1",
      "retry",
      () => "request-2",
    );
    expect(firstAttempt).toEqual({ key: "request-1", signature: "payload-1" });
    const retry = screenshotUploadRequest(
      firstAttempt,
      "payload-1",
      "retry",
      () => "request-3",
    );
    expect(retry.key).toBe("request-1");
    const changed = screenshotUploadRequest(
      retry,
      "payload-2",
      "retry",
      () => "request-3",
    );
    expect(changed).toEqual({ key: "request-3", signature: "payload-2" });
    expect(
      screenshotUploadRequest(
        changed,
        "payload-2",
        "success",
        () => "request-4",
      ),
    ).toEqual({
      key: "request-4",
    });
  });

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
    expect(proofSource).toContain("const form = event.currentTarget");
    expect(proofSource).toContain("uploadRequestRef.current.key");
    expect(proofSource).toContain("URL.createObjectURL");
    expect(proofSource).toContain("Retry preview");
    expect(proofSource).toContain("image/png,image/jpeg,image/webp");
    expect(stylesheet).toContain(".screenshot-proof-form-grid {");
    expect(stylesheet).toContain("@media (max-width: 540px)");
  });

  test("rejects oversized files before reading their bytes", () => {
    const sizeCheck = proofSource.indexOf("file.size > MAX_SCREENSHOT_BYTES");
    const arrayBufferRead = proofSource.indexOf("file.arrayBuffer()");
    expect(proofSource).toContain("MAX_SCREENSHOT_BYTES");
    expect(sizeCheck).toBeGreaterThanOrEqual(0);
    expect(arrayBufferRead).toBeGreaterThan(sizeCheck);
  });

  test("keeps screenshot upload compact and places it below the subtask row", () => {
    expect(proofSource).toContain('className="screenshot-proof-upload"');
    expect(proofSource).toContain("<summary>Add screenshot</summary>");
    expect(proofSource).toContain('className="screenshot-proof-metadata"');
    expect(proofSource).toContain("<summary>Optional metadata</summary>");
    expect(proofSource).toContain("<span>Comparison group</span>");
    expect(proofSource).not.toContain("<span>Pair ID</span>");

    const actions = mainSource.indexOf('className="subtask-actions"');
    const subtaskScreenshot = mainSource.indexOf("ownerLabel={`Subtask");
    expect(subtaskScreenshot).toBeGreaterThan(actions);
    expect(stylesheet).toContain(".subtask.row-expanded > .screenshot-proof {");
    expect(stylesheet).toContain(
      ".subtask.row-expanded > .history {\n  flex-basis: 100%;",
    );
  });
});
