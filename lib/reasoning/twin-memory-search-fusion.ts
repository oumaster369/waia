import "server-only";

import type { TwinMemorySearchHit } from "@/lib/twin-persistence/twin-memory-retrieval";

function hitKey(h: TwinMemorySearchHit): string {
  return `${h.source}:${h.id}`;
}

/**
 * DEE-72.4: Deterministic fuse of per-seed memory retrieval slices (max score wins per stable key).
 * Same semantics as legacy inline loops in pattern summary / contradiction detector — single implementation.
 */
export function fuseMemorySearchSlices(
  slices: TwinMemorySearchHit[][],
  maxFusedItems: number,
): TwinMemorySearchHit[] {
  const merged = new Map<string, TwinMemorySearchHit>();

  for (const slice of slices) {
    for (const hit of slice) {
      const k = hitKey(hit);
      const prev = merged.get(k);
      if (prev === undefined || hit.score > prev.score) {
        merged.set(k, hit);
      }
    }
  }

  const fused = [...merged.values()].sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const ka = `${a.source}\0${a.id}`;
    const kb = `${b.source}\0${b.id}`;
    return ka.localeCompare(kb);
  });

  return fused.slice(0, maxFusedItems);
}
