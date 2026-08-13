import { afterEach, describe, expect, it } from "vitest";

import { bindHistoricalExecutionModelToSession } from "@/lib/trader/backtest/historical-execution-profile";
import {
  assertHistoricalFillInstrumentMatch,
  SymbolMismatchFillRejectedError,
  UnsupportedHistoricalOrderTypeError,
} from "@/lib/trader/execution/historical-simulated-exchange";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import type { OrderRow } from "@/lib/trader/execution/order-repository.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import {
  createAcceptedMarketOrder,
  createWp17PersistencePort,
  createWp17SqliteSession,
  makeWp17Bar,
  makeWp17QualifiedHtxVolumeAuthority,
  refreshWp17AccountState,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP17 historical simulated exchange", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  it("registers accepted market orders and rejects unsupported types", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context);

    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));
    expect(session.exchange.listOpenOrders()).toHaveLength(1);

    const limitOrder = { ...order, type: "limit" as const };
    expect(() => session.exchange.registerOrder(limitOrder, 0, 0)).toThrow(
      UnsupportedHistoricalOrderTypeError,
    );

    const badSymbol = { ...order, symbol: "SOLUSDT" };
    expect(() => session.exchange.registerOrder(badSymbol, 0, 0)).toThrow(
      UnsupportedHistoricalOrderTypeError,
    );
  });

  it("orders cancel-effective events before fills at the same replay timestamp", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.5",
    });
    const decisionBarIndex = 0;
    const acceptedAtTs = Date.parse("2026-01-01T00:00:59.999Z");
    session.exchange.registerOrder(order, decisionBarIndex, acceptedAtTs);

    const cancelRequestedAt = Date.parse("2026-01-01T00:01:30.000Z");
    session.exchange.requestCancel(order.id, cancelRequestedAt, session.model.cancelLatencyMs);

    const barIndex = 1;
    const closedBar = makeWp17Bar(barIndex, { volume: "10" });
    const replayNowMs = Date.parse(closedBar.barCloseTime);
    const events: string[] = [];

    const persistence = {
      recordSimulatedFill: async (_context: OrgContext, current: OrderRow) => {
        events.push("FILL");
        return current;
      },
      transitionOrderExpired: async () => {
        events.push("EXPIRY");
        return order;
      },
      transitionOrderCancelled: async () => {
        events.push("CANCEL_EFFECTIVE");
        return order;
      },
    };

    await session.exchange.advanceOnClosedBar({
      context: session.context,
      closedBar,
      barIndex,
      model: session.model,
      persistence,
      replayNowMs,
      ...makeWp17QualifiedHtxVolumeAuthority(closedBar),
      refreshAccountState: async () => ({
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      }),
      reconcileOrder: async () => undefined,
    });

    expect(events[0]).toBe("CANCEL_EFFECTIVE");
    expect(events).not.toContain("FILL");
  });

  it("bindHistoricalExecutionModelToSession wires profile exchange to venue", async () => {
    const profile = bindHistoricalExecutionModelToSession();
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.1",
    });

    profile.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));
    const closedBar = makeWp17Bar(1, { volume: "2" });
    const result = await profile.exchange.advanceOnClosedBar({
      context: session.context,
      closedBar,
      barIndex: 1,
      model: profile.model,
      persistence: createWp17PersistencePort(session.repo, profile.model),
      replayNowMs: Date.parse(closedBar.barCloseTime),
      ...makeWp17QualifiedHtxVolumeAuthority(closedBar),
      refreshAccountState: async () => ({
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      }),
      reconcileOrder: async () => undefined,
    });
    expect(result.fillEvents.length).toBeGreaterThan(0);
  });
});

