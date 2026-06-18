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
