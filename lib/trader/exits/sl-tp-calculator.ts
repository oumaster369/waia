import type { ExitRunConfig, StopLevel, TakeProfitLevel } from "@/lib/trader/exits/exit-types";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type ComputeSlTpLevelsInput = {
  entryPrice: string;
  atrUsdt: string;
  runConfig: ExitRunConfig;
  computedAt: string;
};

export type SlTpLevels = {
  stopLoss: StopLevel;
  takeProfit: TakeProfitLevel;
  activationPrice: string;
  trailingDistanceUsdt: string;
};

/**
 * Deterministic LONG-only SL/TP levels from entry + ATR.
 * Throws on any invalid config or violated invariant so the caller
 * ({@link buildExitPlan}) fails closed to HOLD rather than emitting unsafe levels.
 */
export function computeSlTpLevels(input: ComputeSlTpLevelsInput): SlTpLevels {
  const { entryPrice, atrUsdt, runConfig, computedAt } = input;

  // Fail-closed config validation — no optimistic defaults.
  if (compareDecimal(entryPrice, "0") <= 0) {
    throw new Error("[trader/exits] entry price must be positive");
  }
  if (compareDecimal(atrUsdt, "0") <= 0) {
    throw new Error("[trader/exits] ATR must be positive");
  }
  if (compareDecimal(runConfig.stopLossAtrMultiple, "0") <= 0) {
    throw new Error("[trader/exits] stopLossAtrMultiple must be positive");
  }
  if (compareDecimal(runConfig.takeProfitAtrMultiple, "0") <= 0) {
    throw new Error("[trader/exits] takeProfitAtrMultiple must be positive");
  }
  if (compareDecimal(runConfig.trailingActivationAtrMultiple, "0") < 0) {
    throw new Error("[trader/exits] trailingActivationAtrMultiple must be non-negative");
  }
  if (compareDecimal(runConfig.trailingDistanceAtrMultiple, "0") <= 0) {
    throw new Error("[trader/exits] trailingDistanceAtrMultiple must be positive");
  }

  const stopDistance = multiplyDecimal(atrUsdt, runConfig.stopLossAtrMultiple);
  const stopLossPrice = subtractDecimal(entryPrice, stopDistance);

  const tpDistance = multiplyDecimal(atrUsdt, runConfig.takeProfitAtrMultiple);
  const takeProfitPrice = addDecimal(entryPrice, tpDistance);

  const activationPrice = addDecimal(
    entryPrice,
    multiplyDecimal(atrUsdt, runConfig.trailingActivationAtrMultiple),
  );
  const trailingDistanceUsdt = multiplyDecimal(atrUsdt, runConfig.trailingDistanceAtrMultiple);

  // Ordering invariants (LONG): 0 < SL < entry < TP. Prevents inverted-risk / sign bugs.
  if (compareDecimal(stopLossPrice, "0") <= 0) {
    throw new Error("[trader/exits] stop loss price must be positive");
  }
  if (compareDecimal(stopLossPrice, entryPrice) >= 0) {
    throw new Error("[trader/exits] stop loss must be below entry for LONG");
  }
  if (compareDecimal(takeProfitPrice, entryPrice) <= 0) {
    throw new Error("[trader/exits] take profit must be above entry for LONG");
  }

  return {
    stopLoss: {
      kind: "STOP_LOSS",
      price: stopLossPrice,
      distanceUsdt: stopDistance,
      atrMultiple: runConfig.stopLossAtrMultiple,
      computedAt,
    },
    takeProfit: {
      kind: "TAKE_PROFIT",
      price: takeProfitPrice,
      distanceUsdt: tpDistance,
      atrMultiple: runConfig.takeProfitAtrMultiple,
      computedAt,
    },
    activationPrice,
    trailingDistanceUsdt,
  };
}
