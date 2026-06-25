function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortKeysDeep(record[key]);
  }
  return sorted;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}
