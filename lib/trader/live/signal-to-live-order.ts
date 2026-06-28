import type { SubmitOrderInput } from "@/lib/trader/execution/execution-service.types";
import type { StrategySignal, TradingPermission } from "@/lib/trader/intelligence/types";
import { compareDecimal, divideDecimal, minDecimal } from "@/lib/trader/risk/numeric";

const BLOCKED_PERMISSIONS: readonly TradingPermission[] = [
  "STOP_TRADING",
  "ONLY_CLOSE_POSITIONS",
  "PAPER_ONLY",
];

export type MapSignalToLiveSubmitOrderInput = {
  signal: StrategySignal;
  accountKey: string;
  referencePrice: string;
  defaultQuantity: string;
  strategyId: string;
  strategyVersion: string;
  credentialId: string;
  tradingPermission?: TradingPermission;
  clientOrderId?: string;
  idempotencyKey?: string;
  notionalCap?: string;
};

function allocateQuantity(
  signal: StrategySignal,
  referencePrice: string,
  defaultQuantity: string,
  notionalCap?: string,
): string {
  let quantity = defaultQuantity;
  if (signal.maxRisk) {
    if (compareDecimal(referencePrice, "0") > 0) {
      quantity = minDecimal(divideDecimal(signal.maxRisk, referencePrice), defaultQuantity);
    }
  }
  if (notionalCap && compareDecimal(referencePrice, "0") > 0) {
    const capQty = divideDecimal(notionalCap, referencePrice);
    quantity = minDecimal(quantity, capQty);
  }
  return quantity;
}

/** Maps an approved strategy signal to a live order request (BP-7 bounded cycle). */
export function mapSignalToLiveSubmitOrder(
  input: MapSignalToLiveSubmitOrderInput,
): SubmitOrderInput | null {
  const { signal } = input;
  if (signal.outcome !== "SIGNAL" || !signal.side) {
    return null;
  }
  if (signal.strategyId !== input.strategyId) {
    return null;
  }

  const permission = input.tradingPermission;
  if (permission && BLOCKED_PERMISSIONS.includes(permission)) {
    return null;
  }

  return {
    clientOrderId: input.clientOrderId ?? crypto.randomUUID(),
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
    executionMode: "live",
    symbol: signal.symbol,
    side: signal.side,
    type: "market",
    quantity: allocateQuantity(
      signal,
      input.referencePrice,
      input.defaultQuantity,
      input.notionalCap,
    ),
    credentialId: input.credentialId,
    strategySignalId: signal.strategySignalId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    allocationDecisionId: null,
    referencePrice: input.referencePrice,
    accountKey: input.accountKey,
  };
}
