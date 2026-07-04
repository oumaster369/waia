import { describe, expect, it } from "vitest";

import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  countOpenLotsForKey,
  pairFillsFifo,
  applyForcedFlatSynthetic,
} from "@/lib/trader/lifecycle/trade-pairing";
import { TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 } from "@/lib/trader/lifecycle/trade-lifecycle-semantics";

const ORG = "00000000-0000-4000-8000-000000000001";
const SIGNAL_A = "signal-a";
const SIGNAL_B = "signal-b";

function makeOrder(
  overrides: Partial<OrderRow> & Pick<OrderRow, "id" | "side" | "strategySignalId">,
): OrderRow {
  return {
    organizationId: ORG,
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    symbol: "BTC/USDT",
    type: "market",
    price: null,
    quantity: "1",
    filledQuantity: "1",
    avgFillPrice: "100",
    state: "FILLED",
    stateVersion: 2,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: `risk-${overrides.id}`,
    allocationDecisionId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function makeFill(
  overrides: Partial<FillRow> & Pick<FillRow, "id" | "orderId" | "quantity" | "executedAt">,
): FillRow {
  return {
    organizationId: ORG,
    exchangeTradeId: `ex-${overrides.id}`,
    price: "100",
    fee: "0",
    feeAsset: "USDT",
    createdAt: overrides.executedAt,
    ...overrides,
  };
}

function lineageFor(signalId: string) {
  return {
    strategySignalId: signalId,
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    riskDecisionId: "risk-1",
  };
}

describe("trader lifecycle pairing (M1 / DEE-376)", () => {
  it("opens distinct lots for concurrent buys before any sell (multi-position FIFO)", () => {
    let seq = 0;
    const newId = () => `id-${++seq}`;

    const snapshot = pairFillsFifo({
      newId,
      now: new Date("2026-01-01T00:00:00.000Z"),
      events: [
        {
          fill: makeFill({
            id: "fill-buy-1",
            orderId: "order-buy-1",
            quantity: "1",
            executedAt: new Date("2026-01-01T00:01:00.000Z"),
          }),
          order: makeOrder({ id: "order-buy-1", side: "buy", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
        {
          fill: makeFill({
            id: "fill-buy-2",
            orderId: "order-buy-2",
            quantity: "1",
            executedAt: new Date("2026-01-01T00:02:00.000Z"),
          }),
          order: makeOrder({ id: "order-buy-2", side: "buy", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
      ],
    });

    expect(snapshot.lots.filter((lot) => lot.state === "OPEN")).toHaveLength(2);
    expect(snapshot.trades.filter((trade) => trade.state === "OPEN")).toHaveLength(2);
    expect(
      countOpenLotsForKey(snapshot, {
        organizationId: ORG,
        symbol: "BTC/USDT",
        strategySignalId: SIGNAL_A,
        positionSide: "LONG",
        accountKey: "paper",
      }),
    ).toBe(2);
  });

  it("partial close keeps lot and trade OPEN with reduced remainingQty", () => {
    let seq = 0;
    const snapshot = pairFillsFifo({
      newId: () => `id-${++seq}`,
      events: [
        {
          fill: makeFill({
            id: "fill-buy",
            orderId: "order-buy",
            quantity: "2",
            executedAt: new Date("2026-01-01T00:01:00.000Z"),
          }),
          order: makeOrder({ id: "order-buy", side: "buy", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
        {
          fill: makeFill({
            id: "fill-sell",
            orderId: "order-sell",
            quantity: "1",
            executedAt: new Date("2026-01-01T00:02:00.000Z"),
          }),
          order: makeOrder({ id: "order-sell", side: "sell", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
      ],
    });

    const lot = snapshot.lots[0]!;
    const trade = snapshot.trades[0]!;
    expect(lot.remainingQty).toBe("1");
    expect(lot.state).toBe("OPEN");
    expect(trade.state).toBe("OPEN");
    expect(trade.frozenAt).toBeNull();
    expect(snapshot.legs.filter((leg) => leg.kind === "CLOSE_FILL")).toHaveLength(1);
  });

  it("FIFO sell consumes oldest lot first across two open positions", () => {
    let seq = 0;
    const snapshot = pairFillsFifo({
      newId: () => `id-${++seq}`,
      events: [
        {
          fill: makeFill({
            id: "fill-buy-1",
            orderId: "order-buy-1",
            quantity: "1",
            price: "90",
            executedAt: new Date("2026-01-01T00:01:00.000Z"),
          }),
          order: makeOrder({ id: "order-buy-1", side: "buy", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
        {
          fill: makeFill({
            id: "fill-buy-2",
            orderId: "order-buy-2",
            quantity: "1",
            price: "110",
            executedAt: new Date("2026-01-01T00:02:00.000Z"),
          }),
          order: makeOrder({ id: "order-buy-2", side: "buy", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
        {
          fill: makeFill({
            id: "fill-sell",
            orderId: "order-sell",
            quantity: "1",
            price: "100",
            executedAt: new Date("2026-01-01T00:03:00.000Z"),
          }),
          order: makeOrder({ id: "order-sell", side: "sell", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
      ],
    });

    const closedTrade = snapshot.trades.find((trade) => trade.state === "CLOSED");
    expect(closedTrade?.realizedPnl).toBe("10");
    expect(snapshot.lots.filter((lot) => lot.state === "OPEN")).toHaveLength(1);
  });

  it("partial buy fill records partial OPEN_FILL leg and reduced lot qty", () => {
    let seq = 0;
    const snapshot = pairFillsFifo({
      newId: () => `id-${++seq}`,
      events: [
        {
          fill: makeFill({
            id: "fill-buy-partial",
            orderId: "order-buy-partial",
            quantity: "1",
            executedAt: new Date("2026-01-01T00:01:00.000Z"),
          }),
          order: makeOrder({
            id: "order-buy-partial",
            side: "buy",
            strategySignalId: SIGNAL_A,
            quantity: "2",
            filledQuantity: "1",
          }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
      ],
    });

    const lot = snapshot.lots[0]!;
    const leg = snapshot.legs[0]!;
    expect(leg.kind).toBe("OPEN_FILL");
    expect(leg.quantity).toBe("1");
    expect(lot.openQty).toBe("1");
    expect(lot.remainingQty).toBe("1");
    expect(lot.state).toBe("OPEN");
  });

  it("forced-flat synthetic leg never references trader_fills", () => {
    let seq = 0;
    const snapshot = pairFillsFifo({
      newId: () => `id-${++seq}`,
      events: [
        {
          fill: makeFill({
            id: "fill-buy",
            orderId: "order-buy",
            quantity: "1",
            price: "100",
            executedAt: new Date("2026-01-01T00:01:00.000Z"),
          }),
          order: makeOrder({ id: "order-buy", side: "buy", strategySignalId: SIGNAL_A }),
          accountKey: "paper",
          lineage: lineageFor(SIGNAL_A),
        },
      ],
    });

    const buckets = new Map<string, { openLots: typeof snapshot.lots }>();
    for (const lot of snapshot.lots) {
      const key = `${lot.organizationId}:${lot.symbol}:${lot.strategySignalId}:${lot.accountKey}`;
      buckets.set(key, { openLots: [lot] });
    }

    applyForcedFlatSynthetic(
      snapshot,
      buckets,
      {
        organizationId: ORG,
        symbol: "BTC/USDT",
        strategySignalId: SIGNAL_A,
        accountKey: "paper",
        boundaryClosePrice: "105",
        adjustedSellPrice: "104",
        sellFee: "0.1",
        tradePnl: "3.9",
        boundaryTimestamp: new Date("2026-01-02T00:00:00.000Z"),
        syntheticId: "synthetic-flat:BTC/USDT",
        lineage: lineageFor(SIGNAL_A),
      },
      { legId: "leg-forced" },
      new Date("2026-01-02T00:00:00.000Z"),
    );

    const forcedLeg = snapshot.legs.find((leg) => leg.kind === "FORCED_FLAT");
    expect(forcedLeg).toBeDefined();
    expect(forcedLeg?.fillId).toBeNull();
    expect(forcedLeg?.syntheticId).toBe("synthetic-flat:BTC/USDT");
    expect(snapshot.trades[0]?.state).toBe("FORCED_FLAT");
  });

  it("stamps TRADE_LIFECYCLE_SEMANTICS_VERSION_V2 on new trades", () => {
    const snapshot = pairFillsFifo({
      newId: () => crypto.randomUUID(),
      events: [
        {
          fill: makeFill({
            id: "fill-buy",
            orderId: "order-buy",
            quantity: "1",
            executedAt: new Date("2026-01-01T00:01:00.000Z"),
          }),
          order: makeOrder({ id: "order-buy", side: "buy", strategySignalId: SIGNAL_B }),
          accountKey: "default",
          lineage: lineageFor(SIGNAL_B),
        },
      ],
    });

    expect(snapshot.trades[0]?.semanticsVersion).toBe(TRADE_LIFECYCLE_SEMANTICS_VERSION_V2);
    expect(snapshot.trades[0]?.positionSide).toBe("LONG");
    expect(snapshot.trades[0]?.instrumentKind).toBe("SPOT");
  });
});
