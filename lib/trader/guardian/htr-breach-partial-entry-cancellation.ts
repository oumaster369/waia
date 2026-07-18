import type { BreachCancellationResultV1 } from "@/lib/trader/execution/execution-service.types";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { isTerminal } from "@/lib/trader/execution/order-state-machine";
import type { OrderExecutionMode, OrderState } from "@/lib/trader/execution/types";
import {
  requestHistoricalBreachCancelIfOpen,
  type HistoricalSimulatedExchange,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type { HtrGuardianCycleResult } from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type { BreachCancellationResultV1 };

export type BreachOrderCancelOutcome =
  | { status: "cancelled"; order: OrderRow }
  | { status: "cancel_requested"; order: OrderRow }
  | { status: "idempotent_skip"; order: OrderRow }
  | { status: "failed"; order: OrderRow };

const CANCELLABLE_ENTRY_STATES = new Set<OrderState>([
  "SENT_TO_EXCHANGE",
  "ACCEPTED",
  "PARTIALLY_FILLED",
]);

function normalizeInventorySymbol(symbol: string): string {
  return normalizeSymbolForHistoricalExecution(symbol);
}

function resolveOpenQty(symbol: string, openQtyBySymbol?: Record<string, string>): string {
  if (!openQtyBySymbol) {
    return "0";
  }
  const normalized = normalizeInventorySymbol(symbol);
  return openQtyBySymbol[normalized] ?? openQtyBySymbol[symbol] ?? "0";
}

export function isPendingEntryOrderForCancellation(
  order: OrderRow,
  openQtyBySymbol?: Record<string, string>,
): boolean {
  if (!CANCELLABLE_ENTRY_STATES.has(order.state)) {
    return false;
  }
  if (order.side === "buy") {
    return true;
  }
  if (order.side === "sell") {
    const openQty = resolveOpenQty(order.symbol, openQtyBySymbol);
    return compareDecimal(openQty, "0") <= 0;
  }
  return false;
}

export function listPendingEntryOrdersForCancellation(
  openOrders: readonly OrderRow[],
  openQtyBySymbol?: Record<string, string>,
): OrderRow[] {
  return openOrders
    .filter((order) => isPendingEntryOrderForCancellation(order, openQtyBySymbol))
    .sort((left, right) => {
      const symbolCompare = left.symbol.localeCompare(right.symbol);
      if (symbolCompare !== 0) {
        return symbolCompare;
      }
      return left.id.localeCompare(right.id);
    });
}

export function createEmptyBreachCancellationResultV1(): BreachCancellationResultV1 {
  return {
    cancelledOrderIds: [],
    failedOrderIds: [],
    idempotentSkipped: [],
    deterministicOrder: [],
    breachCancellationFailed: false,
  };
}

export async function cancelPendingEntryOrdersDeterministic(input: {
  context: OrgContext;
  orders: readonly OrderRow[];
  cancelOrder: (context: OrgContext, order: OrderRow) => Promise<BreachOrderCancelOutcome>;
  historicalExchange?: HistoricalSimulatedExchange;
  cancelLatencyMs?: number;
  replayNowMs?: number;
}): Promise<BreachCancellationResultV1> {
  const result = createEmptyBreachCancellationResultV1();
  result.deterministicOrder = input.orders.map((order) => order.id);

  for (const order of input.orders) {
    if (isTerminal(order.state) || order.state === "CANCEL_REQUESTED") {
      result.idempotentSkipped.push(order.id);
      continue;
    }

    if (input.historicalExchange && input.replayNowMs !== undefined) {
      requestHistoricalBreachCancelIfOpen(
        input.historicalExchange,
        order.id,
        input.replayNowMs,
        input.cancelLatencyMs ?? 100,
      );
    }

    const outcome = await input.cancelOrder(input.context, order);
    if (outcome.status === "idempotent_skip") {
      result.idempotentSkipped.push(order.id);
      continue;
    }
    if (outcome.status === "failed") {
      result.failedOrderIds.push(order.id);
      continue;
    }
    result.cancelledOrderIds.push(order.id);
  }

  result.breachCancellationFailed = result.failedOrderIds.length > 0;
  return result;
}

export async function executeBreachPartialEntryCancellation(input: {
  context: OrgContext;
  guardianCycle: HtrGuardianCycleResult;
  openOrders: readonly OrderRow[];
  cancelOrder: (context: OrgContext, order: OrderRow) => Promise<BreachOrderCancelOutcome>;
  openQtyBySymbol?: Record<string, string>;
  historicalExchange?: HistoricalSimulatedExchange;
  cancelLatencyMs?: number;
  replayNowMs?: number;
}): Promise<BreachCancellationResultV1> {
  if (!input.guardianCycle.cancelPartialEntry) {
    return createEmptyBreachCancellationResultV1();
  }

  const pending = listPendingEntryOrdersForCancellation(input.openOrders, input.openQtyBySymbol);
  return cancelPendingEntryOrdersDeterministic({
    context: input.context,
    orders: pending,
    cancelOrder: input.cancelOrder,
    historicalExchange: input.historicalExchange,
    cancelLatencyMs: input.cancelLatencyMs,
    replayNowMs: input.replayNowMs,
  });
}
