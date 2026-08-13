import { afterEach, describe, expect, it } from "vitest";

import {
  createHtrAccountingCycleBridge,
  recordBreachCancellationOnBridge,
  runAutomaticAccountingReconciliation,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderExecutionService,
} from "@/lib/trader/execution";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { getDb } from "@/db/client";
import { executeBreachPartialEntryCancellation } from "@/lib/trader/guardian/htr-breach-partial-entry-cancellation";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { createSqliteRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import {
  advanceWp17Bar,
  createAcceptedMarketOrder,
  createWp17PersistencePort,
  createWp17SqliteSession,
  type Wp17SqliteSession,
  makeWp17QualifiedHtxVolumeAuthority,
} from "@/tests/unit/helpers/wp17-execution-fixtures";
import type { HistoricalExecutionPersistencePort } from "@/lib/trader/execution/historical-simulated-exchange";

function createHistoricalExecutionService(session: Wp17SqliteSession, replayNowMs: number) {
  const db = getDb();
  const nowMs = () => replayNowMs;
  return createOrderExecutionServiceFromDeps({
    riskEngine: createSqliteRiskEngineService(db, { nowMs }),
    orderRepository: session.repo,
    killSwitchResolver: createKillSwitchResolver({
      repository: createSqliteKillSwitchRepository(db),
      nowMs,
    }),
    connectorForMode: () => new MockExchangeConnector(),
    writeAudit: (input) => writeTraderAuditLogSqlite(db, input),
    nowMs,
    historicalExecution: {
      enabled: true,
      model: session.model,
      exchange: session.exchange,
      getDecisionBarIndex: () => 0,
      getReplayNowMs: () => replayNowMs,
    },
  });
}

describe("trader corrective A3 partial entry breach integration", () => {
  let session: Wp17SqliteSession;

  afterEach(() => {
    session?.cleanup();
  });

  it("partial fill then breach transitions order to CANCELLED in repository", async () => {
    session = createWp17SqliteSession();
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "1.0",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:01:00.000Z"));

    await advanceWp17Bar({
      session,
      barIndex: 1,
      replayNowMs: Date.parse("2026-01-01T00:01:59.999Z"),
    });

    const partial = await session.repo.getOrderById(session.context, order.id);
    expect(partial?.state).toBe("PARTIALLY_FILLED");
    expect(Number(partial?.filledQuantity)).toBeGreaterThan(0);

    const bridge = createHtrAccountingCycleBridge({
      organizationId: session.orgId,
      accountKey: "a3-int",
      runId: "run-a3",
    });

    const guardianCycle = {
      breachState: "STOP_ACCOUNT" as const,
      reason: null,
      allowNewExposure: false,
      cancelPartialEntry: true,
      permitRiskReducingExit: true,
    };

    const replayNowMs = Date.parse("2026-01-01T00:02:59.999Z");
    const execution = createHistoricalExecutionService(session, replayNowMs);

    const openOrders = await session.repo.listOpenOrders(session.context, {
      executionMode: "mock",
    });
    const cancellation = await executeBreachPartialEntryCancellation({
      context: session.context,
      guardianCycle,
      openOrders,
      openQtyBySymbol: { BTCUSDT: partial!.filledQuantity },
      cancelOrder: (context, row) => execution.cancelOrderForBreach!(context, row),
      historicalExchange: session.exchange,
      cancelLatencyMs: session.model.cancelLatencyMs,
      replayNowMs,
    });
    recordBreachCancellationOnBridge(bridge, cancellation, 1);

    expect(cancellation.cancelledOrderIds).toContain(order.id);
    expect(bridge.lastBreachCancellation?.cancelledOrderIds).toContain(order.id);

    const cancelRequested = await session.repo.getOrderById(session.context, order.id);
    expect(cancelRequested?.state).toBe("CANCEL_REQUESTED");
    expect(cancelRequested?.filledQuantity).toBe(partial?.filledQuantity);

    const basePersistence = createWp17PersistencePort(session.repo, session.model);
    const persistence: HistoricalExecutionPersistencePort = {
      ...basePersistence,
      transitionOrderCancelledFromRequested: async (context, order) =>
        session.repo.transitionOrder(context, {
          orderId: order.id,
          expectedStateVersion: order.stateVersion,
          toState: "CANCELLED",
        }),
    };
    const closedBar = {
      symbol: "BTCUSDT",
      interval: "1m" as const,
      open: "50000",
      high: "50100",
      low: "49900",
      close: "50000",
      volume: "1.0",
      barOpenTime: "2026-01-01T00:02:00.000Z",
      barCloseTime: "2026-01-01T00:02:59.999Z",
    };
    await session.exchange.advanceOnClosedBar({
      context: session.context,
      closedBar,
      barIndex: 2,
      model: session.model,
      persistence,
      replayNowMs: Date.parse("2026-01-01T00:02:59.999Z") + session.model.cancelLatencyMs,
      ...makeWp17QualifiedHtxVolumeAuthority(closedBar),
      resolveLatestOrder: (orderId) => session.repo.getOrderById(session.context, orderId),
      refreshAccountState: async () => ({
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      }),
      reconcileOrder: async () => undefined,
    });

    const cancelled = await session.repo.getOrderById(session.context, order.id);
    expect(cancelled?.state).toBe("CANCELLED");
    expect(cancelled?.filledQuantity).toBe(partial?.filledQuantity);
  });

  it("records failure when cancel cannot persist before terminal state", async () => {
    session = createWp17SqliteSession();
    const order = await createAcceptedMarketOrder(session.repo, session.context);
    const guardianCycle = {
      breachState: "STOP_ACCOUNT" as const,
      reason: null,
      allowNewExposure: false,
      cancelPartialEntry: true,
      permitRiskReducingExit: true,
    };

    const result = await executeBreachPartialEntryCancellation({
      context: session.context,
      guardianCycle,
      openOrders: [order],
      cancelOrder: async () => ({ status: "failed", order }),
    });

    expect(result.failedOrderIds).toEqual([order.id]);
    expect(result.breachCancellationFailed).toBe(true);
  });

  it("leaves order in CANCEL_REQUESTED after request before exchange ack", async () => {
    session = createWp17SqliteSession();
    const order = await createAcceptedMarketOrder(session.repo, session.context, {
      quantity: "0.8",
    });
    session.exchange.registerOrder(order, 0, Date.parse("2026-01-01T00:01:00.000Z"));

    const replayNowMs = Date.parse("2026-01-01T00:01:59.999Z");
    const execution = createHistoricalExecutionService(session, replayNowMs);

    const cancellation = await executeBreachPartialEntryCancellation({
      context: session.context,
      guardianCycle: {
        breachState: "CLOSE_ONLY" as const,
        reason: null,
        allowNewExposure: false,
        cancelPartialEntry: true,
        permitRiskReducingExit: true,
      },
      openOrders: [order],
      cancelOrder: (context, row) => execution.cancelOrderForBreach!(context, row),
      historicalExchange: session.exchange,
      cancelLatencyMs: session.model.cancelLatencyMs,
      replayNowMs,
    });

    expect(cancellation.cancelledOrderIds).toEqual([order.id]);
    const requested = await session.repo.getOrderById(session.context, order.id);
    expect(requested?.state).toBe("CANCEL_REQUESTED");
    expect(session.exchange.listOpenOrders()).toHaveLength(1);
  });

  it("passes terminal reconciliation after breach cancellation", async () => {
    session = createWp17SqliteSession();
    const bridge = createHtrAccountingCycleBridge({
      organizationId: session.orgId,
      accountKey: "a3-recon",
      runId: "run-a3-recon",
      startingCashUsdt: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    });

    const order = await createAcceptedMarketOrder(session.repo, session.context);
    const db = getDb();
    const execution = createSqliteOrderExecutionService(db, {
      orderRepository: session.repo,
    });

    const cancellation = await executeBreachPartialEntryCancellation({
      context: session.context,
      guardianCycle: {
        breachState: "STOP_ACCOUNT",
        reason: null,
        allowNewExposure: false,
        cancelPartialEntry: true,
        permitRiskReducingExit: true,
      },
      openOrders: [order],
      cancelOrder: (context, row) => execution.cancelOrderForBreach!(context, row),
    });
    recordBreachCancellationOnBridge(bridge, cancellation, 2);

    expect(() =>
      runAutomaticAccountingReconciliation(bridge, {
        inventoryOpenQtyBySymbol: {},
        cycleIndex: 2,
        phase: "before_terminal_export",
      }),
    ).not.toThrow();
    expect(bridge.breachCancellationFailed).toBe(false);
    expect(
      bridge.callOrder.some((event) => event.kind === "WP20_BREACH_CANCELLATION_EXECUTED"),
    ).toBe(true);
  });
});
