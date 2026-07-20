import { describe, expect, it } from "vitest";

import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  applyBuyFill,
  applySellFill,
  capSellQuantityToInventory,
  deriveCanonicalInventory,
  type SymbolLedger,
} from "@/lib/trader/paper/derive-canonical-inventory";
import { INVENTORY_SEMANTICS_VERSION } from "@/lib/trader/paper/inventory-semantics";
import type { PaperPnLFillEvent } from "@/lib/trader/paper/load-paper-fill-events";
import { PaperPnLReconciliationError } from "@/lib/trader/paper/paper-pnl.errors";

const ORG = "00000000-0000-4000-8000-0000000268";

function mockOrder(overrides: Partial<OrderRow> & Pick<OrderRow, "id" | "side">): OrderRow {
  return {
    organizationId: ORG,
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    symbol: "BTC/USDT",
    type: "market",
    price: null,
    quantity: "0.01",
    filledQuantity: "0.01",
    avgFillPrice: "64000",
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-268",
    strategySignalId: null,
    allocationDecisionId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function mockFill(orderId: string, overrides: Partial<FillRow> = {}): FillRow {
  return {
    id: overrides.id ?? `fill-${orderId}`,
    organizationId: ORG,
    orderId,
    exchangeTradeId: overrides.exchangeTradeId ?? `trade-${orderId}`,
    price: overrides.price ?? "64000",
    quantity: overrides.quantity ?? "0.01",
    fee: overrides.fee ?? "0",
    feeAsset: overrides.feeAsset ?? "USDT",
    executedAt: overrides.executedAt ?? new Date(0),
    createdAt: overrides.createdAt ?? new Date(0),
  };
}

function makeFillEvent(order: OrderRow, fill: FillRow): PaperPnLFillEvent {
  return { fill, order };
}

describe("deriveCanonicalInventory (PR1)", () => {
  it("stamps inventory semantics version and is deterministic", () => {
    const order = mockOrder({ id: "o1", side: "buy" });
    const fill = mockFill(order.id, { executedAt: new Date("2026-01-01T00:00:00.000Z") });
    const events = [makeFillEvent(order, fill)];
    const quote = { "BTC/USDT": "USDT" };
    const first = deriveCanonicalInventory(events, quote);
    const second = deriveCanonicalInventory(events, quote);

    expect(first.semanticsVersion).toBe(INVENTORY_SEMANTICS_VERSION);
    expect(first.openQtyBySymbol.get("BTC/USDT")).toBe("0.01");
    expect(second.openQtyBySymbol.get("BTC/USDT")).toBe("0.01");
  });

  it("sorts by executedAt then fill.id", () => {
    const buyOrder = mockOrder({
      id: "o1",
      side: "buy",
      quantity: "0.01",
      filledQuantity: "0.01",
    });
    const sellOrder = mockOrder({
      id: "o2",
      side: "sell",
      quantity: "0.004",
      filledQuantity: "0.004",
    });
    const events = [
      makeFillEvent(
        sellOrder,
        mockFill(sellOrder.id, {
          id: "f2",
          quantity: "0.004",
          executedAt: new Date("2026-01-02T00:00:00.000Z"),
        }),
      ),
      makeFillEvent(
        buyOrder,
        mockFill(buyOrder.id, {
          id: "f1",
          quantity: "0.01",
          executedAt: new Date("2026-01-01T00:00:00.000Z"),
        }),
      ),
    ];
    const inventory = deriveCanonicalInventory(events, { "BTC/USDT": "USDT" });
    expect(inventory.openQtyBySymbol.get("BTC/USDT")).toBe("0.006");
  });

  it("applySellFill rejects oversell", () => {
    const ledger: SymbolLedger = {
      openQty: "0.00731991",
      avgCost: "64000",
      realizedPnl: "0",
      sellFees: "0",
    };
    expect(() => applySellFill(ledger, "65000", "0.00866055", "0")).toThrow(
      PaperPnLReconciliationError,
    );
  });

  it("capSellQuantityToInventory respects batch allocation", () => {
    const openQtyBySymbol = new Map([["BTC/USDT", "0.00731991"]]);
    const batchAllocatedBySymbol = new Map([["BTC/USDT", "0.003"]]);

    const capped = capSellQuantityToInventory({
      symbol: "BTC/USDT",
      requestedQty: "0.00866055",
      openQtyBySymbol,
      batchAllocatedBySymbol,
    });

    expect(capped).toBe("0.00431991");
  });

  it("fee-adjusted avg cost on buy", () => {
    const ledger: SymbolLedger = {
      openQty: "0",
      avgCost: "0",
      realizedPnl: "0",
      sellFees: "0",
    };
    applyBuyFill(ledger, "64000", "0.01", "6.4");
    expect(ledger.openQty).toBe("0.01");
    expect(ledger.avgCost).toBe("64640");
  });
});
