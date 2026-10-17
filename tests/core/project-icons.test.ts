import { expect, test } from "bun:test";
import { readLucideProjectIcon } from "../../src/project-icons";

test("renders a packaged T3 Lucide override with its selected color", async () => {
  const icon = await readLucideProjectIcon({
    kind: "lucide",
    name: "brain-cog",
    color: "teal",
  });
  expect(icon?.mimeType).toBe("image/svg+xml");
  const svg = Buffer.from(icon!.data, "base64").toString("utf8");
  expect(svg).toContain('class="lucide lucide-brain-cog"');
  expect(svg).toContain('stroke="#2dd4bf"');
});

test("ignores unavailable and invalid Lucide names", async () => {
  for (const name of [
    "../../package",
    "unknown-icon-name-that-does-not-exist",
    "",
    "BrainCog",
  ]) {
    expect(
      await readLucideProjectIcon({ kind: "lucide", name, color: "blue" }),
    ).toBeNull();
  }
});
