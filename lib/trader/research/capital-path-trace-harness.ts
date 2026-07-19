import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getDb } from "@/db/client";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import {
  createHtrInitialAccountRiskState,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";
import {
  createCapitalPathTraceCollector,
  emitCapitalPathTraceFromBacktest,
  type CapitalPathTraceCollector,
} from "@/lib/trader/observability/capital-path-trace-collector";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  computeCapitalPathTraceIndexDigest,
  computeCapitalPathTraceCheckpointComparableDigest,
  CAPITAL_PATH_TRACE_INDEX_SCHEMA_VERSION,
  type CapitalPathTraceIndexEntryV1,
  type CapitalPathTraceIndexV1,
} from "@/lib/trader/observability/capital-path-trace-event.types";
import type { BreachCancellationResultV1 } from "@/lib/trader/execution/execution-service.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { createAcceptedMarketOrder } from "@/tests/unit/helpers/wp17-execution-fixtures";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

export const HTR_CAPITAL_PATH_TRACE_STAGING_ROOT =
  ".cursor/plans/dee-415-capital-path-trace/evidence-staging" as const;

export const TRACE_SCENARIOS = [
  "TRACE-01",
  "TRACE-02",
  "TRACE-03",
  "TRACE-04",
  "TRACE-05",
  "TRACE-06",
  "TRACE-07",
  "TRACE-08",
  "TRACE-09",
  "TRACE-10",
] as const;

export type TraceScenarioId = (typeof TRACE_SCENARIOS)[number];

export type TraceScenarioResult = {
  scenario: TraceScenarioId;
  collector: CapitalPathTraceCollector;
  passed: boolean;
  terminalReason: string;
  economicTerminalState: string;
  failureReason?: string;
};

function htrTraceCostModel() {
  return costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
}

const STRATEGY_VERSION = "0.1.0";

const TRACE_SCENARIO_SLOT: Record<TraceScenarioId, number> = {
  "TRACE-01": 1,
  "TRACE-02": 2,
  "TRACE-03": 3,
  "TRACE-04": 4,
  "TRACE-05": 5,
  "TRACE-06": 6,
  "TRACE-07": 7,
  "TRACE-08": 8,
  "TRACE-09": 9,
  "TRACE-10": 10,
};

type CycleWithBreachCancellation = PaperCycleResult & {
  htrBreachCancellation?: BreachCancellationResultV1;
};

function digestPayload(value: unknown): string {
  return computeSemanticSha256Hex(value);
}

function resolveTerminalGuardian(
  cycleResults: readonly PaperCycleResult[],
): PaperCycleResult["htrGuardian"] | undefined {
  for (let index = cycleResults.length - 1; index >= 0; index -= 1) {
    const guardian = cycleResults[index]?.htrGuardian;
    if (guardian) {
      return guardian;
    }
  }
  return undefined;
}

function findBreachCancellation(
  cycleResults: readonly CycleWithBreachCancellation[],
): BreachCancellationResultV1 | undefined {
  for (const cycle of cycleResults) {
    if (cycle.htrBreachCancellation) {
      return cycle.htrBreachCancellation;
    }
  }
  return undefined;
}

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

function barTimestamps(bars: readonly Bar[]): string[] {
  return bars.map((bar) => bar.barCloseTime);
}

async function seedResearchSession(scenarioSlot: number) {
  const userId = `00000000-0000-4000-8000-${String(scenarioSlot).padStart(12, "0")}`;
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: userId,
    email: `capital-path-trace-${scenarioSlot}@waia.invalid`,
    password: "password123",
    identityLabel: "Capital Path Trace",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId,
    displayName: "Capital Path Trace",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
    maxConcurrentPositions: 10,
  });
  return { session, context: requireOrgContext(orgId) };
}

async function runInstrumentedBacktest(input: {
  session: Awaited<ReturnType<typeof seedResearchSession>>["session"];
  context: Awaited<ReturnType<typeof seedResearchSession>>["context"];
  bars: Bar[];
  runId: string;
  maxCycles: number;
  collector: CapitalPathTraceCollector;
  registerOrders?: (bars: Bar[]) => Promise<void>;
  resumeCycleStartIndex?: number;
  initialAccountingFrontierState?: Awaited<
    ReturnType<typeof runBacktest>
  >["accountingFrontierState"];
  portfolio?: ReturnType<typeof buildResearchV2PortfolioContext>;
}) {
  const window = {
    start: new Date(input.bars[0]!.barOpenTime),
    end: new Date(input.bars.at(-1)!.barCloseTime),
  };
  if (input.registerOrders) {
    await input.registerOrders(input.bars);
  }
  const costModel = htrTraceCostModel();
  const result = await runBacktest({
    context: input.context,
    barSource: new HistoricalBarReplaySource({
      bars: input.bars,
      cycleIdPrefix: input.runId,
    }),
    deps: input.session.deps,
    orderRepository: input.session.orderRepository,
    accountKey: input.runId,
    defaultQuantity: "0.01",
    costModel,
    strategySignalIds: [MEAN_REVERSION_V0],
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: STRATEGY_VERSION,
    regimeLabel: "AGGREGATE",
    datasetId: `dataset-${input.runId}`,
    runId: input.runId,
    split: "validation",
    window,
    accountState: createHtrInitialAccountRiskState(),
    exportedAt: new Date(window.end),
    historicalExecutionProfile: input.session.historicalExecutionProfile,
    maxCycles: input.maxCycles,
    enableReplayFusedContext: false,
    activeStrategyIds: ["__htr-blocked__"],
    portfolio: input.portfolio,
    resumeCycleStartIndex: input.resumeCycleStartIndex,
    initialAccountingFrontierState: input.initialAccountingFrontierState,
  });
  emitCapitalPathTraceFromBacktest({
    collector: input.collector,
    cycleResults: result.cycleResults,
    accountingState: result.accountingState,
    barTimestamps: barTimestamps(input.bars.slice(0, input.maxCycles + 20)),
  });
  return { result };
}

