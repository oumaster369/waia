export const HTR_GUARDIAN_EXIT_REASON_V1 = {
  accountDrawdownBreach: "GUARDIAN_ACCOUNT_DRAWDOWN_BREACH",
  accountDrawdownEquality: "GUARDIAN_ACCOUNT_DRAWDOWN_EQUALITY",
  accountStop: "GUARDIAN_ACCOUNT_STOP",
  monthlyDrawdownBreach: "GUARDIAN_MONTHLY_DRAWDOWN_BREACH",
  monthlyDrawdownEquality: "GUARDIAN_MONTHLY_DRAWDOWN_EQUALITY",
  strategyDrawdownBreach: "GUARDIAN_STRATEGY_DRAWDOWN_BREACH",
  strategyDrawdownEquality: "GUARDIAN_STRATEGY_DRAWDOWN_EQUALITY",
  missingMark: "GUARDIAN_MISSING_MARK",
  reconciliationFailure: "GUARDIAN_RECONCILIATION_FAILURE",
  stopLossHit: "GUARDIAN_STOP_LOSS_HIT",
  takeProfitHit: "GUARDIAN_TAKE_PROFIT_HIT",
  trailingStopHit: "GUARDIAN_TRAILING_STOP_HIT",
  forcedFlat: "GUARDIAN_FORCED_FLAT",
} as const;

export type HtrGuardianExitReasonV1 =
  (typeof HTR_GUARDIAN_EXIT_REASON_V1)[keyof typeof HTR_GUARDIAN_EXIT_REASON_V1];

export type HtrGuardianBreachState = "NONE" | "CLOSE_ONLY" | "STOP_ACCOUNT";

export function resolveDrawdownBreachState(input: {
  accountDrawdownBps: number;
  monthlyDrawdownBps: number;
  strategyDrawdownBps?: number;
  accountLimitBps: number;
  monthlyLimitBps: number;
  strategyLimitBps?: number;
}): { breachState: HtrGuardianBreachState; reason: HtrGuardianExitReasonV1 | null } {
  if (input.accountDrawdownBps > input.accountLimitBps) {
    return {
      breachState: "STOP_ACCOUNT",
      reason: HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach,
    };
  }
  if (input.accountDrawdownBps === input.accountLimitBps) {
    return {
      breachState: "CLOSE_ONLY",
      reason: HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownEquality,
    };
  }
  if (input.monthlyDrawdownBps > input.monthlyLimitBps) {
    return {
      breachState: "STOP_ACCOUNT",
      reason: HTR_GUARDIAN_EXIT_REASON_V1.monthlyDrawdownBreach,
    };
  }
  if (input.monthlyDrawdownBps === input.monthlyLimitBps) {
    return {
      breachState: "CLOSE_ONLY",
      reason: HTR_GUARDIAN_EXIT_REASON_V1.monthlyDrawdownEquality,
    };
  }
  if (
    input.strategyDrawdownBps != null &&
    input.strategyLimitBps != null &&
    input.strategyDrawdownBps > input.strategyLimitBps
  ) {
    return {
      breachState: "STOP_ACCOUNT",
      reason: HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownBreach,
    };
  }
  if (
    input.strategyDrawdownBps != null &&
    input.strategyLimitBps != null &&
    input.strategyDrawdownBps === input.strategyLimitBps
  ) {
    return {
      breachState: "CLOSE_ONLY",
      reason: HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownEquality,
    };
  }
  return { breachState: "NONE", reason: null };
}

export function isRiskReducingExit(side: "buy" | "sell", openQty: string): boolean {
  return side === "sell" && openQty !== "0";
}

export function deterministicLiquidationOrder(symbols: string[]): string[] {
  return [...symbols].sort((a, b) => a.localeCompare(b));
}
