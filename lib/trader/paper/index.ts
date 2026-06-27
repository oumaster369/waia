export {
  mapSignalToSubmitOrder,
  type MapSignalToSubmitOrderInput,
} from "@/lib/trader/paper/signal-to-order";
export {
  deriveAccountRiskStateFromMockOrders,
  type DeriveAccountRiskStateInput,
} from "@/lib/trader/paper/account-risk-state-from-orders";
export {
  derivePaperBook,
  netPositionsFromFilledOrders,
  type DerivePaperBookInput,
} from "@/lib/trader/paper/derive-paper-book";
export {
  derivePaperPnL,
  walkFillsForPnL,
  buildPaperPnLFromLedger,
  loadPaperFillEvents,
  resolvePaperPnLQuoteCurrency,
  buildQuoteCurrencyBySymbol,
  computeUnrealizedFromLedgerForMarks,
  extractInWindowClosedTrades,
  type DerivePaperPnLInput,
  type PaperPnLFillEvent,
  type PaperPnLWalkResult,
  type BuildPaperPnLFromLedgerInput,
  type LoadPaperFillEventsInput,
  type PaperFillClosedTrade,
} from "@/lib/trader/paper/derive-paper-pnl";
export {
  derivePaperPnLPeriod,
  type DerivePaperPnLPeriodInput,
} from "@/lib/trader/paper/derive-paper-pnl-period";
export {
  derivePaperStrategyEvaluation,
  derivePaperStrategyEvaluations,
  type DerivePaperStrategyEvaluationInput,
  type DerivePaperStrategyEvaluationsInput,
} from "@/lib/trader/paper/derive-paper-strategy-eval";
export {
  buildPaperEvaluationExport,
  buildPaperEvaluationExportDocument,
} from "@/lib/trader/paper/build-paper-evaluation-export";
export {
  canonicalJsonString,
  canonicalizePaperEvaluationEvidenceBody,
  computePaperEvaluationExportDigest,
  serializePaperPnL,
  serializePaperPnLPeriodRollup,
  serializePaperStrategyEvaluation,
  toPaperEvaluationExportDocument,
} from "@/lib/trader/paper/serialize-paper-evaluation-export";
export { PaperEvaluationExportError } from "@/lib/trader/paper/paper-evaluation-export.errors";
export {
  PAPER_EVALUATION_EXPORT_SCHEMA_VERSION,
  type PaperEvaluationDataQuality,
  type PaperEvaluationEvidenceSlot,
  type PaperEvaluationExportBundle,
  type PaperEvaluationExportDocument,
  type PaperEvaluationExportEvidenceBody,
  type PaperEvaluationExportInput,
  type PaperEvaluationExportSchemaVersion,
  type PaperEvaluationProvenance,
  type SerializedPaperClosedTrade,
  type SerializedPaperPnL,
  type SerializedPaperPnLWindow,
} from "@/lib/trader/paper/paper-evaluation-export.types";
export {
  PaperPnLReconciliationError,
  PaperPnLScopeError,
  PaperPnLWindowError,
} from "@/lib/trader/paper/paper-pnl.errors";
export type {
  PaperPnL,
  PaperPnLMarkPrices,
  PaperPositionPnL,
} from "@/lib/trader/paper/paper-pnl.types";
export type {
  PaperPnLPeriodRollup,
  PaperPnLWindow,
} from "@/lib/trader/paper/paper-pnl-period.types";
export type {
  PaperClosedTrade,
  PaperStrategyEvaluation,
} from "@/lib/trader/paper/paper-strategy-eval.types";
export type {
  PaperBook,
  PaperBookExecutionMode,
  PaperPosition,
} from "@/lib/trader/paper/paper-book.types";
export {
  msUntilNextBarClose,
  runPaperBarCloseLoop,
  type PaperBarCloseLoopConfig,
  type PaperBarCloseLoopResult,
  type RefreshAccountStateInput,
} from "@/lib/trader/paper/paper-bar-close-loop";
export {
  buildPaperBarCloseCycleCompletePayload,
  emitPaperBarCloseCycleComplete,
  type PaperBarCloseCycleCompleteInput,
} from "@/lib/trader/paper/paper-bar-close-loop-telemetry";
export {
  analyzePaperSoakLog,
  P5_TWO_STRATEGY_SOAK_IDS,
  type PaperSoakLogAnalysis,
  type PaperSoakLogAnalysisInput,
} from "@/lib/trader/paper/analyze-paper-soak-log";
export {
  cycleOrderKeys,
  runFixturePaperCycles,
  runPaperCycleOnce,
  runPollPaperCycles,
} from "@/lib/trader/paper/paper-cycle-runner";
export {
  buildPaperLoopDepsFromEnv,
  loadPaperLoopConfig,
  runPaperLoopCycle,
} from "@/lib/trader/paper/build-worker-deps";
export type {
  PaperLoopCycleDeps,
  PaperLoopCycleReport,
  PaperLoopWorkerConfig,
  RunPaperLoopCycleInput,
} from "@/lib/trader/paper/paper-loop-worker.types";
export { runFixturePaperCyclesHarness } from "@/lib/trader/paper/run-fixture-paper-cycles";
export type {
  PaperCycleDeps,
  PaperCycleExecutionMode,
  PaperCycleInput,
  PaperCycleResult,
  PaperCycleSkipReason,
  PaperCycleStrategyExecution,
  RunFixturePaperCyclesHarnessInput,
  RunFixturePaperCyclesInput,
  RunFixturePaperCyclesResult,
  RunMultiPaperCyclesResult,
  RunMultiPaperCyclesSharedInput,
  RunPollPaperCyclesInput,
} from "@/lib/trader/paper/paper-cycle.types";
