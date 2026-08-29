import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  assertLifecycleFillWalkTaxonomyParity,
  assertTradeLineageImmutable,
  createLifecycleRecorder,
  createSqliteLifecycleRepository,
  deriveTradesFromFills,
  TradeFrozenError,
  TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
} from "@/lib/trader/lifecycle";
import { createSqliteOrderRepository } from "@/lib/trader/execution/repository-adapters";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000376a";

describe("trader lifecycle repository (M1 / DEE-376)", () => {
  let orgA: string;
  let lifecycleRepo: ReturnType<typeof createSqliteLifecycleRepository>;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-lifecycle-repo-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "lifecycle-repo.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "lifecycle-repo-a@waia.invalid",
      password: "password123",
      identityLabel: "Lifecycle Repo Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Lifecycle Repo Org A" });
    lifecycleRepo = createSqliteLifecycleRepository(db);
  });

  it("persists trade + lot + leg and freezes terminal trade rows", async () => {
    const context = requireOrgContext(orgA);
    const tradeId = crypto.randomUUID();
    const lotId = crypto.randomUUID();
    const legId = crypto.randomUUID();
    const openedAt = new Date("2026-01-01T00:00:00.000Z");

    await lifecycleRepo.insertTrade(context, {
      trade: {
        id: tradeId,
        organizationId: orgA,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: "signal-376",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        state: "OPEN",
        semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
        openedAt,
        closedAt: null,
        realizedPnl: "0",
        markedPnl: "0",
        hypothesisId: null,
        patternId: null,
        riskDecisionId: "risk-376",
        allocationDecisionId: null,
        reasoningSessionId: null,
        signalConfidence: null,
        openingRegime: "RANGE",
        openingMsvId: "msv-1",
        openingFeatureSetId: "fs-1",
        closingMsvId: null,
        closingFeatureSetId: null,
        closingRegime: null,
        frozenAt: null,
      },
    });

    await lifecycleRepo.insertPositionLot(context, {
      lot: {
        id: lotId,
        organizationId: orgA,
        symbol: "BTC/USDT",
        venue: "mock",
        accountKey: "paper",
        positionSide: "LONG",
        instrumentKind: "SPOT",
        strategySignalId: "signal-376",
        state: "OPEN",
        openQty: "1",
        remainingQty: "1",
        avgCost: "100",
        openedAt,
        closedAt: null,
        tradeId,
        hedgeGroupId: null,
        targetLotId: null,
      },
    });

    await lifecycleRepo.insertTradeLeg(context, {
      leg: {
        id: legId,
        organizationId: orgA,
        tradeId,
        positionLotId: lotId,
        kind: "OPEN_FILL",
        orderId: crypto.randomUUID(),
        fillId: crypto.randomUUID(),
        syntheticId: null,
        quantity: "1",
        price: "100",
        fee: "0",
        executedAt: openedAt,
        legPnl: "0",
      },
    });

    const frozenAt = new Date("2026-01-01T01:00:00.000Z");
    await lifecycleRepo.updateTradeOperational(context, {
      tradeId,
      state: "CLOSED",
      closedAt: frozenAt,
      realizedPnl: "5",
      frozenAt,
    });

    await expect(
      lifecycleRepo.updateTradeOperational(context, {
        tradeId,
        realizedPnl: "999",
      }),
    ).rejects.toBeInstanceOf(TradeFrozenError);

    const trades = await lifecycleRepo.listTrades(context, { strategySignalId: "signal-376" });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.frozenAt?.toISOString()).toBe(frozenAt.toISOString());
    expect(trades[0]?.openingMsvId).toBe("msv-1");
  });

  it("rejects immutable lineage field mutation after open", () => {
    const openedAt = new Date("2026-01-01T00:00:00.000Z");
    const tradeId = crypto.randomUUID();
    const baseTrade = {
      id: tradeId,
      organizationId: orgA,
      symbol: "BTC/USDT",
      venue: "mock",
      accountKey: "paper",
      positionSide: "LONG" as const,
      instrumentKind: "SPOT" as const,
      strategySignalId: "signal-immutable",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      state: "OPEN" as const,
      semanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION_V2,
      openedAt,
      closedAt: null,
      realizedPnl: "0",
      markedPnl: "0",
      hypothesisId: null,
      patternId: null,
      riskDecisionId: "risk-immutable",
      allocationDecisionId: null,
      reasoningSessionId: null,
      signalConfidence: null,
      openingRegime: null,
      openingMsvId: null,
      openingFeatureSetId: null,
      closingMsvId: null,
      closingFeatureSetId: null,
      closingRegime: null,
      frozenAt: null,
      createdAt: openedAt,
      updatedAt: openedAt,
    };

    expect(() =>
      assertTradeLineageImmutable(baseTrade, { ...baseTrade, strategyId: "mutated" }),
    ).toThrow(/immutable/);
    expect(() =>
      assertTradeLineageImmutable(baseTrade, {
        ...baseTrade,
        openingCausalLineageDigest: "b".repeat(64),
      }),
    ).toThrow(/openingCausalLineageDigest/);
  });
});

