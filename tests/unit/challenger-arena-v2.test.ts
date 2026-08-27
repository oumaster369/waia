import { describe, expect, it } from "vitest";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import {
  qualifyChallengerCandidatesV2,
  runChallengerArenaV2,
} from "@/lib/trader/research/challenger-arena";
import { buildModelTrialSpecV2 } from "@/lib/trader/research/forecast-model-registry";

const d = (c: string) => c.repeat(64);
const contract = buildForecastInputContractV2({
  measurementSemanticVersion: "rv/v2",
  hypothesisAssessmentSchemaVersion: "hyp/v1",
});
const terminalGrid = { edges: [-3, -2, -1, 1, 2, 3], bucketCount: 7 as const };
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
const terminalTargetDigest = computeSemanticSha256Hex(terminalGrid);
const executionOpportunityTargetDefinition = {
  horizonMinutes: 30 as const,
  coordinates: [
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
  ] as const,
};
const executionTargetDigest = computeSemanticSha256Hex(executionOpportunityTargetDefinition);
function trial(modelId: string, terminalTargetDefinitionDigestHex = terminalTargetDigest) {
  const modelSpec = buildForecastModelSpecV2({
    modelId,
    modelTransformVersion: modelId,
    inputContractDigestHex: contract.contentDigestHex,
    terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex: executionTargetDigest,
  });
  return buildModelTrialSpecV2({
    modelSpec,
    equations: ["frozen"],
    parameterConstraints: ["frozen"],
    pitFeatureVector: ["anchorRealizedVol20m_1m"],
    initialization: "frozen",
    fittingAlgorithm: "frozen",
    convergenceAndFailure: "fail closed",
    developmentHyperparameterGrid: [],
    tieBreak: "model id",
    forecastTransform: modelId,
    artifactSchema: "v1",
    scoringTargets: ["TERMINAL_7_BUCKET_LOG_SCORE", "JOINT_13D_ENERGY_SCORE"],
    knownAnswerFixtureIds: ["kat"],
    computeBudget: { maxObservations: 100, maxIterations: 10, maxWallClockMs: 1000 },
    readiness: "EXECUTOR_READY",
  });
}
function submission(modelId: string, targetDigest = terminalTargetDigest) {
  const trialSpec = trial(modelId, targetDigest);
  return {
    artifact: buildForecastModelArtifactV2({
      modelSpecDigestHex: trialSpec.modelSpec.contentDigestHex,
      inputContractDigestHex: contract.contentDigestHex,
      developmentDatasetDigestHex: d("4"),
      runtimeContractDigestHex: d("5"),
      artifactPayloadDigestHex: d("6"),
    }),
    anchorClosedBarAt: "2026-08-27T09:00:00.000Z",
    mathematicalInputDigestHex: d("3"),
    terminalTargetDefinitionDigestHex: targetDigest,
    executionOpportunityTargetDefinitionDigestHex: executionTargetDigest,
    executionOpportunityTargetDefinition,
    terminalBucketProbabilities: [0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.1],
    joint13dSamples: [new Array(13).fill(0), new Array(13).fill(0.1)],
    evidencePartition: "VALIDATION" as const,
    selectionMetric: "PROPER_PREDICTIVE_SCORE" as const,
    trialSpec,
  };
}

describe("DEE-648 common-anchor challenger arena", () => {
  it("scores terminal and joint forecasts, keeps marginal null explicit and cannot self-promote", () => {
    const evidence = runChallengerArenaV2({
      submissions: [submission("a"), submission("b")],
      terminalGrid,
      observedTerminalReturn: 0,
      observedJoint13d: new Array(13).fill(0),
    });
    expect(evidence.results).toHaveLength(2);
    expect(evidence.results.every((row) => row.capitalEligible === false)).toBe(true);
    expect(evidence.disposition).toBe("RESEARCH_EVIDENCE_ONLY");
    expect(evidence.results[0]!.marginalIndependenceEnergyScore).toBeTypeOf("number");
  });
  it("fails on mixed anchors and target drift", () => {
    expect(() =>
      runChallengerArenaV2({
        submissions: [
          submission("a"),
          { ...submission("b"), anchorClosedBarAt: "2026-08-27T09:01:00.000Z" },
        ],
        terminalGrid,
        observedTerminalReturn: 0,
        observedJoint13d: new Array(13).fill(0),
      }),
    ).toThrow("COMMON_ANCHOR_MISMATCH");
    expect(() =>
      runChallengerArenaV2({
        submissions: [submission("a"), submission("b", d("9"))],
        terminalGrid,
        observedTerminalReturn: 0,
        observedJoint13d: new Array(13).fill(0),
      }),
    ).toThrow("COMMON_TARGET_MISMATCH");
  });
  it("delegates terminal qualification to the canonical multi-anchor scientific harness", () => {
    const modelTrial = trial("a");
    const artifact = buildForecastModelArtifactV2({
      modelSpecDigestHex: modelTrial.modelSpec.contentDigestHex,
      inputContractDigestHex: contract.contentDigestHex,
      developmentDatasetDigestHex: d("5"),
      runtimeContractDigestHex: d("6"),
      artifactPayloadDigestHex: d("7"),
    });
    const harnessInput = {
      venue: "HTX",
      market: "spot",
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30 as const,
      challengerPackageContentDigestHex: d("7"),
      comparisonFamilyId: "dee-648/v2",
      evaluationPartitionReceiptDigestHex: d("8"),
      purgeDurationMinutes: 30,
      embargoDurationMinutes: 30,
      developmentReturns: [-0.1, 0, 0.1],
      historyReturns: [0],
      historyReturnMinuteOpenTimesMs: [0],
      anchors: [
        {
          anchorId: "a",
          observedReturn: 0,
          challengerProbabilities: [0.1, 0.1, 0.1, 0.4, 0.1, 0.1, 0.1],
        },
      ],
    };
    const evidence = qualifyChallengerCandidatesV2([
      { trialSpec: modelTrial, artifact, harnessInput },
    ]);
    expect(evidence.results[0]!.terminalAdmission.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
    expect(evidence.qualificationScope).toContain("DEE631_ADMISSION");
    expect(evidence.capitalEligible).toBe(false);
  });
});
