import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import {
  computeStopBasedQuantity,
  derivePortfolioAccountState,
  toAccountRiskState,
} from "@/lib/trader/portfolio";
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

  if (input.portfolio) {
    const portfolio = await derivePortfolioAccountState({
      context: input.context,
      orderRepository: input.orderRepository,
      runConfig: input.portfolio.runConfig,
      limits: input.portfolio.limits,
      stopDistanceProvider: input.portfolio.stopDistanceProvider,
      executionMode: "mock",
      markPrices: input.portfolio.markPrices,
    });
    const openOrders = await input.orderRepository.listOpenOrders(input.context, {
      executionMode: "mock",
    });
    return toAccountRiskState({ portfolio, openOrderCount: openOrders.length });
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

  const actionableSignals = evaluation.signals.filter(
    (signal) =>
      signal.outcome === "SIGNAL" &&
      (snapshot.activeStrategyIds === undefined ||
        snapshot.activeStrategyIds.length === 0 ||
        snapshot.activeStrategyIds.includes(signal.strategyId)),
  );

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
    const referencePrice = evaluation.features.features.close;

    let sizedQuantity: string | undefined;
    let stopDistanceUsdt: string | undefined;

    if (input.portfolio && signal.side) {
      const portfolioState = await derivePortfolioAccountState({
        context: input.context,
        orderRepository: input.orderRepository!,
        runConfig: input.portfolio.runConfig,
        limits: input.portfolio.limits,
        stopDistanceProvider: input.portfolio.stopDistanceProvider,
        executionMode: "mock",
        markPrices: input.portfolio.markPrices,
      });
      const sizing = computeStopBasedQuantity({
        side: signal.side,
        signal,
        entryPrice: referencePrice,
        defaultQuantity: input.defaultQuantity,
        account: portfolioState,
        limits: {
          ...input.portfolio.limits,
          maxNotional: input.portfolio.limits.maxNotional,
        },
        stopDistanceProvider: input.portfolio.stopDistanceProvider,
        runConfig: input.portfolio.runConfig,
        costModel: input.portfolio.costModel,
      });
      if (!sizing.ok) {
        strategyExecutions.push({
          signal,
          submitBlocked: true,
          skipReason: "no_submit",
          execution: null,
          reconciliation: null,
        });
        continue;
      }
      sizedQuantity = sizing.quantity;
      stopDistanceUsdt = sizing.stopDistanceUsdt;
      const openOrders = await input.orderRepository!.listOpenOrders(input.context, {
        executionMode: "mock",
      });
      accountState = toAccountRiskState({
        portfolio: portfolioState,
        openOrderCount: openOrders.length,
      });
    }

    const submit = mapSignalToSubmitOrder({
      signal,
      accountKey: input.accountKey,
      referencePrice,
      executionMode,
      defaultQuantity: input.defaultQuantity,
      tradingPermission: evaluation.msv.derived.tradingPermission,
      clientOrderId: orderKeys.clientOrderId,
      idempotencyKey: orderKeys.idempotencyKey,
      quantity: sizedQuantity,
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

    submit.openingRegime = evaluation.msv.derived.regime;

    if (deps.lifecycleRecorder) {
      await deps.lifecycleRecorder.recordSignalAcceptedLifecycleEvent({
        context,
        strategySignalId: signal.strategySignalId,
        payload: {
          strategyId: signal.strategyId,
          regime: evaluation.msv.derived.regime,
        },
        occurredAt: new Date(snapshot.evaluatedAt),
      });
    }

    const execution = await deps.execution.submitOrder(context, {
      ...submit,
      accountState,
      stopDistanceUsdt,
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
