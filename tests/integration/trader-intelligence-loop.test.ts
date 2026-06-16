import { readFileSync } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000257c";
const NOW = 1_735_689_600_000; // 2026-01-01T00:00:00.000Z

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

type FixtureFile = {
  bars: Bar[];
  latestQuote: Quote;
};

function loadFixture(): FixtureFile {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as FixtureFile;
}

describe("trader intelligence loop integration (DEE-257)", () => {
  let orgA: string;
  let connector: MockExchangeConnector;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-intel-loop-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "intel-loop.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "intel-loop-a@waia.invalid",
      password: "password123",
      identityLabel: "Intel Loop Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Intel Loop Org A" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
  });

  it("runs fixture → intelligence → risk → mock execution → reconciliation", async () => {
    const fixture = loadFixture();
    const context = requireOrgContext(orgA);
    const db = getDb();
    const repo = createSqliteOrderRepository(db);

    const { features, msv, signal } = runEvaluationCycle({
      organizationId: orgA,
      bars: fixture.bars,
      quote: fixture.latestQuote,
      evaluatedAt: fixture.bars.at(-1)!.barCloseTime,
      newId: () => crypto.randomUUID(),
    });

    expect(signal.outcome).toBe("SIGNAL");

    const submit = mapSignalToSubmitOrder({
      signal,
      accountKey: "acct-intel-loop",
      referencePrice: features.features.close,
      executionMode: "mock",
      defaultQuantity: "0.01",
      tradingPermission: msv.derived.tradingPermission,
      clientOrderId: "client-intel-loop-257",
      idempotencyKey: "idem-intel-loop-257",
    });
    expect(submit).not.toBeNull();

    const writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-intel-loop");
    const riskEngine = createRiskEngineService({
      limitsService: createSqliteRiskLimitsService(db),
      killSwitchResolver: createKillSwitchResolver({
        repository: createSqliteKillSwitchRepository(db),
        nowMs: () => NOW,
      }),
      rateStore: createInMemoryOrderRateStore(),
      writeAudit,
      nowMs: () => NOW,
      newDecisionId: () => "risk-decision-intel-loop-257",
    });

    const execution = createOrderExecutionServiceFromDeps({
      riskEngine,
      orderRepository: repo,
      killSwitchResolver: createKillSwitchResolver({
        repository: createSqliteKillSwitchRepository(db),
        nowMs: () => NOW,
      }),
      connectorForMode: () => connector,
      writeAudit,
      nowMs: () => NOW,
    });

    const result = await execution.submitOrder(context, {
      ...submit!,
      accountState: EMPTY_STATE,
    });

    expect(result.status).toBe("submitted");
    if (result.status !== "submitted") {
      return;
    }

    expect(result.order.strategySignalId).toBe(signal.strategySignalId);
    expect(result.order.state).toBe("FILLED");

    const reconciliation = createSqliteReconciliationService(db, {
      connectorForMode: () => connector,
      nowMs: () => NOW,
      writeAudit,
    });

    const report = await reconciliation.reconcile(context, {
      kind: "order",
      orderId: result.order.id,
    });

    expect(report.outcomes[0]?.classification).toBe("IN_SYNC");
  });
});
