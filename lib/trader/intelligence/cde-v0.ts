import { FEATURE_ENGINE_QUALITY_THRESHOLD } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  buildCrowdPsychologyLayer,
  buildFutureContextLayer,
  buildLiquidityLayer,
  buildMarketPhysicsLayer,
  buildMsvUnderstandingBlock,
} from "@/lib/trader/intelligence/analytical-layers-v0";
import type { MarketUnderstandingSnapshot } from "@/lib/trader/intelligence/market-understanding.types";
import { listMvpStrategyRegistry } from "@/lib/trader/intelligence/strategies/registry";
import {
  cdeReasonCodes,
  MEAN_REVERSION_V0,
  TREND_MOMENTUM_V0,
  type FeatureSnapshot,
  type MsvEnvelope,
  type Regime,
  type TradingPermission,
} from "@/lib/trader/intelligence/types";
import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

const QUALITY_PAPER_ONLY_THRESHOLD = FEATURE_ENGINE_QUALITY_THRESHOLD;
const FUSED_DEGRADED_CONFIDENCE_THRESHOLD = 0.5;

const PERMISSION_RESTRICTIVENESS: Record<TradingPermission, number> = {
  STOP_TRADING: 0,
  ONLY_CLOSE_POSITIONS: 1,
  PAPER_ONLY: 2,
  ALLOW_REDUCED_RISK: 3,
  ALLOW_TRADING: 4,
};

export function classifyRegime(features: FeatureSnapshot): Regime {
  const zscore = features.features.zscoreVsSma20;
  if (compareDecimal(zscore, "-2") <= 0) {
    return "TREND_BEAR";
  }
  if (compareDecimal(zscore, "2") >= 0) {
    return "TREND_BULL";
  }
  if (compareDecimal(zscore, "-0.5") >= 0 && compareDecimal(zscore, "0.5") <= 0) {
    return "CHOP";
  }
  return "RANGE";
}

function moreRestrictivePermission(
  current: TradingPermission,
  candidate: TradingPermission,
): TradingPermission {
  return PERMISSION_RESTRICTIVENESS[candidate] < PERMISSION_RESTRICTIVENESS[current]
    ? candidate
    : current;
}

function resolveTradingPermission(input: {
  dataQualityScore: number;
  fusedContext?: FusedMarketContext;
  understanding?: MarketUnderstandingSnapshot;
}): {
  permission: TradingPermission;
  reasonCodes: string[];
  riskMultiplier: string;
} {
  const reasonCodes: string[] = [];

  if (input.dataQualityScore < QUALITY_PAPER_ONLY_THRESHOLD) {
    reasonCodes.push(cdeReasonCodes.qualityPaperOnly);
    return {
      permission: "PAPER_ONLY",
      reasonCodes,
      riskMultiplier: "1.0",
    };
  }

  reasonCodes.push(cdeReasonCodes.qualityAllowTrading);

  let permission: TradingPermission = "ALLOW_TRADING";
  let riskMultiplier = "1.0";

  if (!input.fusedContext) {
    return { permission, reasonCodes, riskMultiplier };
  }

  if (
    input.fusedContext.aggregateHealth === "UNAVAILABLE" ||
    input.fusedContext.aggregateHealth === "STALE"
  ) {
    reasonCodes.push(cdeReasonCodes.providerDegraded);
    permission = "PAPER_ONLY";
    riskMultiplier = "0.75";
  } else if (
    input.fusedContext.aggregateHealth === "DEGRADED" ||
    input.fusedContext.aggregateConfidence < FUSED_DEGRADED_CONFIDENCE_THRESHOLD
  ) {
    reasonCodes.push(cdeReasonCodes.fusedContextReduced);
    permission = moreRestrictivePermission(permission, "ALLOW_REDUCED_RISK");
    riskMultiplier = "0.5";
  }

  if (input.understanding) {
    if (!input.understanding.dataQualitySufficient) {
      reasonCodes.push(cdeReasonCodes.understandingDataInsufficient);
      permission = moreRestrictivePermission(permission, "PAPER_ONLY");
      riskMultiplier = "0.5";
    }

    if (input.understanding.crossVenue.agreement === "DISAGREE") {
      reasonCodes.push(cdeReasonCodes.understandingCrossVenueConflict);
      permission = moreRestrictivePermission(permission, "PAPER_ONLY");
      riskMultiplier = "0.5";
    }

    if (input.understanding.knowledgeGaps.some((gap) => gap.blocksPermission)) {
      reasonCodes.push(cdeReasonCodes.understandingKnowledgeGap);
      permission = moreRestrictivePermission(permission, "PAPER_ONLY");
      riskMultiplier = "0.5";
    }

    if (input.understanding.regimeHint === "STRESSED") {
      reasonCodes.push(cdeReasonCodes.understandingStressed);
      permission = moreRestrictivePermission(permission, "ALLOW_REDUCED_RISK");
      riskMultiplier = "0.5";
    }

    switch (input.understanding.spotPosture) {
      case "NO_TRADE":
        reasonCodes.push(cdeReasonCodes.understandingNoTrade);
        permission = moreRestrictivePermission(permission, "PAPER_ONLY");
        riskMultiplier = "0.25";
        break;
      case "WAIT":
        reasonCodes.push(cdeReasonCodes.understandingWait);
        permission = moreRestrictivePermission(permission, "PAPER_ONLY");
        riskMultiplier = "0.5";
        break;
      case "PRESERVE_CAPITAL":
        reasonCodes.push(cdeReasonCodes.understandingPreserveCapital);
        permission = moreRestrictivePermission(permission, "ONLY_CLOSE_POSITIONS");
        riskMultiplier = "0.25";
        break;
      case "REDUCE_RISK":
        reasonCodes.push(cdeReasonCodes.understandingReducedRisk);
        permission = moreRestrictivePermission(permission, "ALLOW_REDUCED_RISK");
        riskMultiplier = "0.5";
        break;
      case "TRADE":
        break;
    }
  }

  return { permission, reasonCodes, riskMultiplier };
}