describe("HTR-WP17 multi-symbol historical execution", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  async function advance(
    session: ReturnType<typeof createWp17SqliteSession>,
    barIndex: number,
    bar: ReturnType<typeof makeWp17Bar>,
    receiptBar?: ReturnType<typeof makeWp17Bar>,
  ) {
    const authorityBar = receiptBar ?? bar;
    return session.exchange.advanceOnClosedBar({
      context: session.context,
      closedBar: bar,
      barIndex,
      model: session.model,
      persistence: createWp17PersistencePort(session.repo, session.model),
      replayNowMs: Date.parse(bar.barCloseTime),
      ...makeWp17QualifiedHtxVolumeAuthority(authorityBar),
      refreshAccountState: () => refreshWp17AccountState(session.repo, session.context),
      reconcileOrder: async () => undefined,
    });
  }

  it("TEST A: BTC bar advances BTC only; ETH order is unchanged and does not throw", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const btc = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "BTCUSDT",
      quantity: "0.5",
    });
    const eth = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "ETHUSDT",
      quantity: "0.5",
    });
    const acceptedAt = Date.parse("2026-01-01T00:00:59.999Z");
    session.exchange.registerOrder(btc, 0, acceptedAt);
    session.exchange.registerOrder(eth, 0, acceptedAt);

    const btcBar = makeWp17Bar(1, { symbol: "BTC/USDT", volume: "1.0" });
    const result = await advance(session, 1, btcBar);

    expect(result.fillEvents).toHaveLength(1);
    expect(result.fillEvents[0]?.orderId).toBe(btc.id);
    expect(result.fillEvents[0]?.symbol).toBe("BTCUSDT");
    const ethOpen = session.exchange.listOpenOrders().find((entry) => entry.order.id === eth.id);
    expect(ethOpen?.filledQty).toBe("0");
    expect(ethOpen?.remainingQty).toBe("0.5");
    expect(ethOpen?.sameSymbolEligibleBarsSeen).toBe(0);
    const ethRow = (await session.repo.getOrderById(session.context, eth.id))!;
    expect(ethRow.filledQuantity).toBe("0");
    expect(ethRow.state).toBe("ACCEPTED");
  });

  it("TEST B: ETH bar advances ETH only; BTC order is unchanged and does not throw", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const btc = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "BTCUSDT",
      quantity: "0.5",
    });
    const eth = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "ETHUSDT",
      quantity: "0.5",
    });
    const acceptedAt = Date.parse("2026-01-01T00:00:59.999Z");
    session.exchange.registerOrder(btc, 0, acceptedAt);
    session.exchange.registerOrder(eth, 0, acceptedAt);

    const ethBar = makeWp17Bar(1, { symbol: "ETH/USDT", volume: "1.0", close: "3000" });
    const result = await advance(session, 1, ethBar);

    expect(result.fillEvents).toHaveLength(1);
    expect(result.fillEvents[0]?.orderId).toBe(eth.id);
    const btcOpen = session.exchange.listOpenOrders().find((entry) => entry.order.id === btc.id);
    expect(btcOpen?.filledQty).toBe("0");
    expect(btcOpen?.sameSymbolEligibleBarsSeen).toBe(0);
  });

  it("TEST C: interleaved BTC/ETH bars count only same-symbol eligible closed bars toward TIF", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const btc = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "BTCUSDT",
      quantity: "0.5",
    });
    const eth = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "ETHUSDT",
      quantity: "0.5",
    });
    const acceptedAt = Date.parse("2026-01-01T00:00:59.999Z");
    session.exchange.registerOrder(btc, 0, acceptedAt);
    session.exchange.registerOrder(eth, 0, acceptedAt);

    const sequence: Array<{ index: number; symbol: "BTC/USDT" | "ETH/USDT" }> = [
      { index: 1, symbol: "BTC/USDT" },
      { index: 2, symbol: "ETH/USDT" },
      { index: 3, symbol: "BTC/USDT" },
      { index: 4, symbol: "ETH/USDT" },
      { index: 5, symbol: "BTC/USDT" },
      { index: 6, symbol: "ETH/USDT" },
    ];
    const fillByOrder = new Map<string, number>();
    for (const step of sequence) {
      const bar = makeWp17Bar(step.index, {
        symbol: step.symbol,
        volume: "1.0",
        close: step.symbol.startsWith("ETH") ? "3000" : "50000",
      });
      const result = await advance(session, step.index, bar);
      for (const event of result.fillEvents) {
        fillByOrder.set(event.orderId, (fillByOrder.get(event.orderId) ?? 0) + 1);
      }
    }

    expect(fillByOrder.get(btc.id)).toBe(3);
    expect(fillByOrder.get(eth.id)).toBe(3);
    expect(session.exchange.listOpenOrders()).toHaveLength(0);
    const btcRow = (await session.repo.getOrderById(session.context, btc.id))!;
    const ethRow = (await session.repo.getOrderById(session.context, eth.id))!;
    expect(btcRow.state).toBe("EXPIRED");
    expect(ethRow.state).toBe("EXPIRED");
    expect(compareDecimal(btcRow.filledQuantity, "0.3")).toBe(0);
    expect(compareDecimal(ethRow.filledQuantity, "0.3")).toBe(0);
  });

  it("TEST D: another symbol's QUALIFIED receipt cannot authorize capacity", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const btc = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "BTCUSDT",
      quantity: "0.5",
    });
    session.exchange.registerOrder(btc, 0, Date.parse("2026-01-01T00:00:59.999Z"));
    const btcBar = makeWp17Bar(1, { symbol: "BTCUSDT", volume: "1.0" });
    const ethBar = makeWp17Bar(1, { symbol: "ETHUSDT", volume: "1.0", close: "3000" });

    await expect(advance(session, 1, btcBar, ethBar)).rejects.toThrow(
      SymbolMismatchFillRejectedError,
    );
    expect(session.exchange.listOpenOrders()[0]?.filledQty).toBe("0");
  });

  it("TEST E: a forced true cross-symbol fill attempt still fails closed", () => {
    expect(() => assertHistoricalFillInstrumentMatch("BTCUSDT", "ETHUSDT")).toThrow(
      SymbolMismatchFillRejectedError,
    );
    expect(() => assertHistoricalFillInstrumentMatch("ETHUSDT", "ETH/USDT")).not.toThrow();
    expect(() => assertHistoricalFillInstrumentMatch("BTCUSDT", "BTC/USDT")).not.toThrow();
  });
});
