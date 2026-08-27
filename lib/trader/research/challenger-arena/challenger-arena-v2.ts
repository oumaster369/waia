import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { energyMcV1 } from "@/lib/trader/research/benchmark/energy-mc-v1";
import { multiclassLogScore, type TerminalTargetGrid } from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { requireModelTrialSpecV2, type ModelTrialSpecV2 } from "@/lib/trader/research/forecast-model-registry";

export type ArenaSubmissionV2 = Readonly<{
  trialSpec: ModelTrialSpecV2;
  anchorClosedBarAt: string;
  mathematicalInputDigestHex: string;
  terminalTargetDefinitionDigestHex: string;
  executionOpportunityTargetDefinitionDigestHex: string;
  terminalBucketProbabilities: readonly number[];
  joint13dSamples: readonly (readonly number[])[];
  evidencePartition: "DEVELOPMENT" | "VALIDATION";
  selectionMetric: "PROPER_PREDICTIVE_SCORE";
}>;

export type ArenaEvidenceV2 = Readonly<{
  schemaVersion: "waia.trader.challenger_arena_evidence.v2";
  anchorClosedBarAt: string;
  results: readonly Readonly<{ modelId: string; terminalLogScore: number; jointEnergyScore: number; marginalIndependenceEnergyScore: number; capitalEligible: false }>[];
  disposition: "RESEARCH_EVIDENCE_ONLY";
  contentDigestHex: string;
}>;

function independentMarginalNull(samples: readonly (readonly number[])[]): number[][] {
  return samples.map((_, row) => Array.from({ length: 13 }, (__, column) => samples[(row + column) % samples.length]![column]!));
}

export function runChallengerArenaV2(input: {
  submissions: readonly ArenaSubmissionV2[];
  terminalGrid: TerminalTargetGrid;
  observedTerminalReturn: number;
  observedJoint13d: readonly number[];
}): ArenaEvidenceV2 {
  if (input.submissions.length === 0) throw new Error("CHALLENGER_ARENA_EMPTY");
  const first = input.submissions[0]!;
  const results = input.submissions.map((submission) => {
    const trial = requireModelTrialSpecV2(submission.trialSpec);
    if (trial.readiness !== "EXECUTOR_READY") throw new Error(`CHALLENGER_ARENA_NOT_EXECUTABLE:${trial.readiness}`);
    if (submission.anchorClosedBarAt !== first.anchorClosedBarAt || submission.mathematicalInputDigestHex !== first.mathematicalInputDigestHex) throw new Error("CHALLENGER_ARENA_COMMON_ANCHOR_MISMATCH");
    if (submission.terminalTargetDefinitionDigestHex !== trial.modelSpec.terminalTargetDefinitionDigestHex || submission.executionOpportunityTargetDefinitionDigestHex !== trial.modelSpec.executionOpportunityTargetDefinitionDigestHex) throw new Error("CHALLENGER_ARENA_TARGET_MISMATCH");
    if (submission.evidencePartition !== "DEVELOPMENT" && submission.evidencePartition !== "VALIDATION") throw new Error("CHALLENGER_ARENA_HOLDOUT_FORBIDDEN");
    if (submission.selectionMetric !== "PROPER_PREDICTIVE_SCORE") throw new Error("CHALLENGER_ARENA_PNL_SELECTION_FORBIDDEN");
    const probabilitySum = submission.terminalBucketProbabilities.reduce((sum, probability) => sum + probability, 0);
    if (submission.terminalBucketProbabilities.length !== 7 || submission.terminalBucketProbabilities.some((probability) => !Number.isFinite(probability) || probability < 0) || Math.abs(probabilitySum - 1) > 1e-12) throw new Error("CHALLENGER_ARENA_TERMINAL_DISTRIBUTION_INVALID");
    if (submission.joint13dSamples.length < 2 || submission.joint13dSamples.some((row) => row.length !== 13 || row.some((value) => !Number.isFinite(value)))) throw new Error("CHALLENGER_ARENA_JOINT_SAMPLE_INVALID");
    return {
      modelId: trial.modelSpec.modelId,
      terminalLogScore: multiclassLogScore(input.observedTerminalReturn, submission.terminalBucketProbabilities, input.terminalGrid),
      jointEnergyScore: energyMcV1({ samples: submission.joint13dSamples, reference: input.observedJoint13d }),
      marginalIndependenceEnergyScore: energyMcV1({ samples: independentMarginalNull(submission.joint13dSamples), reference: input.observedJoint13d }),
      capitalEligible: false as const,
    };
  }).sort((a, b) => b.terminalLogScore - a.terminalLogScore || a.jointEnergyScore - b.jointEnergyScore || a.modelId.localeCompare(b.modelId));
  const body = { schemaVersion: "waia.trader.challenger_arena_evidence.v2" as const, anchorClosedBarAt: first.anchorClosedBarAt, results, disposition: "RESEARCH_EVIDENCE_ONLY" as const };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}
