import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import { COST_MODEL_VERSION_V1 } from "@/lib/trader/execution/cost-model";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import { runBacktest } from "@/lib/trader/backtest/backtest-runner";
import type { HistoricalExecutionProfileV1 } from "@/lib/trader/backtest/historical-execution-profile";
import {
  StreamingEvidenceError,
  StreamingRegimeTimelineReader,
  type ReplayEvidenceSink,
  type ReplayRetentionMode,
  type StreamingEvidenceManifestRef,
} from "@/lib/trader/backtest/streaming-evidence";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { Bar, Regime } from "@/lib/trader/intelligence/types";
import {
  CLOSED_TRADE_SEMANTICS_VERSION,
  TRADE_LIFECYCLE_SEMANTICS_VERSION,
} from "@/lib/trader/paper/trade-lifecycle-semantics";
import { derivePaperStrategyEvaluations } from "@/lib/trader/paper/derive-paper-strategy-eval";
import {
  assertLifecycleFillWalkOpenQtyParity,
  assertLifecycleFillWalkTaxonomyParity,
  deriveTradesFromFills,
} from "@/lib/trader/lifecycle";
import { deriveCanonicalInventory } from "@/lib/trader/paper/derive-canonical-inventory";
import type {
  PaperCycleDeps,
  PaperCycleResult,
  PortfolioCycleContext,
  GuardianCycleContext,
} from "@/lib/trader/paper/paper-cycle.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { createInitialPortfolioAccountState, toAccountRiskState } from "@/lib/trader/portfolio";
import {
  buildResearchV2PortfolioContext,
  type ResearchPortfolioConfig,
} from "@/lib/trader/research/research-portfolio-config";
import { assertHtrHistoricalExecutionSessionConfiguration } from "@/lib/trader/research/htr-historical-execution-configuration";
import { createHtrInitialAccountRiskState } from "@/lib/trader/research/htr-initial-portfolio-contract";
import { addDecimal, divideDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { buildResearchRegimeCoverage } from "@/lib/trader/research/regime-taxonomy";
import {
  assertResearchValidationMetricsV2Coherence,
  createEmptyResearchRegimeMetricSlice,
} from "@/lib/trader/research/research-validation-metrics-taxonomy";
import type {
  ResearchRegimeMetricSliceV2,
  ResearchValidationMetrics,
  ResearchValidationMetricsV1,
  ResearchValidationMetricsV2,
} from "@/lib/trader/research/strategy-candidate.types";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";
import type { PatternCatalogRunConfig } from "@/lib/trader/mi/pattern-catalog.types";
import type { EventAttributionRunConfig } from "@/lib/trader/events/event-attribution.types";
import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay-fused-context-builder";
import { orderMatchesStrategyEvidenceScope } from "@/lib/trader/paper/strategy-evidence-scope";
import {
  buildQuoteCurrencyBySymbol,
  loadPaperFillEvents,
  type PaperPnLFillEvent,
} from "@/lib/trader/paper/derive-paper-pnl";
import type { PaperClosedTrade } from "@/lib/trader/paper/paper-strategy-eval.types";

export type ResearchValidationBacktestArtifactSink = {
  cycleResults?: PaperCycleResult[];
  portfolioContext?: PortfolioCycleContext;
  streamingManifestRef?: StreamingEvidenceManifestRef;
  /** Active sink during STREAM_ONLY runs — for graceful shutdown sealing in campaign CLIs. */
  evidenceSink?: ReplayEvidenceSink;
};

export { buildResearchV2PortfolioContext, type ResearchPortfolioConfig };

export type PatternCatalogBacktestCompleteHook = (input: {
  context: OrgContext;
  cycleResults: readonly PaperCycleResult[];
  closedTrades: readonly PaperClosedTrade[];
}) => Promise<void>;

export type EventAttributionBacktestCompleteHook = (input: {
  context: OrgContext;
  cycleResults: readonly PaperCycleResult[];
  closedTrades: readonly PaperClosedTrade[];
}) => Promise<void>;

export type RunResearchValidationBacktestInput = {
  context: OrgContext;
  bars: readonly Bar[];
  strategyId: string;
  strategyVersion: string;
  datasetId: string;
  runId: string;
  split: "train" | "validation" | "blind";
  costModel: CostModelV1;
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  accountKey: string;
  defaultQuantity: string;
  accountState?: AccountRiskState;
  exportedAt?: Date;
  newId?: () => string;
  /** Isolates paper-cycle order keys per research phase/window (see research-backtest-cycle-id). */
  cycleIdPrefix?: string;
  /**
   * Metrics schema version. Default `"1.0.0"` preserves legacy v1 semantics for sealed artifacts
   * and the Phase 1 forensic regression. Pass `"2.0.0"` for M0 repaired taxonomy + forced-flat.
   */
  metricsSchemaVersion?:
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  /** Post-hoc M6 analytics export — default disabled; must not alter metrics. */
  patternCatalog?: PatternCatalogRunConfig & {
    onBacktestComplete?: PatternCatalogBacktestCompleteHook;
  };
  /** Post-hoc M7 analytics export — default disabled; must not alter metrics. */
  eventAttribution?: EventAttributionRunConfig & {
    onBacktestComplete?: EventAttributionBacktestCompleteHook;
  };
  /** M2 portfolio overrides for v2 metrics path. Ignored when `portfolio` is set. */
  portfolioConfig?: ResearchPortfolioConfig;
  /** Explicit portfolio context override (advanced). */
  portfolio?: PortfolioCycleContext;
  /** M3/M4 guardian + exit engine — opt-in; requires lifecycleRepository on deps when enabled. */
  guardian?: GuardianCycleContext;
  /** Optional sink for M9 evidence exports (validation window cycle results). */
  artifactSink?: ResearchValidationBacktestArtifactSink;
  /** Optional replay provider sidecar for deterministic fused context in M9 path. */
  providerSidecar?: ReplayProviderSidecar;
  /** When false, skips replay fused context builder (legacy behavior). */
  enableReplayFusedContext?: boolean;
  retentionMode?: ReplayRetentionMode;
  evidenceSink?: ReplayEvidenceSink;
  /** Bounded cycle cap for interrupt/resume harness scenarios. */
  maxCycles?: number;
  /** STREAM_ONLY resume cursor — discard bar-source cycles below this index. */
  resumeCycleStartIndex?: number;
  evidenceSealMode?: "complete" | "partial" | "none";
  evidenceSealReason?: string;
  /** HTR-WP17: versioned historical execution profile for default research replay. */
  historicalExecutionProfile?: HistoricalExecutionProfileV1;
};

function resolveResearchV1InitialAccountState(
  input: RunResearchValidationBacktestInput,
): AccountRiskState {
  if (input.accountState) {
    return input.accountState;
  }
  return createHtrInitialAccountRiskState();
}

function researchV2InitialAccountState(portfolio: PortfolioCycleContext): AccountRiskState {
  return toAccountRiskState({
    portfolio: createInitialPortfolioAccountState({
      runConfig: portfolio.runConfig,
      limits: portfolio.limits,
      stopDistanceProvider: portfolio.stopDistanceProvider,
    }),
    openOrderCount: 0,
  });
}

function resolveResearchV2PortfolioContext(
  input: RunResearchValidationBacktestInput,
): PortfolioCycleContext {
  if (input.portfolio) {
    return input.portfolio;
  }
  return buildResearchV2PortfolioContext(input.costModel, input.portfolioConfig);
}

type RegimeAccumulatorV1 = {
  tradeCount: number;
  periodRealizedPnl: string;
  periodTotalFees: string;
};

type CycleRegimeTimelineEntry = {
  evaluatedAtMs: number;
  regime: Regime;
};

function assertStreamingAnalyticsHooksAllowed(input: RunResearchValidationBacktestInput): void {
  if (input.retentionMode !== "STREAM_ONLY") {
    return;
  }
  const patternEnabled =
    input.patternCatalog?.enabled === true && input.patternCatalog.onBacktestComplete;
  const eventEnabled =
    input.eventAttribution?.enabled === true && input.eventAttribution.onBacktestComplete;
  if (patternEnabled || eventEnabled) {
    throw new StreamingEvidenceError(
      "WP04_STREAMING_INCOMPATIBLE_ANALYTICS_HOOK",
      "[research] pattern/event analytics hooks are unsupported in STREAM_ONLY retention mode",
    );
  }
}

function wrapEvidenceSinkWithOnlineAccumulators(
  baseSink: ReplayEvidenceSink,
  onCycle: (cycle: PaperCycleResult) => void,
): ReplayEvidenceSink {
  return {
    onCycle(cycleIndex, result) {
      onCycle(result);
      return baseSink.onCycle(cycleIndex, result);
    },
    sealComplete(expectedCycleCount) {
      return baseSink.sealComplete(expectedCycleCount);
    },
    sealPartial(expectedCycleCount, reason) {
      return baseSink.sealPartial(expectedCycleCount, reason);
    },
    peakBufferedProjections() {
      return baseSink.peakBufferedProjections();
    },
  };
}

function parseWindowFromBars(bars: readonly Bar[]): { start: Date; end: Date } {
  const start = new Date(bars[0]!.barOpenTime);
  const end = new Date(bars.at(-1)!.barCloseTime);
  return { start, end };
}

function buildCycleRegimeTimeline(
  cycleResults: readonly PaperCycleResult[],
): CycleRegimeTimelineEntry[] {
  return cycleResults.map((cycle) => ({
    evaluatedAtMs: new Date(cycle.evaluation.msv.evaluatedAt).getTime(),
    regime: cycle.evaluation.msv.derived.regime,
  }));
}

function resolveRegimeAtTimestamp(
  timestamp: Date,
  timeline: readonly CycleRegimeTimelineEntry[],
): Regime {
  const targetMs = timestamp.getTime();
  let regime: Regime = timeline[0]?.regime ?? "RANGE";
  for (const entry of timeline) {
    if (entry.evaluatedAtMs <= targetMs) {
      regime = entry.regime;
    } else {
      break;
    }
  }
  return regime;
}

function getOrCreateRegimeSliceV2(
  accumulators: Map<Regime, ResearchRegimeMetricSliceV2>,
  regime: Regime,
): ResearchRegimeMetricSliceV2 {
  const existing = accumulators.get(regime);
  if (existing) {
    return existing;
  }
  const created = createEmptyResearchRegimeMetricSlice(regime);
  accumulators.set(regime, created);
  return created;
}

function accumulateCycleSignalOrderMetrics(
  cycleResults: readonly PaperCycleResult[],
  accumulators: Map<Regime, ResearchRegimeMetricSliceV2>,
): void {
  for (const cycle of cycleResults) {
    accumulateSingleCycleSignalOrderMetrics(cycle, accumulators);
  }
}

function accumulateSingleCycleSignalOrderMetrics(
  cycle: PaperCycleResult,
  accumulators: Map<Regime, ResearchRegimeMetricSliceV2>,
): void {
  const regime = cycle.evaluation.msv.derived.regime;
  const slice = getOrCreateRegimeSliceV2(accumulators, regime);

  if (cycle.strategyExecutions.length === 0) {
    if (cycle.skipReason === "no_signal") {
      slice.skippedSignals += 1;
    }
    return;
  }

  for (const entry of cycle.strategyExecutions) {
    if (entry.skipReason === "no_submit") {
      slice.skippedSignals += 1;
      continue;
    }

    if (entry.execution?.status === "risk_rejected") {
      slice.rejectedSignals += 1;
      continue;
    }

    if (entry.execution?.status === "submitted") {
      slice.submittedOrders += 1;
      slice.acceptedOrders += 1;
      if (entry.execution.order.state === "FILLED") {
        slice.filledOrders += 1;
      }
      continue;
    }

    if (entry.submitBlocked) {
      slice.rejectedSignals += 1;
    }
  }
}

function partitionInWindowFillEvents(
  fillEvents: readonly PaperPnLFillEvent[],
  strategySignalId: string,
  window: { start: Date; end: Date },
): PaperPnLFillEvent[] {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  return fillEvents.filter((event) => {
    if (!orderMatchesStrategyEvidenceScope(event.order, strategySignalId)) {
      return false;
    }
    const executedMs = event.fill.executedAt.getTime();
    return executedMs >= startMs && executedMs < endMs;
  });
}

function attributePeriodFeesByRegime(
  fillEvents: readonly PaperPnLFillEvent[],
  strategySignalId: string,
  window: { start: Date; end: Date },
  timeline: readonly CycleRegimeTimelineEntry[],
  quoteCurrencyBySymbol: Readonly<Record<string, string>>,
): Map<Regime, string> {
  const feesByRegime = new Map<Regime, string>();
  for (const event of partitionInWindowFillEvents(fillEvents, strategySignalId, window)) {
    const quoteCurrency = quoteCurrencyBySymbol[event.order.symbol];
    if (!quoteCurrency) {
      continue;
    }
    const quoteFee = event.fill.feeAsset === quoteCurrency ? event.fill.fee : "0";
    if (quoteFee === "0") {
      continue;
    }
    const regime = resolveRegimeAtTimestamp(event.fill.executedAt, timeline);
    feesByRegime.set(regime, addDecimal(feesByRegime.get(regime) ?? "0", quoteFee));
  }
  return feesByRegime;
}

function resolveLastInWindowBuyRegime(
  fillEvents: readonly PaperPnLFillEvent[],
  strategySignalId: string,
  window: { start: Date; end: Date },
  timeline: readonly CycleRegimeTimelineEntry[],
): Regime | null {
  const inWindow = partitionInWindowFillEvents(fillEvents, strategySignalId, window)
    .filter((event) => event.order.side === "buy")
    .sort(
      (a, b) =>
        a.fill.executedAt.getTime() - b.fill.executedAt.getTime() ||
        a.fill.id.localeCompare(b.fill.id),
    );
  const lastBuy = inWindow.at(-1);
  if (!lastBuy) {
    return null;
  }
  return resolveRegimeAtTimestamp(lastBuy.fill.executedAt, timeline);
}

function buildAggregateFromByRegime(
  byRegime: ResearchRegimeMetricSliceV2[],
  costModel: CostModelV1,
): ResearchValidationMetricsV2 {
  const aggregate = createEmptyResearchRegimeMetricSlice("AGGREGATE");
  for (const slice of byRegime) {
    for (const field of [
      "submittedOrders",
      "acceptedOrders",
      "filledOrders",
      "openPositions",
      "closedTrades",
      "markToCloseTrades",
      "rejectedSignals",
      "skippedSignals",
    ] as const) {
      aggregate[field] += slice[field];
    }
    aggregate.realizedPnl = addDecimal(aggregate.realizedPnl, slice.realizedPnl);
    aggregate.markedPnl = addDecimal(aggregate.markedPnl, slice.markedPnl);
    aggregate.periodTotalFees = addDecimal(aggregate.periodTotalFees, slice.periodTotalFees);
  }

  const metrics: ResearchValidationMetricsV2 = {
    schemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
    closedTradeSemanticsVersion: CLOSED_TRADE_SEMANTICS_VERSION,
    tradeLifecycleSemanticsVersion: TRADE_LIFECYCLE_SEMANTICS_VERSION,
    costModelVersion: costModel.version ?? COST_MODEL_VERSION_V1,
    submittedOrders: aggregate.submittedOrders,
    acceptedOrders: aggregate.acceptedOrders,
    filledOrders: aggregate.filledOrders,
    openPositions: aggregate.openPositions,
    closedTrades: aggregate.closedTrades,
    markToCloseTrades: aggregate.markToCloseTrades,
    realizedPnl: aggregate.realizedPnl,
    markedPnl: aggregate.markedPnl,
    periodTotalFees: aggregate.periodTotalFees,
    rejectedSignals: aggregate.rejectedSignals,
    skippedSignals: aggregate.skippedSignals,
    byRegime: byRegime.filter((slice) => slice.regimeLabel !== "AGGREGATE"),
  };

  assertResearchValidationMetricsV2Coherence(metrics);
  return metrics;
}

async function runResearchValidationBacktestV1(
  input: RunResearchValidationBacktestInput,
  window: { start: Date; end: Date },
  exportedAt: Date,
): Promise<ResearchValidationMetricsV1> {
  assertStreamingAnalyticsHooksAllowed(input);
  const barSource = new HistoricalBarReplaySource({
    bars: input.bars,
    cycleIdPrefix: input.cycleIdPrefix,
  });

  const regimeAccumulators = new Map<Regime, RegimeAccumulatorV1>();
  const retentionMode = input.retentionMode ?? "FULL";
  let evidenceSink = input.evidenceSink;
  if (retentionMode === "STREAM_ONLY" && evidenceSink) {
    evidenceSink = wrapEvidenceSinkWithOnlineAccumulators(evidenceSink, (cycle) => {
      const regime = cycle.evaluation.msv.derived.regime;
      const submitted = cycle.strategyExecutions.filter(
        (entry) => entry.execution?.status === "submitted",
      );
      if (submitted.length === 0) {
        return;
      }
      const current = regimeAccumulators.get(regime) ?? {
        tradeCount: 0,
        periodRealizedPnl: "0",
        periodTotalFees: "0",
      };
      current.tradeCount += submitted.length;
      regimeAccumulators.set(regime, current);
    });
  }

  const backtest = await runBacktest({
    context: input.context,
    barSource,
    deps: input.deps,
    orderRepository: input.orderRepository,
    accountKey: input.accountKey,
    defaultQuantity: input.defaultQuantity,
    costModel: input.costModel,
    strategySignalIds: [input.strategyId],
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    regimeLabel: "AGGREGATE",
    datasetId: input.datasetId,
    runId: input.runId,
    split: input.split,
    window,
    accountState: resolveResearchV1InitialAccountState(input),
    exportedAt,
    activeStrategyIds: [input.strategyId],
    refreshAccountStateBetweenStrategies: true,
    newId: input.newId,
    providerSidecar: input.providerSidecar,
    enableReplayFusedContext: input.enableReplayFusedContext,
    retentionMode,
    evidenceSink,
    maxCycles: input.maxCycles,
    resumeCycleStartIndex: input.resumeCycleStartIndex,
    evidenceSealMode: input.evidenceSealMode,
    evidenceSealReason: input.evidenceSealReason,
    historicalExecutionProfile: input.historicalExecutionProfile,
  });

  if (retentionMode === "FULL") {
    for (const cycle of backtest.cycleResults) {
      const regime = cycle.evaluation.msv.derived.regime;
      const submitted = cycle.strategyExecutions.filter(
        (entry) => entry.execution?.status === "submitted",
      );
      if (submitted.length === 0) {
        continue;
      }
      const current = regimeAccumulators.get(regime) ?? {
        tradeCount: 0,
        periodRealizedPnl: "0",
        periodTotalFees: "0",
      };
      current.tradeCount += submitted.length;
      regimeAccumulators.set(regime, current);
    }
  }

  const evaluations = await derivePaperStrategyEvaluations({
    context: input.context,
    orderRepository: input.orderRepository,
    strategySignalIds: [input.strategyId],
    window,
    executionMode: "mock",
    derivedAt: exportedAt,
  });

  const aggregate = evaluations[0];
  const periodRealizedPnl = aggregate?.periodRealizedPnl ?? "0";
  const periodTotalFees = aggregate?.periodTotalFees ?? "0";
  const closedTradeCount = aggregate?.closedTradeCount ?? 0;

  if (closedTradeCount > 0 && regimeAccumulators.size === 0) {
    const fallbackRegime =
      backtest.cycleResults.at(-1)?.evaluation.msv.derived.regime ??
      (backtest.streamingManifestRef
        ? new StreamingRegimeTimelineReader(
            backtest.streamingManifestRef.runDir,
          ).resolveRegimeAtTimestamp(window.end)
        : "RANGE");
    regimeAccumulators.set(fallbackRegime, {
      tradeCount: closedTradeCount,
      periodRealizedPnl,
      periodTotalFees,
    });
  } else if (closedTradeCount > 0 && regimeAccumulators.size > 0) {
    const perRegimePnl = divideEvenly(periodRealizedPnl, regimeAccumulators.size);
    const perRegimeFees = divideEvenly(periodTotalFees, regimeAccumulators.size);
    let index = 0;
    for (const [regime, acc] of regimeAccumulators) {
      acc.periodRealizedPnl = perRegimePnl[index] ?? "0";
      acc.periodTotalFees = perRegimeFees[index] ?? "0";
      regimeAccumulators.set(regime, acc);
      index += 1;
    }
  }

  const byRegime = [...regimeAccumulators.entries()]
    .filter(([, acc]) => acc.tradeCount > 0)
    .map(([regimeLabel, acc]) => ({
      regimeLabel,
      tradeCount: acc.tradeCount,
      periodRealizedPnl: acc.periodRealizedPnl,
      periodTotalFees: acc.periodTotalFees,
    }))
    .sort((a, b) => a.regimeLabel.localeCompare(b.regimeLabel));

  return {
    schemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
    tradeCount: closedTradeCount,
    periodRealizedPnl,
    periodTotalFees,
    byRegime,
  };
}

async function runResearchValidationBacktestV2(
  input: RunResearchValidationBacktestInput,
  window: { start: Date; end: Date },
  exportedAt: Date,
): Promise<ResearchValidationMetricsV2> {
  assertStreamingAnalyticsHooksAllowed(input);
  const lastBar = input.bars.at(-1)!;
  const barSource = new HistoricalBarReplaySource({
    bars: input.bars,
    cycleIdPrefix: input.cycleIdPrefix,
  });

  const portfolioContext = resolveResearchV2PortfolioContext(input);
  const retentionMode = input.retentionMode ?? "FULL";
  const regimeAccumulators = new Map<Regime, ResearchRegimeMetricSliceV2>();
  let evidenceSink = input.evidenceSink;
  if (retentionMode === "STREAM_ONLY" && evidenceSink) {
    evidenceSink = wrapEvidenceSinkWithOnlineAccumulators(evidenceSink, (cycle) => {
      accumulateSingleCycleSignalOrderMetrics(cycle, regimeAccumulators);
    });
  }

  const backtest = await runBacktest({
    context: input.context,
    barSource,
    deps: input.deps,
    orderRepository: input.orderRepository,
    accountKey: input.accountKey,
    defaultQuantity: input.defaultQuantity,
    costModel: input.costModel,
    strategySignalIds: [input.strategyId],
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    regimeLabel: "AGGREGATE",
    datasetId: input.datasetId,
    runId: input.runId,
    split: input.split,
    window,
    accountState: input.accountState ?? researchV2InitialAccountState(portfolioContext),
    exportedAt,
    activeStrategyIds: [input.strategyId],
    refreshAccountStateBetweenStrategies: true,
    newId: input.newId,
    portfolio: portfolioContext,
    guardian: input.guardian,
    markPrices: { marks: { [lastBar.symbol]: lastBar.close } },
    providerSidecar: input.providerSidecar,
    enableReplayFusedContext: input.enableReplayFusedContext,
    retentionMode,
    evidenceSink,
    maxCycles: input.maxCycles,
    resumeCycleStartIndex: input.resumeCycleStartIndex,
    evidenceSealMode: input.evidenceSealMode,
    evidenceSealReason: input.evidenceSealReason,
    historicalExecutionProfile: input.historicalExecutionProfile,
  });

  if (input.artifactSink) {
    input.artifactSink.portfolioContext = portfolioContext;
    if (retentionMode === "STREAM_ONLY") {
      input.artifactSink.streamingManifestRef = backtest.streamingManifestRef;
      if (evidenceSink) {
        input.artifactSink.evidenceSink = evidenceSink;
      }
    } else {
      input.artifactSink.cycleResults = [...backtest.cycleResults];
    }
  }

  const timelineReader =
    retentionMode === "STREAM_ONLY" && backtest.streamingManifestRef
      ? new StreamingRegimeTimelineReader(backtest.streamingManifestRef.runDir)
      : null;
  const timeline = timelineReader
    ? [...timelineReader.iterate()]
    : buildCycleRegimeTimeline(backtest.cycleResults);

  if (retentionMode === "FULL") {
    accumulateCycleSignalOrderMetrics(backtest.cycleResults, regimeAccumulators);
  }

  const evaluations = await derivePaperStrategyEvaluations({
    context: input.context,
    orderRepository: input.orderRepository,
    strategySignalIds: [input.strategyId],
    window,
    executionMode: "mock",
    derivedAt: exportedAt,
    forcedFlat: {
      boundaryClosePrice: lastBar.close,
      boundaryTimestamp: window.end,
      costModel: input.costModel,
    },
  });

  const evaluation = evaluations[0];
  if (!evaluation) {
    return buildAggregateFromByRegime([], input.costModel);
  }

  const { fillEvents } = await loadPaperFillEvents({
    context: input.context,
    orderRepository: input.orderRepository,
    executionMode: "mock",
  });

  const lifecycleRecorder = input.deps.lifecycleRecorder;
  const lifecycleRepository = input.deps.lifecycleRepository;
  if (lifecycleRecorder && lifecycleRepository) {
    for (const markToClose of evaluation.markToCloseTrades) {
      const symbolOpenLots = await lifecycleRepository.listOpenPositionLots(input.context, {
        symbol: markToClose.symbol,
        accountKey: input.accountKey,
      });
      const strategySignalIds = [...new Set(symbolOpenLots.map((lot) => lot.strategySignalId))];
      for (const strategySignalId of strategySignalIds) {
        await lifecycleRecorder.recordForcedFlatLifecycle({
          context: input.context,
          accountKey: input.accountKey,
          strategySignalId,
          markToClose,
        });
      }
    }

    const strategyFillEvents = fillEvents.filter((event) =>
      orderMatchesStrategyEvidenceScope(event.order, input.strategyId),
    );
    const lifecycleSnapshot = deriveTradesFromFills({
      fillEvents: strategyFillEvents,
      organizationId: input.context.organizationId,
      strategySignalId: input.strategyId,
      accountKey: input.accountKey,
      forcedFlatTrades: evaluation.markToCloseTrades,
    });
    assertLifecycleFillWalkTaxonomyParity({
      fillWalk: evaluation,
      lifecycleSnapshot,
    });

    const symbols = [...new Set(strategyFillEvents.map((event) => event.order.symbol))];
    const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);
    const inventory = deriveCanonicalInventory(strategyFillEvents, quoteCurrencyBySymbol);
    const openLots = await lifecycleRepository.listOpenPositionLots(input.context, {
      accountKey: input.accountKey,
    });
    assertLifecycleFillWalkOpenQtyParity({ inventory, openLots });
  }

  const symbols = [...new Set(fillEvents.map((event) => event.order.symbol))];
  const quoteCurrencyBySymbol = buildQuoteCurrencyBySymbol(symbols);
  const feesByRegime = attributePeriodFeesByRegime(
    fillEvents,
    input.strategyId,
    window,
    timeline,
    quoteCurrencyBySymbol,
  );

  for (const [regime, fees] of feesByRegime) {
    const slice = getOrCreateRegimeSliceV2(regimeAccumulators, regime);
    slice.periodTotalFees = addDecimal(slice.periodTotalFees, fees);
  }

  for (const trade of evaluation.closedTrades) {
    const regime = resolveRegimeAtTimestamp(trade.executedAt, timeline);
    const slice = getOrCreateRegimeSliceV2(regimeAccumulators, regime);
    slice.closedTrades += 1;
    slice.realizedPnl = addDecimal(slice.realizedPnl, trade.tradePnl);
    slice.markedPnl = addDecimal(slice.markedPnl, trade.tradePnl);
  }

  const boundaryRegime =
    timeline.at(-1)?.regime ??
    backtest.cycleResults.at(-1)?.evaluation.msv.derived.regime ??
    timelineReader?.resolveRegimeAtTimestamp(window.end) ??
    "RANGE";

  for (const trade of evaluation.markToCloseTrades) {
    const slice = getOrCreateRegimeSliceV2(regimeAccumulators, boundaryRegime);
    slice.markToCloseTrades += 1;
    slice.markedPnl = addDecimal(slice.markedPnl, trade.tradePnl);
  }

  if (evaluation.openPositionCount > 0) {
    const openRegime =
      resolveLastInWindowBuyRegime(fillEvents, input.strategyId, window, timeline) ??
      boundaryRegime;
    const slice = getOrCreateRegimeSliceV2(regimeAccumulators, openRegime);
    slice.openPositions += evaluation.openPositionCount;
  }

  const byRegime = [...regimeAccumulators.values()]
    .filter(
      (slice) =>
        slice.submittedOrders > 0 ||
        slice.closedTrades > 0 ||
        slice.markToCloseTrades > 0 ||
        slice.openPositions > 0 ||
        slice.rejectedSignals > 0 ||
        slice.skippedSignals > 0,
    )
    .sort((a, b) => a.regimeLabel.localeCompare(b.regimeLabel));

  const metrics = buildAggregateFromByRegime(byRegime, input.costModel);

  if (metrics.periodTotalFees !== evaluation.periodTotalFees && byRegime.length > 0) {
    const delta = subtractDecimal(evaluation.periodTotalFees, metrics.periodTotalFees);
    if (delta !== "0") {
      byRegime[0]!.periodTotalFees = addDecimal(byRegime[0]!.periodTotalFees, delta);
      const adjustedMetrics = buildAggregateFromByRegime(byRegime, input.costModel);
      if (input.patternCatalog?.enabled === true && input.patternCatalog.onBacktestComplete) {
        await input.patternCatalog.onBacktestComplete({
          context: input.context,
          cycleResults: backtest.cycleResults,
          closedTrades: evaluation.closedTrades,
        });
      }
      if (input.eventAttribution?.enabled === true && input.eventAttribution.onBacktestComplete) {
        await input.eventAttribution.onBacktestComplete({
          context: input.context,
          cycleResults: backtest.cycleResults,
          closedTrades: evaluation.closedTrades,
        });
      }
      return adjustedMetrics;
    }
  }

  if (input.patternCatalog?.enabled === true && input.patternCatalog.onBacktestComplete) {
    await input.patternCatalog.onBacktestComplete({
      context: input.context,
      cycleResults: backtest.cycleResults,
      closedTrades: evaluation.closedTrades,
    });
  }

  if (input.eventAttribution?.enabled === true && input.eventAttribution.onBacktestComplete) {
    await input.eventAttribution.onBacktestComplete({
      context: input.context,
      cycleResults: backtest.cycleResults,
      closedTrades: evaluation.closedTrades,
    });
  }

  return metrics;
}

