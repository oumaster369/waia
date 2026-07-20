import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { OrderExecutionService } from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationService } from "@/lib/trader/execution/reconciliation.types";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { mapSignalToLiveSubmitOrder } from "@/lib/trader/live/signal-to-live-order";
import type { LiveReportingBridgeResult } from "@/lib/trader/live/reporting-bridge";
import { proveLiveFillReportingReadable } from "@/lib/trader/live/reporting-bridge";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type LiveCycleDeps = {
  execution: OrderExecutionService;
  reconciliation: ReconciliationService;
  reportingBridge: Parameters<typeof proveLiveFillReportingReadable>[0]["reportingBridge"];
  feeComputation: Parameters<typeof proveLiveFillReportingReadable>[0]["feeComputation"];
  hwmLedger: Parameters<typeof proveLiveFillReportingReadable>[0]["hwmLedger"];
  orderRepository: Parameters<typeof proveLiveFillReportingReadable>[0]["orderRepository"];
};

export type RunLiveCycleInput = {
  context: OrgContext;
  snapshot: MarketSnapshot;
  accountKey: string;
  exchangeAccountId: string;
  strategyId: string;
  strategyVersion: string;
  credentialId: string;
  defaultQuantity?: string;
  notionalCap?: string;
  accountState?: AccountRiskState;
  newId?: () => string;
};

export type LiveCycleStrategyStage = {
  strategySignalId: string | null;
  strategyId: string;
  strategyVersion: string;
};

export type LiveCycleResult = {
  evaluation: ReturnType<typeof runEvaluationCycle>;
  strategyStage: LiveCycleStrategyStage | null;
  execution: Awaited<ReturnType<OrderExecutionService["submitOrder"]>> | null;
  reconciliation: Awaited<ReturnType<ReconciliationService["reconcile"]>> | null;
  reporting: LiveReportingBridgeResult | null;
  submitBlocked: boolean;
  skipReason?: string;
};

export function liveCycleOrderKeys(
  cycleId: string,
  strategyId: string,
): {
  clientOrderId: string;
  idempotencyKey: string;
} {
  return {
    clientOrderId: `client-live-cycle-${cycleId}-${strategyId}`,
    idempotencyKey: `idem-live-cycle-${cycleId}-${strategyId}`,
  };
}

/**
 * Bounded single live cycle: Strategy → Risk → Execution → Reconciliation → Reporting proof.
 * Terminates after one order attempt (no loop).
 */
export async function runLiveCycleOnce(
  deps: LiveCycleDeps,
  input: RunLiveCycleInput,
): Promise<LiveCycleResult> {
  const evaluation = runEvaluationCycle({
    organizationId: input.context.organizationId,
    bars: input.snapshot.bars,
    quote: input.snapshot.quote,
    evaluatedAt: input.snapshot.evaluatedAt,
    newId: input.newId,
  });

  const signal = evaluation.signals.find(
    (entry) =>
      entry.outcome === "SIGNAL" && entry.strategyId === input.strategyId && entry.side != null,
  );

  if (!signal) {
    return {
      evaluation,
      strategyStage: null,
      execution: null,
      reconciliation: null,
      reporting: null,
      submitBlocked: true,
      skipReason: "no_signal",
    };
  }

  const orderKeys = liveCycleOrderKeys(input.snapshot.cycleId, input.strategyId);
  const submit = mapSignalToLiveSubmitOrder({
    signal,
    accountKey: input.accountKey,
    referencePrice: evaluation.features.features.close,
    defaultQuantity: input.defaultQuantity ?? "0.001",
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    credentialId: input.credentialId,
    tradingPermission: evaluation.msv.derived.tradingPermission,
    clientOrderId: orderKeys.clientOrderId,
    idempotencyKey: orderKeys.idempotencyKey,
    notionalCap: input.notionalCap,
  });

  if (submit == null) {
    return {
      evaluation,
      strategyStage: {
        strategySignalId: signal.strategySignalId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
      },
      execution: null,
      reconciliation: null,
      reporting: null,
      submitBlocked: true,
      skipReason: "no_submit",
    };
  }

  const execution = await deps.execution.submitOrder(input.context, {
    ...submit,
    accountState: input.accountState,
  });

  if (execution.status !== "submitted") {
    return {
      evaluation,
      strategyStage: {
        strategySignalId: signal.strategySignalId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
      },
      execution,
      reconciliation: null,
      reporting: null,
      submitBlocked: true,
      skipReason: execution.status,
    };
  }

  const reconciliation = await deps.reconciliation.reconcile(input.context, {
    kind: "order",
    orderId: execution.order.id,
  });

  let reporting: LiveReportingBridgeResult | null = null;
  if (execution.order.state === "FILLED" || execution.order.state === "PARTIALLY_FILLED") {
    reporting = await proveLiveFillReportingReadable({
      context: input.context,
      orderRepository: deps.orderRepository,
      reportingBridge: deps.reportingBridge,
      feeComputation: deps.feeComputation,
      hwmLedger: deps.hwmLedger,
      exchangeAccountId: input.exchangeAccountId,
    });
  }

  return {
    evaluation,
    strategyStage: {
      strategySignalId: signal.strategySignalId,
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
    },
    execution,
    reconciliation,
    reporting,
    submitBlocked: false,
  };
}
