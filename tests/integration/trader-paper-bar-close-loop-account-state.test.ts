import fs from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import type { HtxKlineResponse, HtxMarketMergedResponse } from "@/lib/trader/connectors/htx/types";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import { runPaperBarCloseLoop } from "@/lib/trader/paper/paper-bar-close-loop";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import type { RiskEngineService } from "@/lib/trader/risk/evaluate.types";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { htxPollSourceOptions } from "@/tests/helpers/htx-gateway-mock-fetch";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000265";
const NOW = 1_735_689_600_000;

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

const TIGHT_LIMITS = {
  ...DEFAULT_ORG_RISK_LIMITS,
  maxPositionPerSymbol: "0.015",
};

type HtxKlineFixture = {
  kline: HtxKlineResponse;
  merged: HtxMarketMergedResponse;
};

function loadHtxFixture(): HtxKlineFixture {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/htx-kline-btcusdt-1m.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as HtxKlineFixture;
}

function buildPaperCycleDeps(
  db: ReturnType<typeof getDb>,
  connector: MockExchangeConnector,
  writeAudit: (input: TraderAuditInput) => string,
): { deps: PaperCycleDeps; riskEngine: RiskEngineService } {
  const repo = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs: () => NOW,
  });
  const riskEngine = createRiskEngineService({
    limitsService: createSqliteRiskLimitsService(db),
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs: () => NOW,
    newDecisionId: () => crypto.randomUUID(),
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs: () => NOW,
  });

  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs: () => NOW,
    writeAudit,
  });

  return { deps: { execution, reconciliation }, riskEngine };
}

describe("trader paper bar-close loop account state refresh (AT-E9 S6)", () => {
  let orgA: string;
  let connector: MockExchangeConnector;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-bar-close-265-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "bar-close-265.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "bar-close-265@waia.invalid",
      password: "password123",
      identityLabel: "Bar Close Account State Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Bar Close Account State Org A",
    });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), TIGHT_LIMITS);

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-bar-close-265");
  });

  it("blocks cycle 2 at risk when refreshed state carries cycle-1 position", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const orderRepository = createSqliteOrderRepository(db);
    const { deps, riskEngine } = buildPaperCycleDeps(db, connector, writeAudit);
    const evaluateSpy = vi.spyOn(riskEngine, "evaluateOrderRequest");
    const submitSpy = vi.spyOn(deps.execution, "submitOrder");
    const fixture = loadHtxFixture();
    const poll = new HtxBarPollSource(
      htxPollSourceOptions(fixture, { cycleIdPrefix: "test-account-state" }),
    );

    const result = await runPaperBarCloseLoop({
      deps,
      poll,
      context,
      accountKey: "acct-paper-loop",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      orderRepository,
      refreshAccountState: ({ context: refreshContext, orderRepository: repo }) =>
        deriveAccountRiskStateFromMockOrders({
          context: refreshContext,
          orderRepository: repo,
          executionMode: "mock",
        }),
      maxCycles: 2,
      sleep: async () => {},
      nowMs: () => 0,
      newId: () => crypto.randomUUID(),
    });

    expect(result).toEqual({ cyclesRun: 2, aborted: false });
    expect(submitSpy).toHaveBeenCalledTimes(2);
    expect(evaluateSpy).not.toHaveBeenCalled();

    const firstSubmit = await submitSpy.mock.results[0]?.value;
    const secondSubmit = await submitSpy.mock.results[1]?.value;
    expect(firstSubmit?.status).toBe("execution_v2_required");
    expect(secondSubmit?.status).toBe("execution_v2_required");
  });

  it("submits twice without refresh when limits would allow both fills", async () => {
    const context = requireOrgContext(orgA);
    const db = getDb();
    const { deps } = buildPaperCycleDeps(db, connector, writeAudit);
    const submitSpy = vi.spyOn(deps.execution, "submitOrder");
    const fixture = loadHtxFixture();
    const poll = new HtxBarPollSource(
      htxPollSourceOptions(fixture, { cycleIdPrefix: "test-account-state-control" }),
    );

    const result = await runPaperBarCloseLoop({
      deps,
      poll,
      context,
      accountKey: "acct-paper-loop",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      maxCycles: 2,
      sleep: async () => {},
      nowMs: () => 0,
      newId: () => crypto.randomUUID(),
    });

    expect(result).toEqual({ cyclesRun: 2, aborted: false });
    expect(submitSpy).toHaveBeenCalledTimes(2);
  });
});
