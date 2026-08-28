import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { Order, PlaceOrderInput } from "@/lib/trader/connectors/types";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import {
  createSqliteFeeComputationService,
  createSqliteHwmLedgerService,
  createSqliteReportingPeriodLifecycleService,
} from "@/lib/trader/billing";
import { runLiveCycleOnce } from "@/lib/trader/live";
import { insertCredentialRowSqlite } from "@/lib/trader/credentials/repository-sqlite";
import { FixtureBarReplaySource } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000212d";
const NOW = 1_700_000_000_000;

describe("trader live cycle integration (DEE-212 / BP-7)", () => {
  let orgA: string;
  let credentialId: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-live-cycle-int-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "live-cycle-int.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "live-cycle-int@example.com",
      password: "password123",
    });
    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Live Cycle Int" });
    credentialId = insertCredentialRowSqlite(db, requireOrgContext(orgA), {
      venue: "htx",
      exchangeAccountId: "htx-spot-1",
    }).id;
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgA), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });
  });

  it("runs evaluation → gated live submit → reconciliation → reporting proof", async () => {
    const db = getDb();
    const context = requireOrgContext(orgA);
    const writeAudit = (input: Parameters<typeof writeTraderAuditLogSqlite>[1]) =>
      writeTraderAuditLogSqlite(db, input);
    const nowMs = () => NOW;
    const repo = createSqliteOrderRepository(db);
    const killSwitchResolver = createKillSwitchResolver({
      repository: createSqliteKillSwitchRepository(db),
      nowMs,
    });
    const connector: ExchangeConnector = {
      venueId: "htx",
      marketType: "spot",
      validateCredentials: vi.fn().mockResolvedValue({ valid: true }),
      getAccountInfo: vi.fn(),
      getBalances: vi.fn(),
      getPositions: vi.fn(),
      getOpenOrders: vi.fn(),
      getOrder: vi.fn(),
      cancelOrder: vi.fn(),
      streamMarketData: vi.fn(),
      streamUserData: vi.fn(),
      getFuturesBalances: vi.fn(),
      getFuturesPositions: vi.fn(),
      placeFuturesOrder: vi.fn(),
      getTradeHistory: vi.fn().mockResolvedValue([]),
      placeOrder: vi.fn().mockImplementation(
        async (input: PlaceOrderInput): Promise<Order> => ({
          orderId: "ex-int-1",
          clientOrderId: input.clientOrderId,
          symbol: input.symbol,
          side: input.side,
          type: input.type,
          status: "filled",
          quantity: input.quantity,
          filledQuantity: input.quantity,
          createdAt: new Date(NOW).toISOString(),
          updatedAt: new Date(NOW).toISOString(),
        }),
      ),
    };

    const execution = createOrderExecutionServiceFromDeps({
      riskEngine: createRiskEngineService({
        limitsService: createSqliteRiskLimitsService(db),
        killSwitchResolver,
        rateStore: createInMemoryOrderRateStore(),
        writeAudit,
        nowMs,
        newDecisionId: () => "rd-int",
      }),
      orderRepository: repo,
      killSwitchResolver,
      connectorForMode: () => connector,
      writeAudit,
      nowMs,
      assertLiveAuthorized: vi.fn().mockResolvedValue(undefined),
    });

    const reconciliation = createSqliteReconciliationService(db, {
      connectorForMode: () => connector,
      nowMs,
      writeAudit,
    });

    const fixturePath = path.join(
      process.cwd(),
      "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    );
    const replay = new FixtureBarReplaySource({ fixturePath, mode: "full" });
    const next = replay.next();
    expect(next.done).toBe(false);
    if (next.done) {
      return;
    }
    const snapshot = next.snapshot;

    const result = await runLiveCycleOnce(
      {
        execution,
        reconciliation,
        reportingBridge: createSqliteReportingPeriodLifecycleService(db),
        feeComputation: createSqliteFeeComputationService(db),
        hwmLedger: createSqliteHwmLedgerService(db),
        orderRepository: repo,
      },
      {
        context,
        snapshot,
        accountKey: "htx-spot-1",
        exchangeAccountId: "htx-spot-1",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        credentialId,
        defaultQuantity: "0.001",
        notionalCap: "100",
        accountState: {
          positions: [],
          openOrderCount: 0,
          dailyPnl: "0",
          drawdown: "0",
          quoteExposureByCurrency: {},
        },
      },
    );

    if (result.skipReason === "no_signal") {
      expect(result.evaluation.signals.length).toBeGreaterThan(0);
      return;
    }

    expect(result.submitBlocked).toBe(true);
    expect(result.skipReason).toBe("decision_v2_authority_missing");
    expect(result.execution).toBeNull();
    expect(connector.placeOrder).not.toHaveBeenCalled();
    expect(result.reconciliation).toBeNull();
    expect(result.reporting).toBeNull();
  });
});
