import { afterEach, describe, expect, it } from "vitest";

import { bindHistoricalExecutionModelToSession } from "@/lib/trader/backtest/historical-execution-profile";
import { UnsupportedHistoricalOrderTypeError } from "@/lib/trader/execution/historical-simulated-exchange";
import {
  createAcceptedMarketOrder,
  createWp17PersistencePort,
  createWp17SqliteSession,
  makeWp17Bar,
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
      recordSimulatedFill: async () => {
        events.push("FILL");
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
    const result = await profile.exchange.advanceOnClosedBar({
      context: session.context,
      closedBar: makeWp17Bar(1, { volume: "2" }),
      barIndex: 1,
      model: profile.model,
      persistence: createWp17PersistencePort(session.repo, profile.model),
      replayNowMs: Date.parse(makeWp17Bar(1).barCloseTime),
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
