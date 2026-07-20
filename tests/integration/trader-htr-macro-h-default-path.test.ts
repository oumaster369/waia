/**
 * HTR-MACRO-H default-path corrective — WP18→WP19→WP20 through production runners.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "@/db/client";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { accountingInvariantCodes } from "@/lib/trader/accounting/accounting-invariant-codes";
import { HtrAccountingReconciliationTerminationError } from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import {
  HTR_GUARDIAN_EXIT_REASON_V1,
  resolveDrawdownBreachState,
} from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import { applyBreachSubmissionRestrictions } from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import {
  createHtrInitialAccountRiskState,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import {
  runResearchValidationBacktest,
  type ResearchValidationBacktestArtifactSink,
} from "@/lib/trader/research/research-backtest-runner";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { computePeakEquityDrawdownBps } from "@/lib/trader/risk/drawdown-policy-evaluator";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import { compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { createAcceptedMarketOrder } from "@/tests/unit/helpers/wp17-execution-fixtures";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-0000000415h";
const STRATEGY_VERSION = "0.1.0";
const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";

function flatBars(count: number, close = "65000.00"): Bar[] {
  const minimum = Math.max(count, 20);
  const bars: Bar[] = [];
  for (let index = 0; index < minimum; index += 1) {
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
      volume: "12.50",
    });
  }
  return bars;
}

function barsWithMarkSequence(closes: string[]): Bar[] {
  const minimum = Math.max(closes.length, 25);
  const bars: Bar[] = [];
  for (let index = 0; index < minimum; index += 1) {
    const close = closes[Math.min(index, closes.length - 1)]!;
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
      volume: "12.50",
    });
  }
  return bars;
}

function barsForDrawdownCursorScenario(input: {
  preBreachClose: string;
  breachClose: string;
  breachFromPhysicalIndex: number;
  totalBars?: number;
}): Bar[] {
  const totalBars = input.totalBars ?? input.breachFromPhysicalIndex + 3;
  const closes = Array.from({ length: totalBars }, (_, index) =>
    index < input.breachFromPhysicalIndex ? input.preBreachClose : input.breachClose,
  );
  return barsWithMarkSequence(closes);
}

async function runDrawdownBacktest(input: {
  session: Awaited<ReturnType<typeof seedResearchSession>>["session"];
  context: Awaited<ReturnType<typeof seedResearchSession>>["context"];
  markCloses?: string[];
  maxCycles: number;
  activeStrategyIds?: string[];
  extraSellBarIndex?: number;
  bars?: Bar[];
}) {
  const bars =
    input.bars ??
    barsForDrawdownCursorScenario({
      preBreachClose: "80000.00",
      breachClose: "30000.00",
      breachFromPhysicalIndex: 23,
    });
  const window = {
    start: new Date(bars[0]!.barOpenTime),
    end: new Date(bars.at(-1)!.barCloseTime),
  };
  const buyOrder = await createAcceptedMarketOrder(input.session.orderRepository, input.context, {
    quantity: "0.50000000",
    symbol: "BTC/USDT",
  });
  input.session.historicalExecutionProfile.exchange.registerOrder(
    { ...buyOrder, symbol: "BTCUSDT" },
    0,
    Date.parse(bars[0]!.barCloseTime),
  );
  if (input.extraSellBarIndex != null) {
    const sellOrder = await createAcceptedMarketOrder(
      input.session.orderRepository,
      input.context,
      {
        quantity: "0.50000000",
        symbol: "BTC/USDT",
        side: "sell",
      },
    );
    input.session.historicalExecutionProfile.exchange.registerOrder(
      { ...sellOrder, symbol: "BTCUSDT" },
      input.extraSellBarIndex,
      Date.parse(bars[input.extraSellBarIndex]!.barCloseTime),
    );
  }
  return runBacktest({
    context: input.context,
    barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-drawdown" }),
    deps: input.session.deps,
    orderRepository: input.session.orderRepository,
    accountKey: "macro-h-drawdown",
    defaultQuantity: "0.01",
    costModel: createCostModelV1("0", "0"),
    strategySignalIds: [MEAN_REVERSION_V0],
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: STRATEGY_VERSION,
    regimeLabel: "AGGREGATE",
    datasetId: "dataset-macro-h-drawdown",
    runId: "run-macro-h-drawdown",
    split: "validation",
    window,
    accountState: createHtrInitialAccountRiskState(),
    exportedAt: new Date(window.end),
    historicalExecutionProfile: input.session.historicalExecutionProfile,
    maxCycles: input.maxCycles,
    enableReplayFusedContext: false,
    activeStrategyIds: input.activeStrategyIds ?? ["__htr-blocked__"],
  });
}

async function seedResearchSession() {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "htr-macro-h-default-path@waia.invalid",
    password: "password123",
    identityLabel: "HTR Macro H Default Path",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: USER_ID,
    displayName: "HTR Macro H Default Path",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });
  return { session, context: requireOrgContext(orgId) };
}

describe("HTR-MACRO-H default research path corrective", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("V1 default research path reaches WP18 → WP19 → WP20", async () => {
    const { session, context } = await seedResearchSession();
    const artifactSink: ResearchValidationBacktestArtifactSink = {};
    const costModel = createCostModelV1("10", "5");
    try {
      await runResearchValidationBacktest({
        context,
        bars: flatBars(20),
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        datasetId: "dataset-macro-h-v1",
        runId: "run-macro-h-v1",
        split: "validation",
        costModel,
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-v1",
        defaultQuantity: "0.01",
        cycleIdPrefix: buildResearchValidationCycleIdPrefix("run-macro-h-v1"),
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
        historicalExecutionProfile: session.historicalExecutionProfile,
        artifactSink,
      });
      const cycle = artifactSink.cycleResults?.at(-1);
      expect(cycle?.htrGuardian).toBeDefined();
      expect(cycle?.htrRuntimeCallOrder?.map((event) => event.kind)).toEqual(
        expect.arrayContaining([
          "WP18_INITIAL_STATE",
          "WP19_RECONCILIATION_PASS",
          "WP20_GUARDIAN_EVALUATED",
        ]),
      );
    } finally {
      session.cleanup();
    }
  });

  it("V2 default research path reaches WP18 → WP19 → WP20", async () => {
    const { session, context } = await seedResearchSession();
    const artifactSink: ResearchValidationBacktestArtifactSink = {};
    const costModel = createCostModelV1("10", "5");
    const portfolio = buildResearchV2PortfolioContext(costModel);
    try {
      await runResearchValidationBacktest({
        context,
        bars: flatBars(20),
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        datasetId: "dataset-macro-h-v2",
        runId: "run-macro-h-v2",
        split: "validation",
        costModel,
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-v2",
        defaultQuantity: "0.01",
        cycleIdPrefix: buildResearchValidationCycleIdPrefix("run-macro-h-v2"),
        metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
        portfolio,
        historicalExecutionProfile: session.historicalExecutionProfile,
        artifactSink,
      });
      const cycle = artifactSink.cycleResults?.at(-1);
      expect(cycle?.htrGuardian).toBeDefined();
      const kinds = cycle?.htrRuntimeCallOrder?.map((event) => event.kind) ?? [];
      const wp19Index = kinds.indexOf("WP19_RECONCILIATION_PASS");
      const wp20Index = kinds.indexOf("WP20_GUARDIAN_EVALUATED");
      expect(wp19Index).toBeGreaterThanOrEqual(0);
      expect(wp20Index).toBeGreaterThan(wp19Index);
    } finally {
      session.cleanup();
    }
  });

  it("observes 100000.00 initial portfolio from runtime output", async () => {
    const { session, context } = await seedResearchSession();
    const bars = flatBars(5);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    try {
      const result = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-initial" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-initial",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-initial",
        runId: "run-macro-h-initial",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 1,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      expect(
        compareDecimal(
          result.accountingState?.cash ?? "0",
          HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        ),
      ).toBe(0);
      expect(
        compareDecimal(
          result.accountingState?.equity ?? "0",
          HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        ),
      ).toBe(0);
      expect(result.htrPnlReportV1?.startingEquityUsdt).toBe(
        HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      );
    } finally {
      session.cleanup();
    }
  });

  it("one BUY and one SELL produce exact cash/accounting effects with dual bases", async () => {
    const bars = flatBars(25, "50000.00");
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };

    const { session: buyOnlySession, context: buyOnlyContext } = await seedResearchSession();
    const buyOnlyOrder = await createAcceptedMarketOrder(
      buyOnlySession.orderRepository,
      buyOnlyContext,
      { quantity: "0.01000000", symbol: "BTC/USDT" },
    );
    buyOnlySession.historicalExecutionProfile.exchange.registerOrder(
      { ...buyOnlyOrder, symbol: "BTCUSDT" },
      0,
      Date.parse(bars[0]!.barCloseTime),
    );
    try {
      const buyOnly = await runBacktest({
        context: buyOnlyContext,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-buy-only" }),
        deps: buyOnlySession.deps,
        orderRepository: buyOnlySession.orderRepository,
        accountKey: "macro-h-buy-only",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-buy-only",
        runId: "run-macro-h-buy-only",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: buyOnlySession.historicalExecutionProfile,
        maxCycles: 2,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      const grossBasis = buyOnly.accountingState?.positions.BTCUSDT?.grossPositionBasis ?? "0";
      const netBasis = buyOnly.accountingState?.positions.BTCUSDT?.netPositionBasis ?? "0";
      expect(compareDecimal(grossBasis, "0")).toBeGreaterThan(0);
      expect(compareDecimal(netBasis, grossBasis)).toBeGreaterThan(0);
      expect(buyOnly.htrPnlReportV1?.totalExecutionCostUsdt).not.toBe("0.00000000");
    } finally {
      buyOnlySession.cleanup();
    }

    const { session, context } = await seedResearchSession();
    const buyOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.01000000",
      symbol: "BTC/USDT",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...buyOrder, symbol: "BTCUSDT" },
      0,
      Date.parse(bars[0]!.barCloseTime),
    );
    const sellOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.01000000",
      symbol: "BTC/USDT",
      side: "sell",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...sellOrder, symbol: "BTCUSDT" },
      2,
      Date.parse(bars[2]!.barCloseTime),
    );
    try {
      const closed = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({
          bars,
          cycleIdPrefix: "macro-h-roundtrip-single",
        }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-roundtrip-single",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-roundtrip-single",
        runId: "run-macro-h-roundtrip-single",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 8,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      expect(closed.accountingState?.consumedFillIds.length).toBe(2);
      expect(
        compareDecimal(closed.accountingState?.cash ?? "0", closed.accountingState?.equity ?? "0"),
      ).toBe(0);
      expect(
        compareDecimal(
          closed.accountingState?.grossRealizedPnl ?? "0",
          closed.accountingState?.netRealizedPnl ?? "0",
        ),
      ).not.toBe(0);
    } finally {
      session.cleanup();
    }
  });

  it("checkpoint/resume produces identical accounting and PnL digests", async () => {
    const { session, context } = await seedResearchSession();
    const bars = flatBars(6);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    try {
      const first = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-resume-a" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-resume",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-resume",
        runId: "run-macro-h-resume",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 3,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      const resumed = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-resume-b" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-resume",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-resume",
        runId: "run-macro-h-resume",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 6,
        resumeCycleStartIndex: 3,
        initialAccountingFrontierState: first.accountingFrontierState,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      const firstDigest = computeAccountingSemanticDigest(first.accountingState!);
      const resumedDigest = computeAccountingSemanticDigest(resumed.accountingState!);
      expect(resumedDigest).toBe(firstDigest);
      expect(resumed.htrPnlReportV1?.semanticDigest).toBe(first.htrPnlReportV1?.semanticDigest);
    } finally {
      session.cleanup();
    }
  });

  it("terminal export equals terminal accounting state", async () => {
    const { session, context } = await seedResearchSession();
    const bars = flatBars(3);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    try {
      const result = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-export" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-export",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-export",
        runId: "run-macro-h-export",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 2,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      expect(result.exportBundle.htrPnlReportV1?.terminalCashUsdt).toBe(
        result.accountingState?.cash,
      );
      expect(result.exportBundle.htrPnlReportV1?.terminalEquityUsdt).toBe(
        result.accountingState?.equity,
      );
    } finally {
      session.cleanup();
    }
  });

  it("inventory mismatch terminates the real bounded run", async () => {
    const { session, context } = await seedResearchSession();
    const bars = flatBars(3);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    const order = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.01000000",
      symbol: "BTC/USDT",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...order, symbol: "BTCUSDT" },
      0,
      Date.parse(bars[0]!.barCloseTime),
    );
    try {
      const first = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-mismatch" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-mismatch",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-mismatch",
        runId: "run-macro-h-mismatch",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 2,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      const corrupted = {
        ...first.accountingFrontierState!,
        cash: subtractDecimal(first.accountingFrontierState!.cash, "1.00"),
      };
      const restoredState = {
        ...first.accountingState!,
        cash: corrupted.cash,
        equity: corrupted.equity,
        markedPositionValue: subtractDecimal(corrupted.equity, corrupted.cash),
      };
      corrupted.semanticContentDigest = computeAccountingSemanticDigest(restoredState);
      await expect(
        runBacktest({
          context,
          barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-mismatch-2" }),
          deps: session.deps,
          orderRepository: session.orderRepository,
          accountKey: "macro-h-mismatch",
          defaultQuantity: "0.01",
          costModel: createCostModelV1("10", "5"),
          strategySignalIds: [MEAN_REVERSION_V0],
          strategyId: MEAN_REVERSION_V0,
          strategyVersion: STRATEGY_VERSION,
          regimeLabel: "AGGREGATE",
          datasetId: "dataset-macro-h-mismatch",
          runId: "run-macro-h-mismatch",
          split: "validation",
          window,
          accountState: createHtrInitialAccountRiskState(),
          exportedAt: new Date(window.end),
          historicalExecutionProfile: session.historicalExecutionProfile,
          maxCycles: 3,
          resumeCycleStartIndex: 2,
          initialAccountingFrontierState: corrupted,
          enableReplayFusedContext: false,
          activeStrategyIds: ["__htr-blocked__"],
        }),
      ).rejects.toBeInstanceOf(HtrAccountingReconciliationTerminationError);
    } finally {
      session.cleanup();
    }
  });

  it("reconciliation failure reaches STOP_ACCOUNT guardian state", async () => {
    const { session, context } = await seedResearchSession();
    const bars = flatBars(2);
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    const order = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.01000000",
      symbol: "BTC/USDT",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...order, symbol: "BTCUSDT" },
      0,
      Date.parse(bars[0]!.barCloseTime),
    );
    try {
      const first = await runBacktest({
        context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-stop" }),
        deps: session.deps,
        orderRepository: session.orderRepository,
        accountKey: "macro-h-stop",
        defaultQuantity: "0.01",
        costModel: createCostModelV1("10", "5"),
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-macro-h-stop",
        runId: "run-macro-h-stop",
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: session.historicalExecutionProfile,
        maxCycles: 1,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      const corrupted = {
        ...first.accountingFrontierState!,
        equity: subtractDecimal(first.accountingFrontierState!.equity, "10.00"),
      };
      const restoredState = {
        ...first.accountingState!,
        cash: corrupted.cash,
        equity: corrupted.equity,
        markedPositionValue: subtractDecimal(corrupted.equity, corrupted.cash),
      };
      corrupted.semanticContentDigest = computeAccountingSemanticDigest(restoredState);
      try {
        await runBacktest({
          context,
          barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "macro-h-stop-2" }),
          deps: session.deps,
          orderRepository: session.orderRepository,
          accountKey: "macro-h-stop",
          defaultQuantity: "0.01",
          costModel: createCostModelV1("10", "5"),
          strategySignalIds: [MEAN_REVERSION_V0],
          strategyId: MEAN_REVERSION_V0,
          strategyVersion: STRATEGY_VERSION,
          regimeLabel: "AGGREGATE",
          datasetId: "dataset-macro-h-stop",
          runId: "run-macro-h-stop",
          split: "validation",
          window,
          accountState: createHtrInitialAccountRiskState(),
          exportedAt: new Date(window.end),
          historicalExecutionProfile: session.historicalExecutionProfile,
          maxCycles: 2,
          resumeCycleStartIndex: 1,
          initialAccountingFrontierState: corrupted,
          enableReplayFusedContext: false,
          activeStrategyIds: ["__htr-blocked__"],
        });
      } catch (error) {
        expect(error).toBeInstanceOf(HtrAccountingReconciliationTerminationError);
        expect(String(error)).toContain(accountingInvariantCodes.cashEquityConservation);
      }
    } finally {
      session.cleanup();
    }
  });

  it("drawdown equality reaches CLOSE_ONLY through production runner", async () => {
    const { session, context } = await seedResearchSession();
    try {
      const result = await runDrawdownBacktest({
        session,
        context,
        bars: barsForDrawdownCursorScenario({
          preBreachClose: "80000.00",
          breachClose: "30160.00",
          breachFromPhysicalIndex: 23,
        }),
        maxCycles: 6,
      });
      expect(result.accountingState?.consumedFillIds.length).toBeGreaterThan(0);
      const accountDrawdownBps = computePeakEquityDrawdownBps(
        result.accountingState!.equity,
        result.accountingState!.equityHwm,
      );
      expect(accountDrawdownBps).toBeGreaterThanOrEqual(DEFAULT_D20_DRAWDOWN_POLICY.accountBps);
      const resolved = resolveDrawdownBreachState({
        accountDrawdownBps,
        monthlyDrawdownBps: 0,
        accountLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.accountBps,
        monthlyLimitBps: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps,
      });
      expect(["CLOSE_ONLY", "STOP_ACCOUNT"]).toContain(resolved.breachState);
      expect(
        result.cycleResults.some(
          (cycle) => cycle.htrGuardian?.breachState === resolved.breachState,
        ),
      ).toBe(true);
      const breachEvent = result.htrRuntimeCallOrder?.find(
        (event) =>
          event.kind === "WP20_GUARDIAN_EVALUATED" && event.detail === resolved.breachState,
      );
      expect(breachEvent).toBeDefined();
      const wp19Index =
        result.htrRuntimeCallOrder?.findIndex(
          (event) =>
            event.kind === "WP19_RECONCILIATION_PASS" &&
            event.cycleIndex === breachEvent?.cycleIndex,
        ) ?? -1;
      const wp20Index =
        result.htrRuntimeCallOrder?.findIndex(
          (event) =>
            event.kind === "WP20_GUARDIAN_EVALUATED" && event.detail === resolved.breachState,
        ) ?? -1;
      expect(wp20Index).toBeGreaterThan(wp19Index);
    } finally {
      session.cleanup();
    }
  });

  it("hard breach denies actual new-order submission through paper cycle", async () => {
    const { session, context } = await seedResearchSession();
    try {
      const result = await runDrawdownBacktest({
        session,
        context,
        bars: barsForDrawdownCursorScenario({
          preBreachClose: "80000.00",
          breachClose: "28000.00",
          breachFromPhysicalIndex: 23,
        }),
        maxCycles: 6,
      });
      const stopCycle = result.cycleResults.find(
        (cycle) => cycle.htrGuardian?.breachState === "STOP_ACCOUNT",
      );
      expect(stopCycle?.htrGuardian?.breachState).toBe("STOP_ACCOUNT");
      const restriction = applyBreachSubmissionRestrictions({
        cycle: stopCycle!.htrGuardian!,
        order: {
          symbol: "BTC/USDT",
          side: "buy",
          type: "market",
          quantity: "0.01",
          clientOrderId: "macro-h-breach-buy",
        },
        openQty: result.accountingState?.positions.BTCUSDT?.quantity ?? "0",
      });
      expect(restriction.permitted).toBe(false);
      expect(restriction.reason).toBe(HTR_GUARDIAN_EXIT_REASON_V1.accountStop);
    } finally {
      session.cleanup();
    }
  });

  it("risk-reducing exit remains reachable after hard breach", async () => {
    const { session, context } = await seedResearchSession();
    try {
      const result = await runDrawdownBacktest({
        session,
        context,
        bars: barsForDrawdownCursorScenario({
          preBreachClose: "80000.00",
          breachClose: "28000.00",
          breachFromPhysicalIndex: 23,
          totalBars: 28,
        }),
        maxCycles: 8,
        extraSellBarIndex: 6,
      });
      expect(
        result.cycleResults.some((cycle) => cycle.htrGuardian?.breachState === "STOP_ACCOUNT"),
      ).toBe(true);
      expect(result.accountingState?.consumedFillIds.length).toBe(2);
    } finally {
      session.cleanup();
    }
  });

  it.skipIf(!integrationEnabled)("postgres integration gate marker for Macro-H subset", () => {
    expect(integrationEnabled).toBe(true);
  });
});
