import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";

import type {
  PaperCycleDeps,
  PaperCycleInput,
  PaperCycleResult,
  PaperCycleStrategyExecution,
  RunFixturePaperCyclesInput,
  RunMultiPaperCyclesResult,
  RunPollPaperCyclesInput,
} from "@/lib/trader/paper/paper-cycle.types";

/**
 * Runs one paper trading cycle: intelligence evaluation → signal mapping → mock/paper
 * execution → order reconciliation.
 *
 * Pipeline P5 (NEW-7): dispatches every actionable registered strategy signal through
 * CDE-gated risk → mock execution → reconciliation (not only the primary signal).
 *
 * Off-Cloudflare intent: a long-running paper loop orchestrator (Docker VPS per ADR-0006 /
 * Master Spec §4) will call this function on a bar-close cadence. This module does not deploy
 * that runtime — it only provides the reusable orchestration primitive.
 */
export function cycleOrderKeys(
  cycleId: string,
  strategyId?: string,
): {
  clientOrderId: string;
  idempotencyKey: string;
} {
  const suffix = strategyId ? `-${strategyId}` : "";
  return {
    clientOrderId: `client-paper-cycle-${cycleId}${suffix}`,
    idempotencyKey: `idem-paper-cycle-${cycleId}${suffix}`,
  };
}

function pickLegacyExecution(
  strategyExecutions: readonly PaperCycleStrategyExecution[],
): Pick<PaperCycleResult, "execution" | "reconciliation" | "submitBlocked" | "skipReason"> {
  if (strategyExecutions.length === 0) {
    return {
      submitBlocked: true,
      skipReason: "no_signal",
      execution: null,
      reconciliation: null,
    };
  }

  const firstSubmitted = strategyExecutions.find(
    (entry) => entry.execution?.status === "submitted",
  );
  const lastAttempt = strategyExecutions.at(-1)!;

  if (firstSubmitted) {
    return {
      submitBlocked: false,
      execution: firstSubmitted.execution,
      reconciliation: firstSubmitted.reconciliation,
    };
  }

  return {
    submitBlocked: true,
    skipReason: lastAttempt.skipReason,
    execution: lastAttempt.execution,
    reconciliation: lastAttempt.reconciliation,
  };
}

async function refreshAccountStateIfConfigured(
  input: PaperCycleInput,
  executionMode: NonNullable<PaperCycleInput["executionMode"]>,
): Promise<PaperCycleInput["accountState"]> {
  if (
    executionMode !== "mock" ||
    !input.refreshAccountStateBetweenStrategies ||
    !input.orderRepository
  ) {
    return input.accountState;
  }

  return deriveAccountRiskStateFromMockOrders({
    context: input.context,
    orderRepository: input.orderRepository,
    executionMode: "mock",
  });
}

export async function runPaperCycleOnce(
  deps: PaperCycleDeps,
  input: PaperCycleInput,
): Promise<PaperCycleResult> {
  const { snapshot, context } = input;
  const executionMode = input.executionMode ?? "mock";

  const evaluation = runEvaluationCycle({
    organizationId: context.organizationId,
    bars: snapshot.bars,
    quote: snapshot.quote,
    evaluatedAt: snapshot.evaluatedAt,
    newId: input.newId,
    telemetrySink: input.telemetrySink,
  });

  const actionableSignals = evaluation.signals.filter((signal) => signal.outcome === "SIGNAL");

  if (actionableSignals.length === 0) {
    return {
      evaluation,
      strategyExecutions: [],
      submitBlocked: true,
      skipReason: "no_signal",
      execution: null,
      reconciliation: null,
    };
  }

  let accountState = input.accountState;
  const strategyExecutions: PaperCycleStrategyExecution[] = [];

  for (const signal of actionableSignals) {
    const orderKeys = cycleOrderKeys(snapshot.cycleId, signal.strategyId);
    const submit = mapSignalToSubmitOrder({
      signal,
      accountKey: input.accountKey,
      referencePrice: evaluation.features.features.close,
      executionMode,
      defaultQuantity: input.defaultQuantity,
      tradingPermission: evaluation.msv.derived.tradingPermission,
      clientOrderId: orderKeys.clientOrderId,
      idempotencyKey: orderKeys.idempotencyKey,
    });

    if (submit == null) {
      strategyExecutions.push({
        signal,
        submitBlocked: true,
        skipReason: "no_submit",
        execution: null,
        reconciliation: null,
      });
      continue;
    }

    const execution = await deps.execution.submitOrder(context, {
      ...submit,
      accountState,
    });

    if (execution.status !== "submitted") {
      strategyExecutions.push({
        signal,
        submitBlocked: true,
        execution,
        reconciliation: null,
      });
      continue;
    }

    const reconciliation = await deps.reconciliation.reconcile(context, {
      kind: "order",
      orderId: execution.order.id,
    });

    strategyExecutions.push({
      signal,
      submitBlocked: false,
      execution,
      reconciliation,
    });

    accountState = await refreshAccountStateIfConfigured(input, executionMode);
  }

  const legacy = pickLegacyExecution(strategyExecutions);

  return {
    evaluation,
    strategyExecutions,
    ...legacy,
  };
}

export async function runFixturePaperCycles(
  input: RunFixturePaperCyclesInput,
): Promise<RunMultiPaperCyclesResult> {
  const results: PaperCycleResult[] = [];

  for (let index = 0; index < input.n; index += 1) {
    const next = input.replay.next();
    if (next.done) {
      throw new Error(
        `[paper-cycle] replay exhausted after ${index} cycles (requested ${input.n})`,
      );
    }

    const result = await runPaperCycleOnce(input.deps, {
      context: input.context,
      snapshot: next.snapshot,
      accountKey: input.accountKey,
      defaultQuantity: input.defaultQuantity,
      executionMode: input.executionMode,
      accountState: input.accountState,
      telemetrySink: input.telemetrySink,
      newId: input.newId,
    });

    results.push(result);
  }

  return { results };
}

export async function runPollPaperCycles(
  input: RunPollPaperCyclesInput,
): Promise<RunMultiPaperCyclesResult> {
  const results: PaperCycleResult[] = [];

  for (let index = 0; index < input.n; index += 1) {
    const snapshot = await input.poll.fetchSnapshot();

    const result = await runPaperCycleOnce(input.deps, {
      context: input.context,
      snapshot,
      accountKey: input.accountKey,
      defaultQuantity: input.defaultQuantity,
      executionMode: input.executionMode,
      accountState: input.accountState,
      telemetrySink: input.telemetrySink,
      newId: input.newId,
    });

    results.push(result);
  }

  return { results };
}
