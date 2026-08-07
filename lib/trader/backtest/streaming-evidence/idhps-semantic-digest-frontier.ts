import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import { bumpIdhpsCounter } from "@/lib/trader/execution/idhps-hot-path-counters";

export const IDHPS_SEMANTIC_DIGEST_FRONTIER_SCHEMA_VERSION =
  "idhps-semantic-digest-frontier/v1" as const;

export type IdhpsSemanticDigestFrontierV1 = {
  schemaVersion: typeof IDHPS_SEMANTIC_DIGEST_FRONTIER_SCHEMA_VERSION;
  lastEventDigest: string | null;
  incrementalChainDigest: string | null;
  lastCycle: number;
  eventCount: number;
};

export function createEmptyIdhpsSemanticDigestFrontier(): IdhpsSemanticDigestFrontierV1 {
  return {
    schemaVersion: IDHPS_SEMANTIC_DIGEST_FRONTIER_SCHEMA_VERSION,
    lastEventDigest: null,
    incrementalChainDigest: null,
    lastCycle: 0,
    eventCount: 0,
  };
}

export function digestIdhpsSemanticDigestFrontier(frontier: IdhpsSemanticDigestFrontierV1): string {
  return createHash("sha256").update(canonicalJsonString(frontier), "utf8").digest("hex");
}

/**
 * Fold one event digest into the incremental chain. Does not rehash the full event history.
 */
export function foldIdhpsSemanticEventDigest(
  frontier: IdhpsSemanticDigestFrontierV1,
  input: { eventDigest: string; cycle: number },
): void {
  const prior = frontier.incrementalChainDigest ?? "";
  frontier.incrementalChainDigest = createHash("sha256")
    .update(`${prior}|${input.eventDigest}`, "utf8")
    .digest("hex");
  frontier.lastEventDigest = input.eventDigest;
  frontier.lastCycle = input.cycle;
  frontier.eventCount += 1;
}

/** Full-chain recompute is allowed only at seal/epoch boundaries. */
export function noteIdhpsFullChainDigestRecompute(): void {
  bumpIdhpsCounter("fullChainDigestRecomputes");
}

export function captureIdhpsSemanticDigestFrontier(
  frontier: IdhpsSemanticDigestFrontierV1,
): IdhpsSemanticDigestFrontierV1 {
  return structuredClone(frontier);
}

export function restoreIdhpsSemanticDigestFrontier(
  snapshot: IdhpsSemanticDigestFrontierV1,
): IdhpsSemanticDigestFrontierV1 {
  if (snapshot.schemaVersion !== IDHPS_SEMANTIC_DIGEST_FRONTIER_SCHEMA_VERSION) {
    throw new Error("BLOCKED_BY_H_ARCH_1_IDHPS_SQLITE_MIRROR_MISMATCH: semantic-digest schema");
  }
  return structuredClone(snapshot);
}
