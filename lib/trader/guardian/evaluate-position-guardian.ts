import { decideGuardianAction } from "@/lib/trader/guardian/guardian-decision-model";
import { computeExitQuantity } from "@/lib/trader/guardian/compute-exit-quantity";
import { guardianOrderKeys } from "@/lib/trader/guardian/guardian-order-keys";
import { GUARDIAN_REASON_RECORD_SCHEMA_VERSION } from "@/lib/trader/guardian/guardian-reason-record.types";
import type { GuardianRunConfig } from "@/lib/trader/guardian/guardian-run-config.types";
import type { GuardianRuleProvider } from "@/lib/trader/guardian/guardian-rule-provider.types";
import {
  buildExitPlan,
  createSlTpGuardianRuleProvider,
  toSlTpLevelsSnapshot,
  updateTrailingSessionState,
} from "@/lib/trader/exits/exit-plan-builder";
import type { ExitPlan, ExitRunConfig, TrailingState } from "@/lib/trader/exits/exit-types";
import { buildExitIntelligenceContext } from "@/lib/trader/intelligence/m5/exit-intelligence-context";
import type { ExitIntelligenceRunConfig } from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import type { CanonicalInventoryWalkResult } from "@/lib/trader/paper/derive-canonical-inventory";
import {
  addDecimal,
  compareDecimal,
  multiplyDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  ExitIntent,
  GuardianCycleResult,
  GuardianPositionEvaluation,
} from "@/lib/trader/guardian/guardian.types";
import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";

export type EvaluatePositionGuardianExitEngineInput = {
  runConfig: ExitRunConfig;
  bars: MarketSnapshot["bars"];
  trailingStateByLotId: Map<string, TrailingState>;
};

export type EvaluatePositionGuardianExitIntelligenceInput = {
  runConfig: ExitIntelligenceRunConfig;
};

export type EvaluatePositionGuardianInput = {
  context: OrgContext;
  snapshot: MarketSnapshot;
  evaluation: EvaluationCycleResult;
  openLots: PositionLotRow[];
  tradesById: Map<string, TradeRow>;
  runConfig: GuardianRunConfig;
  accountKey: string;
  markPrice: string;
  ruleProviders?: readonly GuardianRuleProvider[];
  /** M4 dynamic SL/TP — opt-in; omitted preserves M3 behavior. */
  exitEngine?: EvaluatePositionGuardianExitEngineInput;
  /** M5 exit intelligence overlay — opt-in; omitted preserves M3/M4 behavior. */
  exitIntelligence?: EvaluatePositionGuardianExitIntelligenceInput;
  /** PR1 canonical symbol inventory — caps batch EXIT_FULL quantities. */
  canonicalInventory?: Pick<CanonicalInventoryWalkResult, "openQtyBySymbol">;
  minOrderQty?: string;
};

export class GuardianObservationScopeError extends Error {
  readonly code = "GUARDIAN_OBSERVATION_SCOPE_MISMATCH";

  constructor(
    readonly reason:
      | "INVALID_SCOPE"
      | "INSTRUMENT_MISMATCH"
      | "LOT_SCOPE_MISMATCH"
      | "TRADE_BINDING_MISSING"
      | "TRADE_BINDING_MISMATCH",
  ) {
    super(`GUARDIAN_OBSERVATION_SCOPE_MISMATCH: ${reason}`);
    this.name = "GuardianObservationScopeError";
  }
}

/** Exact stored identities only: historical symbol aliases do not confer scope. */
export function requireGuardianObservationScope(
  input: Pick<EvaluatePositionGuardianInput, "context" | "accountKey" | "snapshot" | "evaluation">,
): { organizationId: string; accountKey: string; symbol: string } {
  const { organizationId } = input.context;
  const { accountKey } = input;
  const symbol = input.evaluation.features.instrumentId;
  if (!organizationId.trim() || !accountKey.trim() || !symbol.trim()) {
    throw new GuardianObservationScopeError("INVALID_SCOPE");
  }
  if (
    input.evaluation.msv.instrumentId !== symbol ||
    input.snapshot.quote.symbol !== symbol ||
    input.snapshot.bars.some((bar) => bar.symbol !== symbol)
  ) {
    throw new GuardianObservationScopeError("INSTRUMENT_MISMATCH");
  }
  return { organizationId, accountKey, symbol };
}

