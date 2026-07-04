import { decideGuardianAction } from "@/lib/trader/guardian/guardian-decision-model";
import { guardianOrderKeys } from "@/lib/trader/guardian/guardian-order-keys";
import { GUARDIAN_REASON_RECORD_SCHEMA_VERSION } from "@/lib/trader/guardian/guardian-reason-record.types";
import type { GuardianRunConfig } from "@/lib/trader/guardian/guardian-run-config.types";
import type { GuardianRuleProvider } from "@/lib/trader/guardian/guardian-rule-provider.types";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { PositionLotRow, TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";
import type { MarketSnapshot } from "@/lib/trader/market-data/types";
import { multiplyDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

import type {
  ExitIntent,
  GuardianCycleResult,
  GuardianPositionEvaluation,
} from "@/lib/trader/guardian/guardian.types";

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
};

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

export function evaluatePositionGuardian(
  input: EvaluatePositionGuardianInput,
): GuardianCycleResult {
  if (!input.runConfig.enabled || input.openLots.length === 0) {
    return { evaluations: [], exitIntents: [] };
  }

  const barIntervalMs = input.runConfig.barIntervalMs ?? 60_000;
  const { msv } = input.evaluation;
  const evaluations: GuardianPositionEvaluation[] = [];
  const exitIntents: ExitIntent[] = [];

  for (const lot of sortOpenLots(input.openLots)) {
    const trade = input.tradesById.get(lot.tradeId);
    if (!trade) {
      continue;
    }

    const barsHeld = computeBarsHeld(lot.openedAt, input.snapshot.evaluatedAt, barIntervalMs);
    const unrealizedPnlUsdt = computeUnrealizedPnlUsdt(
      input.markPrice,
      lot.avgCost,
      lot.remainingQty,
    );

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
      ruleProviders: input.ruleProviders,
      ruleInput,
    });

    const evaluationId = `${input.snapshot.cycleId}:${lot.id}`;
    const reason = {
      schemaVersion: GUARDIAN_REASON_RECORD_SCHEMA_VERSION,
      decision: action.decision,
      reasonCode: action.reasonCode,
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
      slTpLevels: null,
      rMultiple: null,
      invalidation: null,
      patternRefs: [],
      signalRefs: [],
    } as const;

    evaluations.push({
      evaluationId,
      positionLotId: lot.id,
      tradeId: lot.tradeId,
      symbol: lot.symbol,
      strategyId: trade.strategyId,
      strategyVersion: trade.strategyVersion,
      openingStrategySignalId: lot.strategySignalId,
      decision: action.decision,
      reason,
      occurredAt: input.snapshot.evaluatedAt,
    });

    if (action.decision === "EXIT_FULL") {
      const orderKeys = guardianOrderKeys(input.snapshot.cycleId, lot.id);
      exitIntents.push({
        intentId: `${evaluationId}:exit`,
        evaluationId,
        kind: "CLOSE_LONG",
        positionLotId: lot.id,
        tradeId: lot.tradeId,
        symbol: lot.symbol,
        side: "sell",
        quantity: lot.remainingQty,
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
  }

  return { evaluations, exitIntents };
}