/**
 * Runs a cost-aware backtest over a bar window and derives {@link ResearchValidationMetrics}
 * with per-CDE-regime slices from cycle MSV envelopes.
 */
export async function runResearchValidationBacktest(
  input: RunResearchValidationBacktestInput & {
    metricsSchemaVersion?: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1;
  },
): Promise<ResearchValidationMetricsV1>;
export async function runResearchValidationBacktest(
  input: RunResearchValidationBacktestInput & {
    metricsSchemaVersion: typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  },
): Promise<ResearchValidationMetricsV2>;
export async function runResearchValidationBacktest(
  input: RunResearchValidationBacktestInput,
): Promise<ResearchValidationMetrics> {
  if (input.bars.length < 20) {
    throw new Error("[research] validation backtest requires at least 20 bars");
  }

  assertHtrHistoricalExecutionSessionConfiguration({
    deps: input.deps,
    historicalExecutionProfile: input.historicalExecutionProfile,
  });

  const window = parseWindowFromBars(input.bars);
  const exportedAt = input.exportedAt ?? new Date(window.end);
  const schemaVersion = input.metricsSchemaVersion ?? RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1;

  if (schemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1) {
    return runResearchValidationBacktestV1(input, window, exportedAt);
  }

  return runResearchValidationBacktestV2(input, window, exportedAt);
}

function divideEvenly(total: string, parts: number): string[] {
  if (parts <= 0) {
    return [];
  }
  const share = divideDecimal(total, String(parts));
  return Array.from({ length: parts }, () => share);
}

export function collectRegimeCoverageFromValidationMetrics(
  metrics: readonly ResearchValidationMetrics[],
) {
  const labels = new Set<string>();
  for (const entry of metrics) {
    for (const slice of entry.byRegime) {
      if ("tradeCount" in slice && slice.tradeCount > 0) {
        labels.add(slice.regimeLabel);
      } else if ("closedTrades" in slice && slice.closedTrades + slice.markToCloseTrades > 0) {
        labels.add(slice.regimeLabel);
      }
    }
  }
  return buildResearchRegimeCoverage([...labels]);
}

// Re-export for orchestrator convenience
export { buildResearchRegimeCoverage };
