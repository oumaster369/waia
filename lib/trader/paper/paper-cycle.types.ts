import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type {
  OrderExecutionService,
  SubmitOrderResult,
} from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationReport } from "@/lib/trader/execution/reconciliation.types";
import type { OrderExecutionMode } from "@/lib/trader/execution/types";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type {
  BarPollSource,
  BarReplayMode,
  BarReplaySource,
  MarketSnapshot,
} from "@/lib/trader/market-data/types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type PaperCycleExecutionMode = Extract<OrderExecutionMode, "mock" | "paper">;

export type PaperCycleDeps = {
  execution: OrderExecutionService;
  reconciliation: {
    reconcile(
      context: OrgContext,
      target: { kind: "order"; orderId: string },
    ): Promise<ReconciliationReport>;
  };
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
};

export type PaperCycleSkipReason = "no_signal" | "no_submit";

export type PaperCycleResult = {
  evaluation: EvaluationCycleResult;
  submitBlocked: boolean;
  skipReason?: PaperCycleSkipReason;
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