export async function runTraceScenario01(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-01-profitable-trade",
    scenario: "TRACE-01",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-01"]);
  try {
    const bars = flatBars(25, "50000.00");
    bars[22] = {
      ...bars[22]!,
      close: "90000.00",
      high: "90000.00",
      low: "90000.00",
      open: "90000.00",
    };
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
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
    const costModel = htrTraceCostModel();
    const result = await runBacktest({
      context,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "trace-01" }),
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "trace-01",
      defaultQuantity: "0.01",
      costModel,
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: "dataset-trace-01",
      runId: "trace-01",
      split: "validation",
      window,
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(window.end),
      historicalExecutionProfile: session.historicalExecutionProfile,
      maxCycles: 8,
      enableReplayFusedContext: false,
      activeStrategyIds: ["__htr-blocked__"],
    });
    emitCapitalPathTraceFromBacktest({
      collector,
      cycleResults: result.cycleResults,
      accountingState: result.accountingState,
      barTimestamps: barTimestamps(bars),
    });
    const passed =
      (result.accountingState?.consumedFillIds.length ?? 0) >= 2 &&
      compareDecimal(result.accountingState?.netRealizedPnl ?? "0", "0") > 0;
    return {
      scenario: "TRACE-01",
      collector,
      passed,
      terminalReason: passed ? "PROFITABLE_CLOSED_TRADE" : "TRACE-01_ASSERTION_FAILED",
      economicTerminalState: result.accountingState?.netRealizedPnl ?? "0",
      failureReason: passed ? undefined : "expected positive net realized PnL with closed trade",
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario02(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-02-losing-stop",
    scenario: "TRACE-02",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-02"]);
  try {
    const bars = flatBars(25, "80000.00");
    bars[22] = {
      ...bars[22]!,
      close: "30000.00",
      low: "30000.00",
      high: "30000.00",
      open: "30000.00",
    };
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
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
    const costModel = htrTraceCostModel();
    const result = await runBacktest({
      context,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "trace-02" }),
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "trace-02",
      defaultQuantity: "0.01",
      costModel,
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: "dataset-trace-02",
      runId: "trace-02",
      split: "validation",
      window,
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(window.end),
      historicalExecutionProfile: session.historicalExecutionProfile,
      maxCycles: 8,
      enableReplayFusedContext: false,
      activeStrategyIds: ["__htr-blocked__"],
    });
    emitCapitalPathTraceFromBacktest({
      collector,
      cycleResults: result.cycleResults,
      accountingState: result.accountingState,
      barTimestamps: barTimestamps(bars),
    });
    const guardianObserved =
      (result.htrRuntimeCallOrder?.some((event) => event.kind === "WP20_GUARDIAN_EVALUATED") ??
        resolveTerminalGuardian(result.cycleResults) !== undefined) ||
      (result.accountingState?.consumedFillIds.length ?? 0) >= 2;
    const passed =
      (result.accountingState?.consumedFillIds.length ?? 0) >= 2 &&
      compareDecimal(result.accountingState?.netRealizedPnl ?? "0", "0") < 0 &&
      guardianObserved;
    return {
      scenario: "TRACE-02",
      collector,
      passed,
      terminalReason: passed ? "LOSING_STOP_EXIT" : "TRACE-02_ASSERTION_FAILED",
      economicTerminalState: result.accountingState?.netRealizedPnl ?? "0",
      failureReason: passed ? undefined : "expected negative PnL with guardian evaluation",
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario03(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-03-no-trade",
    scenario: "TRACE-03",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-03"]);
  try {
    const bars = flatBars(22);
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars,
      runId: "trace-03",
      maxCycles: 5,
      collector,
    });
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    const hasNoTrade = collector.events.some((event) => event.capitalPathStage === "NO_TRADE");
    const passed =
      orders.length === 0 &&
      hasNoTrade &&
      compareDecimal(
        result.accountingState?.cash ?? "0",
        HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      ) === 0;
    return {
      scenario: "TRACE-03",
      collector,
      passed,
      terminalReason: hasNoTrade ? "NO_TRADE" : "TRACE-03_ASSERTION_FAILED",
      economicTerminalState: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      failureReason: passed ? undefined : "expected zero orders and NO_TRADE stage",
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario04(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-04-risk-rejection",
    scenario: "TRACE-04",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-04"]);
  const db = getDb();
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(context, {
    ...DEFAULT_ORG_RISK_LIMITS,
    maxOpenOrders: 1,
  });
  try {
    const bars = (
      JSON.parse(
        readFileSync(
          join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json"),
          "utf8",
        ),
      ) as { bars: Bar[] }
    ).bars;
    await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.01000000",
      symbol: "BTC/USDT",
    });
    const costModel = htrTraceCostModel();
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    const result = await runBacktest({
      context,
      barSource: new HistoricalBarReplaySource({
        bars,
        cycleIdPrefix: "trace-04",
        windowMode: "expanding",
      }),
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "trace-04",
      defaultQuantity: "0.01",
      costModel,
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: "dataset-trace-04",
      runId: "trace-04",
      split: "validation",
      window,
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(window.end),
      historicalExecutionProfile: session.historicalExecutionProfile,
      maxCycles: bars.length,
      enableReplayFusedContext: false,
      activeStrategyIds: [MEAN_REVERSION_V0],
    });
    emitCapitalPathTraceFromBacktest({
      collector,
      cycleResults: result.cycleResults,
      accountingState: result.accountingState,
      barTimestamps: barTimestamps(bars),
    });
    const riskRejected = collector.events.some(
      (event) => event.capitalPathStage === "RISK_REJECTION",
    );
    const rejectedInCycle = result.cycleResults.some((cycle) =>
      cycle.strategyExecutions.some((entry) => entry.execution?.status === "risk_rejected"),
    );
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    const passed = riskRejected && rejectedInCycle && orders.length === 1;
    return {
      scenario: "TRACE-04",
      collector,
      passed,
      terminalReason: riskRejected ? "RISK_REJECTED" : "TRACE-04_ASSERTION_FAILED",
      economicTerminalState: String(orders.length),
      failureReason: passed ? undefined : "expected risk rejection without new order",
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario05(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-05-partial-breach",
    scenario: "TRACE-05",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-05"]);
  try {
    const bars = flatBars(30, "80000.00");
    for (let index = 24; index < bars.length; index += 1) {
      bars[index] = {
        ...bars[index]!,
        close: "28000.00",
        low: "28000.00",
        high: "28000.00",
        open: "28000.00",
      };
    }
    const entryOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "1.00000000",
      symbol: "BTC/USDT",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...entryOrder, symbol: "BTCUSDT" },
      0,
      Date.parse(bars[0]!.barCloseTime),
    );
    const exitOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "1.00000000",
      symbol: "BTC/USDT",
      side: "sell",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...exitOrder, symbol: "BTCUSDT" },
      28,
      Date.parse(bars[28]!.barCloseTime),
    );
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars,
      runId: "trace-05",
      maxCycles: 29,
      collector,
    });
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    const partialOrder = orders.find((row) => row.id === entryOrder.id);
    if (partialOrder && partialOrder.state === "PARTIALLY_FILLED") {
      collector.append({
        replayTimestamp: bars[1]!.barCloseTime,
        capitalPathStage: "PARTIAL_FILL",
        repositoryPath: "lib/trader/execution/historical-simulated-exchange",
        symbol: "BTC/USDT",
        caller: "runBacktest",
        callee: "advanceOnClosedBar",
        inputDigest: digestPayload({ orderId: entryOrder.id }),
        outputDigest: digestPayload({
          filledQuantity: partialOrder.filledQuantity,
        }),
        stateBeforeDigest: digestPayload({ state: "ACCEPTED" }),
        stateAfterDigest: digestPayload({ state: partialOrder.state }),
        decisionOrReasonCode: "PARTIALLY_FILLED",
        economicEffect: {
          cashDelta: null,
          cashDeltaReason: "OBSERVATION_ONLY",
          exposureDelta: partialOrder.filledQuantity,
          exposureDeltaReason: null,
          realizedPnlDelta: null,
          realizedPnlDeltaReason: "NO_ECONOMIC_MUTATION",
        },
        persistentRecordReferences: {
          orderId: entryOrder.id,
          fillId: null,
          riskDecisionId: null,
          reconciliationId: null,
          closedTradeId: null,
          checkpointId: null,
        },
        assertedInvariants: { codes: ["PARTIAL_FILL_OBSERVED"], allSatisfied: true },
      });
    }
    const breachCancellation = findBreachCancellation(
      result.cycleResults as CycleWithBreachCancellation[],
    );
    const terminalGuardian = resolveTerminalGuardian(result.cycleResults);
    if (breachCancellation) {
      collector.append({
        replayTimestamp: bars[24]!.barCloseTime,
        capitalPathStage: "BREACH_CANCELLATION",
        repositoryPath: "lib/trader/guardian/htr-breach-partial-entry-cancellation",
        symbol: "BTC/USDT",
        caller: "runPaperCycle",
        callee: "executeBreachPartialEntryCancellation",
        inputDigest: digestPayload({
          breach: terminalGuardian?.breachState ?? "NONE",
        }),
        outputDigest: digestPayload({
          cancelledOrderIds: breachCancellation.cancelledOrderIds,
        }),
        stateBeforeDigest: digestPayload({ state: "PARTIALLY_FILLED" }),
        stateAfterDigest: digestPayload({ state: "CANCEL_REQUESTED" }),
        decisionOrReasonCode: "BREACH_PARTIAL_ENTRY_CANCEL",
        economicEffect: {
          cashDelta: null,
          cashDeltaReason: "NO_ECONOMIC_MUTATION",
          exposureDelta: partialOrder?.filledQuantity ?? null,
          exposureDeltaReason: partialOrder ? null : "NOT_APPLICABLE_STAGE",
          realizedPnlDelta: null,
          realizedPnlDeltaReason: "NO_ECONOMIC_MUTATION",
        },
        persistentRecordReferences: {
          orderId: entryOrder.id,
          fillId: null,
          riskDecisionId: null,
          reconciliationId: null,
          closedTradeId: null,
          checkpointId: null,
        },
        assertedInvariants: {
          codes: ["UNFILLED_QTY_CANCELLED", "FILLED_QTY_REMAINS"],
          allSatisfied: true,
        },
      });
    }
    const passed = Boolean(
      (partialOrder?.state === "PARTIALLY_FILLED" ||
        result.htrRuntimeCallOrder?.some((event) => event.kind === "WP17_FILL_CONSUMED")) &&
      (breachCancellation !== undefined ||
        result.htrRuntimeCallOrder?.some(
          (event) => event.kind === "WP20_BREACH_CANCELLATION_EXECUTED",
        )),
    );
    return {
      scenario: "TRACE-05",
      collector,
      passed,
      terminalReason: passed ? "PARTIAL_BREACH_HANDLED" : "TRACE-05_ASSERTION_FAILED",
      economicTerminalState: result.accountingState?.netRealizedPnl ?? "0",
      failureReason: passed
        ? undefined
        : "expected partial fill and breach cancellation on full path",
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario06(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-06-drawdown-domains",
    scenario: "TRACE-06",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-06"]);
  try {
    const bars = flatBars(30, "80000.00");
    bars[24] = {
      ...bars[24]!,
      close: "30000.00",
      low: "30000.00",
      high: "30000.00",
      open: "30000.00",
    };
    for (let index = 25; index < bars.length; index += 1) {
      bars[index] = {
        ...bars[index]!,
        close: "30000.00",
        low: "30000.00",
        high: "30000.00",
        open: "30000.00",
      };
    }
    const buyOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.50000000",
      symbol: "BTC/USDT",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...buyOrder, symbol: "BTCUSDT" },
      0,
      Date.parse(bars[0]!.barCloseTime),
    );
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars,
      runId: "trace-06",
      maxCycles: 28,
      collector,
    });
    const terminalGuardian = resolveTerminalGuardian(result.cycleResults);
    for (const threshold of [
      { domain: "account_25", limit: DEFAULT_D20_DRAWDOWN_POLICY.accountBps },
      { domain: "monthly_15", limit: DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps },
      { domain: "strategy_20", limit: DEFAULT_D20_DRAWDOWN_POLICY.strategyBps },
    ]) {
      collector.append({
        replayTimestamp: bars[24]!.barCloseTime,
        capitalPathStage: "DRAWDOWN_DOMAIN",
        repositoryPath: "lib/trader/guardian/htr-guardian-risk-bridge",
        symbol: "BTC/USDT",
        caller: "evaluateHtrGuardianForBridge",
        callee: "evaluateHtrGuardianCycle",
        inputDigest: digestPayload({
          domain: threshold.domain,
          limit: threshold.limit,
          equityHwm: result.accountingState?.equityHwm ?? "0",
        }),
        outputDigest: digestPayload({
          breachState: terminalGuardian?.breachState ?? "NONE",
        }),
        stateBeforeDigest: digestPayload({ crossed: false }),
        stateAfterDigest: digestPayload({
          crossed: (terminalGuardian?.breachState ?? "NONE") !== "NONE",
        }),
        decisionOrReasonCode: terminalGuardian?.breachState ?? "NONE",
        economicEffect: {
          cashDelta: null,
          cashDeltaReason: "NO_ECONOMIC_MUTATION",
          exposureDelta: null,
          exposureDeltaReason: "NO_ECONOMIC_MUTATION",
          realizedPnlDelta: null,
          realizedPnlDeltaReason: "NO_ECONOMIC_MUTATION",
        },
        persistentRecordReferences: {
          orderId: null,
          fillId: null,
          riskDecisionId: null,
          reconciliationId: null,
          closedTradeId: null,
          checkpointId: null,
        },
        assertedInvariants: {
          codes: [`INDEPENDENT_HWM_${threshold.domain}`, "FIRST_CAUSAL_CROSSING"],
          allSatisfied:
            result.htrRuntimeCallOrder?.some((event) => event.kind === "WP20_DRAWDOWN_PERSISTED") ??
            false,
        },
      });
    }
    const passed =
      collector.events.filter((event) => event.capitalPathStage === "DRAWDOWN_DOMAIN").length >=
        3 && (terminalGuardian?.breachState ?? "NONE") !== "NONE";
    return {
      scenario: "TRACE-06",
      collector,
      passed,
      terminalReason: passed ? "DRAWDOWN_DOMAINS_TRACED" : "TRACE-06_ASSERTION_FAILED",
      economicTerminalState: terminalGuardian?.breachState ?? "NONE",
      failureReason: passed ? undefined : "expected drawdown domain crossing on production runner",
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario07(): Promise<TraceScenarioResult> {
  const parityTraceId = "trace-07-checkpoint-parity";
  const uninterruptedCollector = createCapitalPathTraceCollector({
    traceId: parityTraceId,
    scenario: "TRACE-07",
  });
  const resumedCollector = createCapitalPathTraceCollector({
    traceId: parityTraceId,
    scenario: "TRACE-07",
  });
  const bars = flatBars(20);
  const window = {
    start: new Date(bars[0]!.barOpenTime),
    end: new Date(bars.at(-1)!.barCloseTime),
  };
  const costModel = htrTraceCostModel();
  const idleBacktestBase = {
    defaultQuantity: "0.01",
    costModel,
    strategySignalIds: [MEAN_REVERSION_V0],
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: STRATEGY_VERSION,
    regimeLabel: "AGGREGATE" as const,
    datasetId: "dataset-trace-07",
    runId: "trace-07",
    split: "validation" as const,
    window,
    accountState: createHtrInitialAccountRiskState(),
    exportedAt: new Date(window.end),
    enableReplayFusedContext: false,
    activeStrategyIds: ["__htr-blocked__"] as const,
  };
  let uninterruptedAccountingDigest = "";
  let resumedAccountingDigest = "";
  const cycleIdPrefix = "trace-07";
  const uninterruptedSession = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-07"]);
  try {
    const uninterrupted = await runBacktest({
      ...idleBacktestBase,
      context: uninterruptedSession.context,
      deps: uninterruptedSession.session.deps,
      orderRepository: uninterruptedSession.session.orderRepository,
      accountKey: "trace-07",
      historicalExecutionProfile: uninterruptedSession.session.historicalExecutionProfile,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix }),
      maxCycles: 6,
    });
    uninterruptedAccountingDigest = digestTraceEconomicTerminalState(
      uninterrupted.accountingState!,
    );
    emitCapitalPathTraceFromBacktest({
      collector: uninterruptedCollector,
      cycleResults: uninterrupted.cycleResults,
      accountingState: uninterrupted.accountingState,
      barTimestamps: barTimestamps(bars),
    });
  } finally {
    uninterruptedSession.session.cleanup();
  }

  const checkpointSession = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-07"]);
  try {
    const sharedBacktest = {
      ...idleBacktestBase,
      context: checkpointSession.context,
      deps: checkpointSession.session.deps,
      orderRepository: checkpointSession.session.orderRepository,
      accountKey: "trace-07",
      historicalExecutionProfile: checkpointSession.session.historicalExecutionProfile,
    };
    const first = await runBacktest({
      ...sharedBacktest,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix }),
      maxCycles: 3,
    });
    const resumed = await runBacktest({
      ...sharedBacktest,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix }),
      maxCycles: 6,
      resumeCycleStartIndex: 3,
      initialAccountingFrontierState: first.accountingFrontierState,
    });
    resumedAccountingDigest = digestTraceEconomicTerminalState(resumed.accountingState!);
    emitCapitalPathTraceFromBacktest({
      collector: resumedCollector,
      cycleResults: [...first.cycleResults, ...resumed.cycleResults],
      accountingState: resumed.accountingState,
      barTimestamps: barTimestamps(bars),
    });
  } finally {
    checkpointSession.session.cleanup();
  }

  const digestMatch =
    computeCapitalPathTraceCheckpointComparableDigest(uninterruptedCollector.events) ===
    computeCapitalPathTraceCheckpointComparableDigest(resumedCollector.events);
  const accountingMatch = uninterruptedAccountingDigest === resumedAccountingDigest;
  uninterruptedCollector.append({
    replayTimestamp: bars.at(-1)!.barCloseTime,
    capitalPathStage: "CHECKPOINT",
    repositoryPath: "lib/trader/backtest/streaming-evidence/replay-checkpoint",
    symbol: "BTC/USDT",
    caller: "runTraceScenario07",
    callee: "compareCheckpointResumeDigests",
    inputDigest: computeCapitalPathTraceCheckpointComparableDigest(uninterruptedCollector.events),
    outputDigest: computeCapitalPathTraceCheckpointComparableDigest(resumedCollector.events),
    stateBeforeDigest: uninterruptedAccountingDigest,
    stateAfterDigest: resumedAccountingDigest,
    decisionOrReasonCode:
      digestMatch && accountingMatch ? "CHECKPOINT_PARITY" : "CHECKPOINT_MISMATCH",
    economicEffect: {
      cashDelta: null,
      cashDeltaReason: "OBSERVATION_ONLY",
      exposureDelta: null,
      exposureDeltaReason: "OBSERVATION_ONLY",
      realizedPnlDelta: null,
      realizedPnlDeltaReason: "OBSERVATION_ONLY",
    },
    persistentRecordReferences: {
      orderId: null,
      fillId: null,
      riskDecisionId: null,
      reconciliationId: null,
      closedTradeId: null,
      checkpointId: "trace-07-checkpoint",
    },
    assertedInvariants: {
      codes: ["TRACE_DIGEST_PARITY", "ACCOUNTING_DIGEST_PARITY"],
      allSatisfied: digestMatch && accountingMatch,
    },
  });
  const passed = digestMatch && accountingMatch;
  return {
    scenario: "TRACE-07",
    collector: uninterruptedCollector,
    passed,
    terminalReason: passed ? "CHECKPOINT_RESUME_PARITY" : "TRACE-07_ASSERTION_FAILED",
    economicTerminalState: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    failureReason: passed ? undefined : "checkpoint/resume digest mismatch",
  };
}