function regimeReasonCode(regime: Regime): string {
  switch (regime) {
    case "RANGE":
      return cdeReasonCodes.regimeRange;
    case "TREND_BEAR":
      return cdeReasonCodes.regimeTrendBear;
    default:
      return cdeReasonCodes.regimeUnknown;
  }
}

export type BuildMsvEnvelopeInput = {
  features: FeatureSnapshot;
  fusedContext?: FusedMarketContext;
  understanding?: MarketUnderstandingSnapshot;
  newId?: () => string;
};

/**
 * Chief Decision Engine v0 — aggregates features into an MSV envelope.
 * Does not recompute {@link FeatureSnapshot.dataQualityScore}.
 * PR2.5: fused context may adjust permission/confidence only — never trade signals.
 * PR2.6: understanding augments permission/posture rationale — never trade signals.
 */
function resolveAllowedStrategyIds(regime: Regime): readonly string[] {
  const all = listMvpStrategyRegistry().map((entry) => entry.strategyId);
  if (regime === "TREND_BEAR") {
    return all.filter((id) => id !== TREND_MOMENTUM_V0);
  }
  if (regime === "RANGE" || regime === "CHOP") {
    return all.filter((id) => id !== TREND_MOMENTUM_V0);
  }
  if (regime === "TREND_BULL") {
    return all.filter((id) => id !== MEAN_REVERSION_V0);
  }
  return all;
}

export function buildMsvEnvelope(input: BuildMsvEnvelopeInput): MsvEnvelope {
  const { features, fusedContext, understanding } = input;
  const regime = classifyRegime(features);
  const permission = resolveTradingPermission({
    dataQualityScore: features.dataQualityScore,
    fusedContext,
    understanding,
  });
  const crowd = buildCrowdPsychologyLayer(fusedContext);
  const reasonCodes = [...permission.reasonCodes, regimeReasonCode(regime)];
  if (crowd.newsSentiment === null) {
    reasonCodes.push(cdeReasonCodes.newsSentimentDeferredPr3);
  }

  const fusedQuality =
    fusedContext !== undefined
      ? Math.min(
          features.dataQualityScore,
          understanding?.understandingConfidence ?? fusedContext.aggregateConfidence,
        )
      : features.dataQualityScore;

  return {
    msvId: (input.newId ?? crypto.randomUUID.bind(crypto))(),
    instrumentId: features.instrumentId,
    evaluatedAt: features.evaluatedAt,
    featureSetId: features.featureSetId,
    physics: buildMarketPhysicsLayer(features),
    liquidity: buildLiquidityLayer(features),
    crowd,
    futureContext: buildFutureContextLayer(fusedContext, understanding),
    understanding: understanding ? buildMsvUnderstandingBlock(understanding) : undefined,
    derived: {
      regime,
      tradingPermission: permission.permission,
      allowedStrategyIds: resolveAllowedStrategyIds(regime),
      riskMultiplier: permission.riskMultiplier,
      dataQualityScore: fusedQuality,
      reasonCodes,
    },
  };
}

export { QUALITY_PAPER_ONLY_THRESHOLD };
