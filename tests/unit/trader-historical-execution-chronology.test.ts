import { afterEach, describe, expect, it } from "vitest";

import {
  advanceWp17Bar,
  createAcceptedMarketOrder,
  createWp17SqliteSession,
  makeWp17Bar,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP17 execution chronology", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  it("enforces HTR_WP17_NO_SAME_BAR_FILL (decision bar N never fills)", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const decisionBarIndex = 5;
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.2",
    });
    session.exchange.registerOrder(
      order,
      decisionBarIndex,
      Date.parse(makeWp17Bar(decisionBarIndex).barCloseTime),
    );

    const decisionBar = makeWp17Bar(decisionBarIndex, { volume: "10", close: "60000" });
    const result = await advanceWp17Bar({
      session,
      barIndex: decisionBarIndex,
      bar: decisionBar,
    });

    expect(result.fillEvents).toHaveLength(0);
    const unchanged = await session.repo.getOrderById(session.context, order.id);
    expect(unchanged?.state).toBe("ACCEPTED");
    expect(unchanged?.filledQuantity).toBe("0");
  });

  it("fills only on eligible window bars N+1 through N+3", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const decisionBarIndex = 10;
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.40000000",
    });
    session.exchange.registerOrder(
      order,
      decisionBarIndex,
      Date.parse(makeWp17Bar(decisionBarIndex).barCloseTime),
    );

    const barIndexes: number[] = [];
    for (let barIndex = decisionBarIndex + 1; barIndex <= decisionBarIndex + 4; barIndex += 1) {
      const result = await advanceWp17Bar({
        session,
        barIndex,
        bar: makeWp17Bar(barIndex, { volume: "1.0" }),
      });
      if (result.fillEvents.length > 0) {
        barIndexes.push(barIndex);
      }
    }

    expect(barIndexes).toEqual([decisionBarIndex + 1, decisionBarIndex + 2, decisionBarIndex + 3]);
    expect(barIndexes).not.toContain(decisionBarIndex);
    expect(barIndexes).not.toContain(decisionBarIndex + 4);
  });

  it("uses bar close as gross fill reference on first eligible bar", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const decisionBarIndex = 0;
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.1",
    });
    session.exchange.registerOrder(order, decisionBarIndex, Date.parse("2026-01-01T00:00:59.999Z"));

    const eligibleBar = makeWp17Bar(1, { close: "51234.56000000", volume: "2" });
    const result = await advanceWp17Bar({ session, barIndex: 1, bar: eligibleBar });
    expect(result.fillEvents).toHaveLength(1);
    expect(result.fillEvents[0]).toMatchObject({
      sourceBarIndex: 1,
      grossFillPrice: "51234.56000000",
    });
  });
});
