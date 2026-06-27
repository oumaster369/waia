import type { WaiaTraderTelemetrySink } from "@/lib/observability/waia-trader-telemetry";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import type { StartupReconciliationRunner } from "@/lib/trader/execution/reconciliation-startup.types";
import type { BarPollSource } from "@/lib/trader/market-data/types";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";

export type PaperLoopWorkerConfig = {
  enabled: boolean;
  organizationId: string;
  accountKey: string;
  defaultQuantity: string;
  cycleIdPrefix: string;
  htxRestHost?: string;
};

export type PaperLoopCycleDeps = {
  config: PaperLoopWorkerConfig;
  paperCycleDeps: PaperCycleDeps;
  orderRepository: OrderRepository;
  poll: BarPollSource;
  startupReconciliation: StartupReconciliationRunner;
  logger: {
    log(payload: Record<string, unknown>): void;
  };
};

export type PaperLoopCycleReport = {
  outcome: "noop_disabled" | "skipped_no_signal" | "submitted" | "blocked";
  organizationId: string;
  cycleId: string | null;
  strategySignalCount: number;
  strategySubmittedCount: number;
  startupReconciledOrders: number;
  durationMs: number;
};

export type RunPaperLoopCycleInput = {
  deps: PaperLoopCycleDeps;
  telemetrySink?: WaiaTraderTelemetrySink;
  newId?: () => string;
  fetchImpl?: typeof fetch;
};
