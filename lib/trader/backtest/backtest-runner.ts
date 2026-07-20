import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import { applyCostToFill, type CostModelV1 } from "@/lib/trader/execution/cost-model";
import { applyHistoricalExecutionEconomics } from "@/lib/trader/execution/fill-economics";
import { historicalFillId } from "@/lib/trader/execution/deterministic-execution-id";
import type {
  OrderRepository,
  RecordFillInput,
} from "@/lib/trader/execution/order-repository.types";
import {
  advanceHistoricalExecutionOnClosedBar,
  type HistoricalExecutionPersistencePort,
} from "@/lib/trader/execution/historical-simulated-exchange";
import type { HistoricalExecutionProfileV1 } from "@/lib/trader/backtest/historical-execution-profile";
import { HTR_HISTORICAL_EXECUTION_PROFILE_V1 } from "@/lib/trader/backtest/historical-execution-profile";
import { assertHtrHistoricalExecutionSessionConfiguration } from "@/lib/trader/research/htr-historical-execution-configuration";
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
  applyNewBarsToCanvas,
  buildSubstrateFusedContext,
  buildSubstrateReconstruction,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { writeCanvasStateSidecar } from "@/lib/trader/market-data/canvas/market-canvas-serialization";
import type { MarketCanvasState } from "@/lib/trader/market-data/canvas/market-canvas.types";
import {
  DEFAULT_REPLAY_SUBSTRATE_MODE,
  type ReplaySubstrateMode,
} from "@/lib/trader/backtest/replay-substrate-mode";
import { resetFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  createFhvTraceEvidenceSink,
  NOOP_REPLAY_EVIDENCE_SINK,
  type ReplayEvidenceSink,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-sink";
import type {
  StreamingEvidenceManifestRef,
  ReplayRetentionMode,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import type { BarReplaySource } from "@/lib/trader/market-data/types";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay-fused-context-builder";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import type {
  GuardianCycleContext,
  PaperCycleDeps,
  PaperCycleResult,
  PortfolioCycleContext,
} from "@/lib/trader/paper/paper-cycle.types";
import type { Bar } from "@/lib/trader/intelligence/types";
import type { HypothesisSessionState } from "@/lib/trader/intelligence/mi-core.types";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import {
  buildQuoteCurrencyBySymbol,
  loadPaperFillEvents,
} from "@/lib/trader/paper/derive-paper-pnl";
import { deriveCanonicalInventory } from "@/lib/trader/paper/derive-canonical-inventory";
import {
  derivePortfolioAccountState,
  derivePortfolioFromAccountingState,
  toAccountRiskState,
} from "@/lib/trader/portfolio";
import {
  attachClosed1mMarkToAccountingBridge,
  consumeWp17FillIntoAccountingBridge,
  compareReplayDrawdownHwmState,
  createDrawdownPersistenceSession,
  createHtrAccountingCycleBridge,
  deriveAccountRiskStateFromBridge,
  hydrateBridgeDrawdownFromPersistence,
  HtrAccountingReconciliationTerminationError,
  restoreAccountingBridgeFromCheckpoint,
  runAutomaticAccountingReconciliation,
  toAccountingCheckpointSlice,
  toDrawdownHwmCheckpointSlice,
  type HtrAccountingCycleBridge,
  type HtrAccountingCycleContext,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import type {
  ReplayAccountingFrontierState,
  ReplayDrawdownHwmState,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrPnlReportV1 } from "@/lib/trader/accounting/htr-pnl-report-v1.types";
import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { PaperPnLMarkPrices } from "@/lib/trader/paper/paper-pnl.types";
import type { PaperPnLWindow } from "@/lib/trader/paper/paper-pnl-period.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import type { HistoricalIntelligenceProfile } from "@/lib/trader/intelligence/historical-profile/historical-profile.types";
import {
  isHistoricalProfileActive,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
} from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import type { IntelligenceCycleBundleRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import type { ForecastDecisionBundleRepository } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-repository-adapters";
import {
  buildIntelligenceCycleBundle,
  persistEvaluationCycleRecords,
} from "@/lib/trader/intelligence/records/intelligence-records-service";
import { persistForecastDecisionBundleForCycle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-service";
import type { CalibrationSink } from "@/lib/trader/intelligence/calibration/calibration.types";
import {
  buildDefaultWp21Provenance,
  runWp21CycleSeam,
  runWp21TerminalSeam,
  type Wp21RuntimeDeps,
} from "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import type { OutcomeResolutionSink } from "@/lib/trader/intelligence/outcome-resolution/outcome-resolution.types";
import type { ConfidenceUpdateSink } from "@/lib/trader/knowledge/knowledge-confidence-update-repository-postgres";
import type { OutcomeResolutionReadPort } from "@/lib/trader/knowledge/mkb-read-model.types";
import type { Wp21CheckpointState } from "@/lib/trader/intelligence/outcome-resolution/wp21-checkpoint-state";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
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
  /** HTR-WP09: replay substrate mode (default incremental canvas cutover). */
  substrateMode?: ReplaySubstrateMode;
  /** HTR-WP09: restored canvas state for checkpoint resume. */
  initialCanvasState?: MarketCanvasState;
  /** HTR-WP09: 1m bars already applied to restored canvas (prefix through resume frontier). */
  initialBars1mPrefix?: readonly Bar[];
  /** HTR-WP09: write canvas sidecar to this run root at end of execution. */
  checkpointRunRoot?: string;
  /** HTR-WP13: explicit historical intelligence profile (never global default). */
  historicalProfile?: HistoricalIntelligenceProfile;
  /** HTR-WP13: optional intelligence records persistence sink. */
  intelligenceRecordsSink?: IntelligenceCycleBundleRepository;
  /** HTR-WP14: optional forecast-decision persistence sink. */
  forecastDecisionSink?: ForecastDecisionBundleRepository;
  /** HTR-WP21: optional outcome resolution sink (cycle-boundary resolution). */
  outcomeResolutionSink?: OutcomeResolutionSink;
  /** HTR-WP21: optional calibration sink (terminal seam). */
  calibrationSink?: CalibrationSink;
  /** HTR-WP21: optional confidence update sink (terminal seam). */
  confidenceUpdateSink?: ConfidenceUpdateSink;
  /** HTR-WP21: runtime deps bundle (source + ports). */
  wp21RuntimeDeps?: Wp21RuntimeDeps;
  /** HTR-WP21: MKB outcome read port (terminal seam). */
  outcomeResolutionReadPort?: OutcomeResolutionReadPort;
  /** HTR-WP21: checkpoint state for resume. */
  wp21CheckpointState?: Wp21CheckpointState;
  /** HTR-WP21: provenance inputs for epistemic records. */
  wp21Provenance?: { codeSha: string; datasetContentDigest: string };
  /** HTR-WP21: Postgres executor for terminal MKB query. */
  wp21PostgresExecutor?: Pick<
    import("@/db/waia-postgres-transaction").WaiaPostgresDb,
    "select" | "insert" | "execute"
  >;
  /** HTR-WP16: optional strategy gating + drawdown context. */
  wp16?: import("@/lib/trader/paper/paper-cycle.types").Wp16GatingContext;
  /** HTR-WP17: historical execution simulation profile. */
  historicalExecutionProfile?: HistoricalExecutionProfileV1;
  /** Research pipeline phase prefix for intelligence/WP21 cycle business keys. */
  cycleIdPrefix?: string;
  /** HTR-WP18: restored accounting frontier for checkpoint resume. */
  initialAccountingFrontierState?: ReplayAccountingFrontierState;
  /** DEE-415 C-A1: Option-B drawdown persistence (0094/0096). */
  htrDrawdownPersistence?: import("@/lib/trader/accounting/htr-accounting-cycle-bridge").HtrDrawdownPersistencePort;
  /** DEE-415 C-A1: restored drawdown HWM slice for replay resume validation. */
  initialDrawdownHwmState?: ReplayDrawdownHwmState;
  /** DEE-415 C-A4: FHV semantic trace + report emission (replaces NOOP evidence sink). */
  fhvObservability?: Readonly<{
    runLogRoot: string;
    resumeSeq?: number;
    provenance?: import("@/lib/trader/readiness/htr-operator-report-schema.v1").HtrOperatorReportProvenanceSection;
  }>;
};

export type RunBacktestResult = {
  cycleCount: number;
  cycleResults: PaperCycleResult[];
  exportBundle: BacktestEvaluationExportBundle;
  exportDocument: BacktestEvaluationExportDocument;
  evidenceDigest: string;
  regimeMetrics: BacktestRegimeMetrics[];
  streamingManifestRef?: StreamingEvidenceManifestRef;
  canvasState: MarketCanvasState;
  canvasStateRef?: string;
  /** Qualification diagnostic only — length of the retained bars1mPrefix reference array. */
  bars1mPrefixLength?: number;
  /** Qualification diagnostic only — estimated reference-slot bytes (8 × length on 64-bit). */
  bars1mPrefixEstimatedReferenceBytes?: number;
  /** HTR-WP18: terminal accounting authority on default historical research path. */
  accountingState?: AccountingStateV1;
  htrPnlReportV1?: HtrPnlReportV1;
  accountingFrontierState?: ReplayAccountingFrontierState;
  drawdownHwmState?: ReplayDrawdownHwmState;
  htrRuntimeCallOrder?: HtrAccountingCycleBridge["callOrder"];
  /** HTR-WP21: terminal checkpoint state after epistemic closure. */
  wp21CheckpointState?: Wp21CheckpointState;
};

function resolveWp21PostgresDb(
  executor: RunBacktestInput["wp21PostgresExecutor"],
): WaiaPostgresDb | undefined {
  if (executor && "transaction" in executor && typeof executor.transaction === "function") {
    return executor as WaiaPostgresDb;
  }
  return undefined;
}

function resolveIntelligenceCycleId(cycleIdPrefix: string | undefined, cycleIndex: number): string {
  return cycleIdPrefix ? `${cycleIdPrefix}-${cycleIndex}` : String(cycleIndex);
}

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

async function resolveHtrInventoryOpenQtyBySymbol(input: {
  context: OrgContext;
  orderRepository: OrderRepository;
}): Promise<Record<string, string>> {
  const { fillEvents } = await loadPaperFillEvents({
    context: input.context,
    orderRepository: input.orderRepository,
    executionMode: "mock",
  });
  const symbols = [...new Set(fillEvents.map((event) => event.order.symbol))];
  const inventory = deriveCanonicalInventory(fillEvents, buildQuoteCurrencyBySymbol(symbols));
  const openQtyBySymbol: Record<string, string> = {};
  for (const [symbol, qty] of inventory.openQtyBySymbol.entries()) {
    openQtyBySymbol[normalizeSymbolForHistoricalExecution(symbol)] = qty;
  }
  return openQtyBySymbol;
}

async function reconcileHtrAccountingBridge(input: {
  bridge: HtrAccountingCycleBridge;
  context: OrgContext;
  orderRepository: OrderRepository;
  cycleIndex?: number;
  phase:
    | "frontier_mutation"
    | "checkpoint_restore"
    | "before_guardian"
    | "before_cycle_complete"
    | "before_terminal_export";
}): Promise<void> {
  const inventoryOpenQtyBySymbol = await resolveHtrInventoryOpenQtyBySymbol({
    context: input.context,
    orderRepository: input.orderRepository,
  });
  runAutomaticAccountingReconciliation(input.bridge, {
    inventoryOpenQtyBySymbol,
    cycleIndex: input.cycleIndex,
    phase: input.phase,
  });
}

function buildHtrAccountingContext(input: {
  bridge: HtrAccountingCycleBridge;
  context: OrgContext;
  orderRepository: OrderRepository;
  drawdownPersistence?: import("@/lib/trader/accounting/htr-accounting-cycle-bridge").HtrDrawdownPersistencePort;
}): HtrAccountingCycleContext {
  return {
    bridge: input.bridge,
    resolveInventoryOpenQtyBySymbol: () =>
      resolveHtrInventoryOpenQtyBySymbol({
        context: input.context,
        orderRepository: input.orderRepository,
      }),
    drawdownPersistence: input.drawdownPersistence
      ? {
          port: input.drawdownPersistence,
          session: createDrawdownPersistenceSession(),
        }
      : undefined,
  };
}

/**
 * Replays historical bars through `runPaperCycleOnce` (mock mode), applies the
 * versioned cost model on fills, and derives strategy metrics for export.
 */
export async function runBacktest(input: RunBacktestInput): Promise<RunBacktestResult> {
  const substrateMode = input.substrateMode ?? DEFAULT_REPLAY_SUBSTRATE_MODE;
  resetFullHistoryRescanCount();

  assertHtrHistoricalExecutionSessionConfiguration({
    deps: input.deps,
    historicalExecutionProfile: input.historicalExecutionProfile,
  });

  const profileActive =
    input.historicalProfile !== undefined &&
    isHistoricalProfileActive(input.historicalProfile ?? HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1);

  const wp17Active =
    input.historicalExecutionProfile?.profileId === HTR_HISTORICAL_EXECUTION_PROFILE_V1;

  const htrAccountingBridge = wp17Active
    ? createHtrAccountingCycleBridge({
        organizationId: input.context.organizationId,
        accountKey: input.accountKey,
        runId: input.runId,
        frontierAsOf: input.window.start.toISOString(),
      })
    : null;

  if (htrAccountingBridge && input.initialAccountingFrontierState) {
    restoreAccountingBridgeFromCheckpoint(
      htrAccountingBridge,
      input.initialAccountingFrontierState,
    );
    await reconcileHtrAccountingBridge({
      bridge: htrAccountingBridge,
      context: input.context,
      orderRepository: input.orderRepository,
      phase: "checkpoint_restore",
    });
    if (input.initialDrawdownHwmState) {
      compareReplayDrawdownHwmState(
        input.initialDrawdownHwmState,
        toDrawdownHwmCheckpointSlice(htrAccountingBridge),
      );
    }
  }

  if (htrAccountingBridge && input.htrDrawdownPersistence) {
    await hydrateBridgeDrawdownFromPersistence(htrAccountingBridge, input.htrDrawdownPersistence);
  }

  const htrAccounting =
    htrAccountingBridge &&
    buildHtrAccountingContext({
      bridge: htrAccountingBridge,
      context: input.context,
      orderRepository: input.orderRepository,
      drawdownPersistence: input.htrDrawdownPersistence,
    });

  const activeRepository = wp17Active
    ? input.orderRepository
    : wrapOrderRepositoryWithCostModel(input.orderRepository, input.costModel);
  const costAwareRepository = activeRepository;
  const benchmarkObserver = input.benchmarkObserver ?? NOOP_REPLAY_BENCHMARK_OBSERVER;
  const retentionMode = input.retentionMode ?? "FULL";
  const finalizeAccountingRef: { state?: AccountingStateV1 } = {};
  const evidenceSink =
    input.evidenceSink ??
    (input.fhvObservability
      ? createFhvTraceEvidenceSink({
          runLogRoot: input.fhvObservability.runLogRoot,
          organizationId: input.context.organizationId,
          accountKey: input.accountKey,
          runId: input.runId,
          resumeSeq: input.fhvObservability.resumeSeq,
          provenance: input.fhvObservability.provenance ?? {
            codeSha: "unknown",
            dirtyTree: false,
            datasetManifestDigest: input.datasetId,
            runConfigDigest: computeSemanticSha256Hex({
              runId: input.runId,
              strategyId: input.strategyId,
              strategyVersion: input.strategyVersion,
            }),
            strategyVersions: [`${input.strategyId}@${input.strategyVersion}`],
            costModelVersion: input.costModel.version,
            riskPolicyVersion: "htr-wp16-d20-drawdown/v1",
            initialPortfolioDigest: HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT,
          },
          getFinalizeContext: () =>
            finalizeAccountingRef.state
              ? {
                  accountingState: finalizeAccountingRef.state,
                }
              : undefined,
        })
      : NOOP_REPLAY_EVIDENCE_SINK);

  const cycleResults: PaperCycleResult[] = [];
  let cycleCount = 0;
  let accountState = input.accountState;
  let hypothesisSessionState = input.hypothesisSessionState;
  const maxCycles = input.maxCycles ?? Number.POSITIVE_INFINITY;
  const resumeCycleStartIndex = Math.max(0, input.resumeCycleStartIndex ?? 0);

  let canvasState = input.initialCanvasState ?? createInitialCanvasState();
  let canvasAppliedBarCount = input.initialCanvasState?.closedBarCount ?? 0;
  const bars1mPrefix: Bar[] = input.initialBars1mPrefix ? [...input.initialBars1mPrefix] : [];
  let wp21CheckpointState = input.wp21CheckpointState;

  const wp21Active =
    profileActive &&
    input.wp21RuntimeDeps !== undefined &&
    input.outcomeResolutionSink !== undefined &&
    input.calibrationSink !== undefined;

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

    for (const bar of snapshot.bars) {
      bars1mPrefix.push(bar);
    }

    const fusedContextTimer = benchmarkObserver.beginStage("fused-context-build", cycleIndex);
    let fusedContext = undefined;
    let reconstruction = undefined;

    if (input.enableReplayFusedContext !== false) {
      const canvasAdvanceTimer = benchmarkObserver.beginStage("canvas-advance", cycleIndex);
      const advanceResult = applyNewBarsToCanvas(canvasState, snapshot.bars, canvasAppliedBarCount);
      canvasState = advanceResult.state;
      canvasAppliedBarCount += advanceResult.appliedBars;
      canvasAdvanceTimer.end();
      benchmarkObserver.sampleMemory("canvas-advance", cycleIndex);

      const evaluatedAt =
        snapshot.evaluatedAt ?? snapshot.bars.at(-1)?.barCloseTime ?? snapshot.quote.timestamp;
      const instrumentId = snapshot.bars[0]?.symbol ?? snapshot.quote.symbol;

      fusedContext = buildSubstrateFusedContext({
        substrateMode,
        bars: bars1mPrefix,
        quote: snapshot.quote,
        evaluatedAt,
        instrumentId,
        providerSidecar: input.providerSidecar,
        canvasState,
      });
      reconstruction = buildSubstrateReconstruction({ substrateMode, canvasState });
    }

    fusedContextTimer.end();
    benchmarkObserver.sampleMemory("fused-context-build", cycleIndex);

    const clockAdvanceTimer = benchmarkObserver.beginStage("clock-advance", cycleIndex);
    input.deps.researchReplayDeterminism?.clock.setNowMs(new Date(snapshot.evaluatedAt).getTime());
    clockAdvanceTimer.end();
    benchmarkObserver.sampleMemory("clock-advance", cycleIndex);

    if (wp17Active && input.historicalExecutionProfile && htrAccountingBridge) {
      const closedBar = snapshot.bars.at(-1);
      if (closedBar) {
        const persistence: HistoricalExecutionPersistencePort = {
          recordSimulatedFill: (context, order, event, isFirstSlice) =>
            input.deps.execution.recordSimulatedFill!(context, order, event, isFirstSlice).then(
              () => undefined,
            ),
          transitionOrderExpired: (context, order) =>
            input.deps.execution.transitionOrderExpired!(context, order),
          transitionOrderCancelled: (context, order) =>
            input.deps.execution.transitionOrderCancelled!(context, order),
          transitionOrderCancelledFromRequested: (context, order) =>
            input.deps.execution.transitionOrderCancelled!(context, order),
        };
        const advance = await advanceHistoricalExecutionOnClosedBar(
          input.historicalExecutionProfile.exchange,
          {
            context: input.context,
            closedBar,
            barIndex: cycleIndex,
            model: input.historicalExecutionProfile.model,
            persistence,
            replayNowMs: new Date(snapshot.evaluatedAt).getTime(),
            resolveLatestOrder: (orderId) =>
              costAwareRepository.getOrderById(input.context, orderId),
            refreshAccountState: async () => {
              const openOrders = await costAwareRepository.listOpenOrders(input.context, {
                executionMode: "mock",
              });
              if (input.portfolio) {
                const portfolio = derivePortfolioFromAccountingState({
                  state: htrAccountingBridge.state,
                  runConfig: input.portfolio.runConfig,
                  limits: input.portfolio.limits,
                  stopDistanceProvider: input.portfolio.stopDistanceProvider,
                });
                return toAccountRiskState({
                  portfolio,
                  openOrderCount: openOrders.length,
                  accountPeakHwm: htrAccountingBridge.state.equityHwm,
                  monthlyPeakHwm: htrAccountingBridge.state.monthlyPeakHwm,
                });
              }
              return deriveAccountRiskStateFromBridge(htrAccountingBridge, {
                openOrderCount: openOrders.length,
              });
            },
            reconcileOrder: async () => undefined,
          },
        );
        for (const event of advance.fillEvents) {
          const order = await costAwareRepository.getOrderById(input.context, event.orderId);
          if (!order) {
            continue;
          }
          const economics = applyHistoricalExecutionEconomics(
            event,
            input.historicalExecutionProfile.model,
          );
          const fillId = historicalFillId({
            organizationId: input.context.organizationId,
            orderId: order.id,
            fillSequence: event.fillSequence,
            sourceBarIndex: event.sourceBarIndex,
          });
          consumeWp17FillIntoAccountingBridge(htrAccountingBridge, {
            fill: {
              fillId,
              economics: {
                symbol: economics.symbol,
                side: economics.side,
                quantity: economics.quantity,
                grossFillPrice: economics.grossFillPrice,
                grossNotional: economics.grossNotional,
                netFillPrice: economics.netFillPrice,
                feeAmount: economics.feeAmount,
                netCashEffect: economics.netCashEffect,
                spreadCost: economics.spreadCost,
                impactSlippageCost: economics.impactSlippageCost,
                totalExecutionCost: economics.totalExecutionCost,
                economicsContentDigest: economics.economicsContentDigest,
              },
              executedAt: event.fillTimestamp.toISOString(),
            },
            cycleIndex,
          });
        }
        attachClosed1mMarkToAccountingBridge(htrAccountingBridge, closedBar, cycleIndex);
        await reconcileHtrAccountingBridge({
          bridge: htrAccountingBridge,
          context: input.context,
          orderRepository: costAwareRepository,
          cycleIndex,
          phase: "frontier_mutation",
        });
        const openOrders = await costAwareRepository.listOpenOrders(input.context, {
          executionMode: "mock",
        });
        if (input.portfolio) {
          const portfolio = derivePortfolioFromAccountingState({
            state: htrAccountingBridge.state,
            runConfig: input.portfolio.runConfig,
            limits: input.portfolio.limits,
            stopDistanceProvider: input.portfolio.stopDistanceProvider,
          });
          accountState = toAccountRiskState({
            portfolio,
            openOrderCount: openOrders.length,
            accountPeakHwm: htrAccountingBridge.state.equityHwm,
            monthlyPeakHwm: htrAccountingBridge.state.monthlyPeakHwm,
          });
        } else {
          accountState = deriveAccountRiskStateFromBridge(htrAccountingBridge, {
            openOrderCount: openOrders.length,
          });
        }
      }
    }

    if (wp21Active && input.wp21RuntimeDeps && input.outcomeResolutionSink) {
      const evaluatedAt =
        snapshot.evaluatedAt ?? snapshot.bars.at(-1)?.barCloseTime ?? snapshot.quote.timestamp;
      const provenance =
        input.wp21Provenance !== undefined
          ? buildDefaultWp21Provenance(input.wp21Provenance)
          : buildDefaultWp21Provenance({
              codeSha: "unknown",
              datasetContentDigest: input.datasetId,
            });
      const cycleSeam = await runWp21CycleSeam({
        context: input.context,
        runId: input.runId,
        asOf: evaluatedAt,
        bars: bars1mPrefix,
        deps: {
          ...input.wp21RuntimeDeps,
          outcomeResolutionSink: input.outcomeResolutionSink,
          calibrationSink: input.calibrationSink!,
          confidenceUpdateSink:
            input.confidenceUpdateSink ?? input.wp21RuntimeDeps.confidenceUpdateSink,
          outcomeResolutionReadPort:
            input.outcomeResolutionReadPort ?? input.wp21RuntimeDeps.outcomeResolutionReadPort,
        },
        provenance,
        checkpoint: wp21CheckpointState,
        codeSha: provenance.codeSha,
        datasetContentDigest: provenance.datasetContentDigest,
        pgDb: resolveWp21PostgresDb(input.wp21PostgresExecutor),
      });
      wp21CheckpointState = cycleSeam.checkpoint;
    }

    const paperCycleTimer = benchmarkObserver.beginStage("paper-cycle", cycleIndex);
    input.deps.researchReplayDeterminism?.setDecisionBarIndex?.(cycleIndex);
    let result: PaperCycleResult;
    try {
      result = await runPaperCycleOnce(input.deps, {
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
        miCoreEnabled: profileActive ? true : input.miCoreEnabled,
        reconstruction,
        wp16: input.wp16,
        historicalProfile: input.historicalProfile,
        runId: input.runId,
        costModel: input.costModel,
        htrAccounting: htrAccounting ?? undefined,
        htrBreachCancellation:
          wp17Active && input.historicalExecutionProfile
            ? {
                historicalExchange: input.historicalExecutionProfile.exchange,
                cancelLatencyMs: input.historicalExecutionProfile.model.cancelLatencyMs,
                replayNowMs: () =>
                  new Date(
                    snapshot.evaluatedAt ??
                      snapshot.bars.at(-1)?.barCloseTime ??
                      snapshot.quote.timestamp,
                  ).getTime(),
              }
            : undefined,
      });
    } catch (error) {
      if (error instanceof HtrAccountingReconciliationTerminationError) {
        break;
      }
      throw error;
    }
    paperCycleTimer.end();
    benchmarkObserver.sampleMemory("paper-cycle", cycleIndex);

    if (profileActive && result.evaluation.marketStateSnapshot && result.evaluation.decisionChain) {
      const intelligenceCycleId = resolveIntelligenceCycleId(input.cycleIdPrefix, cycleIndex);
      const bundle = buildIntelligenceCycleBundle({
        organizationId: input.context.organizationId,
        runId: input.runId,
        cycleId: intelligenceCycleId,
        symbol: snapshot.bars[0]?.symbol ?? snapshot.quote.symbol,
        marketStateSnapshot: result.evaluation.marketStateSnapshot,
        decisionChain: result.evaluation.decisionChain,
        profile: input.historicalProfile,
      });
      result.evaluation.intelligenceCycleBundle = bundle;

      let wp13Persisted = false;
      if (input.intelligenceRecordsSink) {
        await input.intelligenceRecordsSink.persist(input.context, bundle);
        wp13Persisted = true;
      } else if (input.deps.researchReplayDeterminism) {
        await persistEvaluationCycleRecords(
          input.context,
          {
            organizationId: input.context.organizationId,
            runId: input.runId,
            cycleId: intelligenceCycleId,
            symbol: snapshot.bars[0]?.symbol ?? snapshot.quote.symbol,
            marketStateSnapshot: result.evaluation.marketStateSnapshot,
            decisionChain: result.evaluation.decisionChain,
            profile: input.historicalProfile,
          },
          {},
        );
        wp13Persisted = true;
      }

      if (result.evaluation.hypothesisSet) {
        const forecastDecisionInput = {
          intelligenceCycleBundle: bundle,
          hypothesisSet: result.evaluation.hypothesisSet,
          decisionChain: result.evaluation.decisionChain,
          msv: result.evaluation.msv,
          signal: result.evaluation.signal,
          costModel: input.costModel,
          wp13Persisted,
        };

        if (input.forecastDecisionSink) {
          await persistForecastDecisionBundleForCycle(input.context, forecastDecisionInput, {
            bundleRepository: input.forecastDecisionSink,
          });
        } else if (input.deps.researchReplayDeterminism) {
          await persistForecastDecisionBundleForCycle(input.context, forecastDecisionInput, {});
        }
      }
    }

    hypothesisSessionState = result.hypothesisSessionState;
    if (retentionMode === "FULL") {
      cycleResults.push(result);
    }
    await evidenceSink.onCycle(cycleIndex, result);
    cycleCount += 1;

    const accountRefreshTimer = benchmarkObserver.beginStage("account-state-refresh", cycleIndex);
    if (input.refreshAccountStateBetweenStrategies) {
      const openOrders = await costAwareRepository.listOpenOrders(input.context, {
        executionMode: "mock",
      });
      if (htrAccountingBridge && input.portfolio) {
        const portfolio = derivePortfolioFromAccountingState({
          state: htrAccountingBridge.state,
          runConfig: input.portfolio.runConfig,
          limits: input.portfolio.limits,
          stopDistanceProvider: input.portfolio.stopDistanceProvider,
        });
        accountState = toAccountRiskState({
          portfolio,
          openOrderCount: openOrders.length,
          accountPeakHwm: htrAccountingBridge.state.equityHwm,
          monthlyPeakHwm: htrAccountingBridge.state.monthlyPeakHwm,
        });
      } else if (htrAccountingBridge) {
        accountState = deriveAccountRiskStateFromBridge(htrAccountingBridge, {
          openOrderCount: openOrders.length,
        });
      } else if (input.portfolio) {
        const portfolio = await derivePortfolioAccountState({
          context: input.context,
          orderRepository: costAwareRepository,
          runConfig: input.portfolio.runConfig,
          limits: input.portfolio.limits,
          stopDistanceProvider: input.portfolio.stopDistanceProvider,
          executionMode: "mock",
          markPrices: input.markPrices,
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
    if (htrAccountingBridge && !htrAccountingBridge.runTerminated) {
      await reconcileHtrAccountingBridge({
        bridge: htrAccountingBridge,
        context: input.context,
        orderRepository: costAwareRepository,
        cycleIndex,
        phase: "before_cycle_complete",
      });
    }
    if (htrAccountingBridge?.runTerminated) {
      break;
    }
    accountRefreshTimer.end();
    benchmarkObserver.sampleMemory("account-state-refresh", cycleIndex);
  }

  if (htrAccountingBridge && !htrAccountingBridge.runTerminated) {
    await reconcileHtrAccountingBridge({
      bridge: htrAccountingBridge,
      context: input.context,
      orderRepository: costAwareRepository,
      phase: "before_terminal_export",
    });
  }

  if (
    wp21Active &&
    input.wp21RuntimeDeps &&
    input.outcomeResolutionSink &&
    input.calibrationSink &&
    input.wp21PostgresExecutor
  ) {
    const terminalAsOf = bars1mPrefix.at(-1)?.barCloseTime ?? input.window.end.toISOString();
    const provenance =
      input.wp21Provenance !== undefined
        ? buildDefaultWp21Provenance(input.wp21Provenance)
        : buildDefaultWp21Provenance({ codeSha: "unknown", datasetContentDigest: input.datasetId });
    const terminalSeam = await runWp21TerminalSeam({
      context: input.context,
      runId: input.runId,
      asOf: terminalAsOf,
      deps: {
        ...input.wp21RuntimeDeps,
        outcomeResolutionSink: input.outcomeResolutionSink,
        calibrationSink: input.calibrationSink,
        confidenceUpdateSink:
          input.confidenceUpdateSink ?? input.wp21RuntimeDeps.confidenceUpdateSink,
        outcomeResolutionReadPort:
          input.outcomeResolutionReadPort ?? input.wp21RuntimeDeps.outcomeResolutionReadPort,
      },
      provenance,
      ex: input.wp21PostgresExecutor,
      checkpoint: wp21CheckpointState,
      pgDb: resolveWp21PostgresDb(input.wp21PostgresExecutor),
    });
    wp21CheckpointState = terminalSeam.checkpoint;
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
    historicalExecutionModel: wp17Active ? input.historicalExecutionProfile?.model : undefined,
    accountingState: htrAccountingBridge?.state,
    htrPnlReportSemanticDigest: htrAccountingBridge
      ? computeAccountingSemanticDigest(htrAccountingBridge.state)
      : undefined,
  };

  const evidenceExportTimer = benchmarkObserver.beginStage("evidence-export", null);
  const [exportBundle, exportDocument] = await Promise.all([
    buildBacktestEvaluationExport(exportInput),
    buildBacktestEvaluationExportDocument(exportInput),
  ]);
  evidenceExportTimer.end();
  benchmarkObserver.sampleMemory("evidence-export", null);

  finalizeAccountingRef.state = htrAccountingBridge?.state;

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

  let canvasStateRef: string | undefined;
  if (input.checkpointRunRoot) {
    const serializeTimer = benchmarkObserver.beginStage("canvas-serialize", null);
    canvasStateRef = writeCanvasStateSidecar(input.checkpointRunRoot, canvasState);
    serializeTimer.end();
    benchmarkObserver.sampleMemory("canvas-serialize", null);
  }

  return {
    cycleCount,
    cycleResults: retentionMode === "STREAM_ONLY" ? [] : cycleResults,
    exportBundle,
    exportDocument,
    evidenceDigest: exportDocument.envelope.contentDigest,
    regimeMetrics: buildRegimeMetrics(exportBundle, exportDocument),
    streamingManifestRef: retentionMode === "STREAM_ONLY" ? streamingManifestRef : undefined,
    canvasState,
    canvasStateRef,
    bars1mPrefixLength: bars1mPrefix.length,
    bars1mPrefixEstimatedReferenceBytes: bars1mPrefix.length * 8,
    accountingState: htrAccountingBridge?.state,
    htrPnlReportV1: exportBundle.htrPnlReportV1,
    accountingFrontierState: htrAccountingBridge
      ? toAccountingCheckpointSlice(htrAccountingBridge)
      : undefined,
    drawdownHwmState: htrAccountingBridge
      ? toDrawdownHwmCheckpointSlice(htrAccountingBridge)
      : undefined,
    htrRuntimeCallOrder: htrAccountingBridge?.callOrder,
    wp21CheckpointState,
  };
}
