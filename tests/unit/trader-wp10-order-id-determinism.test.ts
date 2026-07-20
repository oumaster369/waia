/**
 * HTR-WP10 — order id/time determinism via injected repository clock + cycleOrderKeys override.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { createSqliteOrderRepository } from "@/lib/trader/execution/repository-adapters";
import {
  createDeterministicReplayIdFactory,
  RESEARCH_REPLAY_CLOCK_START_MS,
} from "@/lib/trader/research/deterministic-replay-id-factory";
import { cycleOrderKeys } from "@/lib/trader/paper/paper-cycle-runner";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";
import { MEAN_REVERSION_V0 } from "@/lib/trader/intelligence/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000410o";

function seedDb(): string {
  resetWaiaSqliteSingleton();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-wp10-order-"));
  process.env.DATABASE_URL = `file:${path.join(tmpDir, "order.sqlite")}`;
  migrateDatabaseFromEnv();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "wp10-order@waia.invalid",
    password: "password123",
    identityLabel: "WP10 Order",
  });
  return ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "WP10 Order" });
}

describe("HTR-WP10 order id determinism", () => {
  it("createOrder uses injected id factory and clock", async () => {
    const orgId = seedDb();
    const db = getDb();
    const orderNewId = createDeterministicReplayIdFactory(910_000);
    const fixedNow = new Date(RESEARCH_REPLAY_CLOCK_START_MS);
    const repo = createSqliteOrderRepository(db, {
      newId: orderNewId,
      now: () => fixedNow,
    });
    const context = requireOrgContext(orgId);

    const first = await repo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.01",
      clientOrderId: "client-wp10-1",
      idempotencyKey: "idem-wp10-1",
      riskDecisionId: "risk-wp10-1",
    });
    const second = await repo.createOrder(context, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.01",
      clientOrderId: "client-wp10-2",
      idempotencyKey: "idem-wp10-2",
      riskDecisionId: "risk-wp10-2",
    });

    expect(first.id).toBe("00000000-0000-4000-8000-000000910001");
    expect(second.id).toBe("00000000-0000-4000-8000-000000910003");
    expect(first.createdAt.toISOString()).toBe(fixedNow.toISOString());
    expect(second.createdAt.toISOString()).toBe(fixedNow.toISOString());
  });

  it("cycleOrderKeys overrides mapSignalToSubmitOrder random UUID defaults", () => {
    const keys = cycleOrderKeys("cycle-7", MEAN_REVERSION_V0);
    const mapped = mapSignalToSubmitOrder({
      signal: {
        strategySignalId: "sig-1",
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: "0.1.0",
        organizationId: USER_ID,
        symbol: "BTC/USDT",
        msvId: "msv-1",
        featureSetId: "fs-1",
        evaluatedAt: "2026-01-01T00:01:00.000Z",
        outcome: "SIGNAL",
        side: "buy",
        confidence: "0.8",
        reasonCodes: [],
      },
      accountKey: "acct",
      referencePrice: "65000",
      executionMode: "mock",
      defaultQuantity: "0.01",
      clientOrderId: keys.clientOrderId,
      idempotencyKey: keys.idempotencyKey,
    });

    expect(mapped?.clientOrderId).toBe(keys.clientOrderId);
    expect(mapped?.idempotencyKey).toBe(keys.idempotencyKey);
    expect(mapped?.clientOrderId).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
