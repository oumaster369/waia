import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { bumpIdhpsCounter } from "@/lib/trader/execution/idhps-hot-path-counters";

const cache = new Map<string, string>();
let normalizeCount = 0;

export function resetIdhpsDecimalNormalizeCache(): void {
  cache.clear();
  normalizeCount = 0;
}

export function getIdhpsDecimalNormalizeCount(): number {
  return normalizeCount;
}

/**
 * Cache-normalized decimal string for hot-path mirrors. Counts unique normalize ops.
 */
export function normalizeDecimalStringCached(value: string): string {
  const hit = cache.get(value);
  if (hit !== undefined) {
    return hit;
  }
  normalizeCount += 1;
  bumpIdhpsCounter("canonicalSerializeCount");
  // Preserve exact decimal string identity for already-canonical inputs;
  // trim only trivial leading/trailing whitespace (no scientific rewrite).
  const normalized = value.trim();
  cache.set(value, normalized);
  return normalized;
}
