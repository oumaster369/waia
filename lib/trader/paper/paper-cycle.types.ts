import type { CostModelV1 } from "@/lib/trader/execution/cost-model";
import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type {
  OrderExecutionService,
  SubmitOrderResult,
} from "@/lib/trader/execution/execution-service.types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { ReconciliationReport } from "@/lib/trader/execution/reconciliation.types";
import type { OrderExecutionMode } from "@/lib/trader/execution/types";
import type { EvaluationCycleResult, StrategySignal } from "@/lib/trader/intelligence/types";
import type {
  BarPollSource,
  BarReplayMode,
  BarReplaySource,
  MarketSnapshot,
} from "@/lib/trader/market-data/types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { LifecycleRecorder } from "@/lib/trader/lifecycle/lifecycle-recorder";
import type {
  PortfolioRunConfig,
  PortfolioSizingLimits,
  StopDistanceProvider,
} from "@/lib/trader/portfolio";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/** M2 deposit-aware sizing context (optional — legacy cycles omit this). */
export type PortfolioCycleContext = {
  runConfig: PortfolioRunConfig;
  limits: PortfolioSizingLimits;
  stopDistanceProvider: StopDistanceProvider;
  costModel: CostModelV1;
  markPrices?: import("@/lib/trader/paper/paper-pnl.types").PaperPnLMarkPrices;
};

export type PaperCycleExecutionMode = Extract<OrderExecutionMode, "mock" | "paper">;

export type PaperCycleDeps = {
  execution: OrderExecutionService;
  reconciliation: {
    reconcile(
      context: OrgContext,
      target: { kind: "order"; orderId: string },
    ): Promise<ReconciliationReport>;
  };
  lifecycleRecorder?: LifecycleRecorder;
};

export type PaperCycleInput = {
  context: OrgContext;
  snapshot: MarketSnapshot;
  accountKey: string;
  defaultQuantity: string;
  executionMode?: PaperCycleExecutionMode;
  accountState: AccountRiskState;
  telemetrySink?: WaiaTraderTelemetrySink;
  newId?: () => string;
  /** When set with refreshAccountStateBetweenStrategies, refreshes risk state between strategy submits. */
  orderRepository?: OrderRepository;
  refreshAccountStateBetweenStrategies?: boolean;
  /** When set, enables M2 stop-based sizing + portfolio ledger refresh. */
  portfolio?: PortfolioCycleContext;
};

export type PaperCycleSkipReason = "no_signal" | "no_submit";

export type PaperCycleStrategyExecution = {
  signal: StrategySignal;
  submitBlocked: boolean;
  skipReason?: PaperCycleSkipReason;
  execution: SubmitOrderResult | null;
  reconciliation: ReconciliationReport | null;
};

export type PaperCycleResult = {
  evaluation: EvaluationCycleResult;
  /** Per-strategy dispatch attempts in registry order (Pipeline P5 / NEW-7). */
  strategyExecutions: PaperCycleStrategyExecution[];
  submitBlocked: boolean;
  skipReason?: PaperCycleSkipReason;
  /** Backward-compatible primary execution (first submitted, else last attempt). */
  execution: SubmitOrderResult | null;
  reconciliation: ReconciliationReport | null;
};

/** Shared N-cycle runner context (fixture replay + poll sources). */
export type RunMultiPaperCyclesSharedInput = {
  deps: PaperCycleDeps;
  context: OrgContext;
  n: number;
  accountKey: string;
  defaultQuantity: string;
  executionMode?: PaperCycleExecutionMode;
  accountState: AccountRiskState;
  telemetrySink?: WaiaTraderTelemetrySink;
  newId?: () => string;
};

export type RunFixturePaperCyclesInput = RunMultiPaperCyclesSharedInput & {
  replay: BarReplaySource;
};

export type RunPollPaperCyclesInput = RunMultiPaperCyclesSharedInput & {
  poll: BarPollSource;
};

export type RunMultiPaperCyclesResult = {
  results: PaperCycleResult[];
};

export type RunFixturePaperCyclesResult = RunMultiPaperCyclesResult;

export type RunFixturePaperCyclesHarnessInput = {
  deps: PaperCycleDeps;
  context: OrgContext;
  n: number;
  fixturePath?: string;
  mode?: BarReplayMode;
  cycleIdPrefix?: string;
  accountKey: string;
  defaultQuantity: string;
  executionMode?: PaperCycleExecutionMode;
  accountState: AccountRiskState;
  telemetrySink?: WaiaTraderTelemetrySink;
  newId?: () => string;
};
