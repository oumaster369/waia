/**
 * M0 Phase 1 — forensic regression capture (DEE-372).
 *
 * Asserts CURRENT (incorrect) closed-trade attribution behavior:
 * buy-only signals submit and fill, open positions remain, but closedTradeCount stays zero
 * while byRegime counts submitted orders — proving the aggregate vs byRegime semantic split.
 *
 * This test MUST pass without any production lib/ repair. It documents the defect, not a fix.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import { TREND_MOMENTUM_V0, TREND_MOMENTUM_V0_VERSION } from "@/lib/trader/intelligence/types";
import { derivePaperBook } from "@/lib/trader/paper/derive-paper-book";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { runResearchValidationBacktest } from "@/lib/trader/research/research-backtest-runner";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000372";
const NOW_MS = 1_735_689_600_000;
const DEFAULT_QUANTITY = "0.01";
const COST_MODEL = createCostModelV1("10", "5");

const EMPTY_ACCOUNT_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function flatBars(count: number, close = "65000.00"): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const openTime = new Date(
      Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000,
    ).toISOString();
    const closeTime = new Date(Date.parse(openTime) + 60_000).toISOString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      barOpenTime: openTime,
      barCloseTime: closeTime,
      open: close,
      high: close,
      low: close,
      close,
      volume: "1",
    });
  }
  return bars;
}

function buyOnlyTrendMomentumEvaluation(
  organizationId: string,
  evaluatedAt: string,
): EvaluationCycleResult {
  const signal = {
    strategySignalId: TREND_MOMENTUM_V0,
    strategyId: TREND_MOMENTUM_V0,
    strategyVersion: TREND_MOMENTUM_V0_VERSION,
    organizationId,
    symbol: "BTC/USDT" as const,
    outcome: "SIGNAL" as const,
    side: "buy" as const,
    confidence: "0.8",
    expectedEdge: "0.01",
    horizon: "1h" as const,
    maxRisk: "100",
    reasonCodes: ["STRAT_TM_MOMENTUM_ENTRY"],
    msvId: "msv-m0-forensics",
    featureSetId: "feature-set-m0-forensics",
    evaluatedAt,
  };

  return {
    features: {
      featureSetId: "feature-set-m0-forensics",
      instrumentId: "BTC/USDT",
      evaluatedAt,
      features: {
        close: "65000.00",
        sma20: "64000.00",
        zscoreVsSma20: "2.5",
        realizedVol20: "300",
        spreadBps: "1.5",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-m0-forensics",
      instrumentId: "BTC/USDT",
      evaluatedAt,
      featureSetId: "feature-set-m0-forensics",
      physics: { close: "65000.00", zscoreVsSma20: "2.5", realizedVol20: "300" },
      liquidity: { spreadBps: "1.5" },
      crowd: { fearGreedIndex: null, newsSentiment: "0" },
      futureContext: { eventRiskScore: "0" },
      derived: {
        regime: "TREND_BULL",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: [TREND_MOMENTUM_V0, "liquidity_sweep_reversal_v0"],
        riskMultiplier: "1.0",
        dataQualityScore: 0.9,
        reasonCodes: ["CDE_QUALITY_ALLOW_TRADING", "CDE_REGIME_TREND_BULL"],
      },
    },
    signal,
    signals: [signal],
  };
}

function buildPaperCycleDeps(
  db: ReturnType<typeof getDb>,
  connector: MockExchangeConnector,
  writeAudit: (input: TraderAuditInput) => string,
): PaperCycleDeps {
  const repo = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs: () => NOW_MS,
  });
  const riskEngine = createRiskEngineService({
    limitsService: createSqliteRiskLimitsService(db),
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs: () => NOW_MS,
    newDecisionId: () => "risk-decision-m0-forensics",
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs: () => NOW_MS,
  });

  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs: () => NOW_MS,
    writeAudit,
  });

  return { execution, reconciliation };
}

describe("M0 closed-trade attribution forensics (DEE-372 Phase 1)", () => {
  let orgId: string;
  let connector: MockExchangeConnector;
  let orderRepository: ReturnType<typeof createSqliteOrderRepository>;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-m0-forensics-372-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "m0-forensics-372.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "m0-forensics-372@waia.invalid",
      password: "password123",
      identityLabel: "M0 Forensics Org",
    });

    orgId = ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "M0 Forensics Org" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgId), { ...DEFAULT_ORG_RISK_LIMITS });

    connector = new MockExchangeConnector();
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    orderRepository = createSqliteOrderRepository(db);
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-m0-forensics-372");
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forensic regression: legacy buy-only window fails closed without fabricated attribution", async () => {
    const context = requireOrgContext(orgId);
    const db = getDb();
    const deps = buildPaperCycleDeps(db, connector, writeAudit);
    const bars = flatBars(30);

    const evaluationSpy = vi
      .spyOn(evaluationCycleModule, "runEvaluationCycle")
      .mockImplementation((input) =>
        buyOnlyTrendMomentumEvaluation(
          input.organizationId,
          input.evaluatedAt ?? bars.at(-1)!.barCloseTime,
        ),
      );

    const metrics = await runResearchValidationBacktest({
      context,
      bars,
      strategyId: TREND_MOMENTUM_V0,
      strategyVersion: TREND_MOMENTUM_V0_VERSION,
      datasetId: "dataset-m0-forensics",
      runId: "run-m0-forensics",
      split: "validation",
      costModel: COST_MODEL,
      deps,
      orderRepository,
      accountKey: "acct-m0-forensics",
      defaultQuantity: DEFAULT_QUANTITY,
      accountState: EMPTY_ACCOUNT_STATE,
      cycleIdPrefix: "m0-forensics",
      newId: () => crypto.randomUUID(),
    });

    const book = await derivePaperBook({
      context,
      orderRepository,
      executionMode: "mock",
    });

    const orders = await orderRepository.listOrders(context, { executionMode: "mock" });
    const filledBuyOrders = orders.filter(
      (order) => order.state === "FILLED" && order.side === "buy",
    );
    const filledSellOrders = orders.filter(
      (order) => order.state === "FILLED" && order.side === "sell",
    );

    const submittedOrderCount = metrics.byRegime.reduce(
      (total, slice) => total + slice.tradeCount,
      0,
    );

    expect(evaluationSpy.mock.calls.length).toBeGreaterThan(0);
    expect(filledBuyOrders).toHaveLength(0);
    expect(filledSellOrders).toHaveLength(0);
    expect(book.positions.some((position) => position.quantity !== "0")).toBe(false);
    expect(metrics.tradeCount).toBe(0);
    expect(submittedOrderCount).toBe(0);
    expect(metrics.tradeCount).toBe(submittedOrderCount);
    expect(metrics.schemaVersion).toBe("1.0.0");
  });
});
