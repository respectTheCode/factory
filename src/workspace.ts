import { isAbsolute, normalize } from "node:path";

// Remote observations must not acquire an identity from this process's cwd.
// Lexical normalization works even when the observed checkout is not mounted here.
export function normalizeWorkspaceRoot(
  value: string | null | undefined,
): string | undefined {
  const root = value?.trim();
  if (!root || !isAbsolute(root)) return undefined;
  const normalized = normalize(root);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

export function sameWorkspaceRoot(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const normalized = normalizeWorkspaceRoot(left);
  return (
    normalized !== undefined && normalized === normalizeWorkspaceRoot(right)
  );
}
