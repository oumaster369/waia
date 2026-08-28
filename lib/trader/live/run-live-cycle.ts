import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { OrderExecutionService } from "@/lib/trader/execution/execution-service.types";
import type { ReconciliationService } from "@/lib/trader/execution/reconciliation.types";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import {
  runDecisionCapitalAuthorityV2,
  type CanonicalDecisionCapitalAuthorityV2Deps,
  type DecisionCapitalAuthorityV2Result,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
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
  /** DEE-634: sole live-equivalent actionability/economics authority. */
  decisionCapitalAuthorityV2?: CanonicalDecisionCapitalAuthorityV2Deps;
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
  decisionCapitalAuthorityV2?: DecisionCapitalAuthorityV2Result;
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
 * Bounded single live-equivalent cycle: Forecast V2 → Decision V2 → Risk → Execution.
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
      entry.outcome === "SIGNAL" && entry.strategyId === input.strategyId && entry.side === "buy",
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

  if (!deps.decisionCapitalAuthorityV2) {
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
      skipReason: "decision_v2_authority_missing",
    };
  }
  const authority = await runDecisionCapitalAuthorityV2(deps.decisionCapitalAuthorityV2, {
    organizationId: input.context.organizationId,
    accountId: input.accountKey,
    cycleId: input.snapshot.cycleId,
    symbol: input.snapshot.bars[0]?.symbol ?? input.snapshot.quote.symbol,
    referencePrice: evaluation.features.features.close,
    executionMode: "live-equivalent",
    forecastOutcome: evaluation.forecastRuntimeOutcome!,
    proposal: {
      action: "ENTER_LONG",
      quantity: input.defaultQuantity ?? "0.001",
      strategySignalId: signal.strategySignalId,
    },
  });

  if (authority.status === "NO_TRADE") {
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
      skipReason: "decision_v2_no_trade",
      decisionCapitalAuthorityV2: authority,
    };
  }

  const execution = authority.execution.execution;

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
      decisionCapitalAuthorityV2: authority,
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
    decisionCapitalAuthorityV2: authority,
  };
}
