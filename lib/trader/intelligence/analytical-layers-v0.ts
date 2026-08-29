import type {
  FeatureSnapshot,
  MsvCrowdBlock,
  MsvFutureContextBlock,
  MsvLiquidityBlock,
  MsvPhysicsBlock,
  MsvUnderstandingBlock,
} from "@/lib/trader/intelligence/types";
import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";

/**
 * Analytical layers v0 (DEE-200) — explicit layer builders for MSV blocks.
 * PR2.5 wires crowd/future metadata from fused context; depth remains PR3.
 */

export function buildMarketPhysicsLayer(features: FeatureSnapshot): MsvPhysicsBlock {
  return {
    close: features.features.close,
    zscoreVsSma20: features.features.zscoreVsSma20,
    priceDispersion20: features.features.priceDispersion20,
  };
}

export function buildLiquidityLayer(features: FeatureSnapshot): MsvLiquidityBlock {
  return {
    spreadBps: features.features.spreadBps,
  };
}

export function buildCrowdPsychologyLayer(fusedContext?: FusedMarketContext): MsvCrowdBlock {
  const fearGreedValue = fusedContext?.fearGreed?.payload.value;
  return {
    fearGreedIndex:
      typeof fearGreedValue === "number" && Number.isFinite(fearGreedValue) ? fearGreedValue : null,
    newsSentiment: null,
  };
}

export function buildFutureContextLayer(
  fusedContext?: FusedMarketContext,
): MsvFutureContextBlock {
  const sessionPhase = fusedContext?.sessionPhase ?? "UNKNOWN";
  const corridor = fusedContext?.asianRangeCorridor;
  const eventRiskScore = corridor ? "0.1" : "0";
  return {
    eventRiskScore,
    sessionPhase,
    asianRangeCorridorPresent: corridor !== undefined,
  };
}

export function buildMsvUnderstandingBlock(
  understanding: MarketUnderstandingSnapshot,
): MsvUnderstandingBlock {
  return {
    regimeHint: understanding.regimeHint,
    mtfAlignment: understanding.mtfAlignment,
    spotPosture: understanding.spotPosture,
    crossVenueAgreement: understanding.crossVenue.agreement,
    understandingConfidence: understanding.understandingConfidence,
    postureRationale: understanding.postureRationale,
    knowledgeGapCount: understanding.knowledgeGaps.length,
    dataQualitySufficient: understanding.dataQualitySufficient,
  };
}