function assertGuardianLotTradeBindings(input: EvaluatePositionGuardianInput): void {
  const scope = requireGuardianObservationScope(input);
  if (
    input.exitEngine?.runConfig.enabled &&
    input.exitEngine.bars.some((bar) => bar.symbol !== scope.symbol)
  ) {
    throw new GuardianObservationScopeError("INSTRUMENT_MISMATCH");
  }
  // Validate the entire batch before any trailing-map mutation or observations.
  for (const lot of input.openLots) {
    if (
      lot.organizationId !== scope.organizationId ||
      lot.accountKey !== scope.accountKey ||
      lot.symbol !== scope.symbol ||
      lot.state !== "OPEN"
    ) {
      throw new GuardianObservationScopeError("LOT_SCOPE_MISMATCH");
    }
    const trade = input.tradesById.get(lot.tradeId);
    if (!trade) throw new GuardianObservationScopeError("TRADE_BINDING_MISSING");
    if (
      trade.id !== lot.tradeId ||
      trade.organizationId !== lot.organizationId ||
      trade.accountKey !== lot.accountKey ||
      trade.symbol !== lot.symbol ||
      trade.venue !== lot.venue ||
      trade.positionSide !== lot.positionSide ||
      trade.instrumentKind !== lot.instrumentKind ||
      trade.strategySignalId !== lot.strategySignalId
    ) {
      throw new GuardianObservationScopeError("TRADE_BINDING_MISMATCH");
    }
  }
}

export function computeBarsHeld(
  openedAt: Date,
  evaluatedAt: string,
  barIntervalMs: number,
): number {
  const evalMs = new Date(evaluatedAt).getTime();
  const openMs = openedAt.getTime();
  if (Number.isNaN(evalMs) || Number.isNaN(openMs)) {
    return 1;
  }
  if (evalMs <= openMs) {
    return 1;
  }
  return Math.floor((evalMs - openMs) / barIntervalMs) + 1;
}

export function computeUnrealizedPnlUsdt(
  markPrice: string,
  avgCost: string,
  remainingQty: string,
): string {
  const priceDiff = subtractDecimal(markPrice, avgCost);
  return multiplyDecimal(priceDiff, remainingQty);
}

function sortOpenLots(lots: PositionLotRow[]): PositionLotRow[] {
  return [...lots].sort((a, b) => {
    if (a.symbol !== b.symbol) {
      return a.symbol.localeCompare(b.symbol);
    }
    const aTime = a.openedAt.getTime();
    const bTime = b.openedAt.getTime();
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    return a.id.localeCompare(b.id);
  });
}

