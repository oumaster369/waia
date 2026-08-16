import { createHash, type Hash } from "node:crypto";

import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import type { Bar } from "@/lib/trader/intelligence/types";

/** Bounded-memory semantic digest of ordered 1m bars. Never materializes the corpus. */
export const FHV_STREAMING_BAR_SEMANTIC_DIGEST_ALGO =
  "sha256-newline-bar-content-digests/v1" as const;

export function createStreamingBarSemanticHasher(): Hash {
  return createHash("sha256");
}

export function updateStreamingBarSemanticHasher(
  hasher: Hash,
  barOrContentDigest: Bar | string,
): void {
  const digest =
    typeof barOrContentDigest === "string"
      ? barOrContentDigest
      : computeBarContentDigest(barOrContentDigest);
  hasher.update(digest);
  hasher.update("\n");
}

export function finalizeStreamingBarSemanticDigest(hasher: Hash): string {
  return hasher.digest("hex");
}

export function streamingBarSemanticDigestOf(bars: readonly Bar[]): string {
  const hasher = createStreamingBarSemanticHasher();
  for (const bar of bars) {
    updateStreamingBarSemanticHasher(hasher, bar);
  }
  return finalizeStreamingBarSemanticDigest(hasher);
}
