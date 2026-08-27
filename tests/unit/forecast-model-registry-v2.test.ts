import { describe, expect, it } from "vitest";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
  computeForecastInputIdentitiesV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import {
  adaptResearchForecastV2,
  buildModelTrialSpecV2,
  ForecastModelRegistryV2,
  TIER_B_RESEARCH_BLOCKS_V2,
} from "@/lib/trader/research/forecast-model-registry";

const d = (c: string) => c.repeat(64);
const contract = buildForecastInputContractV2({
  measurementSemanticVersion: "realized-volatility-20m-from-1m/v2",
  hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
});
const spec = buildForecastModelSpecV2({
  modelId: "rv-state-conditional-empirical-joint/v1",
  modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
  inputContractDigestHex: contract.contentDigestHex,
  terminalTargetDefinitionDigestHex: d("1"),
  executionOpportunityTargetDefinitionDigestHex: d("2"),
});

function trial(
  readiness: "EXECUTOR_READY" | `RESEARCH_ONLY_UNIMPLEMENTED_${string}` = "EXECUTOR_READY",
) {
  return buildModelTrialSpecV2({
    modelSpec: spec,
    equations: ["p(y|rv)=empirical_state_pool(y)"],
    parameterConstraints: ["minimum pool count = 30"],
    pitFeatureVector: ["anchorRealizedVol20m_1m"],
    initialization: "canonical source-corpus order",
    fittingAlgorithm: "stationary-bootstrap/v1",
    convergenceAndFailure: "fail closed on insufficient pool",
    developmentHyperparameterGrid: [],
    tieBreak: "lexicographic content digest",
    forecastTransform: "rv-state-conditional-empirical-joint/v1",
    artifactSchema: "ForecastModelArtifactV2",
    scoringTargets: ["TERMINAL_7_BUCKET_LOG_SCORE", "JOINT_13D_ENERGY_SCORE"],
    knownAnswerFixtureIds: ["rv-state-kat/v1"],
    computeBudget: { maxObservations: 100_000, maxIterations: 10_000, maxWallClockMs: 60_000 },
    readiness,
  });
}

describe("DEE-648 Forecast Model Registry V2", () => {
  it("is content addressed, idempotent and conflict-failing", () => {
    const registry = new ForecastModelRegistryV2(contract);
    registry.register(trial());
    registry.register(trial());
    expect(registry.list()).toHaveLength(1);
    expect(registry.requireExecutable(spec.modelId).contentDigestHex).toBe(
      trial().contentDigestHex,
    );
    expect(() => registry.register({ ...trial(), contentDigestHex: d("a") })).toThrow(
      "MODEL_TRIAL_SPEC_INVALID",
    );
  });

  it("rejects undeclared/future/PnL predictors and exposes exact Tier-B blocks", () => {
    expect(() =>
      buildModelTrialSpecV2({
        ...trial(),
        pitFeatureVector: ["future_return", "anchorRealizedVol20m_1m"],
      }),
    ).toThrow("pitFeatureVector");
    expect(TIER_B_RESEARCH_BLOCKS_V2["garch11-terminal/v1"]).toBe(
      "RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN",
    );
    expect(() =>
      buildModelTrialSpecV2({
        ...trial(),
        scoringTargets: ["JOINT_13D_ENERGY_SCORE", "TERMINAL_7_BUCKET_LOG_SCORE"] as never,
      }),
    ).toThrow("scoringTargets");
    expect(() =>
      buildModelTrialSpecV2({ ...trial(), readiness: "CAPITAL_ELIGIBLE" as never }),
    ).toThrow("readiness");
  });

  it("adapts only exactly bound research artifacts without creating authority", () => {
    const artifact = buildForecastModelArtifactV2({
      modelSpecDigestHex: spec.contentDigestHex,
      inputContractDigestHex: contract.contentDigestHex,
      developmentDatasetDigestHex: d("3"),
      runtimeContractDigestHex: d("4"),
      artifactPayloadDigestHex: d("5"),
    });
    const identities = computeForecastInputIdentitiesV2({
      contract,
      anchorClosedBarAt: "2026-08-27T09:00:00.000Z",
      predictors: { anchorRealizedVol20m_1m: 0.01 },
      hypothesisAssessmentContentDigestHex: d("6"),
    });
    const result = adaptResearchForecastV2({
      modelSpec: spec,
      artifact,
      inputContract: contract,
      anchorClosedBarAt: identities.anchorClosedBarAt,
      predictors: { anchorRealizedVol20m_1m: 0.01 },
      hypothesisAssessmentContentDigestHex: d("6"),
      terminalBucketProbabilities: [0.1, 0.1, 0.1, 0.2, 0.2, 0.2, 0.1],
      joint13dSamples: [new Array(13).fill(0), new Array(13).fill(0.1)],
    });
    expect(result.researchOnly).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/capitalEligible|BUY|SELL/);
  });
});
