/**
 * Stable identity for one external T3 installation/agent source.
 *
 * Older Factory snapshots and callers did not carry a source identifier. They
 * are deterministically migrated to this legacy namespace so that adding a
 * second source cannot make old threads collide with it.
 */
export const LEGACY_T3_SOURCE_ID = "legacy";

const T3_SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizeT3SourceId(sourceId?: string | null): string {
  const normalized = sourceId?.trim();
  if (!normalized) return LEGACY_T3_SOURCE_ID;
  if (!T3_SOURCE_ID_PATTERN.test(normalized)) {
    throw new Error(
      "T3 source ID must start with a letter or number and contain only letters, numbers, '.', '_' or '-'.",
    );
  }
  return normalized;
}

export type T3ProjectMapping = {
  sourceId: string;
  workspaceRoot?: string;
  t3ProjectId?: string;
};
