import { afterEach, describe, expect, it } from "vitest";

import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  advanceWp17Bar,
  createAcceptedMarketOrder,
  createWp17SqliteSession,
  makeWp17Bar,
  refreshWp17AccountState,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP17 execution account causality", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  it("refreshes account state after advance seam so sizing sees persisted fills", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.20000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    const beforeOrder = await session.repo.getOrderById(session.context, order.id);
    expect(beforeOrder?.filledQuantity).toBe("0");

    const after = await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "2", close: "50000" }),
    });

    const afterOrder = await session.repo.getOrderById(session.context, order.id);
    expect(compareDecimal(afterOrder?.filledQuantity ?? "0", "0")).toBeGreaterThan(0);
    const freshSizingRead = await refreshWp17AccountState(session.repo, session.context);
    expect(freshSizingRead.openOrderCount).toBe(after.accountState.openOrderCount);
  });

  it("reduces open-order count after completing fills before next cycle sizing", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.30000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    const partialAdvance = await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "2" }),
    });
    expect(partialAdvance.accountState.openOrderCount).toBe(1);

    for (let barIndex = 2; barIndex <= 3; barIndex += 1) {
      await advanceWp17Bar({
        session,
        barIndex,
        bar: makeWp17Bar(barIndex, { volume: "2" }),
      });
    }

    const completedState = await refreshWp17AccountState(session.repo, session.context);
    expect(completedState.openOrderCount).toBe(0);
  });

  it("partial fill updates filled quantity before subsequent advance sizing reads", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.30000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "1", close: "40000" }),
    });
    const afterFirst = await session.repo.getOrderById(session.context, order.id);

    await advanceWp17Bar({
      session,
      barIndex: 2,
      bar: makeWp17Bar(2, { volume: "1", close: "40000" }),
    });
    const afterSecond = await session.repo.getOrderById(session.context, order.id);

    expect(
      compareDecimal(afterSecond?.filledQuantity ?? "0", afterFirst?.filledQuantity ?? "0"),
    ).toBe(1);
  });
});
