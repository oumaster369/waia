import { describe, expect, it } from "vitest";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import { pairFillsFifo, type PairingFillEvent } from "@/lib/trader/lifecycle/trade-pairing";
import { addDecimal } from "@/lib/trader/risk/numeric";

const org = "00000000-0000-4000-8000-000000001078";
function event(
  id: string,
  side: "buy" | "sell",
  quantity: string,
  price: string,
  fee = "0",
  feeAsset = "USDT",
): PairingFillEvent {
  const at = new Date(`2026-01-01T00:00:0${id}.000Z`);
  const order: OrderRow = {
    id,
    organizationId: org,
    credentialId: null,
    venue: "htx",
    executionMode: "paper",
    symbol: "BTC/USDT",
    side,
    type: "market",
    price: null,
    quantity,
    filledQuantity: quantity,
    avgFillPrice: price,
    state: "FILLED",
    stateVersion: 1,
    exchangeOrderId: id,
    clientOrderId: id,
    idempotencyKey: id,
    riskDecisionId: id,
    allocationDecisionId: null,
    strategySignalId: "signal",
    createdAt: at,
    updatedAt: at,
  };
  const fill: FillRow = {
    id: `fill-${id}`,
    orderId: id,
    organizationId: org,
    exchangeTradeId: id,
    price,
    quantity,
    fee,
    feeAsset,
    executedAt: at,
    createdAt: at,
  };
  return {
    order,
    fill,
    accountKey: "account",
    lineage: {
      strategySignalId: "signal",
      strategyId: "strategy",
      strategyVersion: "1",
      riskDecisionId: id,
    },
  };
}
const sum = (values: string[]) => values.reduce(addDecimal, "0");

describe("lifecycle native fee and inventory conservation", () => {
  it("opens only the net base quantity and preserves one separate opening fee", () => {
    const snapshot = pairFillsFifo({ events: [event("1", "buy", "1", "100", "0.01", "BTC")] });
    expect(snapshot.lots[0]).toMatchObject({
      openQty: "0.99",
      remainingQty: "0.99",
      avgCost: "100",
    });
    expect(snapshot.legs[0]).toMatchObject({ quantity: "1", fee: "0.01", legPnl: "0" });
  });
  it("closes a net purchased lot without inventing a residual position", () => {
    const snapshot = pairFillsFifo({
      events: [
        event("1", "buy", "1", "100", "0.01", "BTC"),
        event("2", "sell", "0.99", "110", "0.5"),
      ],
    });
    expect(snapshot.lots[0]).toMatchObject({ state: "CLOSED", remainingQty: "0" });
    expect(snapshot.trades[0]?.realizedPnl).toBe("9.4"); // opening fee 1 USDT remains recognized separately, net cash profit 8.4.
  });
  it("debits sell base fees from inventory and converts them at the fill price once", () => {
    const snapshot = pairFillsFifo({
      events: [event("1", "buy", "1.01", "100"), event("2", "sell", "1", "110", "0.01", "BTC")],
    });
    expect(snapshot.lots[0]).toMatchObject({ state: "CLOSED", remainingQty: "0" });
    expect(snapshot.legs[1]).toMatchObject({ quantity: "1.01", fee: "0.01", legPnl: "9" });
    expect(snapshot.trades[0]?.realizedPnl).toBe("9");
  });
  it("conserves fee shares across FIFO lots down to the last decimal", () => {
    const snapshot = pairFillsFifo({
      events: [
        event("1", "buy", "1", "100"),
        event("2", "buy", "2", "100"),
        event("3", "sell", "3", "110", "0.00000001"),
      ],
    });
    const closes = snapshot.legs.filter((l) => l.kind === "CLOSE_FILL");
    expect(sum(closes.map((l) => l.fee))).toBe("0.00000001");
    expect(sum(closes.map((l) => l.legPnl))).toBe("29.99999999");
  });
  it("refuses unconvertible nonzero fees and non-positive net quantity", () => {
    expect(() => pairFillsFifo({ events: [event("1", "buy", "1", "100", "1", "HT")] })).toThrow(
      /FEE_ASSET_UNCONVERTIBLE/,
    );
    expect(() => pairFillsFifo({ events: [event("1", "buy", "1", "100", "1", "BTC")] })).toThrow(
      /NET_QUANTITY_INVALID/,
    );
  });
  it("accepts a proven zero fee without needing its denomination", () => {
    const snapshot = pairFillsFifo({ events: [event("1", "buy", "1", "100", "0", "")] });
    expect(snapshot.lots[0]?.remainingQty).toBe("1");
  });
});
