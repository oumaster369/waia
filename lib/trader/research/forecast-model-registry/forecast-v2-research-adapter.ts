import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  computeForecastInputIdentitiesV2,
  requireForecastInputContractV2,
  requireForecastModelArtifactV2,
  requireForecastModelSpecV2,
  type ForecastInputContractV2,
  type ForecastModelArtifactV2,
  type ForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";

export type ForecastV2ResearchDistribution = Readonly<{
  schemaVersion: "waia.trader.forecast_v2_research_distribution.v1";
  anchorClosedBarAt: string;
  terminalBucketProbabilities: readonly number[];
  joint13dSamples: readonly (readonly number[])[];
  researchOnly: true;
  contentDigestHex: string;
}>;

export function adaptResearchForecastV2(input: {
  modelSpec: ForecastModelSpecV2;
  artifact: ForecastModelArtifactV2;
  inputContract: ForecastInputContractV2;
  anchorClosedBarAt: string;
  predictors: Readonly<{ anchorRealizedVol20m_1m: number }> & Record<string, unknown>;
  hypothesisAssessmentContentDigestHex: string;
  terminalBucketProbabilities: readonly number[];
  joint13dSamples: readonly (readonly number[])[];
}): ForecastV2ResearchDistribution {
  const spec = requireForecastModelSpecV2(input.modelSpec);
  const artifact = requireForecastModelArtifactV2(input.artifact);
  const inputContract = requireForecastInputContractV2(input.inputContract);
  const inputIdentities = computeForecastInputIdentitiesV2({
    contract: inputContract,
    anchorClosedBarAt: input.anchorClosedBarAt,
    predictors: input.predictors,
    hypothesisAssessmentContentDigestHex: input.hypothesisAssessmentContentDigestHex,
  });
  if (inputContract.contentDigestHex !== spec.inputContractDigestHex)
    throw new Error("FORECAST_RESEARCH_ADAPTER_INPUT_CONTRACT_MISMATCH");
  if (
    artifact.modelSpecDigestHex !== spec.contentDigestHex ||
    artifact.inputContractDigestHex !== spec.inputContractDigestHex
  ) {
    throw new Error("FORECAST_RESEARCH_ADAPTER_BINDING_MISMATCH");
  }
  if (
    input.terminalBucketProbabilities.length !== 7 ||
    input.terminalBucketProbabilities.some((p) => !Number.isFinite(p) || p < 0)
  ) {
    throw new Error("FORECAST_RESEARCH_ADAPTER_INVALID_TERMINAL");
  }
  const sum = input.terminalBucketProbabilities.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-12) throw new Error("FORECAST_RESEARCH_ADAPTER_INVALID_TERMINAL_SUM");
  if (
    input.joint13dSamples.length < 2 ||
    input.joint13dSamples.some((row) => row.length !== 13 || row.some((x) => !Number.isFinite(x)))
  ) {
    throw new Error("FORECAST_RESEARCH_ADAPTER_INVALID_JOINT");
  }
  const body = {
    schemaVersion: "waia.trader.forecast_v2_research_distribution.v1" as const,
    anchorClosedBarAt: inputIdentities.anchorClosedBarAt,
    terminalBucketProbabilities: [...input.terminalBucketProbabilities],
    joint13dSamples: input.joint13dSamples.map((row) => [...row]),
    researchOnly: true as const,
  };
  return {
    ...body,
    contentDigestHex: computeSemanticSha256Hex({
      ...body,
      modelSpecDigestHex: spec.contentDigestHex,
      artifactDigestHex: artifact.contentDigestHex,
      qualifiedInputBindingDigestHex: inputIdentities.qualifiedInputBindingDigestHex,
    }),
  };
}
