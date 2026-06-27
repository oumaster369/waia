import type { OrderRow } from "@/lib/trader/execution/order-repository.types";

/**
 * Matches soak evidence strategy scope: registry strategy IDs (CLI default) or per-signal UUID rows.
 * Production paper orders store UUID in strategySignalId; clientOrderId embeds registry strategyId.
 */
export function orderMatchesStrategyEvidenceScope(
  order: Pick<OrderRow, "clientOrderId" | "strategySignalId">,
  registryStrategyId: string,
): boolean {
  if (order.strategySignalId === registryStrategyId) {
    return true;
  }
  return order.clientOrderId.endsWith(`-${registryStrategyId}`);
}
