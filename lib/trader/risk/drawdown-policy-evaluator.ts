import { compareDecimal, parseDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import {
  DEFAULT_D20_DRAWDOWN_POLICY,
  type DrawdownBreachState,
  type DrawdownPolicyConfig,
  type DrawdownPolicyEvaluationInput,
  type DrawdownPolicyEvaluationResult,
} from "@/lib/trader/risk/drawdown-policy.types";
import {
  approveDecision,
  buildRiskSnapshot,
  closeOnlyDecision,
  rejectDecision,
  stopAccountDecision,
} from "@/lib/trader/risk/decision";
import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import { drawdownReasonCodes } from "@/lib/trader/risk/reason-codes";
import type { RiskReasonCode } from "@/lib/trader/risk/reason-codes";
import type { RiskDecision } from "@/lib/trader/risk/types";

export { drawdownReasonCodes };

export function computePeakEquityDrawdownBps(equityUsdt: string, peakHwm: string): number {
  if (compareDecimal(peakHwm, "0") <= 0) {
    return 0;
  }
  const drawdown = subtractDecimal(peakHwm, equityUsdt);
  if (compareDecimal(drawdown, "0") <= 0) {
    return 0;
  }
  const drawdownScaled = parseDecimal(drawdown);
  const peakScaled = parseDecimal(peakHwm);
  if (peakScaled === 0n) {
    return 0;
  }
  const bps = (drawdownScaled * 10000n) / peakScaled;
  return Number(bps);
}

export function isDrawdownBreach(drawdownBps: number, limitBps: number): boolean {
  return drawdownBps >= limitBps;
}

export function resolveMonthKeyUtc(asOfIso: string): string {
  const date = new Date(asOfIso);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function updateDrawdownHighWaterMarks(input: {
  equityUsdt: string;
  accountPeakHwm: string;
  monthlyPeakHwm: string;
  strategyEquityUsdt?: string;
  strategyPeakHwm?: string;
  priorMonthKey?: string;
  monthKey: string;
}): {
  accountPeakHwm: string;
  monthlyPeakHwm: string;
  strategyPeakHwm: string | null;
} {
  const accountPeakHwm =
    compareDecimal(input.equityUsdt, input.accountPeakHwm) > 0
      ? input.equityUsdt
      : input.accountPeakHwm;

  let monthlyPeakHwm = input.monthlyPeakHwm;
  if (input.priorMonthKey !== input.monthKey) {
    monthlyPeakHwm = input.equityUsdt;
  } else if (compareDecimal(input.equityUsdt, monthlyPeakHwm) > 0) {
    monthlyPeakHwm = input.equityUsdt;
  }

  let strategyPeakHwm: string | null = null;
  if (input.strategyEquityUsdt != null && input.strategyPeakHwm != null) {
    strategyPeakHwm =
      compareDecimal(input.strategyEquityUsdt, input.strategyPeakHwm) > 0
        ? input.strategyEquityUsdt
        : input.strategyPeakHwm;
  }

  return { accountPeakHwm, monthlyPeakHwm, strategyPeakHwm };
}

export function evaluateDrawdownPolicy(
  input: DrawdownPolicyEvaluationInput,
  config: DrawdownPolicyConfig = DEFAULT_D20_DRAWDOWN_POLICY,
): DrawdownPolicyEvaluationResult {
  const accountDrawdownBps = computePeakEquityDrawdownBps(input.equityUsdt, input.accountPeakHwm);
  const monthlyDrawdownBps = computePeakEquityDrawdownBps(input.equityUsdt, input.monthlyPeakHwm);
  const strategyDrawdownBps =
    input.strategyEquityUsdt != null && input.strategyPeakHwm != null
      ? computePeakEquityDrawdownBps(input.strategyEquityUsdt, input.strategyPeakHwm)
      : null;

  const accountBreached = isDrawdownBreach(accountDrawdownBps, config.accountBps);
  const monthlyBreached = isDrawdownBreach(monthlyDrawdownBps, config.monthlyBps);
  const strategyBreached =
    strategyDrawdownBps != null ? isDrawdownBreach(strategyDrawdownBps, config.strategyBps) : false;

  let breachState: DrawdownBreachState = "NONE";
  if (accountBreached || monthlyBreached || strategyBreached) {
    breachState = "STOP_ACCOUNT";
  }

  return {
    accountDrawdownBps,
    monthlyDrawdownBps,
    strategyDrawdownBps,
    accountBreached,
    monthlyBreached,
    strategyBreached,
    breachState,
  };
}

export function evaluateDrawdownPolicyDecision(input: {
  order: PlaceOrderInput;
  evaluation: DrawdownPolicyEvaluationResult;
  evaluatedAt: string;
}): RiskDecision {
  const snapshot = buildRiskSnapshot({
    order: input.order,
    checksApplied: ["drawdown"],
  });
  const reasonCodes: RiskReasonCode[] = [];
  if (input.evaluation.accountBreached) {
    reasonCodes.push(drawdownReasonCodes.accountDrawdown);
  }
  if (input.evaluation.monthlyBreached) {
    reasonCodes.push(drawdownReasonCodes.monthlyDrawdown);
  }
  if (input.evaluation.strategyBreached) {
    reasonCodes.push(drawdownReasonCodes.strategyDrawdown);
  }

  if (input.evaluation.breachState === "STOP_ACCOUNT") {
    return stopAccountDecision(reasonCodes, snapshot, input.evaluatedAt);
  }
  if (input.evaluation.breachState === "CLOSE_ONLY") {
    return closeOnlyDecision(reasonCodes, snapshot, input.evaluatedAt);
  }
  if (reasonCodes.length > 0) {
    return rejectDecision(reasonCodes, snapshot, input.evaluatedAt);
  }
  return approveDecision(snapshot, input.evaluatedAt);
}
