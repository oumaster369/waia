import { orderStateEnum } from "@/lib/trader/execution/types";
import { addDecimal, compareDecimal } from "@/lib/trader/risk/numeric";
import { restoreHistoricalSimulationDurableStateSnapshotV2,
  type HistoricalSimulationAtomicScopeV2,
  type HistoricalSimulationDurableStateSnapshotV2 } from "./atomic-cycle-commit-v2";
import type { HistoricalObservablePendingOrderV2 } from "./observable-read-model-v2";

export function projectHistoricalPendingOrdersV2(
  snapshot: HistoricalSimulationDurableStateSnapshotV2<"MODELED_EXCHANGE">,
  scope: HistoricalSimulationAtomicScopeV2 & Readonly<{ cycleId: string }>,
): readonly HistoricalObservablePendingOrderV2[] {
  const state = restoreHistoricalSimulationDurableStateSnapshotV2(snapshot, scope);
  const byId = new Map(state.checkpoint.openOrders.map(order => [order.orderId, order]));
  return Object.freeze(state.openOrders.map(order => {
    const execution = byId.get(order.id);
    if (!execution || order.executionMode !== "mock" || order.credentialId !== null ||
        order.historicalRunId !== scope.runId || order.historicalAccountKey !== scope.accountId ||
        !orderStateEnum.includes(order.state) ||
        ["FILLED", "CANCELLED", "REJECTED", "EXPIRED", "FAILED"].includes(order.state) ||
        !["buy", "sell"].includes(order.side) || !order.symbol ||
        compareDecimal(execution.remainingQty, "0") <= 0 || compareDecimal(execution.filledQty, "0") < 0 ||
        compareDecimal(execution.filledQty, order.filledQuantity) !== 0 ||
        compareDecimal(addDecimal(execution.remainingQty, execution.filledQty), order.quantity) !== 0) {
      throw new Error("HISTORICAL_OBSERVABLE_PENDING_ORDER_INVALID");
    }
    return Object.freeze({ orderId: order.id, symbol: order.symbol, side: order.side,
      state: order.state, quantity: order.quantity, filledQuantity: execution.filledQty,
      remainingQuantity: execution.remainingQty, cancellationPending: execution.pendingCancel != null });
  }).sort((a, b) => a.orderId.localeCompare(b.orderId)));
}
