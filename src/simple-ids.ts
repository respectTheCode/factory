export const TASK_SIMPLE_ID_PREFIX = "T-";
export const SUBTASK_SIMPLE_ID_PREFIX = "ST-";

type SimpleIdRecord = {
  id: string;
  simpleId?: string;
};

function simpleIdNumber(simpleId: string | undefined, prefix: string): number {
  if (!simpleId) return 0;
  const match = new RegExp(`^${prefix}(\\d+)$`, "i").exec(simpleId.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export function nextSimpleId(
  records: SimpleIdRecord[],
  prefix: string,
): string {
  return `${prefix}${nextSimpleIdNumber(records, prefix)}`;
}

export function nextSimpleIdNumber(
  records: SimpleIdRecord[],
  prefix: string,
): number {
  const highest = records.reduce(
    (current, record) =>
      Math.max(current, simpleIdNumber(record.simpleId, prefix)),
    0,
  );
  return highest + 1;
}

export function backfillSimpleIds<T extends SimpleIdRecord>(
  records: T[],
  prefix: string,
): T[] {
  const used = new Set<number>();
  const firstIndexByValue = new Map<number, number>();
  let next = 1;

  for (const [index, record] of records.entries()) {
    const value = simpleIdNumber(record.simpleId, prefix);
    if (value > 0 && !firstIndexByValue.has(value)) {
      firstIndexByValue.set(value, index);
      used.add(value);
      next = Math.max(next, value + 1);
    }
  }

  // Existing valid references win. Assign legacy or duplicate rows in their
  // persisted order so a backfill is deterministic without changing UUIDs.
  return records.map((record, index) => {
    const value = simpleIdNumber(record.simpleId, prefix);
    if (value > 0 && firstIndexByValue.get(value) === index) {
      return { ...record, simpleId: `${prefix}${value}` };
    }

    while (used.has(next)) next += 1;
    used.add(next);
    const assigned = `${prefix}${next}`;
    next += 1;
    return { ...record, simpleId: assigned };
  });
}

export function normalizeSimpleId(value: string): string {
  return value.trim().toUpperCase();
}

export function matchesSimpleId(
  candidate: SimpleIdRecord,
  requested: string,
  prefix: string,
): boolean {
  return (
    candidate.simpleId !== undefined &&
    simpleIdNumber(candidate.simpleId, prefix) > 0 &&
    normalizeSimpleId(candidate.simpleId) === normalizeSimpleId(requested)
  );
}
