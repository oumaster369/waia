/**
 * HTR-WP10 — lifecycle recorder id/time determinism via injected newId + nowMs.
 */
import { describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { createSqliteOrderRepository } from "@/lib/trader/execution/repository-adapters";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  createLifecycleRecorder,
  createSqliteLifecycleRepository,
  deriveTradesFromFills,
} from "@/lib/trader/lifecycle";
import {
  createDeterministicReplayIdFactory,
  RESEARCH_REPLAY_CLOCK_START_MS,
} from "@/lib/trader/research/deterministic-replay-id-factory";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USER_ID = "00000000-0000-4000-8000-0000000410l";

function seedDb(): string {
  resetWaiaSqliteSingleton();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp10-lifecycle-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "lifecycle.sqlite")}`;
  migrateDatabaseFromEnv();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "wp10-lifecycle@waia.invalid",
    password: "password123",
    identityLabel: "WP10 Lifecycle",
  });
  return ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "WP10 Lifecycle" });
}

function makeOrder(
  orgId: string,
  overrides: Partial<OrderRow> & Pick<OrderRow, "id" | "side">,
): OrderRow {
  return {
    organizationId: orgId,
    credentialId: null,
    venue: "mock",
    executionMode: "mock",
    symbol: "BTC/USDT",
    type: "market",
    price: null,
    quantity: "0.01",
    filledQuantity: "0.01",
    avgFillPrice: "65000",
    state: "FILLED",
    stateVersion: 2,
    exchangeOrderId: null,
    clientOrderId: `client-${overrides.id}`,
    idempotencyKey: `idem-${overrides.id}`,
    riskDecisionId: "risk-1",
    strategySignalId: "sig-1",
    allocationDecisionId: null,
    createdAt: new Date(RESEARCH_REPLAY_CLOCK_START_MS),
    updatedAt: new Date(RESEARCH_REPLAY_CLOCK_START_MS),
    ...overrides,
  };
}

function makeFill(
  orgId: string,
  overrides: Partial<FillRow> & Pick<FillRow, "id" | "orderId">,
): FillRow {
  return {
    organizationId: orgId,
    exchangeTradeId: `ex-${overrides.id}`,
    price: "65000",
    quantity: "0.01",
    fee: "0",
    feeAsset: "USDT",
    executedAt: new Date(RESEARCH_REPLAY_CLOCK_START_MS),
    createdAt: new Date(RESEARCH_REPLAY_CLOCK_START_MS),
    ...overrides,
  };
}

describe("HTR-WP10 lifecycle determinism", () => {
  it("deriveTradesFromFills with injected newId+now is stable across runs", () => {
    const orgId = "00000000-0000-4000-8000-0000000410l";
    const fixedNow = new Date(RESEARCH_REPLAY_CLOCK_START_MS);
    const runOnce = () => {
      const newId = createDeterministicReplayIdFactory(920_000);
      return deriveTradesFromFills({
        organizationId: orgId,
        strategySignalId: "sig-1",
        newId,
        now: fixedNow,
        fillEvents: [
          {
            order: makeOrder(orgId, { id: "order-buy", side: "buy" }),
            fill: makeFill(orgId, { id: "fill-buy", orderId: "order-buy" }),
          },
          {
            order: makeOrder(orgId, { id: "order-sell", side: "sell" }),
            fill: makeFill(orgId, {
              id: "fill-sell",
              orderId: "order-sell",
              executedAt: new Date(RESEARCH_REPLAY_CLOCK_START_MS + 60_000),
            }),
          },
        ],
      });
    };

    const first = runOnce();
    const second = runOnce();
    expect(second).toEqual(first);
    expect(first.trades[0]?.id).toBe("00000000-0000-4000-8000-000000920001");
  });

  it("lifecycle recorder buy/sell uses injected nowMs for frozenAt", async () => {
    const orgId = seedDb();
    const db = getDb();
    const lifecycleRepo = createSqliteLifecycleRepository(db);
    const orderRepo = createSqliteOrderRepository(db, {
      newId: createDeterministicReplayIdFactory(930_000),
      now: () => new Date(RESEARCH_REPLAY_CLOCK_START_MS),
    });
    const context = requireOrgContext(orgId);
    const nowMs = () => RESEARCH_REPLAY_CLOCK_START_MS + 120_000;
    const recorder = createLifecycleRecorder({
      repository: lifecycleRepo,
      newId: createDeterministicReplayIdFactory(940_000),
      nowMs,
    });

    const buyOrder = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.01",
      clientOrderId: "client-buy",
      idempotencyKey: "idem-buy",
      riskDecisionId: "risk-buy",
      strategySignalId: "sig-1",
    });
    const buyFill = await orderRepo.recordFill(context, {
      orderId: buyOrder.id,
      exchangeTradeId: "ex-buy",
      price: "65000",
      quantity: "0.01",
      executedAt: new Date(RESEARCH_REPLAY_CLOCK_START_MS),
    });

    await recorder.recordFillLifecycle({
      context,
      order: buyOrder,
      fill: buyFill,
      accountKey: "acct",
      lineage: {
        strategySignalId: "sig-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: "risk-buy",
        allocationDecisionId: null,
      },
    });

    const sellOrder = await orderRepo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "sell",
      type: "market",
      quantity: "0.01",
      clientOrderId: "client-sell",
      idempotencyKey: "idem-sell",
      riskDecisionId: "risk-sell",
      strategySignalId: "sig-1",
    });
    const sellFill = await orderRepo.recordFill(context, {
      orderId: sellOrder.id,
      exchangeTradeId: "ex-sell",
      price: "66000",
      quantity: "0.01",
      executedAt: new Date(RESEARCH_REPLAY_CLOCK_START_MS + 60_000),
    });

    await recorder.recordFillLifecycle({
      context,
      order: sellOrder,
      fill: sellFill,
      accountKey: "acct",
      lineage: {
        strategySignalId: "sig-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        riskDecisionId: "risk-sell",
        allocationDecisionId: null,
      },
    });

    const trades = await lifecycleRepo.listTrades(context);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.state).toBe("CLOSED");
    expect(trades[0]?.frozenAt?.toISOString()).toBe(new Date(nowMs()).toISOString());
  });
});