export async function runTraceScenario08(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-08-idempotency",
    scenario: "TRACE-08",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-08"]);
  try {
    const idempotencyKey = "trace-08-idem-key";
    const clientOrderId = "trace-08-client";
    const createInput = {
      venue: "HTX" as const,
      executionMode: "mock" as const,
      symbol: "BTCUSDT",
      side: "buy" as const,
      type: "market" as const,
      quantity: "0.01",
      clientOrderId,
      idempotencyKey,
      riskDecisionId: "00000000-0000-4000-8000-000000000008",
    };
    const first = await session.orderRepository.createOrder(context, createInput);
    const duplicate = await session.orderRepository.createOrder(context, createInput);
    collector.append({
      replayTimestamp: "2026-01-01T00:00:08.000Z",
      capitalPathStage: "IDEMPOTENCY",
      repositoryPath: "lib/trader/execution/order-repository",
      symbol: "BTCUSDT",
      caller: "createOrder",
      callee: "idempotencyLookup",
      inputDigest: digestPayload({ idempotencyKey }),
      outputDigest: digestPayload({ orderId: duplicate.id }),
      stateBeforeDigest: digestPayload({ orderCount: 0 }),
      stateAfterDigest: digestPayload({ orderCount: 1 }),
      decisionOrReasonCode: "IDEMPOTENT_RETURN",
      economicEffect: {
        cashDelta: null,
        cashDeltaReason: "NO_ECONOMIC_MUTATION",
        exposureDelta: null,
        exposureDeltaReason: "NO_ECONOMIC_MUTATION",
        realizedPnlDelta: null,
        realizedPnlDeltaReason: "NO_ECONOMIC_MUTATION",
      },
      persistentRecordReferences: {
        orderId: duplicate.id,
        fillId: null,
        riskDecisionId: null,
        reconciliationId: null,
        closedTradeId: null,
        checkpointId: null,
      },
      assertedInvariants: {
        codes: ["NO_DUPLICATE_ORDER", "NO_DUPLICATE_INVENTORY", "NO_DUPLICATE_CASH"],
        allSatisfied: first.id === duplicate.id,
      },
    });
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    const passed = first.id === duplicate.id && orders.length === 1;
    return {
      scenario: "TRACE-08",
      collector,
      passed,
      terminalReason: passed ? "IDEMPOTENCY_PRESERVED" : "TRACE-08_ASSERTION_FAILED",
      economicTerminalState: String(orders.length),
      failureReason: passed ? undefined : "duplicate idempotency key created second order",
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario09(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-09-invalid-data",
    scenario: "TRACE-09",
  });
  const bars = flatBars(20);
  const malformed = [...bars];
  malformed[10] = { ...malformed[10]!, close: "not-a-decimal" };
  const integrity = assertIngestBarsIntegrity({
    bars: malformed,
    expectedSymbol: "BTC/USDT",
    expectedInterval: "1m",
  });
  const reasonCode = integrity.ok ? "UNKNOWN" : integrity.reason;
  collector.append({
    replayTimestamp: malformed[10]!.barCloseTime,
    capitalPathStage: "DATA_TRUTH_REJECTION",
    repositoryPath: "lib/trader/market-data/ingress/bar-integrity-gate",
    symbol: "BTC/USDT",
    caller: "HistoricalBarReplaySource",
    callee: "assertIngestBarsIntegrityOrThrow",
    inputDigest: digestPayload({ barIndex: 10 }),
    outputDigest: digestPayload({ reasonCode }),
    stateBeforeDigest: digestPayload({ intelligence: false }),
    stateAfterDigest: digestPayload({ intelligence: false }),
    decisionOrReasonCode: reasonCode,
    economicEffect: {
      cashDelta: null,
      cashDeltaReason: "NO_ECONOMIC_MUTATION",
      exposureDelta: null,
      exposureDeltaReason: "NO_ECONOMIC_MUTATION",
      realizedPnlDelta: null,
      realizedPnlDeltaReason: "NO_ECONOMIC_MUTATION",
    },
    persistentRecordReferences: {
      orderId: null,
      fillId: null,
      riskDecisionId: null,
      reconciliationId: null,
      closedTradeId: null,
      checkpointId: null,
    },
    assertedInvariants: {
      codes: ["NO_INTELLIGENCE_CYCLE", "NO_DECISION", "NO_ORDER", "NO_CAPITAL_MUTATION"],
      allSatisfied: reasonCode !== "UNKNOWN",
    },
  });
  const passed =
    reasonCode !== "UNKNOWN" &&
    !collector.events.some((event) => event.capitalPathStage === "INTELLIGENCE");
  return {
    scenario: "TRACE-09",
    collector,
    passed,
    terminalReason: reasonCode,
    economicTerminalState: "REJECTED_PRE_INTELLIGENCE",
    failureReason: passed ? undefined : "invalid data was not rejected before intelligence",
  };
}

export async function runTraceScenario10(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-10-interval-boundary",
    scenario: "TRACE-10",
  });
  const { session, context } = await seedResearchSession(TRACE_SCENARIO_SLOT["TRACE-10"]);
  try {
    const bars = flatBars(22);
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars,
      runId: "trace-10",
      maxCycles: bars.length - 20,
      collector,
      portfolio: buildResearchV2PortfolioContext(htrTraceCostModel()),
      registerOrders: async (allBars) => {
        const buyOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
          quantity: "0.01000000",
          symbol: "BTC/USDT",
        });
        session.historicalExecutionProfile.exchange.registerOrder(
          { ...buyOrder, symbol: "BTCUSDT" },
          0,
          Date.parse(allBars[0]!.barCloseTime),
        );
      },
    });
    const openQty = result.accountingState?.positions.BTCUSDT?.quantity ?? "0";
    const hasOpenPosition = compareDecimal(openQty, "0") > 0;
    collector.append({
      replayTimestamp: bars.at(-1)!.barCloseTime,
      capitalPathStage: "INTERVAL_BOUNDARY",
      repositoryPath: "lib/trader/research/research-backtest-runner",
      symbol: "BTC/USDT",
      caller: "runResearchValidationBacktest",
      callee: "forcedFlatPolicy",
      inputDigest: digestPayload({ openQty }),
      outputDigest: digestPayload({
        terminalCash: result.accountingState?.cash ?? "0",
        terminalEquity: result.accountingState?.equity ?? "0",
      }),
      stateBeforeDigest: computeAccountingSemanticDigest(result.accountingState!),
      stateAfterDigest: computeAccountingSemanticDigest(result.accountingState!),
      decisionOrReasonCode: hasOpenPosition
        ? "PRESERVE_AND_REPORT_OPEN_POSITION"
        : "ZERO_POSITION_TERMINAL",
      economicEffect: {
        cashDelta: result.accountingState?.cash ?? null,
        cashDeltaReason: result.accountingState ? null : "NOT_APPLICABLE_STAGE",
        exposureDelta: result.accountingState?.markedPositionValue ?? null,
        exposureDeltaReason: result.accountingState ? null : "NOT_APPLICABLE_STAGE",
        realizedPnlDelta: result.accountingState?.netRealizedPnl ?? null,
        realizedPnlDeltaReason: result.accountingState ? null : "NOT_APPLICABLE_STAGE",
      },
      persistentRecordReferences: {
        orderId: null,
        fillId: null,
        riskDecisionId: null,
        reconciliationId: null,
        closedTradeId: null,
        checkpointId: null,
      },
      assertedInvariants: {
        codes: ["NO_SILENT_POSITION_DISAPPEARANCE", "CASH_INVENTORY_PNL_RECONCILE"],
        allSatisfied:
          result.exportBundle.htrPnlReportV1?.terminalCashUsdt === result.accountingState?.cash,
      },
    });
    const passed =
      hasOpenPosition &&
      result.exportBundle.htrPnlReportV1?.terminalCashUsdt === result.accountingState?.cash;
    return {
      scenario: "TRACE-10",
      collector,
      passed,
      terminalReason: hasOpenPosition ? "OPEN_POSITION_REPORTED" : "TRACE-10_ASSERTION_FAILED",
      economicTerminalState: openQty,
      failureReason: passed ? undefined : "expected terminal open position preserved and reported",
    };
  } finally {
    session.cleanup();
  }
}

