import { assertAccountingReconciliation } from "@/lib/trader/accounting/accounting-reconciliation";
import type { AccountingReconciliationInput } from "@/lib/trader/accounting/accounting-reconciliation.types";
import {
  HTR_GUARDIAN_EXIT_REASON_V1,
  resolveDrawdownBreachState,
  type HtrGuardianBreachState,
  type HtrGuardianExitReasonV1,
} from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import {
  computePeakEquityDrawdownBps,
  evaluateDrawdownPolicy,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { PlaceOrderInput } from "@/lib/trader/connectors/types";

export type HtrGuardianCycleInput = {
  /** Required unless `skipReconciliationAssert` is true (hot-path after before_guardian). */
  reconciliation?: AccountingReconciliationInput;
  order?: PlaceOrderInput;
  openQtyBySymbol?: Record<string, string>;
  accountPeakHwm: string;
  monthlyPeakHwm: string;
  equityUsdt: string;
  strategyDrawdownBps?: number;
  strategyEquityUsdt?: string;
  strategyPeakHwm?: string;
  missingMark?: boolean;
  /** When before_guardian reconcile just passed, skip duplicate assert. */
  skipReconciliationAssert?: boolean;
};

export type HtrGuardianCycleResult = {
  breachState: HtrGuardianBreachState;
  reason: HtrGuardianExitReasonV1 | null;
  allowNewExposure: boolean;
  cancelPartialEntry: boolean;
  permitRiskReducingExit: boolean;
};

export function requiresHtrPartialEntryCancellation(cycle: HtrGuardianCycleResult): boolean {
  return cycle.cancelPartialEntry;
}

export function evaluateHtrGuardianCycle(input: HtrGuardianCycleInput): HtrGuardianCycleResult {
  if (!input.skipReconciliationAssert) {
    if (!input.reconciliation) {
      return {
        breachState: "STOP_ACCOUNT",
        reason: HTR_GUARDIAN_EXIT_REASON_V1.reconciliationFailure,
        allowNewExposure: false,
        cancelPartialEntry: true,
        permitRiskReducingExit: true,
      };
    }
    try {
      assertAccountingReconciliation(input.reconciliation);
    } catch {
      return {
        breachState: "STOP_ACCOUNT",
        reason: HTR_GUARDIAN_EXIT_REASON_V1.reconciliationFailure,
        allowNewExposure: false,
        cancelPartialEntry: true,
        permitRiskReducingExit: true,
      };
    }
  }

  if (input.missingMark) {
    return {
      breachState: "STOP_ACCOUNT",
      reason: HTR_GUARDIAN_EXIT_REASON_V1.missingMark,
      allowNewExposure: false,
      cancelPartialEntry: true,
      permitRiskReducingExit: true,
    };
  }

  // Hot path: at all HWMs with zero strategy drawdown — no breach possible.
  if (
    (input.strategyDrawdownBps ?? 0) <= 0 &&
    compareDecimal(input.equityUsdt, input.accountPeakHwm) >= 0 &&
    compareDecimal(input.equityUsdt, input.monthlyPeakHwm) >= 0
  ) {
    return {
      breachState: "NONE",
      reason: null,
      allowNewExposure: true,
      cancelPartialEntry: false,
      permitRiskReducingExit: true,
    };
  }

  const accountDrawdownBps = computePeakEquityDrawdownBps(input.equityUsdt, input.accountPeakHwm);
  const monthlyDrawdownBps = computePeakEquityDrawdownBps(input.equityUsdt, input.monthlyPeakHwm);
  const drawdown = evaluateDrawdownPolicy(
    {
      equityUsdt: input.equityUsdt,
      accountPeakHwm: input.accountPeakHwm,
      monthlyPeakHwm: input.monthlyPeakHwm,
      strategyEquityUsdt: input.strategyEquityUsdt,
      strategyPeakHwm: input.strategyPeakHwm,
    },
    DEFAULT_D20_DRAWDOWN_POLICY,
  );
  const resolved = resolveDrawdownBreachState({
    accountDrawdownBps,
    monthlyDrawdownBps,
    strategyDrawdownBps: input.strategyDrawdownBps,
    accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
    monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
    strategyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps,
  });

  const breachState =
    resolved.breachState !== "NONE"
      ? resolved.breachState
      : drawdown.breachState === "STOP_ACCOUNT"
        ? "STOP_ACCOUNT"
        : "NONE";
  const reason = resolved.reason;

  return {
    breachState,
    reason,
    allowNewExposure: breachState === "NONE",
    cancelPartialEntry: breachState !== "NONE",
    permitRiskReducingExit: true,
  };
}

export function applyBreachSubmissionRestrictions(input: {
  cycle: HtrGuardianCycleResult;
  order: PlaceOrderInput;
  openQty: string;
}): { permitted: boolean; reason: HtrGuardianExitReasonV1 | null } {
  if (input.cycle.breachState === "STOP_ACCOUNT") {
    if (input.order.side === "sell" && input.cycle.permitRiskReducingExit) {
      return { permitted: true, reason: null };
    }
    return { permitted: false, reason: HTR_GUARDIAN_EXIT_REASON_V1.accountStop };
  }
  if (input.cycle.breachState === "CLOSE_ONLY") {
    if (input.order.side === "sell") {
      return { permitted: true, reason: null };
    }
    return { permitted: false, reason: HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownEquality };
  }
  return { permitted: true, reason: null };
}
