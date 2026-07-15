import { buildMsvPayloadCanonical } from "@/lib/trader/mi/serialize-observation";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";
import {
  CYCLE_PROJECTION_SCHEMA_VERSION,
  type ReplayCycleEvidenceProjection,
  type ReplayCycleGuardianProjection,
  type ReplayCycleStrategyExecutionProjection,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

function serializeStrategyExecutions(
  cycle: PaperCycleResult,
): ReplayCycleStrategyExecutionProjection[] {
  return cycle.strategyExecutions.map((entry) => ({
    signalId: entry.signal.strategyId,
    side: entry.signal.side ?? null,
    submitBlocked: entry.submitBlocked,
    skipReason: entry.skipReason ?? null,
    executionStatus: entry.execution?.status ?? null,
    orderState:
      entry.execution && entry.execution.status === "submitted"
        ? entry.execution.order.state
        : null,
    orderId:
      entry.execution && entry.execution.status === "submitted" ? entry.execution.order.id : null,
  }));
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
  return {
    evaluatedAt: evaluation.features.evaluatedAt,
    fused: evaluation.fusedContext ?? null,
    understanding: evaluation.understanding ?? null,
    decisionChain: evaluation.decisionChain ?? null,
    signal: evaluation.signal,
    guardian: cycle.guardian ?? null,
    guardianExecutions: cycle.guardianExecutions ?? null,
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
    evaluatedAtMs: new Date(cycle.evaluation.msv.evaluatedAt).getTime(),
    regime: cycle.evaluation.msv.derived.regime,
    skipReason: cycle.skipReason ?? null,
    strategyExecutions: serializeStrategyExecutions(cycle),
    guardian: serializeGuardian(cycle),
    msv: buildMsvPayloadCanonical(cycle.evaluation.msv),
    m9Trace: {
      ...serializeM9Trace(cycle),
      intelligenceTrace,
    },
  };
}
