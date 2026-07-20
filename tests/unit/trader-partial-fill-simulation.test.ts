import { afterEach, describe, expect, it } from "vitest";

import { InvalidBarVolumeError } from "@/lib/trader/execution/historical-simulated-exchange";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  advanceWp17Bar,
  createAcceptedMarketOrder,
  createWp17SqliteSession,
  makeWp17Bar,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP17 partial fill simulation", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  it("slices parent order across eligible bars via recordFillProgress", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.20000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "1.0" }),
    });
    const afterSlice1 = await session.repo.getOrderById(session.context, order.id);
    expect(afterSlice1?.state).toBe("PARTIALLY_FILLED");
    expect(compareDecimal(afterSlice1?.filledQuantity ?? "0", "0.1")).toBe(0);

    await advanceWp17Bar({
      session,
      barIndex: 2,
      bar: makeWp17Bar(2, { volume: "1.0" }),
    });
    const completed = await session.repo.getOrderById(session.context, order.id);
    expect(completed?.state).toBe("FILLED");
    expect(compareDecimal(completed?.filledQuantity ?? "0", "0.2")).toBe(0);

    const fills = await session.repo.listFills(session.context, order.id);
    expect(fills).toHaveLength(2);
    expect(compareDecimal(fills[0]?.quantity ?? "0", "0.1")).toBe(0);
    expect(compareDecimal(fills[1]?.quantity ?? "0", "0.1")).toBe(0);
  });

  it("caps each slice at participation fraction of bar volume", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "1.00000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    await advanceWp17Bar({
      session,
      barIndex: 1,
      bar: makeWp17Bar(1, { volume: "0.50000000" }),
    });
    const partial = await session.repo.getOrderById(session.context, order.id);
    expect(compareDecimal(partial?.filledQuantity ?? "0", "0.05")).toBe(0);
  });

  it("never overfills parent quantity", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.05000000",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    for (let barIndex = 1; barIndex <= 2; barIndex += 1) {
      await advanceWp17Bar({
        session,
        barIndex,
        bar: makeWp17Bar(barIndex, { volume: "10" }),
      });
    }

    const finalOrder = await session.repo.getOrderById(session.context, order.id);
    expect(compareDecimal(finalOrder?.filledQuantity ?? "0", "0.05")).toBe(0);
    const fills = await session.repo.listFills(session.context, order.id);
    const totalFilled = fills.reduce((sum, fill) => sum + Number(fill.quantity), 0);
    expect(totalFilled).toBeCloseTo(0.05, 8);
  });

  it("fails closed on invalid bar volume", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context);
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    await expect(
      advanceWp17Bar({
        session,
        barIndex: 1,
        bar: makeWp17Bar(1, { volume: "-1" }),
      }),
    ).rejects.toThrow(InvalidBarVolumeError);
  });
});
