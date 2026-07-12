import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { applyCostToFill, type CostModelV1 } from "@/lib/trader/execution/cost-model";
import type {
  OrderRepository,
  RecordFillInput,
} from "@/lib/trader/execution/order-repository.types";
import {
  buildBacktestEvaluationExport,
  buildBacktestEvaluationExportDocument,
} from "@/lib/trader/backtest/build-backtest-evaluation-export";
import type {
  BacktestEvaluationExportBundle,
  BacktestEvaluationExportDocument,
  BacktestRegimeMetrics,
} from "@/lib/trader/backtest/backtest-evaluation-export.types";
import {
  NOOP_REPLAY_BENCHMARK_OBSERVER,
  type ReplayBenchmarkObserver,
} from "@/lib/trader/backtest/replay-benchmark-instrumentation";
import {
  NOOP_REPLAY_EVIDENCE_SINK,
  type ReplayEvidenceSink,
  type ReplayRetentionMode,
  type StreamingEvidenceManifestRef,
} from "@/lib/trader/backtest/streaming-evidence";
import type { BarReplaySource } from "@/lib/trader/market-data/types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import {
  buildReplayFusedContextFromSnapshot,
  type ReplayProviderSidecar,
} from "@/lib/trader/market-data/replay-fused-context-builder";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import type {
  GuardianCycleContext,
  PaperCycleDeps,
  PaperCycleResult,
  PortfolioCycleContext,
} from "@/lib/trader/paper/paper-cycle.types";
import type { HypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import { derivePortfolioAccountState, toAccountRiskState } from "@/lib/trader/portfolio";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type RunBacktestInput = {
  context: OrgContext;
  barSource: BarReplaySource;
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  accountKey: string;
  defaultQuantity: string;
  costModel: CostModelV1;
  strategySignalIds: string[];
  strategyId: string;
  strategyVersion: string;
  regimeLabel: string;
  datasetId: string;
  runId: string;
  split: "train" | "validation" | "blind";
  window: PaperPnLWindow;
  accountState: AccountRiskState;
  exportedAt: Date;
  activeStrategyIds?: readonly string[];
  markPrices?: PaperPnLMarkPrices;
  refreshAccountStateBetweenStrategies?: boolean;
  portfolio?: PortfolioCycleContext;
  /** M3/M4 guardian + exit engine — opt-in per research campaign flag. */
  guardian?: GuardianCycleContext;
  telemetrySink?: WaiaTraderTelemetrySink;
  newId?: () => string;
  maxCycles?: number;
  /** When true (default), builds deterministic replay fused context per cycle. */
  enableReplayFusedContext?: boolean;
  providerSidecar?: ReplayProviderSidecar;
  /** PR-2 MI Core: within-session conviction state seed. */
  hypothesisSessionState?: HypothesisSessionState;
  /** PR-2 MI Core: explicit flag override. */
  miCoreEnabled?: boolean;
  benchmarkObserver?: ReplayBenchmarkObserver;
  retentionMode?: ReplayRetentionMode;
  evidenceSink?: ReplayEvidenceSink;
  /** STREAM_ONLY: discard bar-source cycles below this index before executing paper cycles. */
  resumeCycleStartIndex?: number;
  /** STREAM_ONLY evidence seal behavior at run end (default: complete). */
  evidenceSealMode?: "complete" | "partial" | "none";
  evidenceSealReason?: string;
};

export type RunBacktestResult = {
  cycleCount: number;
  cycleResults: PaperCycleResult[];
  exportBundle: BacktestEvaluationExportBundle;
  exportDocument: BacktestEvaluationExportDocument;
  evidenceDigest: string;
  regimeMetrics: BacktestRegimeMetrics[];
  streamingManifestRef?: StreamingEvidenceManifestRef;
};

function wrapOrderRepositoryWithCostModel(
  inner: OrderRepository,
  costModel: CostModelV1,
): OrderRepository {
  return {
    ...inner,
    async recordFill(context, input: RecordFillInput) {
      const order = await inner.getOrderById(context, input.orderId);
      if (!order) {
        return inner.recordFill(context, input);
      }

      const adjusted = applyCostToFill(input.price, input.quantity, order.side, costModel);
      return inner.recordFill(context, {
        ...input,
        price: adjusted.adjustedPrice,
        fee: adjusted.fee,
        feeAsset: "USDT",
      });
    },
  };
}

function buildRegimeMetrics(
  bundle: BacktestEvaluationExportBundle,
  document: BacktestEvaluationExportDocument,
): BacktestRegimeMetrics[] {
  return bundle.strategyEvaluations.map((evaluation) => ({
    regimeLabel: bundle.regimeLabel,
    strategySignalId: evaluation.strategySignalId,
    periodRealizedPnl: evaluation.periodRealizedPnl,
    periodTotalFees: evaluation.periodTotalFees,
    closedTradeCount: evaluation.closedTradeCount,
    winRate: evaluation.winRate,
    profitFactor: evaluation.profitFactor,
    expectancy: evaluation.expectancy,
    maxRealizedDrawdown: evaluation.maxRealizedDrawdown,
    recoveryFactor: evaluation.recoveryFactor,
    evidenceContentDigest: document.envelope.contentDigest,
  }));
}

/**
 * Replays historical bars through `runPaperCycleOnce` (mock mode), applies the
 * versioned cost model on fills, and derives strategy metrics for export.
 */
export async function runBacktest(input: RunBacktestInput): Promise<RunBacktestResult> {
  const costAwareRepository = wrapOrderRepositoryWithCostModel(
    input.orderRepository,
    input.costModel,
  );
  const benchmarkObserver = input.benchmarkObserver ?? NOOP_REPLAY_BENCHMARK_OBSERVER;
  const retentionMode = input.retentionMode ?? "FULL";
  const evidenceSink = input.evidenceSink ?? NOOP_REPLAY_EVIDENCE_SINK;

  const cycleResults: PaperCycleResult[] = [];
  let cycleCount = 0;
  let accountState = input.accountState;
  let hypothesisSessionState = input.hypothesisSessionState;
  const maxCycles = input.maxCycles ?? Number.POSITIVE_INFINITY;
  const resumeCycleStartIndex = Math.max(0, input.resumeCycleStartIndex ?? 0);

  if (resumeCycleStartIndex > 0 && "advanceToCycleIndex" in input.barSource) {
    (input.barSource as HistoricalBarReplaySource).advanceToCycleIndex(resumeCycleStartIndex);
    cycleCount = resumeCycleStartIndex;
  }

  while (cycleCount < maxCycles) {
    const cycleIndex = cycleCount;

    const barSourceTimer = benchmarkObserver.beginStage("bar-source-next", cycleIndex);
    const next = input.barSource.next();
    barSourceTimer.end({ discard: next.done });
    if (next.done) {
      break;
    }
    benchmarkObserver.sampleMemory("bar-source-next", cycleIndex);

    const snapshot =
      input.activeStrategyIds === undefined
        ? next.snapshot
        : { ...next.snapshot, activeStrategyIds: input.activeStrategyIds };

    const fusedContextTimer = benchmarkObserver.beginStage("fused-context-build", cycleIndex);
    const fusedContext =
      input.enableReplayFusedContext === false
        ? undefined
        : buildReplayFusedContextFromSnapshot(snapshot, input.providerSidecar);
    fusedContextTimer.end();
    benchmarkObserver.sampleMemory("fused-context-build", cycleIndex);

    const clockAdvanceTimer = benchmarkObserver.beginStage("clock-advance", cycleIndex);
    input.deps.researchReplayDeterminism?.clock.setNowMs(new Date(snapshot.evaluatedAt).getTime());
    clockAdvanceTimer.end();
    benchmarkObserver.sampleMemory("clock-advance", cycleIndex);

    const paperCycleTimer = benchmarkObserver.beginStage("paper-cycle", cycleIndex);
    const result = await runPaperCycleOnce(input.deps, {
      context: input.context,
      snapshot,
      fusedContext,
      accountKey: input.accountKey,
      defaultQuantity: input.defaultQuantity,
      executionMode: "mock",
      accountState,
      orderRepository: costAwareRepository,
      refreshAccountStateBetweenStrategies: input.refreshAccountStateBetweenStrategies,
      telemetrySink: input.telemetrySink,
      newId: input.newId,
      portfolio: input.portfolio,
      guardian: input.guardian,
      hypothesisSessionState,
      miCoreEnabled: input.miCoreEnabled,
    });
    paperCycleTimer.end();
    benchmarkObserver.sampleMemory("paper-cycle", cycleIndex);

    hypothesisSessionState = result.hypothesisSessionState;
    if (retentionMode === "FULL") {
      cycleResults.push(result);
    }
    await evidenceSink.onCycle(cycleIndex, result);
    cycleCount += 1;

    const accountRefreshTimer = benchmarkObserver.beginStage("account-state-refresh", cycleIndex);
    if (input.refreshAccountStateBetweenStrategies) {
      if (input.portfolio) {
        const portfolio = await derivePortfolioAccountState({
          context: input.context,
          orderRepository: costAwareRepository,
          runConfig: input.portfolio.runConfig,
          limits: input.portfolio.limits,
          stopDistanceProvider: input.portfolio.stopDistanceProvider,
          executionMode: "mock",
          markPrices: input.markPrices,
        });
        const openOrders = await costAwareRepository.listOpenOrders(input.context, {
          executionMode: "mock",
        });
        accountState = toAccountRiskState({
          portfolio,
          openOrderCount: openOrders.length,
        });
      } else {
        accountState = await deriveAccountRiskStateFromMockOrders({
          context: input.context,
          orderRepository: costAwareRepository,
          executionMode: "mock",
        });
      }
    }
    accountRefreshTimer.end();
    benchmarkObserver.sampleMemory("account-state-refresh", cycleIndex);
  }

  const exportInput = {
    context: input.context,
    orderRepository: costAwareRepository,
    window: input.window,
    strategySignalIds: input.strategySignalIds,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    costModel: input.costModel,
    regimeLabel: input.regimeLabel,
    datasetId: input.datasetId,
    runId: input.runId,
    split: input.split,
    cycleCount,
    executionMode: "mock" as const,
    markPrices: input.markPrices,
    exportedAt: input.exportedAt,
  };

  const evidenceExportTimer = benchmarkObserver.beginStage("evidence-export", null);
  const [exportBundle, exportDocument] = await Promise.all([
    buildBacktestEvaluationExport(exportInput),
    buildBacktestEvaluationExportDocument(exportInput),
  ]);
  evidenceExportTimer.end();
  benchmarkObserver.sampleMemory("evidence-export", null);

  let streamingManifestRef: StreamingEvidenceManifestRef | undefined;
  const sealMode = input.evidenceSealMode ?? "complete";
  if (sealMode === "none") {
    streamingManifestRef = undefined;
  } else if (sealMode === "partial") {
    streamingManifestRef = await evidenceSink.sealPartial(
      cycleCount,
      input.evidenceSealReason ?? "PARTIAL",
    );
  } else {
    streamingManifestRef = await evidenceSink.sealComplete(cycleCount);
  }

  return {
    cycleCount,
    cycleResults: retentionMode === "STREAM_ONLY" ? [] : cycleResults,
    exportBundle,
    exportDocument,
    evidenceDigest: exportDocument.envelope.contentDigest,
    regimeMetrics: buildRegimeMetrics(exportBundle, exportDocument),
    streamingManifestRef: retentionMode === "STREAM_ONLY" ? streamingManifestRef : undefined,
  };
}