function prepareExitEngineState(input: EvaluatePositionGuardianInput): {
  exitPlanByLotId: Map<string, ExitPlan>;
  ruleProviders: readonly GuardianRuleProvider[];
} {
  if (!input.exitEngine?.runConfig.enabled) {
    return {
      exitPlanByLotId: new Map(),
      ruleProviders: input.ruleProviders ?? [],
    };
  }

  const exitPlanByLotId = new Map<string, ExitPlan>();
  const sortedLots = sortOpenLots(input.openLots);

  // Absence from this account/instrument subset is not proof of closure.
  // The session map has no scope metadata; preserve unrelated entries. Its
  // owner, not an observation of one scope, owns session-state cleanup.

  for (const lot of sortedLots) {
    const plan = buildExitPlan({
      lot,
      bars: input.exitEngine.bars,
      runConfig: input.exitEngine.runConfig,
      evaluatedAt: input.snapshot.evaluatedAt,
    });
    if (!plan) {
      continue;
    }

    const trailingState = updateTrailingSessionState({
      plan,
      priorTrailing: input.exitEngine.trailingStateByLotId.get(lot.id),
      bars: input.exitEngine.bars,
      lot,
      markPrice: input.markPrice,
      evaluatedAt: input.snapshot.evaluatedAt,
    });
    input.exitEngine.trailingStateByLotId.set(lot.id, trailingState);
    exitPlanByLotId.set(lot.id, plan);
  }

  const slTpProvider = createSlTpGuardianRuleProvider({
    getExitPlan: (lotId) => exitPlanByLotId.get(lotId),
    getTrailingState: (lotId) => input.exitEngine!.trailingStateByLotId.get(lotId),
  });

  return {
    exitPlanByLotId,
    ruleProviders: [slTpProvider, ...(input.ruleProviders ?? [])],
  };
}

