import { afterEach, describe, expect, it } from "vitest";

import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  advanceWp17Bar,
  createAcceptedMarketOrder,
  createWp17SqliteSession,
  makeWp17Bar,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP17 cancel and expiry simulation", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  it("cancels before first eligible fill when cancel becomes effective early", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.5",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));
    session.exchange.requestCancel(order.id, Date.parse("2026-01-01T00:01:10.000Z"), 100);

    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "5" }),
      replayNowMs: Date.parse("2026-01-01T00:01:59.999Z"),
    });

    const cancelled = await session.repo.getOrderById(session.context, order.id);
    expect(cancelled?.state).toBe("CANCELLED");
    expect(compareDecimal(cancelled?.filledQuantity ?? "0", "0")).toBe(0);
    const fills = await session.repo.listFills(session.context, order.id);
    expect(fills).toHaveLength(0);
  });

  it("allows partial fill then cancel on a later eligible bar", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.30000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "1.0" }),
    });
    const partial = await session.repo.getOrderById(session.context, order.id);
    expect(partial?.state).toBe("PARTIALLY_FILLED");

    session.exchange.requestCancel(order.id, Date.parse("2026-01-01T00:02:30.000Z"), 100);
    await advanceWp17Bar({
      session,
      barIndex: 2,
      bar: makeWp17Bar(2, { volume: "1.0" }),
      replayNowMs: Date.parse("2026-01-01T00:02:59.999Z"),
    });

    const cancelled = await session.repo.getOrderById(session.context, order.id);
    expect(cancelled?.state).toBe("CANCELLED");
    expect(compareDecimal(cancelled?.filledQuantity ?? "0", "0.10000000")).toBe(0);
    expect(session.exchange.listOpenOrders()).toHaveLength(0);
  });

  it("expires remainder after third eligible bar (N+3)", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.50000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "1.0" }),
    });
    await advanceWp17Bar({
      session,
      barIndex: 2,
      bar: makeWp17Bar(2, { volume: "0" }),
    });
    await advanceWp17Bar({
      session,
      barIndex: 3,
      bar: makeWp17Bar(3, { volume: "0" }),
    });

    const expired = await session.repo.getOrderById(session.context, order.id);
    expect(expired?.state).toBe("EXPIRED");
    expect(compareDecimal(expired?.filledQuantity ?? "0", "0.10000000")).toBe(0);
    expect(session.exchange.listOpenOrders()).toHaveLength(0);
  });

  it("records pending cancel metadata and blocks further fills after cancel request", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.30000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "1" }),
    });
    const futureCancelTs = Date.parse("2026-01-01T00:02:30.000Z");
    session.exchange.requestCancel(order.id, futureCancelTs, 100);

    const open = session.exchange.listOpenOrders();
    expect(open).toHaveLength(1);
    expect(open[0]?.pendingCancel?.cancelEffectiveTs).toBe(futureCancelTs + 100);

    await advanceWp17Bar({
      session,
      barIndex: 2,
      bar: makeWp17Bar(2, { volume: "5" }),
      replayNowMs: Date.parse("2026-01-01T00:02:10.000Z"),
    });
    const afterBlockedBar = await session.repo.getOrderById(session.context, order.id);
    expect(compareDecimal(afterBlockedBar?.filledQuantity ?? "0", "0.1")).toBe(0);
  });
});
