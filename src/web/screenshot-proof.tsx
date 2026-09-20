import { useEffect, useMemo, useState } from "react";

import type {
  ScreenshotContentType,
  ScreenshotEvidence,
  ScreenshotEvidenceSummary,
} from "../screenshot-evidence";

type ScreenshotProofProps = {
  canMutate: boolean;
  busy: boolean;
  ownerLabel: string;
  screenshots: ScreenshotEvidenceSummary[];
  onGet: (screenshotId: string) => Promise<ScreenshotEvidence>;
  onUpload: (input: {
    capturedAt?: string;
    captureContext?: string;
    caption: string;
    contentType: ScreenshotContentType;
    dataBase64: string;
    label?: "before" | "after";
    pairId?: string;
    requestKey: string;
    testedRevision?: string;
  }) => Promise<void>;
};

function formatDate(value: Date | string | undefined): string {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Unavailable";
}

async function fileData(file: File): Promise<{
  contentType: ScreenshotContentType;
  dataBase64: string;
}> {
  const contentType = file.type as ScreenshotContentType;
  if (
    contentType !== "image/png" &&
    contentType !== "image/jpeg" &&
    contentType !== "image/webp"
  ) {
    throw new Error("Choose a PNG, JPEG, or WebP screenshot.");
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { contentType, dataBase64: btoa(binary) };
}

export function ScreenshotProof({
  busy,
  canMutate,
  onGet,
  onUpload,
  ownerLabel,
  screenshots,
}: ScreenshotProofProps) {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState("");
  const [captureContext, setCaptureContext] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [testedRevision, setTestedRevision] = useState("");
  const [pairId, setPairId] = useState("");
  const [label, setLabel] = useState<"" | "before" | "after">("");
  const [loaded, setLoaded] = useState<Record<string, ScreenshotEvidence>>({});
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const screenshotIds = useMemo(
    () => screenshots.map((screenshot) => screenshot.id).join(","),
    [screenshots],
  );

  useEffect(() => {
    let active = true;
    const missing = screenshots.filter((screenshot) => !loaded[screenshot.id]);
    void Promise.all(
      missing.map(async (screenshot) => {
        try {
          return await onGet(screenshot.id);
        } catch {
          return undefined;
        }
      }),
    ).then((results) => {
      if (!active) return;
      setLoaded((current) => {
        const next = { ...current };
        for (const result of results) {
          if (result) next[result.id] = result;
        }
        return next;
      });
    });
    return () => {
      active = false;
    };
    // The callback is owned by the dashboard connection; IDs are the data dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshotIds]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || !caption.trim()) return;
    setError(null);
    setUploading(true);
    try {
      const encoded = await fileData(file);
      await onUpload({
        ...encoded,
        caption: caption.trim(),
        ...(capturedAt
          ? { capturedAt: new Date(capturedAt).toISOString() }
          : {}),
        ...(captureContext.trim()
          ? { captureContext: captureContext.trim() }
          : {}),
        ...(testedRevision.trim()
          ? { testedRevision: testedRevision.trim() }
          : {}),
        ...(pairId.trim() ? { pairId: pairId.trim() } : {}),
        ...(label ? { label } : {}),
        requestKey: crypto.randomUUID(),
      });
      setFile(null);
      setCaption("");
      setCaptureContext("");
      setCapturedAt("");
      setTestedRevision("");
      setPairId("");
      setLabel("");
      const input =
        event.currentTarget.querySelector<HTMLInputElement>(
          'input[type="file"]',
        );
      if (input) input.value = "";
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Screenshot upload failed.",
      );
    } finally {
      setUploading(false);
    }
  };

  const renderCard = (summary: ScreenshotEvidenceSummary) => {
    const image = loaded[summary.id];
    const src = image
      ? `data:${image.contentType};base64,${image.dataBase64}`
      : undefined;
    return (
      <article className="screenshot-proof-card" key={summary.id}>
        {src ? (
          <a
            aria-label={`Open full-size screenshot: ${summary.caption}`}
            href={src}
            rel="noreferrer"
            target="_blank"
          >
            <img alt={summary.caption} loading="lazy" src={src} />
          </a>
        ) : (
          <span className="screenshot-proof-loading">Loading preview…</span>
        )}
        <strong>{summary.caption}</strong>
        <div className="screenshot-proof-meta">
          <span>{summary.label ?? "Unlabeled"}</span>
          <span>by {summary.uploader}</span>
          <span>uploaded {formatDate(summary.uploadedAt)}</span>
          <span>captured {formatDate(summary.capturedAt)}</span>
          <span>revision {summary.testedRevision ?? "Unavailable"}</span>
          <span>context {summary.captureContext ?? "Unavailable"}</span>
        </div>
      </article>
    );
  };
  const screenshotGroups = useMemo(() => {
    const groups = new Map<string, ScreenshotEvidenceSummary[]>();
    for (const screenshot of screenshots) {
      const key = screenshot.pairId ?? `single:${screenshot.id}`;
      const group = groups.get(key) ?? [];
      group.push(screenshot);
      groups.set(key, group);
    }
    return [...groups.values()];
  }, [screenshots]);

  return (
    <section
      aria-label={`${ownerLabel} screenshot proof`}
      className="screenshot-proof"
    >
      <div className="screenshot-proof-heading">
        <div>
          <strong>Screenshot proof</strong>
          <span>{screenshots.length} attached</span>
        </div>
        <small>Evidence supplements reports and never verifies work.</small>
      </div>
      {screenshots.length > 0 && (
        <div className="screenshot-proof-grid">
          {screenshotGroups.map((group) => {
            const isComparison =
              group.length > 1 &&
              group.some((screenshot) => screenshot.label === "before") &&
              group.some((screenshot) => screenshot.label === "after");
            if (!isComparison) return group.map(renderCard);
            return (
              <div
                className="screenshot-proof-comparison"
                key={group[0]?.pairId}
              >
                <strong>Before / After comparison</strong>
                <div className="screenshot-proof-comparison-grid">
                  {group
                    .slice()
                    .sort((left, right) =>
                      left.label === "before" && right.label === "after"
                        ? -1
                        : 1,
                    )
                    .map(renderCard)}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canMutate && (
        <form
          className="screenshot-proof-form"
          onSubmit={(event) => void submit(event)}
        >
          <label>
            <span>Screenshot file</span>
            <input
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || uploading}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </label>
          <label>
            <span>Caption</span>
            <input
              disabled={busy || uploading}
              onChange={(event) => setCaption(event.target.value)}
              placeholder="What this proves"
              value={caption}
            />
          </label>
          <div className="screenshot-proof-form-grid">
            <label>
              <span>Pair label</span>
              <select
                disabled={busy || uploading}
                onChange={(event) =>
                  setLabel(event.target.value as "" | "before" | "after")
                }
                value={label}
              >
                <option value="">Unlabeled</option>
                <option value="before">Before</option>
                <option value="after">After</option>
              </select>
            </label>
            <label>
              <span>Pair ID</span>
              <input
                disabled={busy || uploading}
                onChange={(event) => setPairId(event.target.value)}
                placeholder="Optional comparison group"
                value={pairId}
              />
            </label>
            <label>
              <span>Tested revision</span>
              <input
                disabled={busy || uploading}
                onChange={(event) => setTestedRevision(event.target.value)}
                placeholder="Optional commit"
                value={testedRevision}
              />
            </label>
          </div>
          <label>
            <span>Capture context</span>
            <input
              disabled={busy || uploading}
              onChange={(event) => setCaptureContext(event.target.value)}
              placeholder="Optional device or viewport"
              value={captureContext}
            />
          </label>
          <label>
            <span>Captured at</span>
            <input
              disabled={busy || uploading}
              onChange={(event) => setCapturedAt(event.target.value)}
              type="datetime-local"
              value={capturedAt}
            />
          </label>
          <button
            disabled={busy || uploading || !file || !caption.trim()}
            type="submit"
          >
            {uploading ? "Uploading…" : "Attach screenshot"}
          </button>
        </form>
      )}
      {error && (
        <p className="screenshot-proof-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
