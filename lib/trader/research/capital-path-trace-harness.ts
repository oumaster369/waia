import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { getDb } from "@/db/client";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { normalizeAccountingStateDrawdownFields } from "@/lib/trader/accounting/accounting-frontier.types";
import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";
import { runBacktest, type RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { HTR_GUARDIAN_EXIT_REASON_V1 } from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import type { OrderRepository, OrderRow } from "@/lib/trader/execution/order-repository.types";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { declareSyntheticResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  createCapitalPathTraceCollector,
  emitCapitalPathTraceFromBacktest,
  CAPITAL_PATH_TRACE_EMPTY_STATE_DIGEST,
  type CapitalPathTraceCollector,
} from "@/lib/trader/observability/capital-path-trace-collector";
import {
  assertCapitalPathTraceStateDigestContinuity,
  computeCapitalPathTraceCheckpointComparableDigest,
  computeCapitalPathTraceIndexDigest,
  CAPITAL_PATH_TRACE_INDEX_SCHEMA_VERSION,
  type CapitalPathTraceIndexEntryV1,
  type CapitalPathTraceIndexV1,
} from "@/lib/trader/observability/capital-path-trace-event.types";
import type { BreachCancellationResultV1 } from "@/lib/trader/execution/execution-service.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import {
  createHtrInitialAccountRiskState,
  HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
} from "@/lib/trader/research/htr-initial-portfolio-contract";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";
import { DEFAULT_D20_DRAWDOWN_POLICY } from "@/lib/trader/risk/drawdown-policy.types";
import { capitalReasonCodes } from "@/lib/trader/risk/reason-codes";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { buildStrategyAttributionKey } from "@/lib/trader/risk/strategy-attribution";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
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

export type TraceScenarioMetrics = {
  eventCount: number;
  firstTimestamp: string;
  lastTimestamp: string;
  startingCash: string;
  endingCash: string;
  terminalPosition: string;
  grossPnl: string;
  netPnl: string;
  fees: string;
  spreadCost: string;
  marketImpactCost: string;
  semanticDigest: string;
};

export type TraceScenarioResult = {
  scenario: TraceScenarioId;
  collector: CapitalPathTraceCollector;
  passed: boolean;
  terminalReason: string;
  economicTerminalState: string;
  failureReason?: string;
  failedInvariants: string[];
  metrics: TraceScenarioMetrics;
  trace02GuardianStopObserved?: boolean;
  trace03CanonicalAbstentionObserved?: boolean;
  trace04ExactRiskReasonObserved?: boolean;
  drawdownVariantResults?: readonly DrawdownVariantResult[];
  trace08CapitalPathDuplicateSuppressed?: boolean;
  trace09RunnerIngressRejected?: boolean;
};

export type DrawdownVariantResult = {
  variantId: string;
  passed: boolean;
  crossed: boolean;
  drawdownBps: number;
  thresholdBps: number;
  breachState: string;
  guardianReason: string | null;
};