export function evaluatePositionGuardian(
  input: EvaluatePositionGuardianInput,
): GuardianCycleResult {
  if (!input.runConfig.enabled || input.openLots.length === 0) {
    return { evaluations: [], exitIntents: [] };
  }

  assertGuardianLotTradeBindings(input);

  const barIntervalMs = input.runConfig.barIntervalMs ?? 60_000;
  const { msv } = input.evaluation;
  const evaluations: GuardianPositionEvaluation[] = [];
  const exitIntents: ExitIntent[] = [];
  const { exitPlanByLotId, ruleProviders } = prepareExitEngineState(input);
  const batchAllocatedBySymbol = new Map<string, string>();
  const openQtyBySymbol = input.canonicalInventory?.openQtyBySymbol;
  const minOrderQty = input.minOrderQty ?? "0.00001";

  for (const lot of sortOpenLots(input.openLots)) {
    const trade = input.tradesById.get(lot.tradeId)!;

    const barsHeld = computeBarsHeld(lot.openedAt, input.snapshot.evaluatedAt, barIntervalMs);
    const unrealizedPnlUsdt = computeUnrealizedPnlUsdt(
      input.markPrice,
      lot.avgCost,
      lot.remainingQty,
    );

    const exitPlan = exitPlanByLotId.get(lot.id);
    const trailingState = input.exitEngine?.trailingStateByLotId.get(lot.id);

    const ruleInput = {
      lot,
      trade,
      tradingPermission: msv.derived.tradingPermission,
      allowedStrategyIds: msv.derived.allowedStrategyIds,
      regime: msv.derived.regime,
      markPrice: input.markPrice,
      barsHeld,
      cycleId: input.snapshot.cycleId,
      evaluatedAt: input.snapshot.evaluatedAt,
    };

    const action = decideGuardianAction({
      tradingPermission: msv.derived.tradingPermission,
      allowedStrategyIds: msv.derived.allowedStrategyIds,
      tradeStrategyId: trade.strategyId,
      barsHeld,
      maxHoldBars: input.runConfig.maxHoldBars,
      ruleProviders,
      ruleInput,
    });

    const slTpLevels =
      exitPlan && trailingState ? toSlTpLevelsSnapshot(exitPlan, trailingState) : null;

    const evaluationId = `${input.snapshot.cycleId}:${lot.id}`;

    const isExitDecision = action.decision === "EXIT_FULL" || action.decision === "EXIT_PARTIAL";

    let exitQtyResult: ReturnType<typeof computeExitQuantity> | null = null;
    if (isExitDecision) {
      exitQtyResult = computeExitQuantity({
        decision: action.decision,
        ruleReasonCode: action.reasonCode,
        remainingQty: lot.remainingQty,
        partialExitFraction: action.partialExitFraction,
        symbol: lot.symbol,
        minOrderQty,
        openQtyBySymbol,
        batchAllocatedBySymbol,
      });

      if (openQtyBySymbol && compareDecimal(exitQtyResult.approvedQty, "0") > 0) {
        const priorAllocated = batchAllocatedBySymbol.get(lot.symbol) ?? "0";
        batchAllocatedBySymbol.set(
          lot.symbol,
          addDecimal(priorAllocated, exitQtyResult.approvedQty),
        );
      }
    }

    const effectiveDecision = exitQtyResult?.effectiveDecision ?? action.decision;
    const effectiveReasonCode = exitQtyResult?.effectiveReasonCode ?? action.reasonCode;

    const baseReason = {
      schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
      decision: effectiveDecision,
      reasonCode: effectiveReasonCode,
      ruleId: action.ruleId,
      cycleId: input.snapshot.cycleId,
      evaluatedAt: input.snapshot.evaluatedAt,
      symbol: lot.symbol,
      positionLotId: lot.id,
      tradeId: lot.tradeId,
      strategyId: trade.strategyId,
      openingStrategySignalId: lot.strategySignalId,
      regime: msv.derived.regime,
      tradingPermission: msv.derived.tradingPermission,
      remainingQty: lot.remainingQty,
      avgCost: lot.avgCost,
      markPrice: input.markPrice,
      unrealizedPnlUsdt,
      barsHeld,
      slTpLevels,
      rMultiple: null,
      invalidation: null,
      patternRefs: [],
      signalRefs: [],
      exitIntelligenceContext: null,
      requestedExitQty: exitQtyResult?.requestedQty,
      approvedExitQty: exitQtyResult?.approvedQty,
      inventoryAvailableQty: exitQtyResult?.inventoryAvailableQty,
      partialExitFraction: exitQtyResult?.partialExitFraction ?? null,
      inventoryCapApplied: exitQtyResult?.inventoryCapApplied ?? false,
    } satisfies Omit<GuardianReasonRecord, "exitIntelligenceContext"> & {
      exitIntelligenceContext: null;
    };

    const exitIntelligenceContext =
      input.exitIntelligence?.runConfig.enabled === true
        ? buildExitIntelligenceContext({
            reason: baseReason,
            trade,
            msv: input.evaluation.msv,
            signals: input.evaluation.signals,
          })
        : null;

    const reason: GuardianReasonRecord = {
      ...baseReason,
      exitIntelligenceContext,
    };

    evaluations.push({
      evaluationId,
      positionLotId: lot.id,
      tradeId: lot.tradeId,
      symbol: lot.symbol,
      strategyId: trade.strategyId,
      strategyVersion: trade.strategyVersion,
      openingStrategySignalId: lot.strategySignalId,
      decision: effectiveDecision,
      reason,
      occurredAt: input.snapshot.evaluatedAt,
    });

    if (!isExitDecision || !exitQtyResult) {
      continue;
    }

    if (compareDecimal(exitQtyResult.approvedQty, "0") <= 0 || exitQtyResult.belowMinQty) {
      continue;
    }

    const exitKind = effectiveDecision === "EXIT_PARTIAL" ? "REDUCE_LONG" : "CLOSE_LONG";

    const orderKeys = guardianOrderKeys(input.snapshot.cycleId, lot.id);
    exitIntents.push({
      intentId: `${evaluationId}:exit`,
      evaluationId,
      kind: exitKind,
      positionLotId: lot.id,
      tradeId: lot.tradeId,
      symbol: lot.symbol,
      side: "sell",
      quantity: exitQtyResult.approvedQty,
      openingStrategySignalId: lot.strategySignalId,
      strategyId: trade.strategyId,
      strategyVersion: trade.strategyVersion,
      referencePrice: input.markPrice,
      accountKey: input.accountKey,
      reason,
      clientOrderId: orderKeys.clientOrderId,
      idempotencyKey: orderKeys.idempotencyKey,
    });
  }

  return { evaluations, exitIntents };
}
