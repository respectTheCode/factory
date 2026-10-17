import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import type { T3ProjectIcon } from "./t3-project-icon";
import type { T3ProjectFavicon } from "./t3";

const colors = {
  gray: "#9ca3af",
  red: "#f87171",
  orange: "#fb923c",
  amber: "#fbbf24",
  yellow: "#facc15",
  lime: "#a3e635",
  green: "#4ade80",
  emerald: "#34d399",
  teal: "#2dd4bf",
  cyan: "#22d3ee",
  sky: "#38bdf8",
  blue: "#60a5fa",
  indigo: "#818cf8",
  violet: "#a78bfa",
  purple: "#c084fc",
  fuchsia: "#e879f9",
  pink: "#f472b6",
  rose: "#fb7185",
} as const;

/** Resolve only packaged Lucide SVGs; no source URL or user-provided file path. */
export async function readLucideProjectIcon(
  icon: Extract<T3ProjectIcon, { kind: "lucide" }>,
): Promise<T3ProjectFavicon | null> {
  if (icon.name.length > 64 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(icon.name))
    return null;
  try {
    const path = fileURLToPath(
      new URL(
        `./icons/${icon.name}.svg`,
        import.meta.resolve("lucide-static/package.json"),
      ),
    );
    const svg = (await readFile(path, "utf8")).replaceAll(
      "currentColor",
      colors[icon.color] ?? colors.gray,
    );
    return {
      mimeType: "image/svg+xml",
      data: Buffer.from(svg).toString("base64"),
    };
  } catch {
    return null;
  }
}
