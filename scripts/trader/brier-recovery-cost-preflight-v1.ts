import { buildBaselineContextFromDevelopment, evaluateMandatoryBaselineV1, MANDATORY_BASELINE_IDS }
  from "../../lib/trader/research/benchmark/baseline-models-v1";
import { multiclassBrierRewardV1, TERMINAL_SCORING_CONTRACT, TERMINAL_SCORING_AMENDMENT_DIGEST, assertTerminalDevelopmentReturnsV2 }
  from "../../lib/trader/research/benchmark/terminal-scoring-protocol-v2";
import type { ResearchHarnessAdmissionInputV1 } from "../../lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import { CDF_ERF_CODY715_VERSION, CDF_REFERENCE_AMENDMENT_DIGEST } from
  "../../lib/trader/research/benchmark/cdf-evidence-protocol-v2";

/** Diagnostic necessary-condition check ONLY. Never a scientific receipt, p-value,
 * qualification, store reader, generator or substitute for the complete harness.
 * Evaluating preserved production data still requires separate authorization.
 */
export function inspectBrierRecoveryCostPreflightV1(input: ResearchHarnessAdmissionInputV1) {
  if (input.anchors.length === 0) throw new Error("BRIER_PREFLIGHT_EMPTY_ANCHORS");
  assertTerminalDevelopmentReturnsV2(input.developmentReturns);
  const anchors = [...input.anchors].sort((a, b) => a.anchorId.localeCompare(b.anchorId));
  if (new Set(anchors.map(a => a.anchorId)).size !== anchors.length)
    throw new Error("BRIER_PREFLIGHT_DUPLICATE_ANCHORS");
  const context = buildBaselineContextFromDevelopment({
    developmentReturns: input.developmentReturns, history: input.historyReturns,
    historyMinuteOpenTimesMs: input.historyReturnMinuteOpenTimesMs,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
  });
  // Same scoring and ascending anchor arithmetic as the production harness.
  const challenger = anchors.map(a => multiclassBrierRewardV1(a.observedReturn, a.challengerProbabilities, context.grid));
  const comparisons = MANDATORY_BASELINE_IDS.map(baselineId => {
    const baseline = evaluateMandatoryBaselineV1(baselineId, context);
    if (baseline.status === "UNAVAILABLE") return { baselineId, status: "UNAVAILABLE" as const, meanImprovement: null };
    let sum = 0;
    for (let i = 0; i < anchors.length; i++) {
      sum += challenger[i]! - multiclassBrierRewardV1(anchors[i]!.observedReturn, baseline.probabilities, context.grid);
      if (!Number.isFinite(sum)) throw new Error("BRIER_PREFLIGHT_INVALID_SUM");
    }
    const meanImprovement = sum / anchors.length;
    return { baselineId, status: meanImprovement > 0 ? "POSITIVE_MEAN" as const : "NON_POSITIVE_MEAN" as const, meanImprovement };
  });
  return {
    schemaVersion: "brier-recovery-cost-preflight/v2" as const,
    cdfKernelVersion: CDF_ERF_CODY715_VERSION,
    cdfAmendmentDigestHex: CDF_REFERENCE_AMENDMENT_DIGEST,
    authorityGranted: false as const,
    qualification: "NOT_RUN" as const,
    bootstrap: "NOT_RUN" as const,
    scoringContract: TERMINAL_SCORING_CONTRACT,
    amendmentDigestHex: TERMINAL_SCORING_AMENDMENT_DIGEST,
    anchorCount: anchors.length,
    comparisons,
    necessaryCondition: comparisons.every(c => c.status === "POSITIVE_MEAN")
      ? "SATISFIED_NOT_QUALIFIED" as const : "UNSATISFIED_NO_ADMISSION" as const,
    // Work units, NOT elapsed-time promises. No allowance for setup/RNG retries.
    fullFiveBaselineBootstrapVisits: (BigInt(anchors.length) * 10_000n * 5n).toString(),
    estimatedCompletionTime: null,
    executionPermitted: false as const,
  };
}
