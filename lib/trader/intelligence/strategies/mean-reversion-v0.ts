import {
  MEAN_REVERSION_V0,
  MEAN_REVERSION_V0_VERSION,
  strategyReasonCodes,
  type FeatureSnapshot,
  type MsvEnvelope,
  type StrategySignal,
  type TradingPermission,
} from "@/lib/trader/intelligence/types";
import { compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";

function absDecimal(value: string): string {
  return compareDecimal(value, "0") <= 0 ? multiplyDecimal(value, "-1") : value;
}

const ZSCORE_BUY_THRESHOLD = "-1.5";
const DEFAULT_HORIZON = "1h" as const;
const DEFAULT_MAX_RISK = "650.00";

const TRADEABLE_PERMISSIONS: readonly TradingPermission[] = [
  "ALLOW_TRADING",
  "ALLOW_REDUCED_RISK",
  "PAPER_ONLY",
];

function isStrategyAllowed(msv: MsvEnvelope): boolean {
  return msv.derived.allowedStrategyIds.includes(MEAN_REVERSION_V0);
}

function isPermissionTradeable(permission: TradingPermission): boolean {
  return TRADEABLE_PERMISSIONS.includes(permission);
}

function confidenceFromZscore(zscore: string): string {
  const magnitude = compareDecimal(zscore, "0") <= 0 ? multiplyDecimal(zscore, "-1") : zscore;
  if (compareDecimal(magnitude, "3") >= 0) {
    return "0.90";
  }
  if (compareDecimal(magnitude, "2") >= 0) {
    return "0.75";
  }
  return "0.60";
}

export type MeanReversionContext = {
  organizationId: string;
  newId?: () => string;
};

/**
 * Mean Reversion v0 — emits structured signals only; never places orders.
 */
export function evaluateMeanReversionV0(
  msv: MsvEnvelope,
  features: FeatureSnapshot,
  context: MeanReversionContext,
): StrategySignal {
  const base = {
    strategySignalId: (context.newId ?? crypto.randomUUID.bind(crypto))(),
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: MEAN_REVERSION_V0_VERSION,
    organizationId: context.organizationId,
    symbol: features.instrumentId,
    msvId: msv.msvId,
    featureSetId: features.featureSetId,
    evaluatedAt: features.evaluatedAt,
  } satisfies Partial<StrategySignal>;

  if (!isStrategyAllowed(msv)) {
    return {
      ...base,
      outcome: "NO_SIGNAL",
      reasonCodes: [strategyReasonCodes.strategyNotAllowed],
    };
  }

  if (!isPermissionTradeable(msv.derived.tradingPermission)) {
    return {
      ...base,
      outcome: "NO_SIGNAL",
      reasonCodes: [strategyReasonCodes.permissionBlocked],
    };
  }

  const zscore = features.features.zscoreVsSma20;
  if (compareDecimal(zscore, ZSCORE_BUY_THRESHOLD) <= 0) {
    return {
      ...base,
      outcome: "SIGNAL",
      side: "buy",
      confidence: confidenceFromZscore(zscore),
      expectedEdge: multiplyDecimal(absDecimal(zscore), features.features.realizedVol20),
      horizon: DEFAULT_HORIZON,
      maxRisk: DEFAULT_MAX_RISK,
      reasonCodes: [strategyReasonCodes.zscoreBuy],
    };
  }

  return {
    ...base,
    outcome: "NO_SIGNAL",
    reasonCodes: [strategyReasonCodes.zscoreNeutral],
  };
}

export { ZSCORE_BUY_THRESHOLD };