type TraceScenarioFlags = {
  trace02GuardianStopObserved: boolean;
  trace03CanonicalAbstentionObserved: boolean;
  trace04ExactRiskReasonObserved: boolean;
  drawdownVariantsExpected: number;
  drawdownVariantsObserved: number;
  drawdownVariantsPassed: number;
  drawdownVariantsFailed: number;
  trace08CapitalPathDuplicateSuppressed: boolean;
  trace09RunnerIngressRejected: boolean;
  perEventStateDigestsValid: boolean;
  fullEconomicNonInterference: boolean;
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

const CAPITAL_TRACE_SYNTHETIC_ISG_PROVENANCE_DIGEST = digestPayload({
  schemaVersion: "capital-trace-synthetic-isg-provenance/v1",
  scenarios: TRACE_SCENARIOS,
  split: "validation",
  executionMode: "mock",
  capitalEligible: false,
});

function syntheticCapitalTraceInformationAuthority(organizationId: string, runId: string) {
  const synthetic = declareSyntheticResearchNonCapitalInformationAuthorityV2({
    organizationId,
    harness: "CAPITAL_TRACE_SYNTHETIC",
    runId,
    provenanceDigest: CAPITAL_TRACE_SYNTHETIC_ISG_PROVENANCE_DIGEST,
    officialBlindHoldout: false,
    production: false,
    live: false,
    capitalEligible: false,
    capitalUse: false,
  });
  return {
    informationSufficiencyAuthority: synthetic.authority,
    informationSufficiencySyntheticBinding: synthetic.binding,
  };
}

function failedInvariantNames(checks: Record<string, boolean>): string[] {
  return Object.entries(checks)
    .filter(([, satisfied]) => !satisfied)
    .map(([name]) => name);
}

function allInvariantsPass(checks: Record<string, boolean>): boolean {
  return Object.values(checks).every(Boolean);
}

function buildScenarioMetrics(input: {
  collector: CapitalPathTraceCollector;
  accountingState?: AccountingStateV1 | null;
  htrPnlReport?: HtrPnlReportV1 | null;
}): TraceScenarioMetrics {
  const events = input.collector.events;
  const state = input.accountingState;
  const report = input.htrPnlReport;
  return {
    eventCount: events.length,
    firstTimestamp: events[0]?.replayTimestamp ?? "",
    lastTimestamp: events.at(-1)?.replayTimestamp ?? "",
    startingCash: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    endingCash: state?.cash ?? HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
    terminalPosition: state?.positions.BTCUSDT?.quantity ?? "0",
    grossPnl: state?.grossRealizedPnl ?? report?.grossRealizedPnlUsdt ?? "0",
    netPnl: state?.netRealizedPnl ?? report?.netRealizedPnlUsdt ?? "0",
    fees: report?.totalExecutionCostUsdt ?? "0",
    spreadCost: report?.totalExecutionCostUsdt ?? "0",
    marketImpactCost: "0",
    semanticDigest: input.collector.semanticDigest(),
  };
}

function finalizeScenarioResult(input: {
  scenario: TraceScenarioId;
  collector: CapitalPathTraceCollector;
  invariants: Record<string, boolean>;
  terminalReason: string;
  economicTerminalState: string;
  accountingState?: AccountingStateV1 | null;
  htrPnlReport?: HtrPnlReportV1 | null;
  extras?: Partial<TraceScenarioResult>;
}): TraceScenarioResult {
  const failedInvariants = failedInvariantNames(input.invariants);
  const passed = failedInvariants.length === 0;
  return {
    scenario: input.scenario,
    collector: input.collector,
    passed,
    terminalReason: passed ? input.terminalReason : `${input.scenario}_ASSERTION_FAILED`,
    economicTerminalState: input.economicTerminalState,
    failureReason: passed
      ? undefined
      : `failed invariants: ${failedInvariants.join(", ") || "unknown"}`,
    failedInvariants,
    metrics: buildScenarioMetrics({
      collector: input.collector,
      accountingState: input.accountingState,
      htrPnlReport: input.htrPnlReport,
    }),
    ...input.extras,
  };
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
  activeStrategyIds?: readonly string[];
  historicalProfile?: typeof HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1;
  windowMode?: "expanding" | "cursor";
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
      windowMode: input.windowMode,
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
    ...syntheticCapitalTraceInformationAuthority(input.context.organizationId, input.runId),
    split: "validation",
    window,
    accountState: createHtrInitialAccountRiskState(),
    exportedAt: new Date(window.end),
    historicalExecutionProfile: input.session.historicalExecutionProfile,
    maxCycles: input.maxCycles,
    enableReplayFusedContext: false,
    activeStrategyIds: input.activeStrategyIds ?? ["__htr-blocked__"],
    historicalProfile: input.historicalProfile,
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

async function buildFullEconomicObservation(input: {
  result: RunBacktestResult;
  orderRepository: OrderRepository;
  context: OrgContext;
}): Promise<unknown> {
  const orders = await input.orderRepository.listOrders(input.context, {
    executionMode: "mock",
  });
  const state = input.result.accountingState;
  const drawdownState = state ? normalizeAccountingStateDrawdownFields(state) : null;
  const lastCycle = input.result.cycleResults.at(-1);
  const strategyKey = buildStrategyAttributionKey(MEAN_REVERSION_V0, STRATEGY_VERSION);
  return {
    decisions: input.result.cycleResults.map((cycle) => ({
      terminalReasonCode:
        cycle.evaluation.intelligenceCycleBundle?.envelope.terminalReasonCode ?? null,
      decisionClass: cycle.evaluation.forecastDecisionBundle?.decision.decisionClass ?? null,
      strategyExecutionCount: cycle.strategyExecutions.length,
      riskRejectedCount: cycle.strategyExecutions.filter(
        (entry) => entry.execution?.status === "risk_rejected",
      ).length,
      submittedCount: cycle.strategyExecutions.filter(
        (entry) => entry.execution?.status === "submitted",
      ).length,
    })),
    orders: orders.map((order) => ({
      id: order.id,
      state: order.state,
      side: order.side,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      clientOrderId: order.clientOrderId,
      idempotencyKey: order.idempotencyKey,
    })),
    orderTransitionCount: orders.length,
    fillCount: state?.consumedFillIds.length ?? 0,
    consumedFillIds: state?.consumedFillIds ?? [],
    cash: state?.cash ?? "0",
    positions: state?.positions ?? {},
    grossRealizedPnl: state?.grossRealizedPnl ?? "0",
    netRealizedPnl: state?.netRealizedPnl ?? "0",
    unrealizedPnl: input.result.htrPnlReportV1?.netUnrealizedPnlUsdt ?? "0",
    equity: state?.equity ?? "0",
    accountHwm: state?.equityHwm ?? "0",
    monthlyHwm: drawdownState?.monthlyPeakHwm ?? "0",
    strategyHwm: drawdownState?.strategyPeakHwmByKey[strategyKey] ?? "0",
    accountDrawdownBps: drawdownState?.accountDrawdownBps ?? 0,
    monthlyDrawdownBps: drawdownState?.monthlyDrawdownBps ?? 0,
    strategyDrawdownBps: drawdownState?.strategyDrawdownBpsByKey[strategyKey] ?? 0,
    guardianState: lastCycle?.htrGuardian ?? null,
    reconciliation: lastCycle?.reconciliation?.counts ?? null,
    terminalReport: input.result.htrPnlReportV1 ?? null,
    checkpointState: input.result.accountingFrontierState ?? null,
    exportDigest: input.result.evidenceDigest,
  };
}

function digestFullEconomicObservation(observation: unknown): string {
  return computeSemanticSha256Hex(observation);
}

function buildEconomicsComparableDigest(input: {
  result: RunBacktestResult;
  orders: readonly OrderRow[];
}): string {
  const state = input.result.accountingState;
  const report = input.result.htrPnlReportV1;
  const drawdownState = state ? normalizeAccountingStateDrawdownFields(state) : null;
  const strategyKey = buildStrategyAttributionKey(MEAN_REVERSION_V0, STRATEGY_VERSION);
  return computeSemanticSha256Hex({
    decisions: input.result.cycleResults.map((cycle) => ({
      terminalReasonCode:
        cycle.evaluation.intelligenceCycleBundle?.envelope.terminalReasonCode ?? null,
      decisionClass: cycle.evaluation.forecastDecisionBundle?.decision.decisionClass ?? null,
      strategyExecutionCount: cycle.strategyExecutions.length,
      riskRejectedCount: cycle.strategyExecutions.filter(
        (entry) => entry.execution?.status === "risk_rejected",
      ).length,
      submittedCount: cycle.strategyExecutions.filter(
        (entry) => entry.execution?.status === "submitted",
      ).length,
    })),
    orders: [...input.orders]
      .map((order) => ({
        state: order.state,
        side: order.side,
        quantity: order.quantity,
        filledQuantity: order.filledQuantity,
      }))
      .sort((left, right) =>
        `${left.side}:${left.state}`.localeCompare(`${right.side}:${right.state}`),
      ),
    fillCount: state?.consumedFillIds.length ?? 0,
    cash: state?.cash ?? "0",
    positions: state?.positions ?? {},
    grossRealizedPnl: state?.grossRealizedPnl ?? "0",
    netRealizedPnl: state?.netRealizedPnl ?? "0",
    unrealizedPnl: report?.netUnrealizedPnlUsdt ?? "0",
    equity: state?.equity ?? "0",
    accountHwm: state?.equityHwm ?? "0",
    monthlyHwm: drawdownState?.monthlyPeakHwm ?? "0",
    strategyHwm: drawdownState?.strategyPeakHwmByKey[strategyKey] ?? "0",
    accountDrawdownBps: drawdownState?.accountDrawdownBps ?? 0,
    monthlyDrawdownBps: drawdownState?.monthlyDrawdownBps ?? 0,
    strategyDrawdownBps: drawdownState?.strategyDrawdownBpsByKey[strategyKey] ?? 0,
    guardianState: input.result.cycleResults.at(-1)?.htrGuardian ?? null,
    reconciliation: input.result.cycleResults.at(-1)?.reconciliation?.counts ?? null,
    terminalReport: report
      ? {
          terminalCashUsdt: report.terminalCashUsdt,
          terminalEquityUsdt: report.terminalEquityUsdt,
          grossRealizedPnlUsdt: report.grossRealizedPnlUsdt,
          netRealizedPnlUsdt: report.netRealizedPnlUsdt,
          totalExecutionCostUsdt: report.totalExecutionCostUsdt,
          accountDrawdownBps: report.accountDrawdownBps,
        }
      : null,
    checkpointSequence: input.result.accountingFrontierState?.accountingSequence ?? null,
  });
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
      ...syntheticCapitalTraceInformationAuthority(context.organizationId, "trace-01"),
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
    const invariants = {
      ENTRY_AND_EXIT_FILLS: (result.accountingState?.consumedFillIds.length ?? 0) >= 2,
      POSITIVE_NET_REALIZED_PNL:
        compareDecimal(result.accountingState?.netRealizedPnl ?? "0", "0") > 0,
      POSITIVE_GROSS_REALIZED_PNL:
        compareDecimal(result.accountingState?.grossRealizedPnl ?? "0", "0") > 0,
    };
    return finalizeScenarioResult({
      scenario: "TRACE-01",
      collector,
      invariants,
      terminalReason: "PROFITABLE_CLOSED_TRADE",
      economicTerminalState: result.accountingState?.netRealizedPnl ?? "0",
      accountingState: result.accountingState,
      htrPnlReport: result.htrPnlReportV1,
    });
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
    const bars = barsForDrawdownCursorScenario({
      preBreachClose: "80000.00",
      breachClose: "28000.00",
      breachFromPhysicalIndex: 23,
      totalBars: 28,
    });
    const buyOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.50000000",
      symbol: "BTC/USDT",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...buyOrder, symbol: "BTCUSDT" },
      0,
      Date.parse(bars[0]!.barCloseTime),
    );
    const sellOrder = await createAcceptedMarketOrder(session.orderRepository, context, {
      quantity: "0.50000000",
      symbol: "BTC/USDT",
      side: "sell",
    });
    session.historicalExecutionProfile.exchange.registerOrder(
      { ...sellOrder, symbol: "BTCUSDT" },
      6,
      Date.parse(bars[6]!.barCloseTime),
    );
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars,
      runId: "trace-02",
      maxCycles: 8,
      collector,
    });
    // Strategy DD limit (2000 bps) is tighter than account (2500); with correct HWM updates
    // the first STOP_ACCOUNT may be strategy before account — both are valid losing stops.
    const acceptedGuardianStopReasons = new Set<string>([
      HTR_GUARDIAN_EXIT_REASON_V1.accountStop,
      HTR_GUARDIAN_EXIT_REASON_V1.accountDrawdownBreach,
      HTR_GUARDIAN_EXIT_REASON_V1.strategyDrawdownBreach,
      HTR_GUARDIAN_EXIT_REASON_V1.monthlyDrawdownBreach,
    ]);
    const stopCycle = result.cycleResults.find(
      (cycle) =>
        cycle.htrGuardian?.breachState === "STOP_ACCOUNT" &&
        cycle.htrGuardian.reason != null &&
        acceptedGuardianStopReasons.has(cycle.htrGuardian.reason),
    );
    const guardianReason = stopCycle?.htrGuardian?.reason ?? null;
    const guardianStopEvent = collector.events.find(
      (event) =>
        event.capitalPathStage === "GUARDIAN_CYCLE" &&
        event.decisionOrReasonCode === guardianReason,
    );
    const invariants = {
      ACTIONABLE_ENTRY_FILL: (result.accountingState?.consumedFillIds.length ?? 0) >= 1,
      GUARDIAN_STOP_DECISION: stopCycle?.htrGuardian?.breachState === "STOP_ACCOUNT",
      GUARDIAN_REASON: guardianReason != null && acceptedGuardianStopReasons.has(guardianReason),
      GUARDIAN_TRACE_REASON: guardianStopEvent != null,
      EXIT_FILL: (result.accountingState?.consumedFillIds.length ?? 0) >= 2,
      ZERO_TERMINAL_POSITION:
        compareDecimal(result.accountingState?.positions.BTCUSDT?.quantity ?? "0", "0") === 0,
      NEGATIVE_GROSS_PNL: compareDecimal(result.accountingState?.grossRealizedPnl ?? "0", "0") < 0,
      NEGATIVE_NET_PNL: compareDecimal(result.accountingState?.netRealizedPnl ?? "0", "0") < 0,
      D5_COSTS_INCLUDED:
        compareDecimal(result.htrPnlReportV1?.totalExecutionCostUsdt ?? "0", "0") > 0,
    };
    return finalizeScenarioResult({
      scenario: "TRACE-02",
      collector,
      invariants,
      terminalReason: guardianReason ?? "LOSING_GUARDIAN_STOP",
      economicTerminalState: result.accountingState?.netRealizedPnl ?? "0",
      accountingState: result.accountingState,
      htrPnlReport: result.htrPnlReportV1,
      extras: {
        trace02GuardianStopObserved:
          stopCycle?.htrGuardian?.breachState === "STOP_ACCOUNT" &&
          guardianReason != null &&
          guardianStopEvent != null,
      },
    });
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
    const bars = flatBars(30, "65000.00");
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars,
      runId: "trace-03",
      maxCycles: 8,
      collector,
      activeStrategyIds: [MEAN_REVERSION_V0],
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    });
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    const abstainCycle = result.cycleResults.find((cycle) => {
      const decision = cycle.evaluation.forecastDecisionBundle?.decision;
      return (
        decision?.decisionClass === "NO_TRADE" &&
        (decision.whyNotCashJson != null || decision.whyCashOrAbstainJson != null)
      );
    });
    const decision = abstainCycle?.evaluation.forecastDecisionBundle?.decision;
    const explanationPresent = Boolean(
      decision?.whyNotCashJson != null || decision?.whyCashOrAbstainJson != null,
    );
    const invariants = {
      VALID_DATA_ACCEPTED: result.cycleResults.length > 0,
      INTELLIGENCE_CYCLE_EXECUTED: result.cycleResults.some(
        (cycle) => cycle.evaluation.features != null,
      ),
      CANONICAL_NO_TRADE_DECISION: decision?.decisionClass === "NO_TRADE",
      EXPLANATION_POPULATED: explanationPresent,
      ZERO_ORDERS: orders.length === 0,
      ZERO_FILLS: (result.accountingState?.consumedFillIds.length ?? 0) === 0,
      ZERO_CASH_MUTATION:
        compareDecimal(
          result.accountingState?.cash ?? "0",
          HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
        ) === 0,
      ZERO_EXPOSURE: compareDecimal(result.accountingState?.markedPositionValue ?? "0", "0") === 0,
    };
    return finalizeScenarioResult({
      scenario: "TRACE-03",
      collector,
      invariants,
      terminalReason: decision?.universalTerminalReasonCode ?? "NO_TRADE",
      economicTerminalState:
        result.accountingState?.cash ?? HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
      accountingState: result.accountingState,
      htrPnlReport: result.htrPnlReportV1,
      extras: {
        trace03CanonicalAbstentionObserved:
          decision?.decisionClass === "NO_TRADE" && explanationPresent,
      },
    });
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
      ...syntheticCapitalTraceInformationAuthority(context.organizationId, "trace-04"),
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
    const riskRejectedExecution = result.cycleResults
      .flatMap((cycle) => cycle.strategyExecutions)
      .find((entry) => entry.execution?.status === "risk_rejected");
    const exactRiskReason =
      riskRejectedExecution?.execution?.status === "risk_rejected"
        ? riskRejectedExecution.execution.riskDecision.decision.reasonCodes.includes(
            capitalReasonCodes.maxOpenOrdersExceeded,
          )
        : false;
    const riskEvent = collector.events.find(
      (event) =>
        event.capitalPathStage === "RISK_REJECTION" &&
        event.decisionOrReasonCode === capitalReasonCodes.maxOpenOrdersExceeded,
    );
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    const invariants = {
      ACTIONABLE_SIGNAL: result.cycleResults.some((cycle) => cycle.evaluation.signals.length > 0),
      RISK_ENGINE_REACHED: riskRejectedExecution != null,
      EXACT_RISK_MAX_OPEN_ORDERS: exactRiskReason,
      TRACE_EVENT_REASON_CODE: riskEvent != null,
      NO_NEW_ORDER: orders.length === 1,
      NO_FILL: (result.accountingState?.consumedFillIds.length ?? 0) === 0,
      NO_EXPOSURE: compareDecimal(result.accountingState?.markedPositionValue ?? "0", "0") === 0,
      NO_PNL_DELTA: compareDecimal(result.accountingState?.netRealizedPnl ?? "0", "0") === 0,
    };
    return finalizeScenarioResult({
      scenario: "TRACE-04",
      collector,
      invariants,
      terminalReason: capitalReasonCodes.maxOpenOrdersExceeded,
      economicTerminalState: String(orders.length),
      accountingState: result.accountingState,
      htrPnlReport: result.htrPnlReportV1,
      extras: { trace04ExactRiskReasonObserved: exactRiskReason && riskEvent != null },
    });
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
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars,
      runId: "trace-05",
      maxCycles: 26,
      collector,
    });
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    const partialOrder = orders.find((row) => row.id === entryOrder.id);
    const breachCancellation = findBreachCancellation(
      result.cycleResults as CycleWithBreachCancellation[],
    );
    const partialFillObserved =
      result.htrRuntimeCallOrder?.some((event) => event.kind === "WP17_FILL_CONSUMED") === true;
    const guardianPartialCancel = result.cycleResults.some(
      (cycle) => cycle.htrGuardian?.cancelPartialEntry === true,
    );
    const invariants = {
      PARTIAL_FILL_RUNTIME: partialFillObserved,
      GUARDIAN_PARTIAL_CANCEL_ARMED: guardianPartialCancel,
      BREACH_CANCELLATION: breachCancellation != null,
      RUNTIME_BREACH_CANCELLATION:
        result.htrRuntimeCallOrder?.some(
          (event) => event.kind === "WP20_BREACH_CANCELLATION_EXECUTED",
        ) === true,
      OPEN_ENTRY_ORDER_PRESENT: partialOrder != null,
    };
    return finalizeScenarioResult({
      scenario: "TRACE-05",
      collector,
      invariants,
      terminalReason: "PARTIAL_BREACH_HANDLED",
      economicTerminalState: result.accountingState?.netRealizedPnl ?? "0",
      accountingState: result.accountingState,
      htrPnlReport: result.htrPnlReportV1,
    });
  } finally {
    session.cleanup();
  }
}

