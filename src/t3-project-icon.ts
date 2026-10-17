const PROJECT_ICON_COLORS = [
  "gray",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;

export type T3ProjectIconColor = (typeof PROJECT_ICON_COLORS)[number];

export type T3ProjectIcon =
  | { kind: "lucide"; name: string; color: T3ProjectIconColor }
  | { kind: "emoji"; emoji: string }
  | { kind: "monogram"; text: string; color: T3ProjectIconColor };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isProjectIconColor(value: unknown): value is T3ProjectIconColor {
  return (
    typeof value === "string" &&
    PROJECT_ICON_COLORS.includes(value as T3ProjectIconColor)
  );
}

/**
 * Normalize T3's forward-compatible project icon union. T3's stored format
 * accepts legacy Lucide monogram fields, and its wire format maps unknown
 * variants to null so an icon addition cannot invalidate a shell snapshot.
 */
export function parseT3ProjectIcon(value: unknown): T3ProjectIcon | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === "emoji") {
    if (!nonEmptyString(value.emoji) || value.emoji.length > 32)
      return undefined;
    return { kind: "emoji", emoji: value.emoji };
  }
  if (value.kind === "monogram") {
    if (
      !nonEmptyString(value.text) ||
      value.text.length > 32 ||
      !isProjectIconColor(value.color)
    ) {
      return undefined;
    }
    return { kind: "monogram", text: value.text, color: value.color };
  }
  if (value.kind !== "lucide") return undefined;
  const legacyMonogram = value.monogramText ?? value.monogram;
  if (legacyMonogram !== undefined && legacyMonogram !== null) {
    if (
      !nonEmptyString(legacyMonogram) ||
      legacyMonogram.length > 32 ||
      !isProjectIconColor(value.color)
    ) {
      return undefined;
    }
    return { kind: "monogram", text: legacyMonogram, color: value.color };
  }
  if (
    typeof value.name !== "string" ||
    value.name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.name) ||
    !isProjectIconColor(value.color)
  ) {
    return undefined;
  }
  return { kind: "lucide", name: value.name, color: value.color };
}

/** Ignore unsupported optional artwork paths without rejecting the shell. */
export function parseT3ProjectFaviconPath(value: unknown): string | undefined {
  if (
    !nonEmptyString(value) ||
    value.length > 1024 ||
    !/\.(?:avif|gif|icns|ico|jpe?g|png|svg|webp)$/i.test(value)
  ) {
    return undefined;
  }
  return value;
}
