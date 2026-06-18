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
  cycleOrderKeys,
  runFixturePaperCycles,
  runPaperCycleOnce,
  runPollPaperCycles,
} from "@/lib/trader/paper/paper-cycle-runner";
export { runFixturePaperCyclesHarness } from "@/lib/trader/paper/run-fixture-paper-cycles";
export type {
  PaperCycleDeps,
  PaperCycleExecutionMode,
  PaperCycleInput,
  PaperCycleResult,
  PaperCycleSkipReason,
  RunFixturePaperCyclesHarnessInput,
  RunFixturePaperCyclesInput,
  RunFixturePaperCyclesResult,
  RunMultiPaperCyclesResult,
  RunMultiPaperCyclesSharedInput,
  RunPollPaperCyclesInput,
} from "@/lib/trader/paper/paper-cycle.types";
