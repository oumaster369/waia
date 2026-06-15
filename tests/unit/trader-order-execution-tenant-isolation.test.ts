import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
} from "@/lib/trader/execution";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { createSqliteRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000249b";
const USER_B = "00000000-0000-4000-8000-0000000249c";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

describe("trader order execution tenant isolation (DEE-249 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let orgAOrderId: string;
  let repo: ReturnType<typeof createSqliteOrderRepository>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-exec-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-exec-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-exec-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Exec Iso Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "order-exec-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Order Exec Iso Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Order Exec Iso Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Order Exec Iso Org B" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });
    await limits.upsertLimitsForOrg(requireOrgContext(orgB), { ...DEFAULT_ORG_RISK_LIMITS });

    repo = createSqliteOrderRepository(db);

    const orderA = await repo.createOrder(requireOrgContext(orgA), {
      venue: "mock",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.1",
      clientOrderId: "iso-exec-client-a",
      idempotencyKey: "iso-exec-idem-a",
      riskDecisionId: crypto.randomUUID(),
    });
    orgAOrderId = orderA.id;
  });

  it("org B submit with same clientOrderId as org A does not affect org A order", async () => {
    const db = getDb();
    const nowMs = () => Date.now();
    const connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });

    const service = createOrderExecutionServiceFromDeps({
      riskEngine: createSqliteRiskEngineService(db, { nowMs }),
      orderRepository: repo,
      killSwitchResolver: createKillSwitchResolver({
        repository: createSqliteKillSwitchRepository(db),
        nowMs,
      }),
      connectorForMode: () => connector,
      writeAudit: () => "audit",
      nowMs,
    });

    const result = await service.submitOrder(requireOrgContext(orgB), {
      clientOrderId: "iso-exec-client-a",
      idempotencyKey: "iso-exec-idem-a",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.1",
      referencePrice: "65000",
      accountKey: "acct-b",
      accountState: EMPTY_STATE,
    });

    expect(result.status).toBe("submitted");

    const orderA = await repo.getOrderById(requireOrgContext(orgA), orgAOrderId);
    expect(orderA?.state).toBe("CREATED");

    if (result.status === "submitted") {
      expect(result.order.organizationId).toBe(orgB);
      expect(result.order.id).not.toBe(orgAOrderId);
    }
  });

  it("org B cannot read org A order events through repository", async () => {
    const events = await repo.listEvents(requireOrgContext(orgB), orgAOrderId);
    expect(events).toHaveLength(0);
  });
});
