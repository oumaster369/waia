import {
  buildExplanation,
  detectCrossLayerConflicts,
} from "@/lib/trader/intelligence/m5/exit-intelligence-conflicts";
import {
  buildRegimeContext,
  collectStrategySignalRefs,
  computeAnalyticalScores,
  summarizeLayerState,
} from "@/lib/trader/intelligence/m5/exit-intelligence-scores";
import {
  EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION,
  type ExitIntelligenceContext,
} from "@/lib/trader/intelligence/m5/exit-intelligence-types";
import type { GuardianReasonRecord } from "@/lib/trader/guardian/guardian-reason-record.types";
import type { StrategySignal } from "@/lib/trader/intelligence/types";
import type { MsvEnvelope } from "@/lib/trader/intelligence/types";
import type { TradeRow } from "@/lib/trader/lifecycle/trade-lifecycle.types";

export type BuildExitIntelligenceContextInput = {
  reason: GuardianReasonRecord;
  trade: TradeRow;
  msv: MsvEnvelope;
  signals?: readonly StrategySignal[];
};

/**
 * Pure reasoning overlay — consumes assembled GuardianReasonRecord + read-only MSV/trade.
 * Does not evaluate exit rules, alter decisions, or emit execution intents.
 */
export function buildExitIntelligenceContext(
  input: BuildExitIntelligenceContextInput,
): ExitIntelligenceContext {
  const regimeContext = buildRegimeContext({
    reason: input.reason,
    msv: input.msv,
    openingRegime: input.trade.openingRegime,
  });
  const layerSummary = summarizeLayerState(input.reason);
  const scores = computeAnalyticalScores({
    reason: input.reason,
    msv: input.msv,
    regimeContext,
    layerSummary,
  });
  const conflictAnalysis = detectCrossLayerConflicts({
    reason: input.reason,
    layerSummary,
    regimeContext,
  });

  return {
    schemaVersion: EXIT_INTELLIGENCE_CONTEXT_SCHEMA_VERSION,
    positionId: input.reason.positionLotId,
    cycleId: input.reason.cycleId,
    evaluatedAt: input.reason.evaluatedAt,
    guardianOutcome: {
      decision: input.reason.decision,
      reasonCode: input.reason.reasonCode,
      ruleId: input.reason.ruleId,
    },
    m4Levels: input.reason.slTpLevels,
    regimeContext,
    strategySignalRefs: collectStrategySignalRefs({
      symbol: input.reason.symbol,
      strategyId: input.reason.strategyId,
      signals: input.signals ?? [],
    }),
    layerSummary,
    scores,
    conflictAnalysis,
    explanation: buildExplanation({
      reason: input.reason,
      scores,
      conflictAnalysis,
    }),
  };
}