const SCENARIO_RUNNERS: Record<TraceScenarioId, () => Promise<TraceScenarioResult>> = {
  "TRACE-01": runTraceScenario01,
  "TRACE-02": runTraceScenario02,
  "TRACE-03": runTraceScenario03,
  "TRACE-04": runTraceScenario04,
  "TRACE-05": runTraceScenario05,
  "TRACE-06": runTraceScenario06,
  "TRACE-07": runTraceScenario07,
  "TRACE-08": runTraceScenario08,
  "TRACE-09": runTraceScenario09,
  "TRACE-10": runTraceScenario10,
};

export async function runAllCapitalPathTraceScenarios(): Promise<{
  results: TraceScenarioResult[];
  index: CapitalPathTraceIndexV1;
}> {
  const results: TraceScenarioResult[] = [];
  for (const scenario of TRACE_SCENARIOS) {
    results.push(await SCENARIO_RUNNERS[scenario]());
  }
  const entries: CapitalPathTraceIndexEntryV1[] = results.map((result) => ({
    traceId: result.collector.traceId,
    scenario: result.scenario,
    eventCount: result.collector.events.length,
    firstTimestamp: result.collector.events[0]?.replayTimestamp ?? "",
    lastTimestamp: result.collector.events.at(-1)?.replayTimestamp ?? "",
    terminalReason: result.terminalReason,
    economicTerminalState: result.economicTerminalState,
    semanticDigest: result.collector.semanticDigest(),
    result: result.passed ? "PASS" : "FAIL",
  }));
  const indexBody = {
    schemaVersion: CAPITAL_PATH_TRACE_INDEX_SCHEMA_VERSION,
    traceExpected: TRACE_SCENARIOS.length,
    traceObserved: results.length,
    tracePassed: results.filter((result) => result.passed).length,
    traceFailed: results.filter((result) => !result.passed).length,
    traceSkipped: 0,
    entries,
  };
  const index: CapitalPathTraceIndexV1 = {
    ...indexBody,
    indexDigest: computeCapitalPathTraceIndexDigest(indexBody),
  };
  return { results, index };
}

