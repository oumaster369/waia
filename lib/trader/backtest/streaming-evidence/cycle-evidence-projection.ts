import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  CYCLE_PROJECTION_SCHEMA_VERSION,
  type ReplayCycleEvidenceProjection,
  type ReplayCycleGuardianProjection,
  type ReplayCycleStrategyExecutionProjection,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

const EMPTY_STRATEGY_EXECUTIONS: ReplayCycleStrategyExecutionProjection[] = Object.freeze(
  [],
) as ReplayCycleStrategyExecutionProjection[];

function serializeStrategyExecutions(
  cycle: PaperCycleResult,
): ReplayCycleStrategyExecutionProjection[] {
  const executions = cycle.strategyExecutions;
  if (executions.length === 0) {
    return EMPTY_STRATEGY_EXECUTIONS;
  }
  const out: ReplayCycleStrategyExecutionProjection[] = new Array(executions.length);
  for (let index = 0; index < executions.length; index += 1) {
    const entry = executions[index]!;
    const submitted = entry.execution?.status === "submitted";
    out[index] = {
      signalId: entry.signal.strategyId,
      side: entry.signal.side ?? null,
      submitBlocked: entry.submitBlocked,
      skipReason: entry.skipReason ?? null,
      executionStatus: entry.execution?.status ?? null,
      orderState: submitted ? entry.execution!.order.state : null,
      orderId: submitted ? entry.execution!.order.id : null,
    };
  }
  return out;
}

function serializeGuardian(cycle: PaperCycleResult): ReplayCycleGuardianProjection | null {
  if (!cycle.guardian) {
    return null;
  }
  return {
    evaluationCount: cycle.guardian.evaluations.length,
    exitIntentCount: cycle.guardian.exitIntents.length,
    guardianExecutionCount: cycle.guardianExecutions?.length ?? 0,
  };
}

function serializeM9Trace(cycle: PaperCycleResult): Record<string, unknown> | null {
  const evaluation = cycle.evaluation;
  // IDHPS hot path: keep O(1) digest-relevant fields only (avoid fat fused/decision payloads).
  return {
    evaluatedAt: evaluation.features.evaluatedAt,
    signal: evaluation.signal
      ? {
          strategyId: evaluation.signal.strategyId,
          strategyVersion: evaluation.signal.strategyVersion,
          symbol: evaluation.signal.symbol,
          side: evaluation.signal.side ?? null,
          outcome: evaluation.signal.outcome,
        }
      : null,
    htrGuardianBreach: cycle.htrGuardian?.breachState ?? null,
    guardianEvaluationCount: cycle.guardian?.evaluations.length ?? 0,
    guardianExitIntentCount: cycle.guardian?.exitIntents.length ?? 0,
    guardianExecutionCount: cycle.guardianExecutions?.length ?? 0,
  };
}

export function buildReplayCycleEvidenceProjection(
  cycleIndex: number,
  cycle: PaperCycleResult,
): ReplayCycleEvidenceProjection {
  const intelligenceTrace = cycle.evaluation.intelligenceCycleBundle
    ? {
        envelopeDigest: cycle.evaluation.intelligenceCycleBundle.envelope.contentDigest,
        terminalReasonCode: cycle.evaluation.intelligenceCycleBundle.envelope.terminalReasonCode,
        hypothesisCount: cycle.evaluation.intelligenceCycleBundle.hypotheses.length,
        convictionDigest: cycle.evaluation.intelligenceCycleBundle.conviction.contentDigest,
        convictionScope: cycle.evaluation.intelligenceCycleBundle.conviction.convictionScope,
        profileId: cycle.evaluation.intelligenceCycleBundle.envelope.historicalProfileId,
        profileDigest: cycle.evaluation.intelligenceCycleBundle.envelope.historicalProfileDigest,
        matrixDigest: cycle.evaluation.intelligenceCycleBundle.envelope.matrixDigest,
      }
    : null;

  return {
    schemaVersion: CYCLE_PROJECTION_SCHEMA_VERSION,
    cycleIndex,
    evaluatedAtMs: Date.parse(cycle.evaluation.msv.evaluatedAt),
    regime: cycle.evaluation.msv.derived.regime,
    skipReason: cycle.skipReason ?? null,
    strategyExecutions: serializeStrategyExecutions(cycle),
    guardian: serializeGuardian(cycle),
    // IDHPS: digest-stable MSV identity fields only (avoid full canonical MSV payload/bar).
    msv: {
      instrumentId: cycle.evaluation.msv.instrumentId,
      evaluatedAt: cycle.evaluation.msv.evaluatedAt,
      regime: cycle.evaluation.msv.derived.regime,
      tradingPermission: cycle.evaluation.msv.derived.tradingPermission,
      riskMultiplier: cycle.evaluation.msv.derived.riskMultiplier ?? null,
    },
    m9Trace: {
      ...serializeM9Trace(cycle),
      intelligenceTrace,
    },
  };
}
