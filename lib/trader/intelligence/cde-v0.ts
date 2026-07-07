import { FEATURE_ENGINE_QUALITY_THRESHOLD } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  buildCrowdPsychologyLayer,
  buildFutureContextLayer,
  buildLiquidityLayer,
  buildMarketPhysicsLayer,
} from "@/lib/trader/intelligence/analytical-layers-v0";
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

function resolveTradingPermission(input: {
  dataQualityScore: number;
  fusedContext?: FusedMarketContext;
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

  if (!input.fusedContext) {
    return {
      permission: "ALLOW_TRADING",
      reasonCodes,
      riskMultiplier: "1.0",
    };
  }

  if (
    input.fusedContext.aggregateHealth === "UNAVAILABLE" ||
    input.fusedContext.aggregateHealth === "STALE"
  ) {
    reasonCodes.push(cdeReasonCodes.providerDegraded);
    return {
      permission: "PAPER_ONLY",
      reasonCodes,
      riskMultiplier: "0.75",
    };
  }

  if (
    input.fusedContext.aggregateHealth === "DEGRADED" ||
    input.fusedContext.aggregateConfidence < FUSED_DEGRADED_CONFIDENCE_THRESHOLD
  ) {
    reasonCodes.push(cdeReasonCodes.fusedContextReduced);
    return {
      permission: "ALLOW_REDUCED_RISK",
      reasonCodes,
      riskMultiplier: "0.5",
    };
  }

  return {
    permission: "ALLOW_TRADING",
    reasonCodes,
    riskMultiplier: "1.0",
  };
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
  newId?: () => string;
};

/**
 * Chief Decision Engine v0 — aggregates features into an MSV envelope.
 * Does not recompute {@link FeatureSnapshot.dataQualityScore}.
 * PR2.5: fused context may adjust permission/confidence only — never trade signals.
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
  const { features, fusedContext } = input;
  const regime = classifyRegime(features);
  const permission = resolveTradingPermission({
    dataQualityScore: features.dataQualityScore,
    fusedContext,
  });
  const reasonCodes = [...permission.reasonCodes, regimeReasonCode(regime)];

  const fusedQuality =
    fusedContext !== undefined
      ? Math.min(features.dataQualityScore, fusedContext.aggregateConfidence)
      : features.dataQualityScore;

  return {
    msvId: (input.newId ?? crypto.randomUUID.bind(crypto))(),
    instrumentId: features.instrumentId,
    evaluatedAt: features.evaluatedAt,
    featureSetId: features.featureSetId,
    physics: buildMarketPhysicsLayer(features),
    liquidity: buildLiquidityLayer(features),
    crowd: buildCrowdPsychologyLayer(fusedContext),
    futureContext: buildFutureContextLayer(fusedContext),
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