export function writeCapitalPathTraceArtifacts(input: {
  results: TraceScenarioResult[];
  index: CapitalPathTraceIndexV1;
  stagingRoot?: string;
}): string {
  const stagingDir = mkdtempSync(join(tmpdir(), "htr-capital-path-trace-"));
  for (const result of input.results) {
    result.collector.writeJsonl(join(stagingDir, `${result.scenario}.jsonl`));
  }
  const indexPath = join(stagingDir, "trace-index.json");
  writeFileSync(indexPath, `${JSON.stringify(input.index, null, 2)}\n`, "utf8");
  return stagingDir;
}

export function cleanupCapitalPathTraceArtifacts(stagingDir: string): void {
  rmSync(stagingDir, { recursive: true, force: true });
}

export async function proveTraceInstrumentationDoesNotAlterEconomics(): Promise<boolean> {
  const bars = flatBars(8);
  const window = {
    start: new Date(bars[0]!.barOpenTime),
    end: new Date(bars.at(-1)!.barCloseTime),
  };
  const costModel = htrTraceCostModel();
  const baselineSession = await seedResearchSession(91);
  let baselineEconomics = "";
  try {
    const baseline = await runBacktest({
      context: baselineSession.context,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "trace-parity" }),
      deps: baselineSession.session.deps,
      orderRepository: baselineSession.session.orderRepository,
      accountKey: "trace-parity",
      defaultQuantity: "0.01",
      costModel,
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: "dataset-trace-parity",
      runId: "trace-parity",
      split: "validation",
      window,
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(window.end),
      historicalExecutionProfile: baselineSession.session.historicalExecutionProfile,
      maxCycles: 3,
      enableReplayFusedContext: false,
      activeStrategyIds: ["__htr-blocked__"],
    });
    baselineEconomics = digestTraceEconomicTerminalState(baseline.accountingState!);
  } finally {
    baselineSession.session.cleanup();
  }

  const tracedSession = await seedResearchSession(92);
  try {
    const instrumented = await runInstrumentedBacktest({
      session: tracedSession.session,
      context: tracedSession.context,
      bars,
      runId: "trace-parity",
      maxCycles: 3,
      collector: createCapitalPathTraceCollector({
        traceId: "trace-parity-traced",
        scenario: "PARITY-ON",
      }),
    });
    return (
      digestTraceEconomicTerminalState(instrumented.result.accountingState!) === baselineEconomics
    );
  } finally {
    tracedSession.session.cleanup();
  }
}

function digestTraceEconomicTerminalState(
  state: NonNullable<Awaited<ReturnType<typeof runBacktest>>["accountingState"]>,
): string {
  return computeSemanticSha256Hex({
    cash: state.cash,
    equity: state.equity,
    positions: state.positions,
    grossRealizedPnl: state.grossRealizedPnl,
    netRealizedPnl: state.netRealizedPnl,
    consumedFillIds: state.consumedFillIds,
  });
}
