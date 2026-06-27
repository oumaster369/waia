import {
  buildNoSignal,
  isPermissionTradeable,
  isStrategyAllowed,
  type StrategySignalBaseInput,
} from "@/lib/trader/intelligence/strategies/strategy-guards";
import {
  LIQUIDITY_SWEEP_REVERSAL_V0,
  LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
  liquiditySweepReasonCodes,
  type Bar,
  type FeatureSnapshot,
  type MsvEnvelope,
  type StrategySignal,
} from "@/lib/trader/intelligence/types";
import { compareDecimal, multiplyDecimal } from "@/lib/trader/risk/numeric";

export { LIQUIDITY_SWEEP_REVERSAL_V0, LIQUIDITY_SWEEP_REVERSAL_V0_VERSION };

const SWEEP_LOOKBACK = 10;
const DEFAULT_HORIZON = "1h" as const;
const DEFAULT_MAX_RISK = "700.00";

function minLow(bars: readonly Bar[]): string {
  let min = bars[0]!.low;
  for (const bar of bars) {
    if (compareDecimal(bar.low, min) < 0) {
      min = bar.low;
    }
  }
  return min;
}

function detectSweepEntry(bars: readonly Bar[]): boolean {
  if (bars.length < SWEEP_LOOKBACK + 1) {
    return false;
  }
  const history = bars.slice(-SWEEP_LOOKBACK - 1, -1);
  const current = bars.at(-1)!;
  const support = minLow(history);
  return (
    compareDecimal(current.low, support) < 0 &&
    compareDecimal(current.close, support) > 0 &&
    compareDecimal(current.close, current.open) > 0
  );
}

function detectRecoveryExit(features: FeatureSnapshot, bars: readonly Bar[]): boolean {
  if (bars.length === 0) {
    return false;
  }
  const current = bars.at(-1)!;
  const sma20 = features.features.sma20;
  return compareDecimal(current.close, sma20) >= 0 && compareDecimal(current.low, sma20) < 0;
}

export type LiquiditySweepReversalContext = {
  organizationId: string;
  bars: readonly Bar[];
  newId?: () => string;
};

/**
 * Liquidity Sweep Reversal v0 — signal-only; detects stop-hunt reversal entries and mean-recovery exits.
 */
export function evaluateLiquiditySweepReversalV0(
  msv: MsvEnvelope,
  features: FeatureSnapshot,
  context: LiquiditySweepReversalContext,
): StrategySignal {
  const base: StrategySignalBaseInput = {
    strategySignalId: (context.newId ?? crypto.randomUUID.bind(crypto))(),
    strategyId: LIQUIDITY_SWEEP_REVERSAL_V0,
    strategyVersion: LIQUIDITY_SWEEP_REVERSAL_V0_VERSION,
    organizationId: context.organizationId,
    symbol: features.instrumentId,
    msvId: msv.msvId,
    featureSetId: features.featureSetId,
    evaluatedAt: features.evaluatedAt,
  };

  if (!isStrategyAllowed(msv, LIQUIDITY_SWEEP_REVERSAL_V0)) {
    return buildNoSignal(base, [liquiditySweepReasonCodes.strategyNotAllowed]);
  }

  if (!isPermissionTradeable(msv.derived.tradingPermission)) {
    return buildNoSignal(base, [liquiditySweepReasonCodes.permissionBlocked]);
  }

  if (detectSweepEntry(context.bars)) {
    return {
      ...base,
      outcome: "SIGNAL",
      side: "buy",
      confidence: "0.70",
      expectedEdge: multiplyDecimal(features.features.spreadBps, "0.01"),
      horizon: DEFAULT_HORIZON,
      maxRisk: DEFAULT_MAX_RISK,
      reasonCodes: [liquiditySweepReasonCodes.sweepEntry],
    };
  }

  if (detectRecoveryExit(features, context.bars)) {
    return {
      ...base,
      outcome: "SIGNAL",
      side: "sell",
      confidence: "0.65",
      expectedEdge: multiplyDecimal(features.features.realizedVol20, "0.5"),
      horizon: DEFAULT_HORIZON,
      maxRisk: DEFAULT_MAX_RISK,
      reasonCodes: [liquiditySweepReasonCodes.recoveryExit],
    };
  }

  return buildNoSignal(base, [liquiditySweepReasonCodes.noPattern]);
}