async function runDrawdownDomainVariant(input: {
  collector: CapitalPathTraceCollector;
  scenarioSlot: number;
  variantId: string;
  domain: "account" | "monthly" | "strategy";
  expectCross: boolean;
  bars: Bar[];
  maxCycles: number;
  registerOrders?: (input: {
    session: Awaited<ReturnType<typeof seedResearchSession>>["session"];
    context: OrgContext;
    bars: Bar[];
  }) => Promise<void>;
}): Promise<DrawdownVariantResult> {
  const thresholdBps =
    input.domain === "account"
      ? DEFAULT_D20_DRAWDOWN_POLICY.accountBps
      : input.domain === "monthly"
        ? DEFAULT_D20_DRAWDOWN_POLICY.monthlyBps
        : DEFAULT_D20_DRAWDOWN_POLICY.strategyBps;
  const { session, context } = await seedResearchSession(input.scenarioSlot);
  try {
    if (input.collector.events.length > 0) {
      input.collector.append({
        replayTimestamp: input.bars[0]!.barOpenTime,
        capitalPathStage: "CHECKPOINT",
        repositoryPath: "lib/trader/research/capital-path-trace-harness",
        symbol: "BTC/USDT",
        caller: "runDrawdownDomainVariant",
        callee: "variantBoundary",
        inputDigest: digestPayload({ variantId: input.variantId }),
        outputDigest: CAPITAL_PATH_TRACE_EMPTY_STATE_DIGEST,
        stateBeforeDigest: input.collector.events.at(-1)!.stateAfterDigest,
        stateAfterDigest: CAPITAL_PATH_TRACE_EMPTY_STATE_DIGEST,
        decisionOrReasonCode: input.variantId,
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
          checkpointId: input.variantId,
          decisionRecordId: null,
        },
        assertedInvariants: {
          codes: ["INDEPENDENT_VARIANT_BOUNDARY"],
          allSatisfied: true,
        },
      });
    }
    if (input.registerOrders) {
      await input.registerOrders({ session, context, bars: input.bars });
    }
    const { result } = await runInstrumentedBacktest({
      session,
      context,
      bars: input.bars,
      runId: `trace-06-${input.variantId.toLowerCase()}`,
      maxCycles: input.maxCycles,
      collector: input.collector,
    });
    const drawdownState = result.accountingState
      ? normalizeAccountingStateDrawdownFields(result.accountingState)
      : null;
    const strategyKey = buildStrategyAttributionKey(MEAN_REVERSION_V0, STRATEGY_VERSION);
    const drawdownBps =
      input.domain === "account"
        ? (drawdownState?.accountDrawdownBps ?? 0)
        : input.domain === "monthly"
          ? (drawdownState?.monthlyDrawdownBps ?? 0)
          : (drawdownState?.strategyDrawdownBpsByKey[strategyKey] ?? 0);
    const guardian = resolveTerminalGuardian(result.cycleResults);
    const crossed = drawdownBps >= thresholdBps;
    const runtimeDrawdownEvents =
      result.htrRuntimeCallOrder?.filter(
        (event) =>
          event.kind === "WP20_DRAWDOWN_PERSISTED" || event.kind === "WP20_GUARDIAN_EVALUATED",
      ).length ?? 0;
    const passed = input.expectCross
      ? crossed && (guardian?.breachState ?? "NONE") !== "NONE" && runtimeDrawdownEvents > 0
      : drawdownBps < thresholdBps &&
        (guardian?.breachState ?? "NONE") === "NONE" &&
        runtimeDrawdownEvents >= 0;
    return {
      variantId: input.variantId,
      passed,
      crossed,
      drawdownBps,
      thresholdBps,
      breachState: guardian?.breachState ?? "NONE",
      guardianReason: guardian?.reason ?? null,
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
  const registerEntry = async (input: {
    session: Awaited<ReturnType<typeof seedResearchSession>>["session"];
    context: OrgContext;
    bars: Bar[];
  }) => {
    const buyOrder = await createAcceptedMarketOrder(input.session.orderRepository, input.context, {
      quantity: "0.50000000",
      symbol: "BTC/USDT",
    });
    input.session.historicalExecutionProfile.exchange.registerOrder(
      { ...buyOrder, symbol: "BTCUSDT" },
      0,
      Date.parse(input.bars[0]!.barCloseTime),
    );
  };
  const variantResults: DrawdownVariantResult[] = [];
  variantResults.push(
    await runDrawdownDomainVariant({
      collector,
      scenarioSlot: TRACE_SCENARIO_SLOT["TRACE-06"] * 10 + 1,
      variantId: "TRACE-06-A-NO-CROSS",
      domain: "account",
      expectCross: false,
      bars: flatBars(28, "65000.00"),
      maxCycles: 6,
    }),
  );
  variantResults.push(
    await runDrawdownDomainVariant({
      collector,
      scenarioSlot: TRACE_SCENARIO_SLOT["TRACE-06"] * 10 + 2,
      variantId: "TRACE-06-A-CROSS",
      domain: "account",
      expectCross: true,
      bars: barsForDrawdownCursorScenario({
        preBreachClose: "80000.00",
        breachClose: "28000.00",
        breachFromPhysicalIndex: 23,
        totalBars: 28,
      }),
      maxCycles: 10,
      registerOrders: registerEntry,
    }),
  );
  variantResults.push(
    await runDrawdownDomainVariant({
      collector,
      scenarioSlot: TRACE_SCENARIO_SLOT["TRACE-06"] * 10 + 3,
      variantId: "TRACE-06-M-NO-CROSS",
      domain: "monthly",
      expectCross: false,
      bars: flatBars(28, "64000.00"),
      maxCycles: 6,
    }),
  );
  variantResults.push(
    await runDrawdownDomainVariant({
      collector,
      scenarioSlot: TRACE_SCENARIO_SLOT["TRACE-06"] * 10 + 4,
      variantId: "TRACE-06-M-CROSS",
      domain: "monthly",
      expectCross: true,
      bars: barsForDrawdownCursorScenario({
        preBreachClose: "80000.00",
        breachClose: "28000.00",
        breachFromPhysicalIndex: 23,
        totalBars: 28,
      }),
      maxCycles: 10,
      registerOrders: registerEntry,
    }),
  );
  variantResults.push(
    await runDrawdownDomainVariant({
      collector,
      scenarioSlot: TRACE_SCENARIO_SLOT["TRACE-06"] * 10 + 5,
      variantId: "TRACE-06-S-NO-CROSS",
      domain: "strategy",
      expectCross: false,
      bars: flatBars(28, "64500.00"),
      maxCycles: 6,
    }),
  );
  variantResults.push(
    await runDrawdownDomainVariant({
      collector,
      scenarioSlot: TRACE_SCENARIO_SLOT["TRACE-06"] * 10 + 6,
      variantId: "TRACE-06-S-CROSS",
      domain: "strategy",
      expectCross: true,
      bars: barsForDrawdownCursorScenario({
        preBreachClose: "80000.00",
        breachClose: "28000.00",
        breachFromPhysicalIndex: 23,
        totalBars: 28,
      }),
      maxCycles: 10,
      registerOrders: registerEntry,
    }),
  );
  const invariants = Object.fromEntries(
    variantResults.map((variant) => [variant.variantId, variant.passed]),
  );
  return finalizeScenarioResult({
    scenario: "TRACE-06",
    collector,
    invariants,
    terminalReason: "DRAWDOWN_DOMAINS_TRACED",
    economicTerminalState: String(variantResults.filter((variant) => variant.passed).length),
    extras: { drawdownVariantResults: variantResults },
  });
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
      ...syntheticCapitalTraceInformationAuthority(
        uninterruptedSession.context.organizationId,
        "trace-07",
      ),
      deps: uninterruptedSession.session.deps,
      orderRepository: uninterruptedSession.session.orderRepository,
      accountKey: "trace-07",
      historicalExecutionProfile: uninterruptedSession.session.historicalExecutionProfile,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix }),
      maxCycles: 6,
    });
    uninterruptedAccountingDigest = computeAccountingSemanticDigest(uninterrupted.accountingState!);
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
      ...syntheticCapitalTraceInformationAuthority(
        checkpointSession.context.organizationId,
        "trace-07",
      ),
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
    resumedAccountingDigest = computeAccountingSemanticDigest(resumed.accountingState!);
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
      decisionRecordId: null,
    },
    assertedInvariants: {
      codes: ["TRACE_DIGEST_PARITY", "ACCOUNTING_DIGEST_PARITY"],
      allSatisfied: digestMatch && accountingMatch,
    },
  });
  const passed = digestMatch && accountingMatch;
  return finalizeScenarioResult({
    scenario: "TRACE-07",
    collector: uninterruptedCollector,
    invariants: {
      TRACE_DIGEST_PARITY: digestMatch,
      ACCOUNTING_DIGEST_PARITY: accountingMatch,
    },
    terminalReason: passed ? "CHECKPOINT_RESUME_PARITY" : "TRACE-07_ASSERTION_FAILED",
    economicTerminalState: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
  });
}

