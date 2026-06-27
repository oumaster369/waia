import { describe, expect, it } from "vitest";

import type { Order } from "@/lib/trader/connectors/types";
import {
  classifyReconciliation,
  classifyReconciliationForOrder,
  deriveTerminalDriftEscalationKind,
  type ConnectorView,
} from "@/lib/trader/execution/reconciliation-classification";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";

const NOW = new Date(1_700_000_000_000);

function baseOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: overrides.id ?? "order-1",
    organizationId: overrides.organizationId ?? "org-1",
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    symbol: overrides.symbol ?? "BTC/USDT",
    side: "buy",
    type: "limit",
    price: "65000",
    quantity: "0.1",
    filledQuantity: overrides.filledQuantity ?? "0",
    avgFillPrice: overrides.avgFillPrice ?? null,
    state: overrides.state ?? "SENT_TO_EXCHANGE",
    stateVersion: overrides.stateVersion ?? 1,
    exchangeOrderId: overrides.exchangeOrderId ?? null,
    clientOrderId: overrides.clientOrderId ?? "client-1",
    idempotencyKey: "idem-1",
    riskDecisionId: "rd-1",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function connectorOrder(overrides: Partial<Order> = {}): Order {
  return {
    orderId: overrides.orderId ?? "ex-1",
    clientOrderId: overrides.clientOrderId ?? "client-1",
    symbol: overrides.symbol ?? "BTC/USDT",
    side: "buy",
    type: "limit",
    status: overrides.status ?? "open",
    price: "65000",
    quantity: "0.1",
    filledQuantity: overrides.filledQuantity ?? "0",
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function view(
  order: Order | null,
  trades: ConnectorView["trades"] = [],
  dbFillTradeIds: string[] = [],
): ConnectorView {
  return { order, trades, dbFillTradeIds };
}

describe("trader order reconciliation classification (DEE-250)", () => {
  it("classifies UNKNOWN_POSITION when connector order has no DB row", () => {
    expect(classifyReconciliation(null, view(connectorOrder()))).toBe("UNKNOWN_POSITION");
  });

  it("classifies TERMINAL_DRIFT when connector open matches terminal DB order", () => {
    const order = baseOrder({ state: "FILLED", filledQuantity: "0.1" });
    expect(classifyReconciliation(order, view(connectorOrder({ status: "open" })))).toBe(
      "TERMINAL_DRIFT",
    );
  });

  it("classifies NOT_FOUND_AT_VENUE for post-dispatch order with no connector record", () => {
    const order = baseOrder({ state: "SENT_TO_EXCHANGE" });
    expect(classifyReconciliation(order, view(null))).toBe("NOT_FOUND_AT_VENUE");
  });

  it("classifies VENUE_ACKED for SENT_TO_EXCHANGE behind venue open order", () => {
    const order = baseOrder({ state: "SENT_TO_EXCHANGE" });
    expect(classifyReconciliation(order, view(connectorOrder({ status: "open" })))).toBe(
      "VENUE_ACKED",
    );
  });

  it("classifies FILL_PROGRESS when connector reports additional fills", () => {
    const order = baseOrder({ state: "ACCEPTED", exchangeOrderId: "ex-1" });
    const trades = [
      {
        tradeId: "trade-1",
        orderId: "ex-1",
        clientOrderId: "client-1",
        symbol: "BTC/USDT",
        side: "buy" as const,
        price: "65000",
        quantity: "0.1",
        fee: "0",
        feeAsset: "USDT",
        executedAt: NOW.toISOString(),
      },
    ];
    expect(
      classifyReconciliation(
        order,
        view(connectorOrder({ status: "filled", filledQuantity: "0.1" }), trades),
      ),
    ).toBe("FILL_PROGRESS");
  });

  it("classifies VENUE_TERMINALIZED when connector reports canceled", () => {
    const order = baseOrder({ state: "ACCEPTED", exchangeOrderId: "ex-1" });
    expect(classifyReconciliation(order, view(connectorOrder({ status: "canceled" })))).toBe(
      "VENUE_TERMINALIZED",
    );
  });

  it("classifies IN_SYNC when DB and connector align", () => {
    const order = baseOrder({ state: "ACCEPTED", exchangeOrderId: "ex-1" });
    expect(classifyReconciliation(order, view(connectorOrder({ status: "open" })))).toBe("IN_SYNC");
  });

  it("returns null for pre-dispatch states via classifyReconciliationForOrder", () => {
    expect(classifyReconciliationForOrder(baseOrder({ state: "CREATED" }), view(null))).toBeNull();
    expect(
      classifyReconciliationForOrder(baseOrder({ state: "RISK_APPROVED" }), view(null)),
    ).toBeNull();
  });

  it("deriveTerminalDriftEscalationKind returns phantom_open for connector open activity on terminal DB", () => {
    const order = baseOrder({ state: "FILLED", filledQuantity: "0.1" });
    expect(deriveTerminalDriftEscalationKind(order, view(connectorOrder({ status: "open" })))).toBe(
      "phantom_open",
    );
  });

  it("deriveTerminalDriftEscalationKind returns terminal_fact_drift for state mismatch", () => {
    const order = baseOrder({ state: "FILLED", filledQuantity: "0.1", exchangeOrderId: "ex-1" });
    expect(
      deriveTerminalDriftEscalationKind(
        order,
        view(connectorOrder({ status: "filled", filledQuantity: "0.05", orderId: "ex-1" })),
      ),
    ).toBe("terminal_fact_drift");
  });
});
