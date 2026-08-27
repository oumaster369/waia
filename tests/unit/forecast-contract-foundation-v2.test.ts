import { describe, expect, it } from "vitest";

import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
  CHAMPION_FORECAST_PREDICTOR_ID,
  computeForecastInputIdentitiesV2,
  requireForecastInputContractV2,
  requireForecastModelArtifactV2,
  requireForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";

const digest = (char: string) => char.repeat(64);

function fixture() {
  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: "realized-volatility-20m-from-1m/v2",
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: "rv-state-conditional-empirical-joint/v1",
    modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: digest("1"),
    executionOpportunityTargetDefinitionDigestHex: digest("2"),
  });
  const artifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: digest("3"),
    runtimeContractDigestHex: digest("4"),
    artifactPayloadDigestHex: digest("5"),
  });
  return { inputContract, modelSpec, artifact };
}

describe("DEE-745 Forecast V2 content-addressed contract core", () => {
  it("freezes exactly one champion mathematical predictor and applicability-only hypothesis", () => {
    const { inputContract } = fixture();
    expect(inputContract.predictorDefinitions).toEqual([
      {
        predictorId: CHAMPION_FORECAST_PREDICTOR_ID,
        measurementSemanticVersion: "realized-volatility-20m-from-1m/v2",
        scalarEncoding: "NON_NEGATIVE_FINITE_NUMBER",
      },
    ]);
    expect(inputContract.applicabilityPrerequisites).toEqual([
      {
        prerequisiteId: "HypothesisAssessment",
        schemaVersion: "waia.trader.hypothesis_assessment.v1",
        role: "APPLICABILITY_ONLY",
      },
    ]);
    expect(JSON.stringify(inputContract)).not.toContain("confidence");
  });

  it("roundtrips exact content-addressed contracts and rejects tampering", () => {
    const { inputContract, modelSpec, artifact } = fixture();
    expect(requireForecastInputContractV2(inputContract)).toBe(inputContract);
    expect(requireForecastModelSpecV2(modelSpec)).toBe(modelSpec);
    expect(requireForecastModelArtifactV2(artifact)).toBe(artifact);
    expect(() =>
      requireForecastInputContractV2({ ...inputContract, contentDigestHex: digest("a") }),
    ).toThrow("FORECAST_INPUT_CONTRACT_INVALID");
    expect(() =>
      requireForecastModelSpecV2({ ...modelSpec, modelId: "substituted" }),
    ).toThrow("FORECAST_MODEL_SPEC_INVALID");
    expect(() =>
      requireForecastModelArtifactV2({ ...artifact, artifactPayloadDigestHex: digest("6") }),
    ).toThrow("FORECAST_MODEL_ARTIFACT_INVALID");
  });

  it("lets only the declared predictor alter mathematical input identity", () => {
    const { inputContract } = fixture();
    const base = {
      contract: inputContract,
      anchorClosedBarAt: "2026-08-27T00:00:00.000Z",
      predictors: { anchorRealizedVol20m_1m: 0.015, undeclaredNoise: 1 },
      hypothesisAssessmentContentDigestHex: digest("7"),
    };
    const first = computeForecastInputIdentitiesV2(base);
    const undeclaredMutation = computeForecastInputIdentitiesV2({
      ...base,
      predictors: { ...base.predictors, undeclaredNoise: 999 },
    });
    const predictorMutation = computeForecastInputIdentitiesV2({
      ...base,
      predictors: { ...base.predictors, anchorRealizedVol20m_1m: 0.016 },
    });
    expect(undeclaredMutation).toEqual(first);
    expect(predictorMutation.mathematicalInputDigestHex).not.toBe(
      first.mathematicalInputDigestHex,
    );
  });

  it("keeps hypothesis applicability out of mathematical predictor identity", () => {
    const { inputContract } = fixture();
    const base = computeForecastInputIdentitiesV2({
      contract: inputContract,
      anchorClosedBarAt: "2026-08-27T00:00:00.000Z",
      predictors: { anchorRealizedVol20m_1m: 0.015 },
      hypothesisAssessmentContentDigestHex: digest("7"),
    });
    const changed = computeForecastInputIdentitiesV2({
      contract: inputContract,
      anchorClosedBarAt: "2026-08-27T00:00:00.000Z",
      predictors: { anchorRealizedVol20m_1m: 0.015 },
      hypothesisAssessmentContentDigestHex: digest("8"),
    });
    expect(changed.mathematicalInputDigestHex).toBe(base.mathematicalInputDigestHex);
    expect(changed.applicabilityPrerequisiteDigestHex).not.toBe(
      base.applicabilityPrerequisiteDigestHex,
    );
    expect(changed.qualifiedInputBindingDigestHex).not.toBe(
      base.qualifiedInputBindingDigestHex,
    );
  });

  it("binds mathematical identity to the exact canonical PIT anchor", () => {
    const { inputContract } = fixture();
    const base = {
      contract: inputContract,
      anchorClosedBarAt: "2026-08-27T00:00:00.000Z",
      predictors: { anchorRealizedVol20m_1m: 0.015 },
      hypothesisAssessmentContentDigestHex: digest("7"),
    };
    const first = computeForecastInputIdentitiesV2(base);
    const nextClosedBar = computeForecastInputIdentitiesV2({
      ...base,
      anchorClosedBarAt: "2026-08-27T00:01:00.000Z",
    });

    expect(nextClosedBar.mathematicalInputDigestHex).not.toBe(
      first.mathematicalInputDigestHex,
    );
    expect(nextClosedBar.applicabilityPrerequisiteDigestHex).not.toBe(
      first.applicabilityPrerequisiteDigestHex,
    );
    expect(nextClosedBar.qualifiedInputBindingDigestHex).not.toBe(
      first.qualifiedInputBindingDigestHex,
    );
    expect(() =>
      computeForecastInputIdentitiesV2({
        ...base,
        anchorClosedBarAt: "2026-08-27T00:00:00Z",
      }),
    ).toThrow("FORECAST_CONTRACT_INVALID:anchorClosedBarAt");
    expect(() =>
      computeForecastInputIdentitiesV2({
        ...base,
        anchorClosedBarAt: "not-an-instant",
      }),
    ).toThrow("FORECAST_CONTRACT_INVALID:anchorClosedBarAt");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01])(
    "rejects invalid declared predictor %s",
    (value) => {
      const { inputContract } = fixture();
      expect(() =>
        computeForecastInputIdentitiesV2({
          contract: inputContract,
          anchorClosedBarAt: "2026-08-27T00:00:00.000Z",
          predictors: { anchorRealizedVol20m_1m: value },
          hypothesisAssessmentContentDigestHex: digest("7"),
        }),
      ).toThrow("FORECAST_CONTRACT_INVALID:anchorRealizedVol20m_1m");
    },
  );
});
