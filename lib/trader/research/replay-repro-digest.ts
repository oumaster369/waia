import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import type { MsvEnvelope } from "@/lib/trader/intelligence/types";
import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";

const STRIP_KEYS = new Set(["msvId", "generatedAt", "campaignId"]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripVolatile);
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (STRIP_KEYS.has(key)) {
        continue;
      }
      output[key] = stripVolatile(nested);
    }
    return output;
  }
  return value;
}

export function computeReplayReproContentDigest(value: unknown): string {
  return createHash("sha256")
    .update(canonicalJsonString(stripVolatile(value)), "utf8")
    .digest("hex");
}

export function computeFusedContextReproDigest(fused: FusedMarketContext): string {
  return computeReplayReproContentDigest(fused);
}

export function computeMsvReproDigest(msv: MsvEnvelope): string {
  return computeReplayReproContentDigest({
    derived: msv.derived,
    crowd: msv.crowd,
    physics: msv.physics,
    liquidity: msv.liquidity,
  });
}

export function computeUnderstandingReproDigest(
  understanding: MarketUnderstandingSnapshot,
): string {
  return computeReplayReproContentDigest(understanding);
}
