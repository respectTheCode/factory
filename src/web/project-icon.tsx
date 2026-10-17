import { useEffect, useState } from "react";
import type { createTRPCProxyClient } from "@trpc/client";
import type { FactoryRouter } from "../server";

export type ProjectIconSummary = {
  id: string;
  name: string;
  t3ProjectIcon?:
    | { kind: "emoji"; emoji: string }
    | { kind: "monogram"; text: string; color: string }
    | { kind: "lucide"; name: string; color: string };
  t3FaviconAvailable?: boolean;
};
type Client = ReturnType<typeof createTRPCProxyClient<FactoryRouter>>;
type IconAsset = { mimeType: string; data: string } | null;
const requests = new WeakMap<
  Client,
  Map<string, { expires: number; result: Promise<IconAsset> }>
>();

function loadIcon(
  client: Client,
  project: ProjectIconSummary,
): Promise<IconAsset> {
  let cache = requests.get(client);
  if (!cache) {
    cache = new Map();
    requests.set(client, cache);
  }
  const key = `${project.id}:${JSON.stringify(project.t3ProjectIcon ?? null)}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = client.projects.favicon
    .query({ projectId: project.id })
    .catch(() => null);
  cache.set(key, { expires: Date.now() + 60_000, result });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  return result;
}

export function ProjectIcon({
  client,
  project,
}: {
  client: Client | null;
  project: ProjectIconSummary;
}) {
  const icon = project.t3ProjectIcon;
  const [asset, setAsset] = useState<{ key: string; url: string } | null>(null);
  const key = `${project.id}:${JSON.stringify(icon ?? null)}`;
  const needsAsset =
    icon?.kind === "lucide" || (!icon && project.t3FaviconAvailable);
  useEffect(() => {
    let current = true;
    if (client && needsAsset) {
      void loadIcon(client, project).then((image) => {
        if (current && image)
          setAsset({ key, url: `data:${image.mimeType};base64,${image.data}` });
      });
    }
    return () => {
      current = false;
    };
  }, [client, key, needsAsset]);

  const color = icon && "color" in icon ? icon.color : "gray";
  if (icon?.kind === "emoji")
    return (
      <span aria-hidden="true" className="project-icon project-icon-emoji">
        {icon.emoji}
      </span>
    );
  if (icon?.kind === "monogram")
    return (
      <span
        aria-hidden="true"
        className="project-icon project-icon-monogram"
        data-color={color}
      >
        {icon.text}
      </span>
    );
  if (asset?.key === key)
    return (
      <img
        alt=""
        className="project-icon"
        data-color={color}
        onError={() => setAsset(null)}
        src={asset.url}
      />
    );
  return (
    <span
      aria-hidden="true"
      className="project-icon project-icon-fallback"
      data-color={color}
    >
      {Array.from(project.name.trim())[0]?.toUpperCase() ?? "?"}
    </span>
  );
}
