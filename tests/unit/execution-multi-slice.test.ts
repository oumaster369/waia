import { afterEach, describe, expect, it } from "vitest";

import { SymbolMismatchFillRejectedError } from "@/lib/trader/execution/historical-simulated-exchange";
import {
  createAcceptedMarketOrder,
  createWp17PersistencePort,
  createWp17SqliteSession,
  makeWp17Bar,
  refreshWp17AccountState,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("DEE-520 execution multi-slice fill invariant", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  it("three partial slices sum to order filledQuantity with fresh order state", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.03",
    });
    const decisionBarIndex = 0;
    const acceptedAtTs = Date.parse("2026-01-01T00:00:59.999Z");
    session.exchange.registerOrder(order, decisionBarIndex, acceptedAtTs);

    const persistence = createWp17PersistencePort(session.repo, session.model);

    for (let barIndex = 1; barIndex <= 3; barIndex += 1) {
      const closedBar = makeWp17Bar(barIndex, { volume: "0.10", symbol: "BTCUSDT" });
      const result = await session.exchange.advanceOnClosedBar({
        context: session.context,
        closedBar,
        barIndex,
        model: session.model,
        persistence,
        replayNowMs: Date.parse(closedBar.barCloseTime),
        refreshAccountState: () => refreshWp17AccountState(session.repo, session.context),
        reconcileOrder: async () => undefined,
      });
      expect(result.fillEvents).toHaveLength(1);
    }

    const lastOrder = (await session.repo.getOrderById(session.context, order.id))!;
    expect(lastOrder.filledQuantity).toBe("0.03");
    expect(lastOrder.state).toBe("FILLED");
  });

  it("rejects fill when bar symbol mismatches order symbol", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context);
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:00:59.999Z"));

    const closedBar = makeWp17Bar(1, { volume: "10", symbol: "ETHUSDT" });
    const persistence = createWp17PersistencePort(session.repo, session.model);

    await expect(
      session.exchange.advanceOnClosedBar({
        context: session.context,
        closedBar,
        barIndex: 1,
        model: session.model,
        persistence,
        replayNowMs: Date.parse(closedBar.barCloseTime),
        refreshAccountState: () => refreshWp17AccountState(session.repo, session.context),
        reconcileOrder: async () => undefined,
      }),
    ).rejects.toThrow(SymbolMismatchFillRejectedError);
  });
});
