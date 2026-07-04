import { computeAtrUsdt, filterBarsForLot, getCurrentBar } from "@/lib/trader/exits/atr-estimator";
import { exitReasonCodes, exitRuleIds } from "@/lib/trader/exits/exit-reason-codes";
import { computeSlTpLevels } from "@/lib/trader/exits/sl-tp-calculator";
import {
  createInitialTrailingState,
  reduceTrailingState,
} from "@/lib/trader/exits/trailing-stop-machine";
import type {
  ExitPlan,
  ExitRunConfig,
  SlTpLevelsSnapshot,
  TrailingState,
} from "@/lib/trader/exits/exit-types";
import { EXIT_PLAN_SCHEMA_VERSION } from "@/lib/trader/exits/exit-types";
import type { GuardianRuleProvider } from "@/lib/trader/guardian/guardian-rule-provider.types";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { PositionLotRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

export type BuildExitPlanInput = {
  lot: PositionLotRow;
  bars: readonly Bar[];
  runConfig: ExitRunConfig;
  evaluatedAt: string;
};

export function buildExitPlan(input: BuildExitPlanInput): ExitPlan | null {
  // M4 is LONG spot-only. Fail closed (HOLD) for SHORT or non-spot lots —
  // never emit inverted-risk SL/TP for an unsupported direction.
  if (input.lot.positionSide !== "LONG") {
    return null;
  }
  if (input.lot.instrumentKind !== "SPOT") {
    return null;
  }

  const barsSinceEntry = filterBarsForLot(
    input.bars,
    input.lot.symbol,
    input.lot.openedAt,
    input.evaluatedAt,
  );
  const atrUsdt = computeAtrUsdt(barsSinceEntry, input.runConfig.atrPeriod);
  if (atrUsdt === null) {
    return null;
  }

  const currentBar = getCurrentBar(barsSinceEntry);
  const computedAt = currentBar?.barCloseTime ?? input.evaluatedAt;

  try {
    const levels = computeSlTpLevels({
      entryPrice: input.lot.avgCost,
      atrUsdt,
      runConfig: input.runConfig,
      computedAt,
    });

    const trailing = createInitialTrailingState({
      entryPrice: input.lot.avgCost,
      activationPrice: levels.activationPrice,
      trailingDistanceUsdt: levels.trailingDistanceUsdt,
      evaluatedAt: input.evaluatedAt,
    });

    return {
      schemaVersion: EXIT_PLAN_SCHEMA_VERSION,
      positionLotId: input.lot.id,
      symbol: input.lot.symbol,
      entryPrice: input.lot.avgCost,
      atrPeriod: input.runConfig.atrPeriod,
      atrUsdt,
      stopLoss: levels.stopLoss,
      takeProfit: levels.takeProfit,
      trailing,
      planBuiltAt: computedAt,
    };
  } catch {
    return null;
  }
}

export function toSlTpLevelsSnapshot(
  plan: ExitPlan,
  trailingState: TrailingState,
): SlTpLevelsSnapshot {
  return {
    stopLossPrice: plan.stopLoss.price,
    takeProfitPrice: plan.takeProfit.price,
    trailingStopPrice: trailingState.stopPrice,
    atrUsdt: plan.atrUsdt,
    trailingPhase: trailingState.phase,
  };
}

export type UpdateTrailingSessionInput = {
  plan: ExitPlan;
  priorTrailing?: TrailingState;
  bars: readonly Bar[];
  lot: PositionLotRow;
  markPrice: string;
  evaluatedAt: string;
};

export function updateTrailingSessionState(input: UpdateTrailingSessionInput): TrailingState {
  const barsSinceEntry = filterBarsForLot(
    input.bars,
    input.lot.symbol,
    input.lot.openedAt,
    input.evaluatedAt,
  );
  const currentBar = getCurrentBar(barsSinceEntry);
  const barHigh = currentBar?.high ?? input.markPrice;
  const barLow = currentBar?.low ?? input.markPrice;

  const prior =
    input.priorTrailing ??
    createInitialTrailingState({
      entryPrice: input.plan.entryPrice,
      activationPrice: input.plan.trailing.activationPrice,
      trailingDistanceUsdt: input.plan.trailing.trailingDistanceUsdt,
      evaluatedAt: input.evaluatedAt,
    });

  return reduceTrailingState({
    prior,
    barHigh,
    barLow,
    markPrice: input.markPrice,
    stopLossFloorPrice: input.plan.stopLoss.price,
    evaluatedAt: input.evaluatedAt,
  }).state;
}

export function createSlTpGuardianRuleProvider(deps: {
  getExitPlan: (lotId: string) => ExitPlan | undefined;
  getTrailingState: (lotId: string) => TrailingState | undefined;
}): GuardianRuleProvider {
  return {
    ruleId: exitRuleIds.stopLoss,
    evaluate(input) {
      const plan = deps.getExitPlan(input.lot.id);
      if (!plan) {
        return null;
      }

      if (compareDecimal(input.markPrice, plan.stopLoss.price) <= 0) {
        return {
          decision: "EXIT_FULL",
          reasonCode: exitReasonCodes.stopLossHit,
          ruleId: exitRuleIds.stopLoss,
        };
      }

      if (compareDecimal(input.markPrice, plan.takeProfit.price) >= 0) {
        return {
          decision: "EXIT_FULL",
          reasonCode: exitReasonCodes.takeProfitHit,
          ruleId: exitRuleIds.takeProfit,
        };
      }

      const trailing = deps.getTrailingState(input.lot.id) ?? plan.trailing;
      if (
        trailing.phase === "ARMED" &&
        trailing.stopPrice !== null &&
        compareDecimal(input.markPrice, trailing.stopPrice) <= 0
      ) {
        return {
          decision: "EXIT_FULL",
          reasonCode: exitReasonCodes.trailingStopHit,
          ruleId: exitRuleIds.trailingStop,
        };
      }

      return null;
    },
  };
}