async function runTrace08CapitalPathRun(input: {
  duplicateRetry: boolean;
  runId: string;
}): Promise<{
  observationDigest: string;
  firstOrderId: string | null;
  retryOrderId: string | null;
  orderCount: number;
  consumedFillCount: number;
}> {
  const { session, context } = await seedResearchSession(
    input.duplicateRetry
      ? TRACE_SCENARIO_SLOT["TRACE-08"] * 10 + 2
      : TRACE_SCENARIO_SLOT["TRACE-08"] * 10 + 1,
  );
  const bars = flatBars(10, "65000.00");
  const idempotencyKey = "trace-08-capital-path-idem";
  const clientOrderId = "trace-08-capital-path-client";
  let firstOrderId: string | null = null;
  let retryOrderId: string | null = null;
  try {
    const submitBase = {
      clientOrderId,
      idempotencyKey,
      executionMode: "mock" as const,
      symbol: "BTC/USDT",
      side: "buy" as const,
      type: "market" as const,
      quantity: "0.01000000",
      referencePrice: "65000.00",
      accountKey: input.runId,
      accountState: createHtrInitialAccountRiskState(),
      strategySignalId: MEAN_REVERSION_V0,
    };
    const firstSubmit = await session.deps.execution.submitOrder(context, submitBase);
    if (firstSubmit.status === "submitted") {
      firstOrderId = firstSubmit.order.id;
    }
    if (input.duplicateRetry) {
      const retrySubmit = await session.deps.execution.submitOrder(context, submitBase);
      if (retrySubmit.status === "submitted") {
        retryOrderId = retrySubmit.order.id;
      }
    }
    const window = {
      start: new Date(bars[0]!.barOpenTime),
      end: new Date(bars.at(-1)!.barCloseTime),
    };
    const result = await runBacktest({
      context,
      barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: input.runId }),
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: input.runId,
      defaultQuantity: "0.01",
      costModel: htrTraceCostModel(),
      strategySignalIds: [MEAN_REVERSION_V0],
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: STRATEGY_VERSION,
      regimeLabel: "AGGREGATE",
      datasetId: `dataset-${input.runId}`,
      runId: input.runId,
      ...syntheticCapitalTraceInformationAuthority(context.organizationId, input.runId),
      split: "validation",
      window,
      accountState: createHtrInitialAccountRiskState(),
      exportedAt: new Date(window.end),
      historicalExecutionProfile: session.historicalExecutionProfile,
      maxCycles: 4,
      enableReplayFusedContext: false,
      activeStrategyIds: ["__htr-blocked__"],
    });
    const orders = await session.orderRepository.listOrders(context, { executionMode: "mock" });
    return {
      observationDigest: buildEconomicsComparableDigest({ result, orders }),
      firstOrderId,
      retryOrderId,
      orderCount: orders.length,
      consumedFillCount: result.accountingState?.consumedFillIds.length ?? 0,
    };
  } finally {
    session.cleanup();
  }
}

