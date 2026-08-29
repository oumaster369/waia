/**
 * M0 Phase 2 — closed-trade semantics v2 (DEE-372).
 *
 * Separate from the Phase 1 forensic regression (v1 legacy). Exercises forced-flat
 * mark-to-close, explicit metric taxonomy, and aggregate == sum(byRegime) invariants.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  applyCostToFill,
  COST_MODEL_VERSION_V1,
  createCostModelV1,
} from "@/lib/trader/execution/cost-model";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import { TREND_MOMENTUM_V0, TREND_MOMENTUM_V0_VERSION } from "@/lib/trader/intelligence/types";
import type { FillRow, OrderRow } from "@/lib/trader/execution/order-repository.types";
import {
  buildQuoteCurrencyBySymbol,
  extractForcedFlatMarkToCloseTrades,
  walkFillsForPnL,
  type PaperPnLFillEvent,
} from "@/lib/trader/paper/derive-paper-pnl";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import {
  CLOSED_TRADE_SEMANTICS_VERSION,
  TRADE_LIFECYCLE_SEMANTICS_VERSION,
} from "@/lib/trader/paper/trade-lifecycle-semantics";
import { runResearchValidationBacktest } from "@/lib/trader/research/research-backtest-runner";
import {
  assertResearchValidationMetricsV2Coherence,
  isResearchValidationMetricsV2,
} from "@/lib/trader/research/research-validation-metrics-taxonomy";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
} from "@/lib/trader/risk/kill-switch";
import { createRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import { multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { TraderAuditInput } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000373";
const WINDOW_START_MS = Date.parse("2026-01-01T00:00:00.000Z");
const IN_WINDOW_NOW_MS = WINDOW_START_MS + 15 * 60_000;
const DEFAULT_QUANTITY = "0.01";
const COST_MODEL = createCostModelV1("10", "5");
const BOUNDARY_CLOSE = "65000.00";

const EMPTY_ACCOUNT_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function flatBars(count: number, close = BOUNDARY_CLOSE): Bar[] {
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
    msvId: "msv-m0-v2",
    featureSetId: "feature-set-m0-v2",
    evaluatedAt,
  };

  return {
    features: {
      featureSetId: "feature-set-m0-v2",
      instrumentId: "BTC/USDT",
      evaluatedAt,
      features: {
        close: BOUNDARY_CLOSE,
        sma20: "64000.00",
        zscoreVsSma20: "2.5",
        priceDispersion20: "300",
        spreadBps: "1.5",
      },
      dataQualityScore: 0.9,
      inputs: { barCount: 25 },
    },
    msv: {
      msvId: "msv-m0-v2",
      instrumentId: "BTC/USDT",
      evaluatedAt,
      featureSetId: "feature-set-m0-v2",
      physics: { close: BOUNDARY_CLOSE, zscoreVsSma20: "2.5", priceDispersion20: "300" },
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
    nowMs: () => IN_WINDOW_NOW_MS,
  });
  const riskEngine = createRiskEngineService({
    limitsService: createSqliteRiskLimitsService(db),
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs: () => IN_WINDOW_NOW_MS,
    newDecisionId: () => "risk-decision-m0-v2",
  });

  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository: repo,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs: () => IN_WINDOW_NOW_MS,
  });

  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs: () => IN_WINDOW_NOW_MS,
    writeAudit,
  });

  return { execution, reconciliation };
}

function makeBuyFillEvent(
  fillId: string,
  orderId: string,
  executedAt: Date,
  price: string,
  quantity: string,
  fee: string,
): PaperPnLFillEvent {
  return {
    fill: {
      id: fillId,
      organizationId: "org-v2-test",
      orderId,
      exchangeTradeId: `ex-${fillId}`,
      price,
      quantity,
      fee,
      feeAsset: "USDT",
      executedAt,
      createdAt: executedAt,
    } satisfies FillRow,
    order: {
      id: orderId,
      organizationId: "org-v2-test",
      credentialId: null,
      venue: "mock",
      executionMode: "mock",
      clientOrderId: `client-${orderId}`,
      idempotencyKey: `idem-${orderId}`,
      symbol: "BTC/USDT",
      side: "buy",
      type: "market",
      price: null,
      state: "FILLED",
      quantity,
      filledQuantity: quantity,
      avgFillPrice: price,
      stateVersion: 1,
      exchangeOrderId: null,
      riskDecisionId: "risk-v2-test",
      strategySignalId: TREND_MOMENTUM_V0,
      allocationDecisionId: null,
      createdAt: executedAt,
      updatedAt: executedAt,
    } satisfies OrderRow,
  };
}

describe("M0 closed-trade attribution v2 (DEE-372 Phase 2)", () => {
  let orgId: string;
  let connector: MockExchangeConnector;
  let orderRepository: ReturnType<typeof createSqliteOrderRepository>;
  let writeAudit: ReturnType<typeof vi.fn<(input: TraderAuditInput) => string>>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-m0-v2-372-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "m0-v2-372.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "m0-v2-372@waia.invalid",
      password: "password123",
      identityLabel: "M0 V2 Org",
    });

    orgId = ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "M0 V2 Org" });

    const limits = createSqliteRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgId), { ...DEFAULT_ORG_RISK_LIMITS });

    connector = new MockExchangeConnector({ nowMs: () => IN_WINDOW_NOW_MS });
    await connector.validateCredentials({ apiKey: "mock", apiSecret: "mock" });
    orderRepository = createSqliteOrderRepository(db);
    writeAudit = vi.fn((input: TraderAuditInput) => input.entityId ?? "audit-m0-v2-372");
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("forced-flat mark-to-close math (H2)", () => {
    it("buy-only fixture yields one synthetic markToCloseTrade with applyCostToFill economics", () => {
      const executedAt = new Date("2026-01-01T00:25:00.000Z");
      const buyPrice = "65000.00";
      const buyFee = "0.65";
      const events = [
        makeBuyFillEvent("fill-buy-1", "order-buy-1", executedAt, buyPrice, "0.01", buyFee),
      ];
      const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(["BTC/USDT"]);
      const boundaryTimestamp = new Date("2026-01-01T00:30:00.000Z");

      const markToCloseTrades = extractForcedFlatMarkToCloseTrades({
        openingEvents: [],
        inWindowEvents: events,
        quoteCurrencyBySymbol,
        boundaryClosePrice: BOUNDARY_CLOSE,
        boundaryTimestamp,
        costModel: COST_MODEL,
        newSyntheticId: (symbol) => `synthetic-flat:${symbol}`,
      });

      expect(markToCloseTrades).toHaveLength(1);
      const trade = markToCloseTrades[0]!;
      expect(trade.syntheticClose).toBe(true);
      expect(trade.syntheticId).toBe("synthetic-flat:BTC/USDT");

      const walk = walkFillsForPnL(events, quoteCurrencyBySymbol);
      const ledger = walk.ledgerBySymbol.get("BTC/USDT")!;
      const { adjustedPrice, fee } = applyCostToFill(
        BOUNDARY_CLOSE,
        ledger.openQty,
        "sell",
        COST_MODEL,
      );
      const proceeds = multiplyDecimal(adjustedPrice, ledger.openQty);
      const cost = multiplyDecimal(ledger.openQty, ledger.avgCost);
      const expectedPnl = subtractDecimal(subtractDecimal(proceeds, cost), fee);

      expect(trade.adjustedSellPrice).toBe(adjustedPrice);
      expect(trade.sellFee).toBe(fee);
      expect(trade.tradePnl).toBe(expectedPnl);
    });
  });

  describe("v2 research validation backtest", () => {
    async function runBuyOnlyV2Backtest(newId: () => string) {
      const context = requireOrgContext(orgId);
      const db = getDb();
      const deps = buildPaperCycleDeps(db, connector, writeAudit);
      const bars = flatBars(30);

      vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockImplementation((input) =>
        buyOnlyTrendMomentumEvaluation(
          input.organizationId,
          input.evaluatedAt ?? bars.at(-1)!.barCloseTime,
        ),
      );

      return runResearchValidationBacktest({
        context,
        bars,
        strategyId: TREND_MOMENTUM_V0,
        strategyVersion: TREND_MOMENTUM_V0_VERSION,
        datasetId: "dataset-m0-v2",
        runId: "run-m0-v2",
        split: "validation",
        costModel: COST_MODEL,
        deps,
        orderRepository,
        accountKey: "acct-m0-v2",
        defaultQuantity: DEFAULT_QUANTITY,
        accountState: EMPTY_ACCOUNT_STATE,
        cycleIdPrefix: "m0-v2",
        newId,
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
        exportedAt: new Date(bars.at(-1)!.barCloseTime),
      });
    }

    it("legacy buy-only window fails closed with zero fabricated trades and stamped semantics", async () => {
      let idCounter = 0;
      const metrics = await runBuyOnlyV2Backtest(() => `id-v2-${++idCounter}`);

      expect(isResearchValidationMetricsV2(metrics)).toBe(true);
      if (!isResearchValidationMetricsV2(metrics)) {
        return;
      }

      expect(metrics.schemaVersion).toBe("2.0.0");
      expect(metrics.closedTradeSemanticsVersion).toBe(CLOSED_TRADE_SEMANTICS_VERSION);
      expect(metrics.tradeLifecycleSemanticsVersion).toBe(TRADE_LIFECYCLE_SEMANTICS_VERSION);
      expect(metrics.costModelVersion).toBe(COST_MODEL_VERSION_V1);
      expect(metrics.closedTrades).toBe(0);
      expect(metrics.markToCloseTrades).toBe(0);
      expect(metrics.closedTrades + metrics.markToCloseTrades).toBe(0);
      expect(metrics.submittedOrders).toBe(0);
      expect(metrics.openPositions).toBe(0);
      assertResearchValidationMetricsV2Coherence(metrics);
    });

    it("aggregate equals element-wise sum over byRegime for every taxonomy field", async () => {
      let idCounter = 0;
      const metrics = await runBuyOnlyV2Backtest(() => `id-v2-coherence-${++idCounter}`);
      expect(isResearchValidationMetricsV2(metrics)).toBe(true);
      if (isResearchValidationMetricsV2(metrics)) {
        assertResearchValidationMetricsV2Coherence(metrics);
      }
    });

    it("deterministic id factory produces byte-identical metrics across two runs", async () => {
      let counter = 0;
      const deterministicNewId = () => `deterministic-id-${++counter}`;

      counter = 0;
      const metricsA = await runBuyOnlyV2Backtest(deterministicNewId);
      counter = 0;
      const metricsB = await runBuyOnlyV2Backtest(deterministicNewId);

      expect(JSON.stringify(metricsA)).toBe(JSON.stringify(metricsB));
    });
  });
});
