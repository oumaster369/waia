import type { SubmitOrderInput } from "@/lib/trader/execution/execution-service.types";
import type { StrategySignal, TradingPermission } from "@/lib/trader/intelligence/types";
import {
  assertLegacySignalMappingNotV2CapitalAuthority,
  type CapitalAuthorityPath,
} from "@/lib/trader/risk/authority-chain";
import { compareDecimal, divideDecimal, minDecimal } from "@/lib/trader/risk/numeric";

const BLOCKED_PERMISSIONS: readonly TradingPermission[] = [
  "STOP_TRADING",
  "ONLY_CLOSE_POSITIONS",
  "PAPER_ONLY",
];

export type MapSignalToSubmitOrderInput = {
  signal: StrategySignal;
  accountKey: string;
  referencePrice: string;
  executionMode: "mock" | "paper";
  defaultQuantity: string;
  /** When set, caps notional via min(maxRisk/price, defaultQuantity). */
  /** When set, overrides allocateQuantity result (M2 portfolio sizer output). */
  quantity?: string;
  tradingPermission?: TradingPermission;
  clientOrderId?: string;
  idempotencyKey?: string;
  /** Legacy V1 paper/mock mapping — V2 capital authority path fails closed. */
  capitalAuthorityPath?: CapitalAuthorityPath;
};

function allocateQuantity(
  signal: StrategySignal,
  referencePrice: string,
  defaultQuantity: string,
): string {
  if (!signal.maxRisk) {
    return defaultQuantity;
  }
  if (compareDecimal(referencePrice, "0") <= 0) {
    return defaultQuantity;
  }
  const maxQty = divideDecimal(signal.maxRisk, referencePrice);
  return minDecimal(maxQty, defaultQuantity);
}

/**
 * Maps an approved strategy signal to a risk/execution order request.
 * Returns null when the signal cannot become an order.
 * LEGACY V1 maxRisk sizing only — cannot claim V2 capital authority.
 */
export function mapSignalToSubmitOrder(
  input: MapSignalToSubmitOrderInput,
): SubmitOrderInput | null {
  assertLegacySignalMappingNotV2CapitalAuthority(input.capitalAuthorityPath);

  const { signal } = input;
  if (signal.outcome !== "SIGNAL" || !signal.side) {
    return null;
  }

  const permission = input.tradingPermission;
  if (permission && BLOCKED_PERMISSIONS.includes(permission)) {
    return null;
  }

  const quantity =
    input.quantity ?? allocateQuantity(signal, input.referencePrice, input.defaultQuantity);
  if (compareDecimal(quantity, "0") <= 0) {
    return null;
  }

  return {
    clientOrderId: input.clientOrderId ?? crypto.randomUUID(),
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
    executionMode: input.executionMode,
    symbol: signal.symbol,
    side: signal.side,
    type: "market",
    quantity,
    strategySignalId: signal.strategySignalId,
    strategyId: signal.strategyId,
    strategyVersion: signal.strategyVersion,
    allocationDecisionId: null,
    openingMsvId: signal.msvId,
    openingFeatureSetId: signal.featureSetId,
    signalConfidence: signal.confidence ?? null,
    referencePrice: input.referencePrice,
    accountKey: input.accountKey,
  };
}
