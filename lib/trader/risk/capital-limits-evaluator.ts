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
import {
  addDecimal,
  compareDecimal,
  isZeroDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import { capitalReasonCodes } from "@/lib/trader/risk/reason-codes";
import type { RiskCheckName, RiskDecision } from "@/lib/trader/risk/types";

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
  input: CapitalLimitsEvaluationInput,
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
