export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024;

export const SCREENSHOT_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type ScreenshotContentType = (typeof SCREENSHOT_CONTENT_TYPES)[number];
export type ScreenshotLabel = "before" | "after";

export type ScreenshotEvidence = {
  id: string;
  projectId: string;
  taskId?: string;
  subtaskId?: string;
  contentType: ScreenshotContentType;
  dataBase64: string;
  sizeBytes: number;
  caption: string;
  uploader: string;
  uploaderKind: "human" | "machine";
  uploadedAt: Date | string;
  capturedAt?: Date | string;
  captureContext?: string;
  testedRevision?: string;
  pairId?: string;
  label?: ScreenshotLabel;
};

export type ScreenshotEvidenceSummary = Omit<ScreenshotEvidence, "dataBase64">;

export type CreateScreenshotEvidenceInput = {
  id: string;
  projectId: string;
  taskId?: string;
  subtaskId?: string;
  contentType: string;
  dataBase64: string;
  caption: string;
  uploader: string;
  uploaderKind: "human" | "machine";
  uploadedAt?: Date | string;
  capturedAt?: Date | string;
  captureContext?: string;
  testedRevision?: string;
  pairId?: string;
  label?: ScreenshotLabel;
};

export function screenshotSummary(
  evidence: ScreenshotEvidence,
): ScreenshotEvidenceSummary {
  const { dataBase64: _dataBase64, ...summary } = evidence;
  return summary;
}

export function screenshotByteLength(dataBase64: string): number {
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(dataBase64) ||
    dataBase64.length % 4 !== 0
  ) {
    throw new Error("Screenshot data must be valid base64.");
  }
  const padding = dataBase64.endsWith("==")
    ? 2
    : dataBase64.endsWith("=")
      ? 1
      : 0;
  return Math.floor((dataBase64.length * 3) / 4) - padding;
}

function screenshotBytes(dataBase64: string): Uint8Array {
  const binary = atob(dataBase64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hasSignature(
  contentType: ScreenshotContentType,
  bytes: Uint8Array,
): boolean {
  if (contentType === "image/png") {
    // Require the signature and the first IHDR chunk so a renamed text file or
    // truncated signature is not accepted as an image.
    return (
      bytes.length >= 24 &&
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
        (byte, index) => bytes[index] === byte,
      ) &&
      bytes[8] === 0 &&
      bytes[9] === 0 &&
      bytes[10] === 0 &&
      bytes[11] === 0x0d &&
      bytes[12] === 0x49 &&
      bytes[13] === 0x48 &&
      bytes[14] === 0x44 &&
      bytes[15] === 0x52 &&
      bytes[16] !== undefined
    );
  }
  if (contentType === "image/jpeg") {
    return (
      bytes.length >= 4 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff &&
      bytes[3] !== 0x00
    );
  }
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function normalizeScreenshotEvidence(
  input: CreateScreenshotEvidenceInput | ScreenshotEvidence,
): ScreenshotEvidence {
  if (typeof input.id !== "string" || !input.id.trim()) {
    throw new Error("Screenshot ID must not be empty.");
  }
  if (typeof input.projectId !== "string" || !input.projectId.trim()) {
    throw new Error("Screenshot Project ID must not be empty.");
  }
  const hasTask = typeof input.taskId === "string" && input.taskId.trim();
  const hasSubtask =
    typeof input.subtaskId === "string" && input.subtaskId.trim();
  if (Boolean(hasTask) === Boolean(hasSubtask)) {
    throw new Error("Screenshot must belong to exactly one Task or Subtask.");
  }
  if (
    !SCREENSHOT_CONTENT_TYPES.includes(
      input.contentType as ScreenshotContentType,
    )
  ) {
    throw new Error(
      `Screenshot content type must be one of ${SCREENSHOT_CONTENT_TYPES.join(", ")}.`,
    );
  }
  if (typeof input.dataBase64 !== "string") {
    throw new Error("Screenshot data must be base64.");
  }
  const sizeBytes = screenshotByteLength(input.dataBase64);
  if (sizeBytes < 1 || sizeBytes > MAX_SCREENSHOT_BYTES) {
    throw new Error(
      `Screenshot must be between 1 byte and ${MAX_SCREENSHOT_BYTES} bytes.`,
    );
  }
  const contentType = input.contentType as ScreenshotContentType;
  if (!hasSignature(contentType, screenshotBytes(input.dataBase64))) {
    throw new Error("Screenshot bytes do not match the declared image type.");
  }
  if (typeof input.caption !== "string" || !input.caption.trim()) {
    throw new Error("Screenshot caption must not be empty.");
  }
  if (typeof input.uploader !== "string" || !input.uploader.trim()) {
    throw new Error("Screenshot uploader must not be empty.");
  }
  const validateDate = (value: Date | string | undefined, field: string) => {
    if (
      value !== undefined &&
      ((value instanceof Date && !Number.isFinite(value.getTime())) ||
        (typeof value === "string" && !Number.isFinite(Date.parse(value))) ||
        (typeof value !== "string" && !(value instanceof Date)))
    ) {
      throw new Error(`Screenshot ${field} must be a valid date.`);
    }
  };
  validateDate(input.uploadedAt, "upload time");
  validateDate(input.capturedAt, "capture time");

  const optionalText = (
    value: string | undefined,
    field: string,
  ): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Screenshot ${field} must not be blank when provided.`);
    }
    return value.trim();
  };

  if (input.uploaderKind !== "human" && input.uploaderKind !== "machine") {
    throw new Error("Screenshot uploader kind is invalid.");
  }
  if (
    input.label !== undefined &&
    input.label !== "before" &&
    input.label !== "after"
  ) {
    throw new Error("Screenshot label is invalid.");
  }
  const captureContext = optionalText(input.captureContext, "capture context");
  const testedRevision = optionalText(input.testedRevision, "tested revision");
  const pairId = optionalText(input.pairId, "pair ID");
  return {
    id: input.id.trim(),
    projectId: input.projectId.trim(),
    ...(hasTask ? { taskId: input.taskId!.trim() } : {}),
    ...(hasSubtask ? { subtaskId: input.subtaskId!.trim() } : {}),
    contentType,
    dataBase64: input.dataBase64,
    sizeBytes,
    caption: input.caption.trim(),
    uploader: input.uploader.trim(),
    uploaderKind: input.uploaderKind,
    uploadedAt: new Date(input.uploadedAt ?? new Date()),
    ...(input.capturedAt ? { capturedAt: new Date(input.capturedAt) } : {}),
    ...(captureContext ? { captureContext } : {}),
    ...(testedRevision ? { testedRevision } : {}),
    ...(pairId ? { pairId } : {}),
    ...(input.label === undefined ? {} : { label: input.label }),
  };
}

export function parseScreenshotDataUrl(value: string): {
  contentType: ScreenshotContentType;
  dataBase64: string;
} {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(value);
  if (!match?.[1] || match[2] === undefined) {
    throw new Error("Screenshot upload must be an image data URL.");
  }
  return {
    contentType: match[1] as ScreenshotContentType,
    dataBase64: match[2],
  };
}
