import type {
  FeatureSnapshot,
  MsvCrowdBlock,
  MsvFutureContextBlock,
  MsvLiquidityBlock,
  MsvPhysicsBlock,
} from "@/lib/trader/intelligence/types";

/**
 * Analytical layers v0 (DEE-200) — explicit layer builders for MSV blocks.
 * Crowd Psychology and Future Context remain MVP stubs per Execution Program.
 */

export function buildMarketPhysicsLayer(features: FeatureSnapshot): MsvPhysicsBlock {
  return {
    close: features.features.close,
    zscoreVsSma20: features.features.zscoreVsSma20,
    realizedVol20: features.features.realizedVol20,
  };
}

export function buildLiquidityLayer(features: FeatureSnapshot): MsvLiquidityBlock {
  return {
    spreadBps: features.features.spreadBps,
  };
}

export function buildCrowdPsychologyLayer(): MsvCrowdBlock {
  return {
    fearGreedIndex: null,
    newsSentiment: "0",
  };
}

export function buildFutureContextLayer(): MsvFutureContextBlock {
  return {
    eventRiskScore: "0",
  };
}
