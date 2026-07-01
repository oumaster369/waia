import { createHash } from "node:crypto";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortKeysDeep(entry));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort((a, b) => a.localeCompare(b))
        .map((key) => [key, sortKeysDeep(record[key])]),
    );
  }
  return value;
}

export function canonicalJsonString(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

/** SHA-256 hex digest of canonically serialized JSON (paper-export parity). */
export function computeStableJsonDigest(payload: unknown): string {
  return createHash("sha256").update(canonicalJsonString(payload), "utf8").digest("hex");
}
