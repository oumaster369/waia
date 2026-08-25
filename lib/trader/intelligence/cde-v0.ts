import { FEATURE_ENGINE_QUALITY_THRESHOLD } from "@/lib/trader/intelligence/feature-engine-v0";
import {
  buildCrowdPsychologyLayer,
  buildFutureContextLayer,
  buildLiquidityLayer,
  buildMarketPhysicsLayer,
  buildMsvUnderstandingBlock,
} from "@/lib/trader/intelligence/analytical-layers-v0";
import type { MarketOpportunity } from "@/lib/trader/intelligence/hypothesis/hypothesis.types";
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

function lessRestrictivePermission(
  current: TradingPermission,
  candidate: TradingPermission,
): TradingPermission {
  return PERMISSION_RESTRICTIVENESS[candidate] > PERMISSION_RESTRICTIVENESS[current]
    ? candidate
    : current;
}

function hasHardVeto(input: {
  dataQualityScore: number;
  fusedContext?: FusedMarketContext;
}): boolean {
  if (input.dataQualityScore < QUALITY_PAPER_ONLY_THRESHOLD) {
    return true;
  }
  if (
    input.fusedContext?.aggregateHealth === "UNAVAILABLE" ||
    input.fusedContext?.aggregateHealth === "STALE"
  ) {
    return true;
  }
  return false;
}

function isTruthfulHealthSufficientForTrading(input: {
  dataQualityScore: number;
  fusedContext?: FusedMarketContext;
}): { sufficient: boolean; degradedOk: boolean } {
  if (input.dataQualityScore < QUALITY_PAPER_ONLY_THRESHOLD) {
    return { sufficient: false, degradedOk: false };
  }
  if (!input.fusedContext) {
    return { sufficient: true, degradedOk: false };
  }
  if (
    input.fusedContext.aggregateHealth === "UNAVAILABLE" ||
    input.fusedContext.aggregateHealth === "STALE"
  ) {
    return { sufficient: false, degradedOk: false };
  }
  if (input.fusedContext.aggregateHealth === "DEGRADED") {
    return { sufficient: true, degradedOk: true };
  }
  return { sufficient: true, degradedOk: false };
}

function resolveConvictionPermission(input: {
  opportunity?: MarketOpportunity;
  dataQualityScore: number;
  fusedContext?: FusedMarketContext;
}): {
  permission: TradingPermission;
  reasonCodes: string[];
  riskMultiplier: string;
} | null {
  if (!input.opportunity?.authorized) {
    return null;
  }

  const health = isTruthfulHealthSufficientForTrading({
    dataQualityScore: input.dataQualityScore,
    fusedContext: input.fusedContext,
  });
  if (!health.sufficient) {
    return null;
  }

  const reasonCodes: string[] = [];
  if (health.degradedOk) {
    reasonCodes.push(cdeReasonCodes.truthfulHealthDegradedOk);
  } else {
    reasonCodes.push(cdeReasonCodes.truthfulHealthSufficient);
  }

  if (health.degradedOk) {
    reasonCodes.push(cdeReasonCodes.convictionAllowReducedRisk);
    return { permission: "ALLOW_REDUCED_RISK", reasonCodes, riskMultiplier: "0.5" };
  }

  reasonCodes.push(cdeReasonCodes.convictionAllowTrading);
  return { permission: "ALLOW_TRADING", reasonCodes, riskMultiplier: "1.0" };
}

function resolveTradingPermission(input: {
  dataQualityScore: number;
  fusedContext?: FusedMarketContext;
  opportunity?: MarketOpportunity;
  miCoreEnabled?: boolean;
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
    if (!input.miCoreEnabled) {
      permission = moreRestrictivePermission(permission, "ALLOW_REDUCED_RISK");
      riskMultiplier = "0.5";
    } else {
      reasonCodes.push(cdeReasonCodes.truthfulHealthDegradedOk);
    }
  }

  if (input.miCoreEnabled) {
    const convictionPath = resolveConvictionPermission({
      opportunity: input.opportunity,
      dataQualityScore: input.dataQualityScore,
      fusedContext: input.fusedContext,
    });
    if (convictionPath && !hasHardVeto(input)) {
      for (const code of convictionPath.reasonCodes) {
        reasonCodes.push(code);
      }
      permission = lessRestrictivePermission(permission, convictionPath.permission);
      if (convictionPath.riskMultiplier !== "1.0") {
        riskMultiplier = convictionPath.riskMultiplier;
      }
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
  opportunity?: MarketOpportunity;
  miCoreEnabled?: boolean;
  newId?: () => string;
};

/**
 * Chief Decision Engine v0 — aggregates features into an MSV envelope.
 * Does not recompute {@link FeatureSnapshot.dataQualityScore}.
 * PR2.5: fused context may adjust permission/confidence only — never trade signals.
 * DEE-622: legacy Understanding is projected to telemetry only and never affects permission,
 * conviction, risk, strategy selection, or data-quality authority.
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
  const { features, fusedContext, understanding, opportunity, miCoreEnabled } = input;
  const regime = classifyRegime(features);
  const permission = resolveTradingPermission({
    dataQualityScore: features.dataQualityScore,
    fusedContext,
    opportunity,
    miCoreEnabled,
  });
  const crowd = buildCrowdPsychologyLayer(fusedContext);
  const reasonCodes = [...permission.reasonCodes, regimeReasonCode(regime)];
  if (crowd.newsSentiment === null) {
    reasonCodes.push(cdeReasonCodes.newsSentimentDeferredPr3);
  }

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
    crowd,
    futureContext: buildFutureContextLayer(fusedContext),
    understanding: understanding ? buildMsvUnderstandingBlock(understanding) : undefined,
    derived: {
      regime,
      tradingPermission: permission.permission,
      allowedStrategyIds: resolveAllowedStrategyIds(regime),
      riskMultiplier: permission.riskMultiplier,
      dataQualityScore: fusedQuality,
      reasonCodes,
      ...(miCoreEnabled && opportunity
        ? {
            conviction: opportunity.conviction,
            opportunityAuthorized: opportunity.authorized,
            activeHypothesisType: opportunity.hypothesisType,
            eligibleStrategyFamilies: opportunity.eligibleStrategyFamilies,
          }
        : {}),
    },
  };
}

export { QUALITY_PAPER_ONLY_THRESHOLD };
