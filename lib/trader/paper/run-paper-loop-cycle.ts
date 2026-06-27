import { emitPaperBarCloseCycleComplete } from "@/lib/trader/paper/paper-bar-close-loop-telemetry";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import { runPaperCycleOnce } from "@/lib/trader/paper/paper-cycle-runner";
import type {
  PaperLoopCycleReport,
  RunPaperLoopCycleInput,
} from "@/lib/trader/paper/paper-loop-worker.types";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

/** Runs one scheduled paper-loop cycle: startup reconciliation → HTX poll → multi-strategy paper dispatch (P5). */
export async function runPaperLoopCycle(
  input: RunPaperLoopCycleInput,
): Promise<PaperLoopCycleReport> {
  const startMs = Date.now();
  const { deps } = input;
  const { config } = deps;
  const telemetrySink = input.telemetrySink;

  if (!config.enabled) {
    deps.logger.log({
      event: "waia_paper_loop",
      phase: "cycle_skipped",
      reason: "disabled",
    });
    return {
      outcome: "noop_disabled",
      organizationId: config.organizationId,
      cycleId: null,
      strategySignalCount: 0,
      strategySubmittedCount: 0,
      startupReconciledOrders: 0,
      durationMs: Date.now() - startMs,
    };
  }

  const context = requireOrgContext(config.organizationId);
  const startup = await deps.startupReconciliation.runStartupReconciliation(context, "mock");

  let accountState = EMPTY_STATE;
  try {
    accountState = await deriveAccountRiskStateFromMockOrders({
      context,
      orderRepository: deps.orderRepository,
      executionMode: "mock",
    });
  } catch {
    accountState = EMPTY_STATE;
  }

  const snapshot = await deps.poll.fetchSnapshot();
  const result = await runPaperCycleOnce(deps.paperCycleDeps, {
    context,
    snapshot,
    accountKey: config.accountKey,
    defaultQuantity: config.defaultQuantity,
    accountState,
    executionMode: "mock",
    telemetrySink,
    newId: input.newId,
    orderRepository: deps.orderRepository,
    refreshAccountStateBetweenStrategies: true,
  });

  let accountStateAfterCycle = accountState;
  try {
    accountStateAfterCycle = await deriveAccountRiskStateFromMockOrders({
      context,
      orderRepository: deps.orderRepository,
      executionMode: "mock",
    });
  } catch {
    accountStateAfterCycle = accountState;
  }

  const strategySubmittedCount = result.strategyExecutions.filter(
    (entry) => entry.execution?.status === "submitted",
  ).length;

  emitPaperBarCloseCycleComplete(
    {
      organizationId: context.organizationId,
      cycleId: snapshot.cycleId,
      cyclesRun: 1,
      durationMs: Date.now() - startMs,
      result,
      stateRefreshed: true,
      accountStateAfterCycle,
    },
    telemetrySink,
  );

  const outcome =
    strategySubmittedCount > 0
      ? "submitted"
      : result.submitBlocked && result.skipReason === "no_signal"
        ? "skipped_no_signal"
        : "blocked";

  deps.logger.log({
    event: "waia_paper_loop",
    phase: "cycle_complete",
    outcome,
    organizationId: context.organizationId,
    cycleId: snapshot.cycleId,
    strategySignalCount: result.strategyExecutions.length,
    strategySubmittedCount,
    startupReconciledOrders: startup.reconciliation.outcomes.length,
    durationMs: Date.now() - startMs,
  });

  return {
    outcome,
    organizationId: context.organizationId,
    cycleId: snapshot.cycleId,
    strategySignalCount: result.strategyExecutions.length,
    strategySubmittedCount,
    startupReconciledOrders: startup.reconciliation.outcomes.length,
    durationMs: Date.now() - startMs,
  };
}