export async function runTraceScenario08(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-08-idempotency",
    scenario: "TRACE-08",
  });
  const control = await runTrace08CapitalPathRun({
    duplicateRetry: false,
    runId: "trace-08-control",
  });
  const duplicate = await runTrace08CapitalPathRun({
    duplicateRetry: true,
    runId: "trace-08-duplicate",
  });
  const controlDigest = control.observationDigest;
  const duplicateDigest = duplicate.observationDigest;
  const suppressionReason =
    duplicate.firstOrderId != null &&
    duplicate.retryOrderId != null &&
    duplicate.firstOrderId === duplicate.retryOrderId
      ? "IDEMPOTENT_RETURN"
      : "DUPLICATE_NOT_SUPPRESSED";
  collector.append({
    replayTimestamp: "2026-01-01T00:00:08.000Z",
    capitalPathStage: "IDEMPOTENCY",
    repositoryPath: "lib/trader/execution/order-execution-service",
    symbol: "BTC/USDT",
    caller: "runTraceScenario08",
    callee: "OrderExecutionService.submitOrder",
    inputDigest: digestPayload({
      idempotencyKey: "trace-08-capital-path-idem",
      duplicateRetry: true,
    }),
    outputDigest: digestPayload({
      firstOrderId: duplicate.firstOrderId,
      retryOrderId: duplicate.retryOrderId,
      controlDigest,
      duplicateDigest,
    }),
    stateBeforeDigest: controlDigest,
    stateAfterDigest: duplicateDigest,
    decisionOrReasonCode: suppressionReason,
    economicEffect: {
      cashDelta: null,
      cashDeltaReason: "NO_ECONOMIC_MUTATION",
      exposureDelta: null,
      exposureDeltaReason: "NO_ECONOMIC_MUTATION",
      realizedPnlDelta: null,
      realizedPnlDeltaReason: "NO_ECONOMIC_MUTATION",
    },
    persistentRecordReferences: {
      orderId: duplicate.retryOrderId,
      fillId: null,
      riskDecisionId: null,
      reconciliationId: null,
      closedTradeId: null,
      checkpointId: null,
      decisionRecordId: null,
    },
    assertedInvariants: {
      codes: ["CAPITAL_PATH_DUPLICATE_SUPPRESSED", "CONTROL_DIGEST_MATCH"],
      allSatisfied: suppressionReason === "IDEMPOTENT_RETURN" && controlDigest === duplicateDigest,
    },
  });
  const invariants = {
    DUPLICATE_RETRY_REACHED: duplicate.retryOrderId != null,
    SAME_IDEMPOTENCY_IDENTITY:
      duplicate.firstOrderId != null &&
      duplicate.retryOrderId != null &&
      duplicate.firstOrderId === duplicate.retryOrderId,
    SINGLE_ORDER_RECORD: duplicate.orderCount === 1,
    CONTROL_DIGEST_MATCH: controlDigest === duplicateDigest,
    NO_DUPLICATE_FILL: control.consumedFillCount === duplicate.consumedFillCount,
    SUPPRESSION_REASON_CAPTURED: suppressionReason === "IDEMPOTENT_RETURN",
  };
  return finalizeScenarioResult({
    scenario: "TRACE-08",
    collector,
    invariants,
    terminalReason: suppressionReason,
    economicTerminalState: String(duplicate.orderCount),
    extras: { trace08CapitalPathDuplicateSuppressed: suppressionReason === "IDEMPOTENT_RETURN" },
  });
}

