import type { Order, Trade } from "@/lib/trader/connectors/types";
import { mapConnectorStatusToOrderState } from "@/lib/trader/execution/connector-status-map";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import { isTerminal } from "@/lib/trader/execution/order-state-machine";
import type { ReconciliationClassification } from "@/lib/trader/execution/reconciliation.types";
import type { OrderState } from "@/lib/trader/execution/types";

export type ConnectorView = {
  order: Order | null;
  trades: Trade[];
  dbFillTradeIds: readonly string[];
};

const CONNECTOR_NON_TERMINAL_STATUSES = new Set(["open", "partially_filled"]);

function parseQty(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function qtyGreater(left: string, right: string): boolean {
  return parseQty(left) > parseQty(right);
}

function qtyEqual(left: string, right: string): boolean {
  return parseQty(left) === parseQty(right);
}

function tradesForClient(trades: Trade[], clientOrderId: string): Trade[] {
  return trades.filter((trade) => trade.clientOrderId === clientOrderId);
}

function missingTrades(trades: Trade[], recordedTradeIds: readonly string[]): Trade[] {
  const recorded = new Set(recordedTradeIds);
  return trades.filter((trade) => !recorded.has(trade.tradeId));
}

function connectorShowsOpenActivity(order: Order | null): boolean {
  return order !== null && CONNECTOR_NON_TERMINAL_STATUSES.has(order.status);
}

function expectedStateForConnectorOrder(connectorOrder: Order): OrderState {
  return mapConnectorStatusToOrderState(connectorOrder.status);
}

function hasFillProgress(
  order: OrderRow,
  connectorOrder: Order | null,
  clientTrades: Trade[],
  recordedTradeIds: readonly string[],
): boolean {
  if (missingTrades(clientTrades, recordedTradeIds).length > 0) {
    return true;
  }

  if (connectorOrder && qtyGreater(connectorOrder.filledQuantity, order.filledQuantity)) {
    return true;
  }

  if (
    connectorOrder &&
    (connectorOrder.status === "partially_filled" || connectorOrder.status === "filled") &&
    !qtyEqual(connectorOrder.filledQuantity, order.filledQuantity)
  ) {
    return true;
  }

  return false;
}

function isVenueAcked(order: OrderRow, connectorOrder: Order): boolean {
  return (
    connectorOrder.status === "open" &&
    (order.state === "SENT_TO_EXCHANGE" || order.state === "RECONCILIATION_REQUIRED") &&
    !qtyGreater(connectorOrder.filledQuantity, order.filledQuantity)
  );
}

function statesAlign(order: OrderRow, connectorOrder: Order): boolean {
  const expected = expectedStateForConnectorOrder(connectorOrder);
  if (order.state === expected) {
    return qtyEqual(order.filledQuantity, connectorOrder.filledQuantity);
  }

  if (order.state === "ACCEPTED" && connectorOrder.status === "open") {
    return qtyEqual(order.filledQuantity, connectorOrder.filledQuantity);
  }

  if (order.state === "PARTIALLY_FILLED" && connectorOrder.status === "partially_filled") {
    return qtyEqual(order.filledQuantity, connectorOrder.filledQuantity);
  }

  if (order.state === "FILLED" && connectorOrder.status === "filled") {
    return qtyEqual(order.filledQuantity, connectorOrder.filledQuantity);
  }

  return false;
}

/**
 * Pure reconciliation classifier (DEE-250 / AT-E8 S4).
 * Pre-dispatch orders must be filtered by the service before invocation.
 */
export function classifyReconciliation(
  order: OrderRow | null,
  connector: ConnectorView,
): ReconciliationClassification {
  const connectorOrder = connector.order;

  if (order === null) {
    return connectorOrder !== null ? "UNKNOWN_POSITION" : "IN_SYNC";
  }

  const clientTrades = tradesForClient(connector.trades, order.clientOrderId);

  if (isTerminal(order.state)) {
    if (connectorShowsOpenActivity(connectorOrder)) {
      return "TERMINAL_DRIFT";
    }

    if (connectorOrder && !statesAlign(order, connectorOrder)) {
      return "TERMINAL_DRIFT";
    }

    if (missingTrades(clientTrades, connector.dbFillTradeIds).length > 0) {
      return "TERMINAL_DRIFT";
    }

    return "IN_SYNC";
  }

  if (connectorOrder === null && clientTrades.length === 0) {
    return "NOT_FOUND_AT_VENUE";
  }

  if (connectorOrder === null && clientTrades.length > 0) {
    return "FILL_PROGRESS";
  }

  if (connectorOrder!.status === "canceled" || connectorOrder!.status === "rejected") {
    return "VENUE_TERMINALIZED";
  }

  if (hasFillProgress(order, connectorOrder, clientTrades, connector.dbFillTradeIds)) {
    return "FILL_PROGRESS";
  }

  if (connectorOrder && isVenueAcked(order, connectorOrder)) {
    return "VENUE_ACKED";
  }

  if (connectorOrder && statesAlign(order, connectorOrder)) {
    return "IN_SYNC";
  }

  if (connectorOrder && connectorOrder.status === "open" && order.state === "SENT_TO_EXCHANGE") {
    return "VENUE_ACKED";
  }

  if (connectorOrder) {
    const expected = expectedStateForConnectorOrder(connectorOrder);
    if (order.state !== expected) {
      if (connectorOrder.status === "filled" || connectorOrder.status === "partially_filled") {
        return "FILL_PROGRESS";
      }
      return "AMBIGUOUS_STALE";
    }
  }

  return "AMBIGUOUS_STALE";
}

/**
 * Returns null when the order is pre-dispatch and must be skipped by reconciliation.
 */
export function classifyReconciliationForOrder(
  order: OrderRow | null,
  connector: ConnectorView,
): ReconciliationClassification | null {
  if (order !== null && (order.state === "CREATED" || order.state === "RISK_APPROVED")) {
    return null;
  }

  return classifyReconciliation(order, connector);
}
