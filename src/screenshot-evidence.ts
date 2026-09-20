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

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    (((bytes[offset] ?? 0) << 24) |
      ((bytes[offset + 1] ?? 0) << 16) |
      ((bytes[offset + 2] ?? 0) << 8) |
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16) |
      ((bytes[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1) >>> 0;
  }
  return value;
});

function pngCrc(bytes: Uint8Array, start: number, end: number): number {
  let value = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    value =
      (PNG_CRC_TABLE[(value ^ bytes[index]!) & 0xff]! ^ (value >>> 8)) >>> 0;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function isValidPng(bytes: Uint8Array): boolean {
  if (
    bytes.length < 33 ||
    ![0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (byte, index) => bytes[index] === byte,
    )
  ) {
    return false;
  }

  let offset = 8;
  let sawHeader = false;
  let sawData = false;
  while (offset + 12 <= bytes.length) {
    const length = readUint32BE(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) return false;
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    if (
      pngCrc(bytes, offset + 4, dataStart + length) !==
      readUint32BE(bytes, dataStart + length)
    ) {
      return false;
    }
    if (type === "IHDR") {
      if (sawHeader || length !== 13) return false;
      const width = readUint32BE(bytes, dataStart);
      const height = readUint32BE(bytes, dataStart + 4);
      if (width < 1 || height < 1) return false;
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader || length === 0) return false;
      sawData = true;
    } else if (type === "IEND") {
      return sawHeader && sawData && length === 0 && chunkEnd === bytes.length;
    }
    offset = chunkEnd;
  }
  return false;
}

function isJpegSof(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function isValidJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return false;
  }
  let offset = 2;
  let sawFrame = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined) return false;
    if (marker === 0xd9) return sawFrame && offset === bytes.length;
    if (marker === 0xda) {
      if (offset + 2 > bytes.length) return false;
      const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
      if (length < 2 || offset + length > bytes.length) return false;
      offset += length;
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const next = bytes[offset + 1]!;
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2;
          continue;
        }
        return next === 0xd9 && sawFrame && offset + 2 === bytes.length;
      }
      return false;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return false;
    const length = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) return false;
    if (isJpegSof(marker)) {
      if (length < 7) return false;
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      if (width < 1 || height < 1) return false;
      sawFrame = true;
    }
    offset += length;
  }
  return false;
}

function isValidWebp(bytes: Uint8Array): boolean {
  if (
    bytes.length < 20 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    readUint32LE(bytes, 4) !== bytes.length - 8
  ) {
    return false;
  }
  let offset = 12;
  let sawImage = false;
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4);
    const length = readUint32LE(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const paddedEnd = dataEnd + (length & 1);
    if (paddedEnd > bytes.length) return false;
    if (type === "VP8 ") {
      if (
        length < 10 ||
        bytes[dataStart + 3] !== 0x9d ||
        bytes[dataStart + 4] !== 0x01 ||
        bytes[dataStart + 5] !== 0x2a
      ) {
        return false;
      }
      const width = bytes[dataStart + 6]! | (bytes[dataStart + 7]! << 8);
      const height = bytes[dataStart + 8]! | (bytes[dataStart + 9]! << 8);
      if (width < 1 || height < 1) return false;
      sawImage = true;
    } else if (type === "VP8L") {
      if (length < 5 || bytes[dataStart] !== 0x2f) return false;
      const width =
        1 + (bytes[dataStart + 1]! | ((bytes[dataStart + 2]! & 0x3f) << 8));
      const height =
        1 +
        (((bytes[dataStart + 2]! >> 6) |
          (bytes[dataStart + 3]! << 2) |
          ((bytes[dataStart + 4]! & 0x0f) << 10)) >>>
          0);
      if (width < 1 || height < 1) return false;
      sawImage = true;
    } else if (type === "VP8X") {
      if (length < 10) return false;
      const width =
        1 +
        (bytes[dataStart + 4]! |
          (bytes[dataStart + 5]! << 8) |
          (bytes[dataStart + 6]! << 16));
      const height =
        1 +
        (bytes[dataStart + 7]! |
          (bytes[dataStart + 8]! << 8) |
          (bytes[dataStart + 9]! << 16));
      if (width < 1 || height < 1) return false;
    }
    offset = paddedEnd;
  }
  return offset === bytes.length && sawImage;
}

/**
 * Validate the bounded container structure, dimensions, chunk lengths, and
 * checksums available in the supported formats. This deliberately stops short
 * of decoding pixels; browser rendering remains the final visual check.
 */
function isStructurallyValidImage(
  contentType: ScreenshotContentType,
  bytes: Uint8Array,
): boolean {
  if (contentType === "image/png") {
    return isValidPng(bytes);
  }
  if (contentType === "image/jpeg") {
    return isValidJpeg(bytes);
  }
  return isValidWebp(bytes);
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
  if (
    !isStructurallyValidImage(contentType, screenshotBytes(input.dataBase64))
  ) {
    throw new Error("Screenshot bytes are not a structurally valid image.");
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
