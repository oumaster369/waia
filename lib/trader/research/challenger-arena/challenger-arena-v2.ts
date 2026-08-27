import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  requireForecastModelArtifactV2,
  type ForecastModelArtifactV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import { energyMcV1 } from "@/lib/trader/research/benchmark/energy-mc-v1";
import {
  multiclassLogScore,
  type TerminalTargetGrid,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import {
  requireModelTrialSpecV2,
  type ModelTrialSpecV2,
} from "@/lib/trader/research/forecast-model-registry";

export type ArenaSubmissionV2 = Readonly<{
  trialSpec: ModelTrialSpecV2;
  artifact: ForecastModelArtifactV2;
  anchorClosedBarAt: string;
  mathematicalInputDigestHex: string;
  terminalTargetDefinitionDigestHex: string;
  executionOpportunityTargetDefinitionDigestHex: string;
  executionOpportunityTargetDefinition: Readonly<{
    horizonMinutes: 30 | 60;
    coordinates: readonly [
      "R1",
      "R2",
      "R3",
      "Rh",
      "Rh+1",
      "Rh+2",
      "Rh+3",
      "V1",
      "V2",
      "V3",
      "Vh+1",
      "Vh+2",
      "Vh+3",
    ];
  }>;
  terminalBucketProbabilities: readonly number[];
  joint13dSamples: readonly (readonly number[])[];
  evidencePartition: "DEVELOPMENT" | "VALIDATION";
  selectionMetric: "PROPER_PREDICTIVE_SCORE";
}>;

export type ArenaEvidenceV2 = Readonly<{
  schemaVersion: "waia.trader.challenger_arena_evidence.v2";
  anchorClosedBarAt: string;
  results: readonly Readonly<{
    modelId: string;
    terminalLogScore: number;
    jointEnergyScore: number;
    marginalIndependenceEnergyScore: number;
    capitalEligible: false;
  }>[];
  comparisonIdentityDigestHex: string;
  disposition: "RESEARCH_EVIDENCE_ONLY";
  contentDigestHex: string;
}>;

function independentMarginalNull(samples: readonly (readonly number[])[]): number[][] {
  return samples.map((_, row) =>
    Array.from({ length: 13 }, (__, column) => samples[(row + column) % samples.length]![column]!),
  );
}

const DIGEST_HEX = /^[0-9a-f]{64}$/;
const EXECUTION_OPPORTUNITY_COORDINATES = [
  "R1",
  "R2",
  "R3",
  "Rh",
  "Rh+1",
  "Rh+2",
  "Rh+3",
  "V1",
  "V2",
  "V3",
  "Vh+1",
  "Vh+2",
  "Vh+3",
] as const;

function requireCanonicalAnchor(value: string): void {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
    throw new Error("CHALLENGER_ARENA_ANCHOR_INVALID");
}

export function runChallengerArenaV2(input: {
  submissions: readonly ArenaSubmissionV2[];
  terminalGrid: TerminalTargetGrid;
  observedTerminalReturn: number;
  observedJoint13d: readonly number[];
}): ArenaEvidenceV2 {
  if (input.submissions.length === 0) throw new Error("CHALLENGER_ARENA_EMPTY");
  if (
    input.terminalGrid.bucketCount !== 7 ||
    input.terminalGrid.edges.length !== 6 ||
    input.terminalGrid.edges.some((edge) => !Number.isFinite(edge)) ||
    input.terminalGrid.edges.some(
      (edge, index) => index > 0 && edge <= input.terminalGrid.edges[index - 1]!,
    )
  )
    throw new Error("CHALLENGER_ARENA_TERMINAL_GRID_INVALID");
  if (
    input.observedJoint13d.length !== 13 ||
    input.observedJoint13d.some((value) => !Number.isFinite(value)) ||
    !Number.isFinite(input.observedTerminalReturn)
  )
    throw new Error("CHALLENGER_ARENA_OBSERVATION_INVALID");
  const first = input.submissions[0]!;
  requireCanonicalAnchor(first.anchorClosedBarAt);
  const terminalGridContentDigestHex = computeSemanticSha256Hex(input.terminalGrid);
  if (first.terminalTargetDefinitionDigestHex !== terminalGridContentDigestHex)
    throw new Error("CHALLENGER_ARENA_TERMINAL_TARGET_BINDING_MISMATCH");
  const seenModelSpecs = new Set<string>();
  const results = input.submissions
    .map((submission) => {
      const trial = requireModelTrialSpecV2(submission.trialSpec);
      const artifact = requireForecastModelArtifactV2(submission.artifact);
      if (
        artifact.modelSpecDigestHex !== trial.modelSpec.contentDigestHex ||
        artifact.inputContractDigestHex !== trial.modelSpec.inputContractDigestHex
      )
        throw new Error("CHALLENGER_ARENA_ARTIFACT_MISMATCH");
      if (seenModelSpecs.has(trial.modelSpec.contentDigestHex))
        throw new Error("CHALLENGER_ARENA_DUPLICATE_MODEL_SPEC");
      seenModelSpecs.add(trial.modelSpec.contentDigestHex);
      if (trial.readiness !== "EXECUTOR_READY")
        throw new Error(`CHALLENGER_ARENA_NOT_EXECUTABLE:${trial.readiness}`);
      requireCanonicalAnchor(submission.anchorClosedBarAt);
      for (const digest of [
        submission.mathematicalInputDigestHex,
        submission.terminalTargetDefinitionDigestHex,
        submission.executionOpportunityTargetDefinitionDigestHex,
      ])
        if (!DIGEST_HEX.test(digest)) throw new Error("CHALLENGER_ARENA_IDENTITY_INVALID");
      if (
        submission.anchorClosedBarAt !== first.anchorClosedBarAt ||
        submission.mathematicalInputDigestHex !== first.mathematicalInputDigestHex
      )
        throw new Error("CHALLENGER_ARENA_COMMON_ANCHOR_MISMATCH");
      if (
        submission.terminalTargetDefinitionDigestHex !== first.terminalTargetDefinitionDigestHex ||
        submission.executionOpportunityTargetDefinitionDigestHex !==
          first.executionOpportunityTargetDefinitionDigestHex
      )
        throw new Error("CHALLENGER_ARENA_COMMON_TARGET_MISMATCH");
      if (submission.evidencePartition !== first.evidencePartition)
        throw new Error("CHALLENGER_ARENA_COMMON_PARTITION_MISMATCH");
      if (
        (submission.executionOpportunityTargetDefinition.horizonMinutes !== 30 &&
          submission.executionOpportunityTargetDefinition.horizonMinutes !== 60) ||
        JSON.stringify(submission.executionOpportunityTargetDefinition.coordinates) !==
          JSON.stringify(EXECUTION_OPPORTUNITY_COORDINATES)
      )
        throw new Error("CHALLENGER_ARENA_EXECUTION_TARGET_INVALID");
      if (
        submission.terminalTargetDefinitionDigestHex !== terminalGridContentDigestHex ||
        submission.executionOpportunityTargetDefinitionDigestHex !==
          computeSemanticSha256Hex(submission.executionOpportunityTargetDefinition)
      )
        throw new Error("CHALLENGER_ARENA_TARGET_BINDING_MISMATCH");
      if (
        submission.terminalTargetDefinitionDigestHex !==
          trial.modelSpec.terminalTargetDefinitionDigestHex ||
        submission.executionOpportunityTargetDefinitionDigestHex !==
          trial.modelSpec.executionOpportunityTargetDefinitionDigestHex
      )
        throw new Error("CHALLENGER_ARENA_TARGET_MISMATCH");
      if (
        submission.evidencePartition !== "DEVELOPMENT" &&
        submission.evidencePartition !== "VALIDATION"
      )
        throw new Error("CHALLENGER_ARENA_HOLDOUT_FORBIDDEN");
      if (submission.selectionMetric !== "PROPER_PREDICTIVE_SCORE")
        throw new Error("CHALLENGER_ARENA_PNL_SELECTION_FORBIDDEN");
      const probabilitySum = submission.terminalBucketProbabilities.reduce(
        (sum, probability) => sum + probability,
        0,
      );
      if (
        submission.terminalBucketProbabilities.length !== 7 ||
        submission.terminalBucketProbabilities.some(
          (probability) => !Number.isFinite(probability) || probability < 0,
        ) ||
        Math.abs(probabilitySum - 1) > 1e-12
      )
        throw new Error("CHALLENGER_ARENA_TERMINAL_DISTRIBUTION_INVALID");
      if (
        submission.joint13dSamples.length < 2 ||
        submission.joint13dSamples.some(
          (row) => row.length !== 13 || row.some((value) => !Number.isFinite(value)),
        )
      )
        throw new Error("CHALLENGER_ARENA_JOINT_SAMPLE_INVALID");
      return {
        modelId: trial.modelSpec.modelId,
        terminalLogScore: multiclassLogScore(
          input.observedTerminalReturn,
          submission.terminalBucketProbabilities,
          input.terminalGrid,
        ),
        jointEnergyScore: energyMcV1({
          samples: submission.joint13dSamples,
          reference: input.observedJoint13d,
        }),
        marginalIndependenceEnergyScore: energyMcV1({
          samples: independentMarginalNull(submission.joint13dSamples),
          reference: input.observedJoint13d,
        }),
        capitalEligible: false as const,
      };
    })
    .sort(
      (a, b) =>
        b.terminalLogScore - a.terminalLogScore ||
        a.jointEnergyScore - b.jointEnergyScore ||
        a.modelId.localeCompare(b.modelId),
    );
  const comparisonIdentityDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.challenger_arena_comparison_identity.v2",
    terminalGridContentDigestHex,
    observedTerminalReturn: input.observedTerminalReturn,
    observedJoint13d: input.observedJoint13d,
    submissions: input.submissions
      .map((submission) => ({
        trialSpecDigestHex: submission.trialSpec.contentDigestHex,
        modelSpecDigestHex: submission.trialSpec.modelSpec.contentDigestHex,
        artifactContentDigestHex: submission.artifact.contentDigestHex,
        anchorClosedBarAt: submission.anchorClosedBarAt,
        mathematicalInputDigestHex: submission.mathematicalInputDigestHex,
        terminalTargetDefinitionDigestHex: submission.terminalTargetDefinitionDigestHex,
        executionOpportunityTargetDefinitionDigestHex:
          submission.executionOpportunityTargetDefinitionDigestHex,
        evidencePartition: submission.evidencePartition,
        terminalDistributionDigestHex: computeSemanticSha256Hex(
          submission.terminalBucketProbabilities,
        ),
        jointDistributionDigestHex: computeSemanticSha256Hex(submission.joint13dSamples),
      }))
      .sort((a, b) => a.modelSpecDigestHex.localeCompare(b.modelSpecDigestHex)),
  });
  const body = {
    schemaVersion: "waia.trader.challenger_arena_evidence.v2" as const,
    anchorClosedBarAt: first.anchorClosedBarAt,
    results,
    comparisonIdentityDigestHex,
    disposition: "RESEARCH_EVIDENCE_ONLY" as const,
  };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}
