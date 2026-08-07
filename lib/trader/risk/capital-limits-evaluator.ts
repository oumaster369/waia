import type { OrderSide, PlaceOrderInput } from "@/lib/trader/connectors/types";

import {
  approveDecision,
  buildRiskSnapshot,
  closeOnlyDecision,
  rejectDecision,
  stopAccountDecision,
} from "@/lib/trader/risk/decision";
import type {
  AccountRiskState,
  CapitalLimitsConfig,
  CapitalLimitsEvaluationInput,
  CapitalLimitsEvaluatorDeps,
} from "@/lib/trader/risk/capital-limits.types";
import type { DrawdownPolicyEvaluationResult } from "@/lib/trader/risk/drawdown-policy.types";
import {
  addDecimal,
  compareDecimal,
  isZeroDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import {
  evaluateDrawdownPolicy,
  evaluateDrawdownPolicyDecision,
} from "@/lib/trader/risk/drawdown-policy-evaluator";
import { capitalReasonCodes, drawdownReasonCodes } from "@/lib/trader/risk/reason-codes";
import type { RiskCheckName, RiskDecision } from "@/lib/trader/risk/types";
import type { RiskReasonCode } from "@/lib/trader/risk/reason-codes";

type Wp16AccountRiskState = AccountRiskState & {
  accountPeakHwm?: string;
  monthlyPeakHwm?: string;
};

type Wp16CapitalLimitsEvaluationInput = CapitalLimitsEvaluationInput & {
  drawdownEvaluation?: DrawdownPolicyEvaluationResult;
  accountState: Wp16AccountRiskState;
};

function resolveEffectivePrice(order: PlaceOrderInput, referencePrice: string): string {
  if (order.type === "limit") {
    if (!order.price || isZeroDecimal(order.price)) {
      throw new Error("[trader/risk] limit orders require a positive price");
    }
    return order.price;
  }

  if (!referencePrice || isZeroDecimal(referencePrice)) {
    throw new Error("[trader/risk] market orders require a positive referencePrice");
  }

  return referencePrice;
}

function parseQuoteCurrency(symbol: string): string {
  const parts = symbol.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[trader/risk] invalid symbol for quote currency: ${symbol}`);
  }
  return parts[1];
}

function getPositionQuantity(state: AccountRiskState, symbol: string): string {
  let total = "0";
  for (const position of state.positions) {
    if (position.symbol === symbol) {
      total = addDecimal(total, position.quantity);
    }
  }
  return total;
}

function projectPositionQty(currentQty: string, side: OrderSide, orderQty: string): string {
  const projected =
    side === "buy" ? addDecimal(currentQty, orderQty) : subtractDecimal(currentQty, orderQty);
  if (compareDecimal(projected, "0") < 0) {
    return "0";
  }
  return projected;
}

function isPositionIncreasing(side: OrderSide): boolean {
  return side === "buy";
}

function computeOrderNotional(order: PlaceOrderInput, referencePrice: string): string {
  const price = resolveEffectivePrice(order, referencePrice);
  return multiplyDecimal(price, order.quantity);
}

function getQuoteExposure(state: AccountRiskState, quoteCurrency: string): string {
  return state.quoteExposureByCurrency[quoteCurrency] ?? "0";
}

function projectQuoteExposure(currentExposure: string, side: OrderSide, notional: string): string {
  if (side === "buy") {
    return addDecimal(currentExposure, notional);
  }
  return currentExposure;
}

function negateThreshold(threshold: string): string {
  if (threshold.startsWith("-")) {
    return threshold;
  }
  return `-${threshold}`;
}

export function evaluateCapitalLimits(
  input: Wp16CapitalLimitsEvaluationInput,
  config: CapitalLimitsConfig,
  deps: CapitalLimitsEvaluatorDeps,
): RiskDecision {
  const checksApplied: RiskCheckName[] = [];
  const evaluatedAt = new Date(deps.nowMs()).toISOString();
  const effectivePrice = resolveEffectivePrice(input.order, input.referencePrice);
  const computedNotional = computeOrderNotional(input.order, input.referencePrice);

  const baseSnapshot = () =>
    buildRiskSnapshot({
      order: input.order,
      effectivePrice,
      computedNotional,
      checksApplied: [...checksApplied],
    });

  if (input.drawdownEvaluation) {
    return evaluateDrawdownPolicyDecision({
      order: input.order,
      evaluation: input.drawdownEvaluation,
      evaluatedAt,
    });
  }

  if (
    input.accountState.equityUsdt &&
    input.accountState.accountPeakHwm &&
    input.accountState.monthlyPeakHwm
  ) {
    const d20 = evaluateDrawdownPolicy({
      equityUsdt: input.accountState.equityUsdt,
      accountPeakHwm: input.accountState.accountPeakHwm,
      monthlyPeakHwm: input.accountState.monthlyPeakHwm,
    });
    if (d20.breachState === "STOP_ACCOUNT") {
      const reasonCodes: RiskReasonCode[] = [];
      if (d20.accountBreached) reasonCodes.push(drawdownReasonCodes.accountDrawdown);
      if (d20.monthlyBreached) reasonCodes.push(drawdownReasonCodes.monthlyDrawdown);
      if (d20.strategyBreached) reasonCodes.push(drawdownReasonCodes.strategyDrawdown);
      return stopAccountDecision(reasonCodes, baseSnapshot(), evaluatedAt);
    }
    if (d20.breachState === "CLOSE_ONLY") {
      const reasonCodes: RiskReasonCode[] = [];
      if (d20.accountBreached) reasonCodes.push(drawdownReasonCodes.accountDrawdown);
      if (d20.monthlyBreached) reasonCodes.push(drawdownReasonCodes.monthlyDrawdown);
      if (d20.strategyBreached) reasonCodes.push(drawdownReasonCodes.strategyDrawdown);
      return closeOnlyDecision(reasonCodes, baseSnapshot(), evaluatedAt);
    }
  }

  checksApplied.push("drawdown");
  if (compareDecimal(input.accountState.drawdown, config.maxDrawdown) >= 0) {
    return stopAccountDecision(
      [capitalReasonCodes.maxDrawdownExceeded],
      baseSnapshot(),
      evaluatedAt,
    );
  }

  checksApplied.push("dailyLoss");
  const dailyLossThreshold = negateThreshold(config.maxDailyLoss);
  if (compareDecimal(input.accountState.dailyPnl, dailyLossThreshold) <= 0) {
    return rejectDecision([capitalReasonCodes.maxDailyLossExceeded], baseSnapshot(), evaluatedAt);
  }

  checksApplied.push("openOrders");
  if (input.accountState.openOrderCount + 1 > config.maxOpenOrders) {
    return rejectDecision([capitalReasonCodes.maxOpenOrdersExceeded], baseSnapshot(), evaluatedAt);
  }

  checksApplied.push("position");
  const currentPosition = getPositionQuantity(input.accountState, input.order.symbol);
  const projectedPosition = projectPositionQty(
    currentPosition,
    input.order.side,
    input.order.quantity,
  );
  if (
    isPositionIncreasing(input.order.side) &&
    compareDecimal(projectedPosition, config.maxPositionPerSymbol) > 0
  ) {
    return closeOnlyDecision(
      [capitalReasonCodes.maxPositionPerSymbolExceeded],
      baseSnapshot(),
      evaluatedAt,
    );
  }

  if (input.order.side === "sell" && compareDecimal(input.order.quantity, currentPosition) > 0) {
    return rejectDecision(
      [capitalReasonCodes.sellExceedsOpenQuantity],
      baseSnapshot(),
      evaluatedAt,
    );
  }

  checksApplied.push("quoteExposure");
  if (input.order.side === "buy") {
    const quoteCurrency = parseQuoteCurrency(input.order.symbol);
    const currentExposure = getQuoteExposure(input.accountState, quoteCurrency);
    const projectedExposure = projectQuoteExposure(
      currentExposure,
      input.order.side,
      computedNotional,
    );
    if (compareDecimal(projectedExposure, config.maxQuoteExposure) > 0) {
      return rejectDecision(
        [capitalReasonCodes.maxQuoteExposureExceeded],
        baseSnapshot(),
        evaluatedAt,
      );
    }
  }

  if (input.stopDistanceUsdt !== undefined) {
    checksApplied.push("stopDistance");
    if (compareDecimal(input.stopDistanceUsdt, "0") <= 0) {
      return rejectDecision([capitalReasonCodes.invalidStopDistance], baseSnapshot(), evaluatedAt);
    }
  }

  if (input.accountState.availableBalanceUsdt !== undefined && input.order.side === "buy") {
    checksApplied.push("availableBalance");
    if (compareDecimal(computedNotional, input.accountState.availableBalanceUsdt) > 0) {
      return rejectDecision(
        [capitalReasonCodes.insufficientAvailableBalance],
        baseSnapshot(),
        evaluatedAt,
      );
    }
  }

  if (
    input.accountState.openPositionCount !== undefined &&
    isPositionIncreasing(input.order.side)
  ) {
    checksApplied.push("concurrentPositions");
    const hasExisting = compareDecimal(currentPosition, "0") > 0;
    if (!hasExisting && input.accountState.openPositionCount >= config.maxConcurrentPositions) {
      return rejectDecision(
        [capitalReasonCodes.maxConcurrentPositionsExceeded],
        baseSnapshot(),
        evaluatedAt,
      );
    }
  }

  if (
    input.accountState.equityUsdt !== undefined &&
    input.accountState.openRiskUsdt !== undefined &&
    input.stopDistanceUsdt !== undefined &&
    isPositionIncreasing(input.order.side)
  ) {
    checksApplied.push("portfolioRisk");
    const projectedOrderRisk = multiplyDecimal(input.order.quantity, input.stopDistanceUsdt);
    const projectedOpenRisk = addDecimal(input.accountState.openRiskUsdt, projectedOrderRisk);
    const portfolioRiskCap = multiplyDecimal(
      input.accountState.equityUsdt,
      config.maxPortfolioRiskPct,
    );
    if (compareDecimal(projectedOpenRisk, portfolioRiskCap) > 0) {
      return rejectDecision(
        [capitalReasonCodes.maxPortfolioRiskExceeded],
        baseSnapshot(),
        evaluatedAt,
      );
    }
  }

  return approveDecision(baseSnapshot(), evaluatedAt);
}
