import type { PlaceOrderInput } from "@/lib/trader/connectors/types";

import {
  approveDecision,
  buildRiskSnapshot,
  rejectDecision,
  resizeDecision,
} from "@/lib/trader/risk/decision";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  isPositiveDecimal,
  isZeroDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import { riskReasonCodes } from "@/lib/trader/risk/reason-codes";
import type {
  TradeAbuseEvaluationInput,
  TradeAbuseEvaluatorDeps,
  TradeAbuseLimitsConfig,
} from "@/lib/trader/risk/trade-abuse.types";
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

function computeNotional(price: string, quantity: string): string {
  return multiplyDecimal(price, quantity);
}

function isSymbolAllowed(symbol: string, allowedSymbols: readonly string[]): boolean {
  if (allowedSymbols.length === 0) {
    return false;
  }
  return allowedSymbols.includes(symbol);
}

function isWithinCollar(
  effectivePrice: string,
  referencePrice: string,
  collarBps: number,
): boolean {
  if (collarBps <= 0) {
    return true;
  }

  const band = divideDecimal(multiplyDecimal(referencePrice, String(collarBps)), "10000");
  const lowerBound =
    compareDecimal(referencePrice, band) <= 0 ? "0" : subtractDecimal(referencePrice, band);
  const upperBound = addDecimal(referencePrice, band);

  return (
    compareDecimal(effectivePrice, lowerBound) >= 0 &&
    compareDecimal(effectivePrice, upperBound) <= 0
  );
}

function computeResizeQuantity(maxNotional: string, effectivePrice: string): string | null {
  if (!isPositiveDecimal(effectivePrice)) {
    return null;
  }
  // divideDecimal truncates toward zero at DECIMAL_SCALE.
  const trimmed = divideDecimal(maxNotional, effectivePrice);
  if (!isPositiveDecimal(trimmed)) {
    return null;
  }
  return trimmed;
}

export function evaluateTradeAbuse(
  input: TradeAbuseEvaluationInput,
  config: TradeAbuseLimitsConfig,
  deps: TradeAbuseEvaluatorDeps,
): RiskDecision {
  const checksApplied: RiskCheckName[] = [];
  const evaluatedAt = new Date(deps.nowMs()).toISOString();
  const effectivePrice = resolveEffectivePrice(input.order, input.referencePrice);
  const computedNotional = computeNotional(effectivePrice, input.order.quantity);

  const baseSnapshot = () =>
    buildRiskSnapshot({
      order: input.order,
      effectivePrice,
      computedNotional,
      checksApplied: [...checksApplied],
    });

  checksApplied.push("allowlist");
  if (!isSymbolAllowed(input.order.symbol, config.allowedSymbols)) {
    return rejectDecision([riskReasonCodes.symbolNotAllowed], baseSnapshot(), evaluatedAt);
  }

  checksApplied.push("notional");
  if (compareDecimal(computedNotional, config.maxNotional) > 0) {
    const trimmedQuantity = computeResizeQuantity(config.maxNotional, effectivePrice);
    const trimmedNotional =
      trimmedQuantity !== null ? computeNotional(effectivePrice, trimmedQuantity) : null;

    if (
      trimmedQuantity !== null &&
      trimmedNotional !== null &&
      compareDecimal(trimmedQuantity, input.order.quantity) < 0 &&
      isPositiveDecimal(trimmedQuantity)
    ) {
      return resizeDecision(
        [riskReasonCodes.maxNotionalExceeded],
        buildRiskSnapshot({
          order: input.order,
          effectivePrice,
          computedNotional,
          checksApplied: [...checksApplied],
        }),
        { quantity: trimmedQuantity, notional: trimmedNotional },
        evaluatedAt,
      );
    }

    return rejectDecision([riskReasonCodes.maxNotionalExceeded], baseSnapshot(), evaluatedAt);
  }

  checksApplied.push("rate");
  const orderCount = deps.rateStore.recordAndCount(input.accountKey, deps.nowMs(), config.windowMs);
  if (orderCount > config.maxOrdersPerWindow) {
    return rejectDecision([riskReasonCodes.orderRateExceeded], baseSnapshot(), evaluatedAt);
  }

  checksApplied.push("collar");
  if (!isWithinCollar(effectivePrice, input.referencePrice, config.collarBps)) {
    return rejectDecision([riskReasonCodes.priceCollarBreached], baseSnapshot(), evaluatedAt);
  }

  return approveDecision(baseSnapshot(), evaluatedAt);
}
