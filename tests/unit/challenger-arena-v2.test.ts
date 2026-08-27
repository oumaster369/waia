import { describe, expect, it } from "vitest";
import { buildForecastInputContractV2, buildForecastModelSpecV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import { runChallengerArenaV2 } from "@/lib/trader/research/challenger-arena";
import { buildModelTrialSpecV2 } from "@/lib/trader/research/forecast-model-registry";

const d = (c: string) => c.repeat(64);
const contract = buildForecastInputContractV2({ measurementSemanticVersion: "rv/v2", hypothesisAssessmentSchemaVersion: "hyp/v1" });
function trial(modelId: string) {
  const modelSpec = buildForecastModelSpecV2({ modelId, modelTransformVersion: modelId, inputContractDigestHex: contract.contentDigestHex, terminalTargetDefinitionDigestHex: d("1"), executionOpportunityTargetDefinitionDigestHex: d("2") });
  return buildModelTrialSpecV2({ modelSpec, equations:["frozen"], parameterConstraints:["frozen"], pitFeatureVector:["anchorRealizedVol20m_1m"], initialization:"frozen", fittingAlgorithm:"frozen", convergenceAndFailure:"fail closed", developmentHyperparameterGrid:[], tieBreak:"model id", forecastTransform:modelId, artifactSchema:"v1", scoringTargets:["TERMINAL_7_BUCKET_LOG_SCORE","JOINT_13D_ENERGY_SCORE"], knownAnswerFixtureIds:["kat"], computeBudget:{maxObservations:100,maxIterations:10,maxWallClockMs:1000}, readiness:"EXECUTOR_READY" });
}
const base = { anchorClosedBarAt:"2026-08-27T09:00:00.000Z", mathematicalInputDigestHex:d("3"), terminalTargetDefinitionDigestHex:d("1"), executionOpportunityTargetDefinitionDigestHex:d("2"), terminalBucketProbabilities:[0.1,0.1,0.1,0.2,0.2,0.2,0.1], joint13dSamples:[new Array(13).fill(0),new Array(13).fill(0.1)], evidencePartition:"VALIDATION" as const, selectionMetric:"PROPER_PREDICTIVE_SCORE" as const };

describe("DEE-648 common-anchor challenger arena", () => {
  it("scores terminal and joint forecasts, keeps marginal null explicit and cannot self-promote", () => {
    const evidence = runChallengerArenaV2({ submissions:[{...base,trialSpec:trial("a")},{...base,trialSpec:trial("b")}], terminalGrid:{edges:[-3,-2,-1,1,2,3],bucketCount:7}, observedTerminalReturn:0, observedJoint13d:new Array(13).fill(0) });
    expect(evidence.results).toHaveLength(2);
    expect(evidence.results.every((row) => row.capitalEligible === false)).toBe(true);
    expect(evidence.disposition).toBe("RESEARCH_EVIDENCE_ONLY");
    expect(evidence.results[0]!.marginalIndependenceEnergyScore).toBeTypeOf("number");
  });
  it("fails on mixed anchors and target drift", () => {
    expect(() => runChallengerArenaV2({ submissions:[{...base,trialSpec:trial("a")},{...base,anchorClosedBarAt:"2026-08-27T09:01:00.000Z",trialSpec:trial("b")}], terminalGrid:{edges:[-3,-2,-1,1,2,3],bucketCount:7}, observedTerminalReturn:0, observedJoint13d:new Array(13).fill(0) })).toThrow("COMMON_ANCHOR_MISMATCH");
    expect(() => runChallengerArenaV2({ submissions:[{...base,terminalTargetDefinitionDigestHex:d("9"),trialSpec:trial("a")}], terminalGrid:{edges:[-3,-2,-1,1,2,3],bucketCount:7}, observedTerminalReturn:0, observedJoint13d:new Array(13).fill(0) })).toThrow("TARGET_MISMATCH");
  });
});