export async function runTraceScenario09(): Promise<TraceScenarioResult> {
  const collector = createCapitalPathTraceCollector({
    traceId: "trace-09-invalid-data",
    scenario: "TRACE-09",
  });
  const bars = flatBars(20);
  const malformed = [...bars];
  malformed[10] = { ...malformed[10]!, volume: "-1.00" };
  let reasonCode = "UNKNOWN";
  let runnerConstructed = false;
  try {
    new HistoricalBarReplaySource({ bars: malformed, cycleIdPrefix: "trace-09" });
    runnerConstructed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = message.match(/\[market-data\] ([A-Z0-9_]+):/);
    reasonCode = match?.[1] ?? "UNKNOWN";
  }
  collector.append({
    replayTimestamp: malformed[10]!.barCloseTime,
    capitalPathStage: "DATA_TRUTH_REJECTION",
    repositoryPath: "lib/trader/market-data/historical-bar-replay-source",
    symbol: "BTC/USDT",
    caller: "runBacktest",
    callee: "HistoricalBarReplaySource.constructor",
    inputDigest: digestPayload({ barIndex: 10, volume: malformed[10]!.volume }),
    outputDigest: digestPayload({ reasonCode, runnerConstructed }),
    stateBeforeDigest: CAPITAL_PATH_TRACE_EMPTY_STATE_DIGEST,
    stateAfterDigest: CAPITAL_PATH_TRACE_EMPTY_STATE_DIGEST,
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
      decisionRecordId: null,
    },
    assertedInvariants: {
      codes: [
        "RUNNER_INGRESS_REJECTED",
        "NO_INTELLIGENCE_CYCLE",
        "NO_DECISION",
        "NO_ORDER",
        "NO_CAPITAL_MUTATION",
      ],
      allSatisfied: reasonCode !== "UNKNOWN" && !runnerConstructed,
    },
  });
  const invariants = {
    RUNNER_INGRESS_ATTEMPTED: true,
    RUNNER_CONSTRUCTION_REJECTED: !runnerConstructed,
    EXACT_INGRESS_REASON: reasonCode === "HTR_WP12_INGRESS_NEGATIVE_VOLUME",
    ZERO_DOWNSTREAM_STAGES: !collector.events.some((event) =>
      ["INTELLIGENCE", "DECISION", "RISK_EVALUATION", "ORDER_SUBMIT"].includes(
        event.capitalPathStage,
      ),
    ),
  };
  return finalizeScenarioResult({
    scenario: "TRACE-09",
    collector,
    invariants,
    terminalReason: reasonCode,
    economicTerminalState: "REJECTED_PRE_INTELLIGENCE",
    extras: { trace09RunnerIngressRejected: reasonCode === "HTR_WP12_INGRESS_NEGATIVE_VOLUME" },
  });
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
        decisionRecordId: null,
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
    return finalizeScenarioResult({
      scenario: "TRACE-10",
      collector,
      invariants: {
        OPEN_POSITION_PRESERVED: hasOpenPosition,
        TERMINAL_CASH_RECONCILED:
          result.exportBundle.htrPnlReportV1?.terminalCashUsdt === result.accountingState?.cash,
      },
      terminalReason: hasOpenPosition ? "OPEN_POSITION_REPORTED" : "TRACE-10_ASSERTION_FAILED",
      economicTerminalState: openQty,
      accountingState: result.accountingState,
      htrPnlReport: result.htrPnlReportV1,
    });
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
  flags: TraceScenarioFlags;
}> {
  const results: TraceScenarioResult[] = [];
  for (const scenario of TRACE_SCENARIOS) {
    results.push(await SCENARIO_RUNNERS[scenario]());
  }

  const traceIds = results.map((result) => result.collector.traceId);
  const uniqueTraceIds = new Set(traceIds).size;
  const drawdownVariantResults =
    results.find((result) => result.scenario === "TRACE-06")?.drawdownVariantResults ?? [];
  const perEventStateDigestsValid = results.every((result) =>
    assertCapitalPathTraceStateDigestContinuity(result.collector.events),
  );

  const entries: CapitalPathTraceIndexEntryV1[] = results.map((result) => ({
    traceId: result.collector.traceId,
    scenario: result.scenario,
    eventCount: result.metrics.eventCount,
    firstTimestamp: result.metrics.firstTimestamp,
    lastTimestamp: result.metrics.lastTimestamp,
    terminalReason: result.terminalReason,
    startingCash: result.metrics.startingCash,
    endingCash: result.metrics.endingCash,
    terminalPosition: result.metrics.terminalPosition,
    grossPnl: result.metrics.grossPnl,
    netPnl: result.metrics.netPnl,
    fees: result.metrics.fees,
    spreadCost: result.metrics.spreadCost,
    marketImpactCost: result.metrics.marketImpactCost,
    semanticDigest: result.metrics.semanticDigest,
    result: result.passed ? "PASS" : "FAIL",
    failedInvariants: result.failedInvariants,
  }));

  const fullEconomicNonInterference = await proveTraceInstrumentationDoesNotAlterEconomics();

  const flags: TraceScenarioFlags = {
    trace02GuardianStopObserved: results.some(
      (result) => result.trace02GuardianStopObserved === true,
    ),
    trace03CanonicalAbstentionObserved: results.some(
      (result) => result.trace03CanonicalAbstentionObserved === true,
    ),
    trace04ExactRiskReasonObserved: results.some(
      (result) => result.trace04ExactRiskReasonObserved === true,
    ),
    drawdownVariantsExpected: 6,
    drawdownVariantsObserved: drawdownVariantResults.length,
    drawdownVariantsPassed: drawdownVariantResults.filter((variant) => variant.passed).length,
    drawdownVariantsFailed: drawdownVariantResults.filter((variant) => !variant.passed).length,
    trace08CapitalPathDuplicateSuppressed: results.some(
      (result) => result.trace08CapitalPathDuplicateSuppressed === true,
    ),
    trace09RunnerIngressRejected: results.some(
      (result) => result.trace09RunnerIngressRejected === true,
    ),
    perEventStateDigestsValid,
    fullEconomicNonInterference,
  };

  const indexBody = {
    schemaVersion: CAPITAL_PATH_TRACE_INDEX_SCHEMA_VERSION,
    traceExpected: TRACE_SCENARIOS.length,
    traceObserved: results.length,
    tracePassed: results.filter((result) => result.passed).length,
    traceFailed: results.filter((result) => !result.passed).length,
    traceSkipped: 0,
    uniqueTraceIds,
    duplicateTraceIds: traceIds.length - uniqueTraceIds,
    trace02GuardianStopObserved: flags.trace02GuardianStopObserved,
    trace03CanonicalAbstentionObserved: flags.trace03CanonicalAbstentionObserved,
    trace04ExactRiskReasonObserved: flags.trace04ExactRiskReasonObserved,
    drawdownVariantsExpected: flags.drawdownVariantsExpected,
    drawdownVariantsObserved: flags.drawdownVariantsObserved,
    drawdownVariantsPassed: flags.drawdownVariantsPassed,
    drawdownVariantsFailed: flags.drawdownVariantsFailed,
    trace08CapitalPathDuplicateSuppressed: flags.trace08CapitalPathDuplicateSuppressed,
    trace09RunnerIngressRejected: flags.trace09RunnerIngressRejected,
    perEventStateDigestsValid: flags.perEventStateDigestsValid,
    fullEconomicNonInterference: flags.fullEconomicNonInterference,
    entries,
  };
  const index: CapitalPathTraceIndexV1 = {
    ...indexBody,
    indexDigest: computeCapitalPathTraceIndexDigest(indexBody),
  };
  return { results, index, flags };
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

  async function runBaseline(traced: boolean): Promise<string> {
    const slot = traced ? 92 : 91;
    const seeded = await seedResearchSession(slot);
    try {
      const collector = traced
        ? createCapitalPathTraceCollector({
            traceId: "trace-parity-traced",
            scenario: "PARITY-ON",
          })
        : null;
      const result = await runBacktest({
        context: seeded.context,
        barSource: new HistoricalBarReplaySource({ bars, cycleIdPrefix: "trace-parity" }),
        deps: seeded.session.deps,
        orderRepository: seeded.session.orderRepository,
        accountKey: "trace-parity",
        defaultQuantity: "0.01",
        costModel,
        strategySignalIds: [MEAN_REVERSION_V0],
        strategyId: MEAN_REVERSION_V0,
        strategyVersion: STRATEGY_VERSION,
        regimeLabel: "AGGREGATE",
        datasetId: "dataset-trace-parity",
        runId: "trace-parity",
        ...syntheticCapitalTraceInformationAuthority(
          seeded.context.organizationId,
          "trace-parity",
        ),
        split: "validation",
        window,
        accountState: createHtrInitialAccountRiskState(),
        exportedAt: new Date(window.end),
        historicalExecutionProfile: seeded.session.historicalExecutionProfile,
        maxCycles: 3,
        enableReplayFusedContext: false,
        activeStrategyIds: ["__htr-blocked__"],
      });
      if (collector) {
        emitCapitalPathTraceFromBacktest({
          collector,
          cycleResults: result.cycleResults,
          accountingState: result.accountingState,
          barTimestamps: barTimestamps(bars),
        });
      }
      const orders = await seeded.session.orderRepository.listOrders(seeded.context, {
        executionMode: "mock",
      });
      return buildEconomicsComparableDigest({ result, orders });
    } finally {
      seeded.session.cleanup();
    }
  }

  const baselineA = await runBaseline(false);
  const tracedA = await runBaseline(true);
  const baselineB = await runBaseline(false);
  const tracedB = await runBaseline(true);
  return baselineA === tracedA && baselineB === tracedB && baselineA === baselineB;
}
