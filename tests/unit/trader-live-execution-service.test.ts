import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type { Order, PlaceOrderInput } from "@/lib/trader/connectors/types";
import {
  LiveExecutionNotSupportedError,
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
} from "@/lib/trader/execution";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
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

const USER_A = "00000000-0000-4000-8000-0000000212c";
const NOW = 1_700_000_000_000;

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function liveConnectorStub(): ExchangeConnector {
  return {
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
        orderId: "ex-live-1",
        clientOrderId: input.clientOrderId,
        symbol: input.symbol,
        side: input.side,
        type: input.type,
        status: "filled",
        price: input.price,
        quantity: input.quantity,
        filledQuantity: input.quantity,
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
      }),
    ),
  };
}

describe("live execution service gate wiring (DEE-212 / BP-7)", () => {
  let orgA: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-live-exec-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "live-exec.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "live-exec@example.com",
      password: "password123",
    });
    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Live Exec" });
    await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgA), {
      ...DEFAULT_ORG_RISK_LIMITS,
    });
  });

  function makeService(withGate: boolean) {
    const db = getDb();
    const writeAudit = (input: Parameters<typeof writeTraderAuditLogSqlite>[1]) =>
      writeTraderAuditLogSqlite(db, input);
    const nowMs = () => NOW;
    const repo = createSqliteOrderRepository(db);
    const killSwitchResolver = createKillSwitchResolver({
      repository: createSqliteKillSwitchRepository(db),
      nowMs,
    });
    const riskEngine = createRiskEngineService({
      limitsService: createSqliteRiskLimitsService(db),
      killSwitchResolver,
      rateStore: createInMemoryOrderRateStore(),
      writeAudit,
      nowMs,
      newDecisionId: () => "rd-live",
    });
    const connector = liveConnectorStub();

    const service = createOrderExecutionServiceFromDeps({
      riskEngine,
      orderRepository: repo,
      killSwitchResolver,
      connectorForMode: () => connector,
      writeAudit,
      nowMs,
      assertLiveAuthorized: withGate ? vi.fn().mockResolvedValue(undefined) : undefined,
    });

    return { service, connector };
  }

  it("rejects ungated live execution (Worker default posture)", async () => {
    const { service } = makeService(false);
    await expect(
      service.submitOrder(requireOrgContext(orgA), {
        clientOrderId: "live-ungated",
        idempotencyKey: "idem-live-ungated",
        executionMode: "live",
        symbol: "BTC/USDT",
        side: "buy",
        type: "market",
        quantity: "0.001",
        strategyId: "mean_reversion_v0",
        strategyVersion: "0.1.0",
        credentialId: null,
        referencePrice: "50000",
        accountKey: "htx-spot-1",
        accountState: EMPTY_STATE,
      }),
    ).rejects.toThrow(LiveExecutionNotSupportedError);
  });

  it("allows gated live execution when hook is injected", async () => {
    const { service, connector } = makeService(true);
    const result = await service.submitOrder(requireOrgContext(orgA), {
      clientOrderId: "live-gated",
      idempotencyKey: "idem-live-gated",
      executionMode: "live",
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      quantity: "0.001",
      strategyId: "mean_reversion_v0",
      strategyVersion: "0.1.0",
      credentialId: null,
      referencePrice: "50000",
      accountKey: "htx-spot-1",
      accountState: EMPTY_STATE,
    });

    expect(result.status).toBe("submitted");
    expect(connector.placeOrder).toHaveBeenCalled();
    if (result.status === "submitted") {
      expect(result.order.venue).toBe("htx");
      expect(result.order.executionMode).toBe("live");
    }
  });
});
