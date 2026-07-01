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
import { compareDecimal } from "@/lib/trader/risk/numeric";

const QUALITY_PAPER_ONLY_THRESHOLD = FEATURE_ENGINE_QUALITY_THRESHOLD;

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

function resolveTradingPermission(dataQualityScore: number): {
  permission: TradingPermission;
  reasonCodes: string[];
} {
  if (dataQualityScore < QUALITY_PAPER_ONLY_THRESHOLD) {
    return {
      permission: "PAPER_ONLY",
      reasonCodes: [cdeReasonCodes.qualityPaperOnly],
    };
  }
  return {
    permission: "ALLOW_TRADING",
    reasonCodes: [cdeReasonCodes.qualityAllowTrading],
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
  newId?: () => string;
};

/**
 * Chief Decision Engine v0 — aggregates features into an MSV envelope.
 * Does not recompute {@link FeatureSnapshot.dataQualityScore}.
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
  const { features } = input;
  const regime = classifyRegime(features);
  const permission = resolveTradingPermission(features.dataQualityScore);
  const reasonCodes = [...permission.reasonCodes, regimeReasonCode(regime)];

  return {
    msvId: (input.newId ?? crypto.randomUUID.bind(crypto))(),
    instrumentId: features.instrumentId,
    evaluatedAt: features.evaluatedAt,
    featureSetId: features.featureSetId,
    physics: buildMarketPhysicsLayer(features),
    liquidity: buildLiquidityLayer(features),
    crowd: buildCrowdPsychologyLayer(),
    futureContext: buildFutureContextLayer(),
    derived: {
      regime,
      tradingPermission: permission.permission,
      allowedStrategyIds: resolveAllowedStrategyIds(regime),
      riskMultiplier: "1.0",
      dataQualityScore: features.dataQualityScore,
      reasonCodes,
    },
  };
}

export { QUALITY_PAPER_ONLY_THRESHOLD };
