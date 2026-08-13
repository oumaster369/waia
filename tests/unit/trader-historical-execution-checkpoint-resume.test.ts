import { afterEach, describe, expect, it } from "vitest";

import { createHistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import { historicalFillId } from "@/lib/trader/execution/deterministic-execution-id";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import {
  advanceWp17Bar,
  createAcceptedMarketOrder,
  createWp17PersistencePort,
  createWp17SqliteSession,
  makeWp17Bar,
  refreshWp17AccountState,
  makeWp17QualifiedHtxVolumeAuthority,
} from "@/tests/unit/helpers/wp17-execution-fixtures";

describe("HTR-WP17 execution checkpoint resume", () => {
  const sessions: Array<ReturnType<typeof createWp17SqliteSession>> = [];

  afterEach(() => {
    for (const session of sessions) {
      session.cleanup();
    }
    sessions.length = 0;
  });

  it("serializes and restores open-order metadata for WP05 Model B extension", async () => {
    const session = createWp17SqliteSession();
    sessions.push(session);
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.40000000",
    });
    session.exchange.registerOrder(order, 2, Date.parse(makeWp17Bar(2).barCloseTime));

    await advanceWp17Bar({
      session,
      barIndex: 3,
      bar: makeWp17Bar(3, { volume: "1.0" }),
    });

    const slice = session.exchange.buildCheckpointSlice();
    expect(slice.schemaVersion).toBe("htr-wp17-execution-checkpoint/v1");
    expect(slice.openOrders).toHaveLength(1);
    expect(slice.openOrders[0]?.orderId).toBe(order.id);
    expect(slice.openOrders[0]?.fillSequence).toBe(1);

    const resumedExchange = createHistoricalSimulatedExchange(session.model);
    const restoredOrder = (await session.repo.getOrderById(session.context, order.id))!;
    resumedExchange.restoreFromCheckpointSlice(slice, new Map([[order.id, restoredOrder]]));
    expect(resumedExchange.listOpenOrders()).toHaveLength(1);
    expect(resumedExchange.listOpenOrders()[0]?.remainingQty).toBe(
      slice.openOrders[0]?.remainingQty,
    );
  });

  it("resumed exchange continues partial fills without duplicate or missing slices", async () => {
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

    const slice = session.exchange.buildCheckpointSlice();
    const resumedExchange = createHistoricalSimulatedExchange(session.model);
    const restoredOrder = (await session.repo.getOrderById(session.context, order.id))!;
    resumedExchange.restoreFromCheckpointSlice(slice, new Map([[order.id, restoredOrder]]));

    for (let barIndex = 2; barIndex <= 2; barIndex += 1) {
      const closedBar = makeWp17Bar(barIndex, { volume: "1.0" });
      await resumedExchange.advanceOnClosedBar({
        context: session.context,
        closedBar,
        barIndex,
        model: session.model,
        persistence: createWp17PersistencePort(session.repo, session.model),
        replayNowMs: Date.parse(closedBar.barCloseTime),
        ...makeWp17QualifiedHtxVolumeAuthority(closedBar),
        refreshAccountState: () => refreshWp17AccountState(session.repo, session.context),
        reconcileOrder: async () => undefined,
      });
    }

    const fills = await session.repo.listFills(session.context, order.id);
    expect(fills).toHaveLength(2);
    expect(fills.map((fill) => compareDecimal(fill.quantity, "0.1"))).toEqual([0, 0]);
    expect(fills[0]?.id).toBe(
      historicalFillId({
        organizationId: session.orgId,
        orderId: order.id,
        fillSequence: 1,
        sourceBarIndex: 1,
      }),
    );
  });

  it("restored checkpoint preserves remaining quantity for partial in-flight orders", async () => {
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

    const slice = session.exchange.buildCheckpointSlice();
    const resumedExchange = createHistoricalSimulatedExchange(session.model);
    const restoredOrder = (await session.repo.getOrderById(session.context, order.id))!;
    resumedExchange.restoreFromCheckpointSlice(slice, new Map([[order.id, restoredOrder]]));

    const open = resumedExchange.listOpenOrders()[0];
    expect(compareDecimal(open?.remainingQty ?? "0", "0.40000000")).toBe(0);
    expect(open?.fillSequence).toBe(1);
  });

  it("TEST F: checkpoint restore with simultaneous BTC and ETH opens preserves subsequent fill sequence", async () => {
    const acceptedAt = Date.parse("2026-01-01T00:00:59.999Z");
    const bars = [
      makeWp17Bar(1, { symbol: "BTC/USDT", volume: "1.0" }),
      makeWp17Bar(2, { symbol: "ETH/USDT", volume: "1.0", close: "3000" }),
      makeWp17Bar(3, { symbol: "BTC/USDT", volume: "1.0" }),
      makeWp17Bar(4, { symbol: "ETH/USDT", volume: "1.0", close: "3000" }),
    ];

    const control = createWp17SqliteSession();
    const controlBtc = await createAcceptedMarketOrder(control.repo, control.context, {
      symbol: "BTCUSDT",
      quantity: "0.5",
    });
    const controlEth = await createAcceptedMarketOrder(control.repo, control.context, {
      symbol: "ETHUSDT",
      quantity: "0.5",
    });
    control.exchange.registerOrder(controlBtc, 0, acceptedAt);
    control.exchange.registerOrder(controlEth, 0, acceptedAt);
    for (let i = 0; i < 4; i += 1) {
      await advanceWp17Bar({ session: control, barIndex: i + 1, bar: bars[i] });
    }
    const expectedBtcQty = (await control.repo.listFills(control.context, controlBtc.id)).map(
      (fill) => fill.quantity,
    );
    const expectedEthQty = (await control.repo.listFills(control.context, controlEth.id)).map(
      (fill) => fill.quantity,
    );
    control.cleanup();

    const session = createWp17SqliteSession();
    sessions.push(session);
    const liveBtc = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "BTCUSDT",
      quantity: "0.5",
    });
    const liveEth = await createAcceptedMarketOrder(session.repo, session.context, {
      symbol: "ETHUSDT",
      quantity: "0.5",
    });
    session.exchange.registerOrder(liveBtc, 0, acceptedAt);
    session.exchange.registerOrder(liveEth, 0, acceptedAt);

    await advanceWp17Bar({ session, barIndex: 1, bar: bars[0] });
    await advanceWp17Bar({ session, barIndex: 2, bar: bars[1] });

    const slice = session.exchange.buildCheckpointSlice();
    expect(slice.openOrders).toHaveLength(2);
    const resumed = createHistoricalSimulatedExchange(session.model);
    const btcRow = (await session.repo.getOrderById(session.context, liveBtc.id))!;
    const ethRow = (await session.repo.getOrderById(session.context, liveEth.id))!;
    resumed.restoreFromCheckpointSlice(
      slice,
      new Map([
        [liveBtc.id, btcRow],
        [liveEth.id, ethRow],
      ]),
    );
    session.exchange = resumed;

    await advanceWp17Bar({ session, barIndex: 3, bar: bars[2] });
    await advanceWp17Bar({ session, barIndex: 4, bar: bars[3] });

    const liveBtcFills = await session.repo.listFills(session.context, liveBtc.id);
    const liveEthFills = await session.repo.listFills(session.context, liveEth.id);
    expect(liveBtcFills.map((fill) => fill.quantity)).toEqual(expectedBtcQty);
    expect(liveEthFills.map((fill) => fill.quantity)).toEqual(expectedEthQty);
    expect(liveBtcFills).toHaveLength(2);
    expect(liveEthFills).toHaveLength(2);
    expect(liveBtcFills[1]?.id).toBe(
      historicalFillId({
        organizationId: session.orgId,
        orderId: liveBtc.id,
        fillSequence: 2,
        sourceBarIndex: 3,
      }),
    );
  });
});
