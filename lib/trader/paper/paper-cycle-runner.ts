import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { buildReplayFusedContextFromSnapshot } from "@/lib/trader/market-data/replay-fused-context-builder";
import { evaluatePositionGuardian, mapExitIntentToSubmitOrder } from "@/lib/trader/guardian";
import { applyBreachSubmissionRestrictions } from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { HTR_GUARDIAN_EXIT_REASON_V1 } from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import {
  deriveAccountRiskStateFromBridge,
  derivePortfolioFromAccountingState,
  evaluateHtrGuardianForBridge,
  getHtrGuardianCycleForCancellation,
  persistDrawdownCycleAfterGuardian,
  recordBreachCancellationOnBridge,
  runAutomaticAccountingReconciliation,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import { executeBreachPartialEntryCancellation } from "@/lib/trader/guardian/htr-breach-partial-entry-cancellation";
import { requiresHtrPartialEntryCancellation } from "@/lib/trader/guardian/htr-guardian-risk-bridge";
import { addDecimal, compareDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { assertLifecycleFillWalkOpenQtyParity } from "@/lib/trader/lifecycle";
import {
  buildQuoteCurrencyBySymbol,
  loadPaperFillEvents,
} from "@/lib/trader/paper/derive-paper-pnl";
import { deriveCanonicalInventory } from "@/lib/trader/paper/derive-canonical-inventory";
import { mapSignalToSubmitOrder } from "@/lib/trader/paper/signal-to-order";
import { applyRiskMultiplierToQuantity } from "@/lib/trader/paper/apply-risk-multiplier";
import {
  evaluateStrategyEligibilityGate,
  projectIneligibleSignal,
} from "@/lib/trader/intelligence/strategies/strategy-eligibility-gate";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import { getStrategyRegistryEntry } from "@/lib/trader/intelligence/strategies/registry";
import { getIdhpsSession } from "@/lib/trader/execution/idhps-session-registry";
import { deriveAccountRiskStateFromMockOrders } from "@/lib/trader/paper/account-risk-state-from-orders";
import {
  computeStopBasedQuantity,
  derivePortfolioAccountState,
  toAccountRiskState,
} from "@/lib/trader/portfolio";
import { buildPortfolioAccountStateFromIdhps } from "@/lib/trader/portfolio/idhps-portfolio-sizing";
import { countIdhpsOpenOrders } from "@/lib/trader/paper/idhps-inventory-mirror";
import { normalizeSymbolForHistoricalExecution } from "@/lib/trader/backtest/historical-execution-profile";
import type { PlaceOrderInput } from "@/lib/trader/connectors/types";
import type { BreachCancellationResultV1 } from "@/lib/trader/execution/execution-service.types";
import type { HistoricalSimulatedExchange } from "@/lib/trader/execution/historical-simulated-exchange";
import type {
  PaperCycleDeps,
  PaperCycleGuardianExecution,
  PaperCycleInput,
  PaperCycleResult,
  PaperCycleStrategyExecution,
  RunFixturePaperCyclesInput,
  RunMultiPaperCyclesResult,
  RunPollPaperCyclesInput,
} from "@/lib/trader/paper/paper-cycle.types";

export type PaperCycleHtrBreachCancellationOptions = {
  historicalExchange?: HistoricalSimulatedExchange;
  cancelLatencyMs?: number;
  replayNowMs?: () => number;
};

export type PaperCycleInputWithHtrBreachCancellation = PaperCycleInput & {
  htrBreachCancellation?: PaperCycleHtrBreachCancellationOptions;
};

export type PaperCycleResultWithHtrBreachCancellation = PaperCycleResult & {
  htrBreachCancellation?: BreachCancellationResultV1;
};

/**
 * Runs one paper trading cycle: intelligence evaluation → signal mapping → mock/paper
 * execution → order reconciliation.
 *
 * Pipeline P5 (NEW-7): dispatches every actionable registered strategy signal through
 * CDE-gated risk → mock execution → reconciliation (not only the primary signal).
 *
 * M3: optional Position Guardian runs after evaluation and before strategy entries when
 * `input.guardian` + `deps.lifecycleRepository` are configured.
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
  guardianExecutions: readonly PaperCycleGuardianExecution[],
): Pick<PaperCycleResult, "execution" | "reconciliation" | "submitBlocked" | "skipReason"> {
  const firstGuardianSubmitted = guardianExecutions.find(
    (entry) => entry.execution?.status === "submitted",
  );
  if (firstGuardianSubmitted) {
    return {
      submitBlocked: false,
      execution: firstGuardianSubmitted.execution,
      reconciliation: firstGuardianSubmitted.reconciliation,
    };
  }

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

  if (input.htrAccounting) {
    const idhps = getIdhpsSession();
    const openOrderCount = idhps
      ? countIdhpsOpenOrders(idhps.inventory)
      : (
          await input.orderRepository.listOpenOrders(input.context, {
            executionMode: "mock",
          })
        ).length;
    if (input.portfolio) {
      const portfolio = derivePortfolioFromAccountingState({
        state: input.htrAccounting.bridge.state,
        runConfig: input.portfolio.runConfig,
        limits: input.portfolio.limits,
        stopDistanceProvider: input.portfolio.stopDistanceProvider,
      });
      return toAccountRiskState({
        portfolio,
        openOrderCount,
        accountPeakHwm: input.htrAccounting.bridge.state.equityHwm,
        monthlyPeakHwm: input.htrAccounting.bridge.state.monthlyPeakHwm,
      });
    }
    return deriveAccountRiskStateFromBridge(input.htrAccounting.bridge, {
      openOrderCount,
    });
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

async function runHtrGuardianPhase(
  deps: PaperCycleDeps,
  input: PaperCycleInputWithHtrBreachCancellation,
  evaluation: ReturnType<typeof runEvaluationCycle>,
  accountState: PaperCycleInput["accountState"],
  cycleIndex?: number,
): Promise<{
  htrGuardian?: PaperCycleResultWithHtrBreachCancellation["htrGuardian"];
  htrBreachCancellation?: PaperCycleResultWithHtrBreachCancellation["htrBreachCancellation"];
  accountState: PaperCycleInput["accountState"];
}> {
  if (!input.htrAccounting) {
    return { accountState };
  }

  const inventoryOpenQtyBySymbol = await input.htrAccounting.resolveInventoryOpenQtyBySymbol();
  runAutomaticAccountingReconciliation(input.htrAccounting.bridge, {
    inventoryOpenQtyBySymbol,
    cycleIndex,
    phase: "before_guardian",
  });

  const missingMark = Object.entries(input.htrAccounting.bridge.state.positions).some(
    ([symbol, position]) =>
      compareDecimal(position.quantity, "0") > 0 &&
      !input.htrAccounting!.bridge.state.marks[symbol],
  );

  const htrGuardian = evaluateHtrGuardianForBridge(input.htrAccounting.bridge, {
    equityUsdt: input.htrAccounting.bridge.state.equity,
    missingMark,
    cycleIndex: cycleIndex ?? 0,
    inventoryOpenQtyBySymbol,
  });

  if (htrGuardian.breachState !== "NONE" && input.htrAccounting.bridge.guardianReason) {
    input.htrAccounting.bridge.guardianReason = htrGuardian.reason;
  }

  if (input.htrAccounting.drawdownPersistence) {
    await persistDrawdownCycleAfterGuardian(
      input.htrAccounting.bridge,
      input.htrAccounting.drawdownPersistence.port,
      input.htrAccounting.drawdownPersistence.session,
      cycleIndex ?? 0,
    );
  }

  let htrBreachCancellation: PaperCycleResultWithHtrBreachCancellation["htrBreachCancellation"];
  const guardianCycleForCancellation = getHtrGuardianCycleForCancellation(
    input.htrAccounting.bridge,
  );
  if (
    guardianCycleForCancellation &&
    requiresHtrPartialEntryCancellation(guardianCycleForCancellation) &&
    input.orderRepository &&
    deps.execution.cancelOrderForBreach
  ) {
    const openOrders = await input.orderRepository.listOpenOrders(input.context, {
      executionMode: input.executionMode ?? "mock",
    });
    htrBreachCancellation = await executeBreachPartialEntryCancellation({
      context: input.context,
      guardianCycle: guardianCycleForCancellation,
      openOrders,
      openQtyBySymbol: inventoryOpenQtyBySymbol,
      cancelOrder: (context, order) => deps.execution.cancelOrderForBreach!(context, order),
      historicalExchange: input.htrBreachCancellation?.historicalExchange,
      cancelLatencyMs: input.htrBreachCancellation?.cancelLatencyMs,
      replayNowMs: input.htrBreachCancellation?.replayNowMs?.(),
    });
    recordBreachCancellationOnBridge(
      input.htrAccounting.bridge,
      htrBreachCancellation,
      cycleIndex ?? 0,
    );
  }

  return { htrGuardian, htrBreachCancellation, accountState };
}

function shouldDeferReconciliationToHistoricalExchange(
  input: PaperCycleInputWithHtrBreachCancellation,
): boolean {
  return input.htrBreachCancellation?.historicalExchange !== undefined;
}

function assertHtrOrderSubmissionPermitted(
  input: PaperCycleInput,
  order: PlaceOrderInput,
): { permitted: boolean; reason: string | null } {
  if (input.htrAccounting?.bridge.breachCancellationFailed) {
    return { permitted: false, reason: "breach_cancellation_failed" };
  }
  if (!input.htrAccounting?.bridge.lastGuardianCycle) {
    return { permitted: true, reason: null };
  }
  const symbol = normalizeSymbolForHistoricalExecution(order.symbol);
  const openQty =
    input.htrAccounting.bridge.state.positions[symbol]?.quantity ??
    input.htrAccounting.bridge.state.positions[order.symbol]?.quantity ??
    "0";
  const restriction = applyBreachSubmissionRestrictions({
    cycle: input.htrAccounting.bridge.lastGuardianCycle,
    order,
    openQty,
  });
  return {
    permitted: restriction.permitted,
    reason: restriction.reason,
  };
}

async function runGuardianPhase(
  deps: PaperCycleDeps,
  input: PaperCycleInput,
  evaluation: ReturnType<typeof runEvaluationCycle>,
  accountState: PaperCycleInput["accountState"],
  executionMode: NonNullable<PaperCycleInput["executionMode"]>,
): Promise<{
  guardianResult?: PaperCycleResult["guardian"];
  guardianExecutions: PaperCycleGuardianExecution[];
  accountState: PaperCycleInput["accountState"];
}> {
  const guardianExecutions: PaperCycleGuardianExecution[] = [];

  if (input.htrAccounting) {
    return {
      guardianExecutions,
      accountState,
    };
  }

  if (!input.guardian?.runConfig.enabled || !deps.lifecycleRepository) {
    return { guardianExecutions, accountState };
  }

  const { snapshot, context } = input;
  const openLots = await deps.lifecycleRepository.listOpenPositionLots(context, {});
  if (openLots.length === 0) {
    return {
      guardianResult: { evaluations: [], exitIntents: [] },
      guardianExecutions,
      accountState,
    };
  }

  const trades = await Promise.all(
    openLots.map((lot) => deps.lifecycleRepository!.getTradeById(context, lot.tradeId)),
  );
  const tradesById = new Map(
    trades
      .filter((trade): trade is NonNullable<typeof trade> => trade != null)
      .map((trade) => [trade.id, trade]),
  );

  const markPrice = evaluation.features.features.close;

  let canonicalInventory: ReturnType<typeof deriveCanonicalInventory> | undefined;
  if (input.orderRepository && !input.htrAccounting) {
    const { fillEvents } = await loadPaperFillEvents({
      context,
      orderRepository: input.orderRepository,
      executionMode,
    });
    const symbols = [...new Set(fillEvents.map((event) => event.order.symbol))];
    canonicalInventory = deriveCanonicalInventory(fillEvents, buildQuoteCurrencyBySymbol(symbols));
  }

  const exitEngine = input.guardian.exitEngine;
  const exitIntelligence = input.guardian.exitIntelligence;
  const guardianResult = evaluatePositionGuardian({
    context,
    snapshot,
    evaluation,
    openLots,
    tradesById,
    runConfig: input.guardian.runConfig,
    accountKey: input.accountKey,
    markPrice,
    exitEngine:
      exitEngine?.runConfig.enabled === true
        ? {
            runConfig: exitEngine.runConfig,
            bars: snapshot.bars,
            trailingStateByLotId: exitEngine.trailingStateByLotId,
          }
        : undefined,
    exitIntelligence:
      exitIntelligence?.runConfig.enabled === true
        ? { runConfig: exitIntelligence.runConfig }
        : undefined,
    canonicalInventory,
    minOrderQty: input.portfolio?.runConfig.minOrderQty,
  });

  let nextAccountState = accountState;

  for (const evaluationEntry of guardianResult.evaluations) {
    if (deps.lifecycleRecorder) {
      await deps.lifecycleRecorder.recordGuardianEvaluated({
        context,
        positionLotId: evaluationEntry.positionLotId,
        reason: evaluationEntry.reason,
        occurredAt: new Date(snapshot.evaluatedAt),
      });
    }
  }

  for (const intent of guardianResult.exitIntents) {
    if (deps.lifecycleRecorder) {
      await deps.lifecycleRecorder.recordGuardianExitIntent({
        context,
        intent,
        occurredAt: new Date(snapshot.evaluatedAt),
      });
    }

    const submit = mapExitIntentToSubmitOrder(intent, executionMode);
    const execution = await deps.execution.submitOrder(context, {
      ...submit,
      accountState: nextAccountState,
    });

    if (execution.status !== "submitted") {
      guardianExecutions.push({
        intentId: intent.intentId,
        submitBlocked: true,
        execution,
        reconciliation: null,
      });
      continue;
    }

    const reconciliation = shouldDeferReconciliationToHistoricalExchange(input)
      ? null
      : await deps.reconciliation.reconcile(context, {
          kind: "order",
          orderId: execution.order.id,
        });

    guardianExecutions.push({
      intentId: intent.intentId,
      submitBlocked: false,
      execution,
      reconciliation,
    });

    nextAccountState = await refreshAccountStateIfConfigured(input, executionMode);
  }

  const hadGuardianFillRecording = guardianExecutions.some(
    (execution) => !execution.submitBlocked && execution.reconciliation != null,
  );

  if (
    deps.lifecycleRecorder &&
    input.orderRepository &&
    hadGuardianFillRecording &&
    !input.htrAccounting
  ) {
    const { fillEvents } = await loadPaperFillEvents({
      context,
      orderRepository: input.orderRepository,
      executionMode,
    });
    const symbols = [...new Set(fillEvents.map((event) => event.order.symbol))];
    const inventory = deriveCanonicalInventory(fillEvents, buildQuoteCurrencyBySymbol(symbols));
    const remainingOpenLots = await deps.lifecycleRepository.listOpenPositionLots(context, {
      accountKey: input.accountKey,
    });
    assertLifecycleFillWalkOpenQtyParity({ inventory, openLots: remainingOpenLots });
  }

  return {
    guardianResult,
    guardianExecutions,
    accountState: nextAccountState,
  };
}

export async function runPaperCycleOnce(
  deps: PaperCycleDeps,
  input: PaperCycleInputWithHtrBreachCancellation,
): Promise<PaperCycleResultWithHtrBreachCancellation> {
  const { snapshot, context } = input;
  const executionMode = input.executionMode ?? "mock";
  const cycleNewId = input.newId ?? deps.researchReplayDeterminism?.newId;

  const evaluation = runEvaluationCycle({
    organizationId: context.organizationId,
    bars: snapshot.bars,
    quote: snapshot.quote,
    evaluatedAt: snapshot.evaluatedAt,
    fusedContext: input.fusedContext,
    newId: cycleNewId,
    telemetrySink: input.telemetrySink,
    hypothesisSessionState: input.hypothesisSessionState,
    miCoreEnabled: input.miCoreEnabled,
    reconstruction: input.reconstruction,
    historicalProfile: input.historicalProfile ?? input.wp16?.historicalProfile,
    runId: input.runId,
    cycleId: snapshot.cycleId,
    symbol: snapshot.bars[0]?.symbol ?? snapshot.quote.symbol,
    costModel: input.costModel,
    omitIntelligenceArtifacts: input.omitIntelligenceArtifacts,
    strategySignalIds: input.strategySignalIds ?? input.snapshot.activeStrategyIds,
  });

  const actionableSignals = evaluation.signals.filter(
    (signal) =>
      signal.outcome === "SIGNAL" &&
      (snapshot.activeStrategyIds === undefined ||
        snapshot.activeStrategyIds.length === 0 ||
        snapshot.activeStrategyIds.includes(signal.strategyId)),
  );

  let accountState = input.accountState;
  if (
    input.refreshAccountStateBetweenStrategies &&
    input.orderRepository &&
    executionMode === "mock"
  ) {
    accountState = await refreshAccountStateIfConfigured(input, executionMode);
  }
  const guardianPhase = await runGuardianPhase(
    deps,
    input,
    evaluation,
    accountState,
    executionMode,
  );
  accountState = guardianPhase.accountState;

  if (
    input.htrAccounting?.invalidateInventoryCache &&
    guardianPhase.guardianExecutions.some(
      (execution) => !execution.submitBlocked && execution.reconciliation != null,
    )
  ) {
    input.htrAccounting.invalidateInventoryCache();
  }

  const htrGuardianPhase = await runHtrGuardianPhase(
    deps,
    input,
    evaluation,
    accountState,
    Number.parseInt(snapshot.cycleId, 10),
  );
  accountState = htrGuardianPhase.accountState;

  const hasGuardianActivity =
    (guardianPhase.guardianResult?.evaluations.length ?? 0) > 0 ||
    (guardianPhase.guardianExecutions.length ?? 0) > 0;

  const strategyExecutions: PaperCycleStrategyExecution[] = [];

  const gatedSignals = await Promise.all(
    actionableSignals.map(async (signal) => {
      if (!input.wp16) {
        return signal;
      }
      const asOf = snapshot.evaluatedAt;
      const lifecycleState =
        (input.wp16.lifecycleStateResolver
          ? await input.wp16.lifecycleStateResolver(signal.strategyId, signal.strategyVersion, asOf)
          : null) ??
        getStrategyRegistryEntry(signal.strategyId)?.lifecycleState ??
        "DRAFT";
      if (!lifecycleState) {
        return projectIneligibleSignal(signal, ["STRAT_LIFECYCLE_NOT_ELIGIBLE"]);
      }
      const gate = evaluateStrategyEligibilityGate({
        signal,
        lifecycleState,
        historicalProfile: input.wp16.historicalProfile,
        entryPurposeStrategyVersion: input.wp16.entryPurposeStrategyVersion,
      });
      if (!gate.eligible) {
        return projectIneligibleSignal(signal, gate.reasonCodes);
      }
      if (input.wp16.trialService) {
        const trialIdFactory = cycleNewId ?? createDeterministicReplayIdFactory(415_160);
        await input.wp16.trialService.registerStrategyTrial(input.context, {
          strategyId: signal.strategyId,
          strategyVersion: signal.strategyVersion,
          runId: input.wp16.runId,
          cycleId: snapshot.cycleId,
          symbol: signal.symbol,
          accountKey: input.accountKey,
          portfolioId: input.wp16.portfolioId,
          eventTime: asOf,
          ingestTime: asOf,
          registeredBy: "wp16-paper-cycle",
          deterministicId: trialIdFactory(),
        });
      }
      return signal;
    }),
  );

  const eligibleActionableSignals = gatedSignals.filter((signal) => signal.outcome === "SIGNAL");

  if (eligibleActionableSignals.length === 0 && !hasGuardianActivity) {
    return {
      evaluation,
      strategyExecutions: [],
      submitBlocked: true,
      skipReason: "no_signal",
      execution: null,
      reconciliation: null,
      guardian: guardianPhase.guardianResult,
      guardianExecutions: guardianPhase.guardianExecutions,
      htrGuardian: htrGuardianPhase.htrGuardian,
      htrBreachCancellation: htrGuardianPhase.htrBreachCancellation,
      // Epoch-scoped callOrder reference is O(epoch); expose count+tail for evidence digests.
      htrRuntimeCallOrder: input.htrAccounting?.bridge.callOrder,
      hypothesisSessionState: evaluation.hypothesisSessionState,
    };
  }

  for (const signal of eligibleActionableSignals) {
    const orderKeys = cycleOrderKeys(snapshot.cycleId, signal.strategyId);
    const referencePrice = evaluation.features.features.close;

    let sizedQuantity: string | undefined;
    let stopDistanceUsdt: string | undefined;

    if (input.portfolio && signal.side) {
      const idhps = getIdhpsSession();
      // Hot path: IDHPS fill-walk-equivalent mirrors (GS-05). Offline: full fill-walk.
      const portfolioState = idhps
        ? buildPortfolioAccountStateFromIdhps({
            mirror: idhps.accountRisk,
            context: input.context,
            runConfig: input.portfolio.runConfig,
            limits: input.portfolio.limits,
            stopDistanceProvider: input.portfolio.stopDistanceProvider,
            markPrices: input.portfolio.markPrices,
          })
        : await derivePortfolioAccountState({
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
      const riskMultiplier = Number(evaluation.msv.derived.riskMultiplier ?? "1");
      sizedQuantity = applyRiskMultiplierToQuantity(sizedQuantity, riskMultiplier);
      const openOrderCount = idhps
        ? countIdhpsOpenOrders(idhps.inventory)
        : (
            await input.orderRepository!.listOpenOrders(input.context, {
              executionMode: "mock",
              venue: "HTX",
            })
          ).length;
      accountState = toAccountRiskState({
        portfolio: portfolioState,
        openOrderCount,
        accountPeakHwm: input.wp16?.accountPeakHwm,
        monthlyPeakHwm: input.wp16?.monthlyPeakHwm,
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

    const htrRestriction = assertHtrOrderSubmissionPermitted(input, submit);
    if (!htrRestriction.permitted) {
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

    const reconciliation = shouldDeferReconciliationToHistoricalExchange(input)
      ? null
      : await deps.reconciliation.reconcile(context, {
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

  const legacy = pickLegacyExecution(strategyExecutions, guardianPhase.guardianExecutions);

  if (
    input.htrAccounting?.invalidateInventoryCache &&
    strategyExecutions.some(
      (execution) => !execution.submitBlocked && execution.reconciliation != null,
    )
  ) {
    input.htrAccounting.invalidateInventoryCache();
  }

  return {
    evaluation,
    strategyExecutions,
    ...legacy,
    guardian: guardianPhase.guardianResult,
    guardianExecutions: guardianPhase.guardianExecutions,
    htrGuardian: htrGuardianPhase.htrGuardian,
    htrBreachCancellation: htrGuardianPhase.htrBreachCancellation,
    htrRuntimeCallOrder: input.htrAccounting?.bridge.callOrder,
    hypothesisSessionState: evaluation.hypothesisSessionState,
  };
}

export async function runFixturePaperCycles(
  input: RunFixturePaperCyclesInput,
): Promise<RunMultiPaperCyclesResult> {
  const results: PaperCycleResult[] = [];
  let hypothesisSessionState = input.hypothesisSessionState;

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
      fusedContext:
        input.enableReplayFusedContext === false
          ? undefined
          : buildReplayFusedContextFromSnapshot(next.snapshot, input.providerSidecar),
      accountKey: input.accountKey,
      defaultQuantity: input.defaultQuantity,
      executionMode: input.executionMode,
      accountState: input.accountState,
      telemetrySink: input.telemetrySink,
      newId: input.newId,
      hypothesisSessionState,
      miCoreEnabled: input.miCoreEnabled,
    });

    hypothesisSessionState = result.hypothesisSessionState;
    results.push(result);
  }

  return { results };
}

export async function runPollPaperCycles(
  input: RunPollPaperCyclesInput,
): Promise<RunMultiPaperCyclesResult> {
  const results: PaperCycleResult[] = [];

  for (let index = 0; index < input.n; index += 1) {
    let snapshot;
    let fusedContext;

    if (input.poll instanceof HtxBarPollSource) {
      const bundle = await input.poll.fetchEvaluationBundle();
      snapshot = bundle.snapshot;
      fusedContext = bundle.fusedContext;
    } else {
      snapshot = await input.poll.fetchSnapshot();
    }

    const result = await runPaperCycleOnce(input.deps, {
      context: input.context,
      snapshot,
      fusedContext,
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
