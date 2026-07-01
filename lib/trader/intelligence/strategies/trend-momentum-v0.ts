import {
  buildNoSignal,
  isPermissionTradeable,
  isStrategyAllowed,
  type StrategySignalBaseInput,
} from "@/lib/trader/intelligence/strategies/strategy-guards";
import {
  TREND_MOMENTUM_V0,
  TREND_MOMENTUM_V0_VERSION,
  trendMomentumReasonCodes,
  type FeatureSnapshot,
  type MsvEnvelope,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";
import { compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";

const MOMENTUM_ENTRY_ZSCORE = "1.0";
const MOMENTUM_EXIT_ZSCORE = "0";
const DEFAULT_HORIZON = "1h" as const;
const DEFAULT_MAX_RISK = "500.00";
const VOL_TARGET = "0.02";

function confidenceFromMomentum(zscore: string): string {
  if (compareDecimal(zscore, "2.5") >= 0) {
    return "0.85";
  }
  if (compareDecimal(zscore, "1.5") >= 0) {
    return "0.70";
  }
  return "0.55";
}

/**
 * Trend / time-series momentum v0 — long-or-flat, volatility-targeted sizing hint.
 * Per Research Study #2: primary MVP edge family for spot-long-only.
 */
export function evaluateTrendMomentumV0(
  msv: MsvEnvelope,
  features: FeatureSnapshot,
  context: { organizationId: string; newId?: () => string },
): StrategySignal {
  const base: StrategySignalBaseInput = {
    strategySignalId: (context.newId ?? crypto.randomUUID.bind(crypto))(),
    strategyId: TREND_MOMENTUM_V0,
    strategyVersion: TREND_MOMENTUM_V0_VERSION,
    organizationId: context.organizationId,
    symbol: features.instrumentId,
    msvId: msv.msvId,
    featureSetId: features.featureSetId,
    evaluatedAt: features.evaluatedAt,
  };

  if (!isStrategyAllowed(msv, TREND_MOMENTUM_V0)) {
    return buildNoSignal(base, [trendMomentumReasonCodes.strategyNotAllowed]);
  }

  if (!isPermissionTradeable(msv.derived.tradingPermission)) {
    return buildNoSignal(base, [trendMomentumReasonCodes.permissionBlocked]);
  }

  if (msv.derived.regime === "TREND_BEAR") {
    return buildNoSignal(base, [trendMomentumReasonCodes.regimeFlat]);
  }

  const zscore = features.features.zscoreVsSma20;
  const vol = features.features.realizedVol20;

  if (compareDecimal(zscore, MOMENTUM_ENTRY_ZSCORE) >= 0) {
    const volScale =
      compareDecimal(vol, "0") > 0 ? multiplyDecimal(VOL_TARGET, multiplyDecimal("1", vol)) : "1";
    return {
      ...base,
      outcome: "SIGNAL",
      side: "buy",
      confidence: confidenceFromMomentum(zscore),
      expectedEdge: multiplyDecimal(zscore, volScale),
      horizon: DEFAULT_HORIZON,
      maxRisk: DEFAULT_MAX_RISK,
      reasonCodes: [trendMomentumReasonCodes.momentumEntry],
    };
  }

  if (compareDecimal(zscore, MOMENTUM_EXIT_ZSCORE) <= 0) {
    return {
      ...base,
      outcome: "SIGNAL",
      side: "sell",
      confidence: "0.60",
      expectedEdge: "0",
      horizon: DEFAULT_HORIZON,
      maxRisk: DEFAULT_MAX_RISK,
      reasonCodes: [trendMomentumReasonCodes.momentumExit],
    };
  }

  return buildNoSignal(base, [trendMomentumReasonCodes.zscoreNeutral]);
}