describe("trader lifecycle execution wire (M1 / DEE-376)", () => {
  let orgA: string;
  let orderRepo: ReturnType<typeof createSqliteOrderRepository>;
  let lifecycleRepo: ReturnType<typeof createSqliteLifecycleRepository>;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-lifecycle-wire-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "lifecycle-wire.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: "00000000-0000-4000-8000-0000000376b",
      email: "lifecycle-wire-a@waia.invalid",
      password: "password123",
      identityLabel: "Lifecycle Wire Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: "00000000-0000-4000-8000-0000000376b",
      displayName: "Lifecycle Wire Org A",
    });
    orderRepo = createSqliteOrderRepository(db);
    lifecycleRepo = createSqliteLifecycleRepository(db);
  });

  it("records buy fill into trade + lot rows via lifecycle recorder", async () => {
    const context = requireOrgContext(orgA);
    const recorder = createLifecycleRecorder({ repository: lifecycleRepo });

    const order = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "1",
      clientOrderId: "client-lifecycle-wire-buy",
      idempotencyKey: "idem-lifecycle-wire-buy",
      riskDecisionId: "risk-wire-buy",
      strategySignalId: "signal-wire",
    });

    const fill = await orderRepo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "ex-wire-buy",
      price: "100",
      quantity: "1",
      executedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    await recorder.recordFillLifecycle({
      context,
      order,
      fill,
      accountKey: "paper",
      lineage: {
        strategySignalId: "signal-wire",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: order.riskDecisionId,
        openingMsvId: "msv-wire",
        openingFeatureSetId: "fs-wire",
      },
    });

    const trades = await lifecycleRepo.listTrades(context, { strategySignalId: "signal-wire" });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.state).toBe("OPEN");

    const lots = await lifecycleRepo.listOpenPositionLots(context, {
      strategySignalId: "signal-wire",
    });
    expect(lots).toHaveLength(1);
    expect(lots[0]?.remainingQty).toBe("1");

    const events = await lifecycleRepo.listLifecycleEvents(context, {
      entityType: "TRADE",
      entityId: trades[0]!.id,
    });
    expect(events.some((event) => event.phase === "TRADE_OPENED")).toBe(true);
  });

  it("persists FORCED_FLAT leg without creating trader_fills rows", async () => {
    const context = requireOrgContext(orgA);
    const recorder = createLifecycleRecorder({ repository: lifecycleRepo });
    const boundaryAt = new Date("2026-01-03T00:00:00.000Z");

    const order = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "1",
      clientOrderId: "client-lifecycle-wire-forced-flat",
      idempotencyKey: "idem-lifecycle-wire-forced-flat",
      riskDecisionId: "risk-wire-forced-flat",
      strategySignalId: "signal-forced-flat",
    });

    const fill = await orderRepo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "ex-wire-forced-flat-buy",
      price: "100",
      quantity: "1",
      executedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    await recorder.recordFillLifecycle({
      context,
      order,
      fill,
      accountKey: "paper",
      lineage: {
        strategySignalId: "signal-forced-flat",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: order.riskDecisionId,
      },
    });

    const fillsBefore = await orderRepo.listFills(context, order.id);

    await recorder.recordForcedFlatLifecycle({
      context,
      accountKey: "paper",
      strategySignalId: "signal-forced-flat",
      markToClose: {
        syntheticId: "synthetic-flat:BTC/USDT",
        symbol: "BTC/USDT",
        executedAt: boundaryAt,
        quantity: "1",
        boundaryClosePrice: "105",
        adjustedSellPrice: "104",
        sellFee: "0.1",
        tradePnl: "3.9",
        syntheticClose: true,
      },
    });

    const fillsAfter = await orderRepo.listFills(context, order.id);
    expect(fillsAfter).toHaveLength(fillsBefore.length);

    const trades = await lifecycleRepo.listTrades(context, {
      strategySignalId: "signal-forced-flat",
    });
    expect(trades).toHaveLength(1);
    expect(trades[0]?.state).toBe("FORCED_FLAT");
    expect(trades[0]?.frozenAt).not.toBeNull();

    const legs = await lifecycleRepo.listTradeLegs(context, trades[0]!.id);
    const forcedLeg = legs.find((leg) => leg.kind === "FORCED_FLAT");
    expect(forcedLeg).toBeDefined();
    expect(forcedLeg?.fillId).toBeNull();
    expect(forcedLeg?.syntheticId).toBe("synthetic-flat:BTC/USDT");

    const events = await lifecycleRepo.listLifecycleEvents(context, {
      entityType: "TRADE",
      entityId: trades[0]!.id,
    });
    expect(events.some((event) => event.phase === "FORCED_FLAT")).toBe(true);
  });

  it("asserts lifecycle vs fill-walk taxonomy parity for forced-flat snapshot", async () => {
    const context = requireOrgContext(orgA);
    const recorder = createLifecycleRecorder({ repository: lifecycleRepo });
    const boundaryAt = new Date("2026-01-03T00:00:00.000Z");

    const order = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "1",
      clientOrderId: "client-lifecycle-parity",
      idempotencyKey: "idem-lifecycle-parity",
      riskDecisionId: "risk-parity",
      strategySignalId: "signal-parity",
    });

    const fill = await orderRepo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "ex-parity-buy",
      price: "100",
      quantity: "1",
      executedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    await recorder.recordFillLifecycle({
      context,
      order,
      fill,
      accountKey: "paper",
      lineage: {
        strategySignalId: "signal-parity",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: order.riskDecisionId,
      },
    });

    const markToClose = {
      syntheticId: "synthetic-flat:BTC/USDT",
      symbol: "BTC/USDT",
      executedAt: boundaryAt,
      quantity: "1",
      boundaryClosePrice: "105",
      adjustedSellPrice: "104",
      sellFee: "0.1",
      tradePnl: "3.9",
      syntheticClose: true as const,
    };

    await recorder.recordForcedFlatLifecycle({
      context,
      accountKey: "paper",
      strategySignalId: "signal-parity",
      markToClose,
    });

    const lifecycleSnapshot = deriveTradesFromFills({
      fillEvents: [{ fill, order }],
      organizationId: orgA,
      strategySignalId: "signal-parity",
      accountKey: "paper",
      forcedFlatTrades: [markToClose],
    });

    assertLifecycleFillWalkTaxonomyParity({
      fillWalk: {
        closedTrades: [],
        markToCloseTrades: [markToClose],
        closedTradeCount: 0,
        markToCloseTradeCount: 1,
      },
      lifecycleSnapshot,
    });
  });

  it("scopes sell fills to pairing key strategySignalId and accountKey (PR2)", async () => {
    const context = requireOrgContext(orgA);
    const recorder = createLifecycleRecorder({ repository: lifecycleRepo });

    async function openLot(strategySignalId: string, clientSuffix: string) {
      const order = await orderRepo.createOrder(context, {
        venue: "mock",
        executionMode: "mock",
        symbol: "BTC/USDT",
        side: "buy",
        type: "market",
        quantity: "0.01",
        clientOrderId: `client-pair-${clientSuffix}`,
        idempotencyKey: `idem-pair-${clientSuffix}`,
        riskDecisionId: `risk-pair-${clientSuffix}`,
        strategySignalId,
      });
      const fill = await orderRepo.recordFill(context, {
        orderId: order.id,
        exchangeTradeId: `ex-pair-${clientSuffix}`,
        price: "100",
        quantity: "0.01",
        executedAt: new Date("2026-01-02T00:00:00.000Z"),
      });
      await recorder.recordFillLifecycle({
        context,
        order,
        fill,
        accountKey: "paper",
        lineage: {
          strategySignalId,
          strategyId: "mean_reversion_v0",
          strategyVersion: "0.1.0",
          riskDecisionId: order.riskDecisionId,
        },
      });
    }

    await openLot("signal-scope-a", "a");
    await openLot("signal-scope-b", "b");

    const sellOrder = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "sell",
      type: "market",
      quantity: "0.01",
      clientOrderId: "client-pair-sell-a",
      idempotencyKey: "idem-pair-sell-a",
      riskDecisionId: "risk-pair-sell-a",
      strategySignalId: "signal-scope-a",
    });
    const sellFill = await orderRepo.recordFill(context, {
      orderId: sellOrder.id,
      exchangeTradeId: "ex-pair-sell-a",
      price: "101",
      quantity: "0.01",
      executedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await recorder.recordFillLifecycle({
      context,
      order: sellOrder,
      fill: sellFill,
      accountKey: "paper",
      lineage: {
        strategySignalId: "signal-scope-a",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: sellOrder.riskDecisionId,
      },
    });

    const lotA = await lifecycleRepo.listOpenPositionLots(context, {
      strategySignalId: "signal-scope-a",
      accountKey: "paper",
    });
    const lotB = await lifecycleRepo.listOpenPositionLots(context, {
      strategySignalId: "signal-scope-b",
      accountKey: "paper",
    });
    expect(lotA).toHaveLength(0);
    expect(lotB).toHaveLength(1);
    expect(lotB[0]?.remainingQty).toBe("0.01");
  });

  it("closes dust remainder via synthetic FORCED_FLAT leg (PR2)", async () => {
    const context = requireOrgContext(orgA);
    const recorder = createLifecycleRecorder({ repository: lifecycleRepo });

    const buyOrder = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.003",
      clientOrderId: "client-dust-buy",
      idempotencyKey: "idem-dust-buy",
      riskDecisionId: "risk-dust-buy",
      strategySignalId: "signal-dust",
    });
    const buyFill = await orderRepo.recordFill(context, {
      orderId: buyOrder.id,
      exchangeTradeId: "ex-dust-buy",
      price: "100",
      quantity: "0.003",
      executedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    await recorder.recordFillLifecycle({
      context,
      order: buyOrder,
      fill: buyFill,
      accountKey: "paper",
      lineage: {
        strategySignalId: "signal-dust",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: buyOrder.riskDecisionId,
      },
    });

    const sellOrder = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "sell",
      type: "market",
      quantity: "0.0025",
      clientOrderId: "client-dust-sell",
      idempotencyKey: "idem-dust-sell",
      riskDecisionId: "risk-dust-sell",
      strategySignalId: "signal-dust",
    });
    const sellFill = await orderRepo.recordFill(context, {
      orderId: sellOrder.id,
      exchangeTradeId: "ex-dust-sell",
      price: "101",
      quantity: "0.0025",
      executedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    await recorder.recordFillLifecycle({
      context,
      order: sellOrder,
      fill: sellFill,
      accountKey: "paper",
      minOrderQty: "0.001",
      markPrice: "101",
      lineage: {
        strategySignalId: "signal-dust",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: sellOrder.riskDecisionId,
      },
    });

    const openLots = await lifecycleRepo.listOpenPositionLots(context, {
      strategySignalId: "signal-dust",
      accountKey: "paper",
    });
    expect(openLots).toHaveLength(0);

    const trades = await lifecycleRepo.listTrades(context, { strategySignalId: "signal-dust" });
    const legs = await lifecycleRepo.listTradeLegs(context, trades[0]!.id);
    const dustLeg = legs.find((leg) => leg.kind === "FORCED_FLAT");
    expect(dustLeg?.syntheticId).toMatch(/^dust-remainder:/);
  });
});
