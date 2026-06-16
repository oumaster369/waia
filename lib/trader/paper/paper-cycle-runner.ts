import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";

import type {
  PaperCycleDeps,
  PaperCycleInput,
  PaperCycleResult,
  RunFixturePaperCyclesInput,
  RunFixturePaperCyclesResult,
} from "@/lib/trader/paper/paper-cycle.types";

/**
 * Runs one paper trading cycle: intelligence evaluation → signal mapping → mock/paper
 * execution → order reconciliation.
 *
 * Off-Cloudflare intent: a long-running paper loop orchestrator (Docker VPS per ADR-0006 /
 * Master Spec §4) will call this function on a bar-close cadence. This module does not deploy
 * that runtime — it only provides the reusable orchestration primitive.
 */
export function cycleOrderKeys(cycleId: string): {
  clientOrderId: string;
  idempotencyKey: string;
} {
  return {
    clientOrderId: `client-paper-cycle-${cycleId}`,
    idempotencyKey: `idem-paper-cycle-${cycleId}`,
  };
}

export async function runPaperCycleOnce(
  deps: PaperCycleDeps,
  input: PaperCycleInput,
): Promise<PaperCycleResult> {
  const { snapshot, context } = input;
  const executionMode = input.executionMode ?? "mock";
  const orderKeys = cycleOrderKeys(snapshot.cycleId);

  const evaluation = runEvaluationCycle({
    organizationId: context.organizationId,
    bars: snapshot.bars,
    quote: snapshot.quote,
    evaluatedAt: snapshot.evaluatedAt,
    newId: input.newId,
    telemetrySink: input.telemetrySink,
  });

  if (evaluation.signal.outcome !== "SIGNAL") {
    return {
      evaluation,
      submitBlocked: true,
      skipReason: "no_signal",
      execution: null,
      reconciliation: null,
    };
  }

  const submit = mapSignalToSubmitOrder({
    signal: evaluation.signal,
    accountKey: input.accountKey,
    referencePrice: evaluation.features.features.close,
    executionMode,
    defaultQuantity: input.defaultQuantity,
    tradingPermission: evaluation.msv.derived.tradingPermission,
    clientOrderId: orderKeys.clientOrderId,
    idempotencyKey: orderKeys.idempotencyKey,
  });

  if (submit == null) {
    return {
      evaluation,
      submitBlocked: true,
      skipReason: "no_submit",
      execution: null,
      reconciliation: null,
    };
  }

  const execution = await deps.execution.submitOrder(context, {
    ...submit,
    accountState: input.accountState,
  });

  if (execution.status !== "submitted") {
    return {
      evaluation,
      submitBlocked: true,
      execution,
      reconciliation: null,
    };
  }

  const reconciliation = await deps.reconciliation.reconcile(context, {
    kind: "order",
    orderId: execution.order.id,
  });

  return {
    evaluation,
    submitBlocked: false,
    execution,
    reconciliation,
  };
}

export async function runFixturePaperCycles(
  input: RunFixturePaperCyclesInput,
): Promise<RunFixturePaperCyclesResult> {
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
