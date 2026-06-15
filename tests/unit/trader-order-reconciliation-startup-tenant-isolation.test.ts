import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { traderKillSwitches } from "@/db/schema";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import {
  emptyReconciliationCounts,
  createReconciliationServiceFromDeps,
  createSqliteOrderRepository,
  createStartupReconciliationRunnerFromDeps,
  runStartupReconciliation,
} from "@/lib/trader/execution";
import { createSqliteAutomaticTriggerDispatcher } from "@/lib/trader/risk/kill-switch";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000252b";
const USER_B = "00000000-0000-4000-8000-0000000252c";
const NOW = 1_700_000_000_000;

function stubConnector(): ExchangeConnector {
  return {
    venueId: "mock",
    marketType: "spot",
    validateCredentials: vi.fn().mockResolvedValue({ valid: true }),
    getAccountInfo: vi.fn(),
    getBalances: vi.fn(),
    getPositions: vi.fn(),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getOrder: vi.fn().mockResolvedValue(null),
    placeOrder: vi.fn(),
    cancelOrder: vi.fn(),
    getTradeHistory: vi.fn().mockResolvedValue([]),
    streamMarketData: vi.fn(),
    streamUserData: vi.fn(),
    getFuturesBalances: vi.fn(),
    getFuturesPositions: vi.fn(),
    placeFuturesOrder: vi.fn(),
  };
}

describe("trader order reconciliation startup tenant isolation (DEE-252 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-recon-startup-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-recon-startup-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-recon-startup-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Startup Iso Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "order-recon-startup-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Startup Iso Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Order Recon Startup Iso Org A",
    });
    orgB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "Order Recon Startup Iso Org B",
    });
  });

  it("org B startup context cannot escalate org A reconciliation report", async () => {
    const db = getDb();
    const triggerPort = createSqliteAutomaticTriggerDispatcher(db);

    const orgAReport = {
      organizationId: orgA,
      runStartedAt: new Date(NOW),
      outcomes: [
        {
          clientOrderId: "iso-startup-client-a",
          classification: "NOT_FOUND_AT_VENUE" as const,
          recordedFills: [],
          markedReconciliationRequired: true,
        },
      ],
      counts: { ...emptyReconciliationCounts(), NOT_FOUND_AT_VENUE: 1 },
    };

    await expect(
      runStartupReconciliation(requireOrgContext(orgB), "mock", {
        reconciliationService: {
          reconcile: async () => orgAReport,
        },
        triggerPort,
      }),
    ).rejects.toThrow(/org mismatch/i);

    const orgARow = db
      .select()
      .from(traderKillSwitches)
      .where(
        and(
          eq(traderKillSwitches.organizationId, orgA),
          eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
        ),
      )
      .all()[0];

    expect(orgARow?.state).not.toBe("ACTIVE");
  });

  it("org A startup trips only org A kill switch", async () => {
    const db = getDb();
    const repoA = createSqliteOrderRepository(db);
    const runner = createStartupReconciliationRunnerFromDeps({
      reconciliationService: createReconciliationServiceFromDeps({
        orderRepository: repoA,
        connectorForMode: () => stubConnector(),
        writeAudit: () => "audit",
        nowMs: () => NOW,
      }),
      triggerPort: createSqliteAutomaticTriggerDispatcher(db),
    });

    const contextA = requireOrgContext(orgA);
    const created = await repoA.createOrder(contextA, {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.1",
      clientOrderId: "iso-startup-only-a",
      idempotencyKey: "iso-startup-only-a-idem",
      riskDecisionId: crypto.randomUUID(),
    });
    const approved = await repoA.transitionOrder(contextA, {
      orderId: created.id,
      expectedStateVersion: created.stateVersion,
      toState: "RISK_APPROVED",
    });
    await repoA.transitionOrder(contextA, {
      orderId: approved.id,
      expectedStateVersion: approved.stateVersion,
      toState: "SENT_TO_EXCHANGE",
    });

    await runner.runStartupReconciliation(contextA, "mock");

    const orgARow = db
      .select()
      .from(traderKillSwitches)
      .where(
        and(
          eq(traderKillSwitches.organizationId, orgA),
          eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
        ),
      )
      .all()[0];
    expect(orgARow?.state).toBe("ACTIVE");

    const orgBRow = db
      .select()
      .from(traderKillSwitches)
      .where(
        and(
          eq(traderKillSwitches.organizationId, orgB),
          eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
        ),
      )
      .all()[0];
    expect(orgBRow).toBeUndefined();
  });
});
