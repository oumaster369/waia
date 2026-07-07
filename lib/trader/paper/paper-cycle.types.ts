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
import type { GuardianCycleResult } from "@/lib/trader/guardian";
import type { GuardianRunConfig } from "@/lib/trader/guardian/guardian-run-config.types";
import type { ExitRunConfig, TrailingState } from "@/lib/trader/exits/exit-types";
import type { ExitIntelligenceRunConfig } from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { LifecycleRecorder } from "@/lib/trader/lifecycle/lifecycle-recorder";
import type { LifecycleRepository } from "@/lib/trader/lifecycle/lifecycle-repository.types";
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

/** M4 session-scoped trailing cache (not replay truth). */
export type ExitEngineCycleContext = {
  runConfig: ExitRunConfig;
  trailingStateByLotId: Map<string, TrailingState>;
};

/** M5 exit intelligence overlay (advisory metadata only). */
export type ExitIntelligenceCycleContext = {
  runConfig: ExitIntelligenceRunConfig;
};

/** M3 guardian supervisory context (optional — legacy cycles omit this). */
export type GuardianCycleContext = {
  runConfig: GuardianRunConfig;
  /** M4 dynamic SL/TP — opt-in; requires guardian enabled. */
  exitEngine?: ExitEngineCycleContext;
  /** M5 reasoning overlay — opt-in; requires guardian enabled. */
  exitIntelligence?: ExitIntelligenceCycleContext;
};

export type PaperCycleDeps = {
  execution: OrderExecutionService;
  reconciliation: {
    reconcile(
      context: OrgContext,
      target: { kind: "order"; orderId: string },
    ): Promise<ReconciliationReport>;
  };
  lifecycleRecorder?: LifecycleRecorder;
  /** Required when guardian enabled on input. */
  lifecycleRepository?: LifecycleRepository;
};

import type { FusedMarketContext } from "@/lib/trader/market-data/observation-types";

export type PaperCycleInput = {
  context: OrgContext;
  snapshot: MarketSnapshot;
  fusedContext?: FusedMarketContext;
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
  /** When set with lifecycleRepository, enables M3 position guardian per bar. */
  guardian?: GuardianCycleContext;
};

export type PaperCycleSkipReason = "no_signal" | "no_submit";

export type PaperCycleStrategyExecution = {
  signal: StrategySignal;
  submitBlocked: boolean;
  skipReason?: PaperCycleSkipReason;
  execution: SubmitOrderResult | null;
  reconciliation: ReconciliationReport | null;
};

export type PaperCycleGuardianExecution = {
  intentId: string;
  submitBlocked: boolean;
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
  /** M3 guardian evaluations + exit intents when guardian enabled. */
  guardian?: GuardianCycleResult;
  guardianExecutions?: PaperCycleGuardianExecution[];
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
