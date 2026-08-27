import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";

import { assertDigestHex64 } from "./scientific-identity-validators-v1";

export const FORECAST_INPUT_CONTRACT_V2_VERSION =
  "waia.trader.forecast_input_contract.v2" as const;
export const FORECAST_MODEL_SPEC_V2_VERSION = "waia.trader.forecast_model_spec.v2" as const;
export const FORECAST_MODEL_ARTIFACT_V2_VERSION =
  "waia.trader.forecast_model_artifact.v2" as const;
export const CHAMPION_FORECAST_PREDICTOR_ID = "anchorRealizedVol20m_1m" as const;
export const HYPOTHESIS_APPLICABILITY_ROLE = "APPLICABILITY_ONLY" as const;

const EXACT_INPUT_CONTRACT_KEYS = [
  "applicabilityPrerequisites",
  "contentDigestHex",
  "predictorDefinitions",
  "schemaVersion",
] as const;

function exactKeys(value: object, expected: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function requireNonEmpty(value: string, field: string): string {
  if (!value.trim()) throw new Error(`FORECAST_CONTRACT_INVALID:${field}`);
  return value;
}

function requireCanonicalInstant(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`FORECAST_CONTRACT_INVALID:${field}`);
  }
  return value;
}

function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`FORECAST_CONTRACT_INVALID:${field}`);
  }
  return value;
}

export type ForecastInputContractV2 = Readonly<{
  schemaVersion: typeof FORECAST_INPUT_CONTRACT_V2_VERSION;
  predictorDefinitions: readonly [
    Readonly<{
      predictorId: typeof CHAMPION_FORECAST_PREDICTOR_ID;
      measurementSemanticVersion: string;
      scalarEncoding: "NON_NEGATIVE_FINITE_NUMBER";
    }>,
  ];
  applicabilityPrerequisites: readonly [
    Readonly<{
      prerequisiteId: "HypothesisAssessment";
      schemaVersion: string;
      role: typeof HYPOTHESIS_APPLICABILITY_ROLE;
    }>,
  ];
  contentDigestHex: string;
}>;

export type ForecastModelSpecV2 = Readonly<{
  schemaVersion: typeof FORECAST_MODEL_SPEC_V2_VERSION;
  modelId: string;
  modelTransformVersion: string;
  inputContractDigestHex: string;
  terminalTargetDefinitionDigestHex: string;
  executionOpportunityTargetDefinitionDigestHex: string;
  contentDigestHex: string;
}>;

export type ForecastModelArtifactV2 = Readonly<{
  schemaVersion: typeof FORECAST_MODEL_ARTIFACT_V2_VERSION;
  modelSpecDigestHex: string;
  inputContractDigestHex: string;
  developmentDatasetDigestHex: string;
  runtimeContractDigestHex: string;
  artifactPayloadDigestHex: string;
  contentDigestHex: string;
}>;

function withDigest<T extends object>(body: T): T & { contentDigestHex: string } {
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

export function buildForecastInputContractV2(input: {
  measurementSemanticVersion: string;
  hypothesisAssessmentSchemaVersion: string;
}): ForecastInputContractV2 {
  return withDigest({
    schemaVersion: FORECAST_INPUT_CONTRACT_V2_VERSION,
    predictorDefinitions: [
      {
        predictorId: CHAMPION_FORECAST_PREDICTOR_ID,
        measurementSemanticVersion: requireNonEmpty(
          input.measurementSemanticVersion,
          "measurementSemanticVersion",
        ),
        scalarEncoding: "NON_NEGATIVE_FINITE_NUMBER" as const,
      },
    ] as const,
    applicabilityPrerequisites: [
      {
        prerequisiteId: "HypothesisAssessment" as const,
        schemaVersion: requireNonEmpty(
          input.hypothesisAssessmentSchemaVersion,
          "hypothesisAssessmentSchemaVersion",
        ),
        role: HYPOTHESIS_APPLICABILITY_ROLE,
      },
    ] as const,
  });
}

export function requireForecastInputContractV2(
  contract: ForecastInputContractV2,
): ForecastInputContractV2 {
  if (!exactKeys(contract, EXACT_INPUT_CONTRACT_KEYS)) {
    throw new Error("FORECAST_INPUT_CONTRACT_INVALID:shape");
  }
  const rebuilt = buildForecastInputContractV2({
    measurementSemanticVersion: contract.predictorDefinitions?.[0]?.measurementSemanticVersion,
    hypothesisAssessmentSchemaVersion:
      contract.applicabilityPrerequisites?.[0]?.schemaVersion,
  });
  if (canonicalizeSemanticJsonString(rebuilt) !== canonicalizeSemanticJsonString(contract)) {
    throw new Error("FORECAST_INPUT_CONTRACT_INVALID:digestOrSemantics");
  }
  return contract;
}

export function buildForecastModelSpecV2(
  input: Omit<ForecastModelSpecV2, "schemaVersion" | "contentDigestHex">,
): ForecastModelSpecV2 {
  for (const [field, digest] of [
    ["inputContractDigestHex", input.inputContractDigestHex],
    ["terminalTargetDefinitionDigestHex", input.terminalTargetDefinitionDigestHex],
    [
      "executionOpportunityTargetDefinitionDigestHex",
      input.executionOpportunityTargetDefinitionDigestHex,
    ],
  ] as const) {
    assertDigestHex64(digest, field);
  }
  return withDigest({
    schemaVersion: FORECAST_MODEL_SPEC_V2_VERSION,
    modelId: requireNonEmpty(input.modelId, "modelId"),
    modelTransformVersion: requireNonEmpty(input.modelTransformVersion, "modelTransformVersion"),
    inputContractDigestHex: input.inputContractDigestHex,
    terminalTargetDefinitionDigestHex: input.terminalTargetDefinitionDigestHex,
    executionOpportunityTargetDefinitionDigestHex:
      input.executionOpportunityTargetDefinitionDigestHex,
  });
}

export function requireForecastModelSpecV2(spec: ForecastModelSpecV2): ForecastModelSpecV2 {
  if (
    !exactKeys(spec, [
      "schemaVersion",
      "modelId",
      "modelTransformVersion",
      "inputContractDigestHex",
      "terminalTargetDefinitionDigestHex",
      "executionOpportunityTargetDefinitionDigestHex",
      "contentDigestHex",
    ]) ||
    canonicalizeSemanticJsonString(
      buildForecastModelSpecV2({
        modelId: spec.modelId,
        modelTransformVersion: spec.modelTransformVersion,
        inputContractDigestHex: spec.inputContractDigestHex,
        terminalTargetDefinitionDigestHex: spec.terminalTargetDefinitionDigestHex,
        executionOpportunityTargetDefinitionDigestHex:
          spec.executionOpportunityTargetDefinitionDigestHex,
      }),
    ) !== canonicalizeSemanticJsonString(spec)
  ) {
    throw new Error("FORECAST_MODEL_SPEC_INVALID:digestOrSemantics");
  }
  return spec;
}

export function buildForecastModelArtifactV2(
  input: Omit<ForecastModelArtifactV2, "schemaVersion" | "contentDigestHex">,
): ForecastModelArtifactV2 {
  for (const [field, digest] of Object.entries(input)) assertDigestHex64(digest, field);
  if (input.inputContractDigestHex === input.modelSpecDigestHex) {
    throw new Error("FORECAST_MODEL_ARTIFACT_INVALID:identityAliasing");
  }
  return withDigest({ schemaVersion: FORECAST_MODEL_ARTIFACT_V2_VERSION, ...input });
}

export function requireForecastModelArtifactV2(
  artifact: ForecastModelArtifactV2,
): ForecastModelArtifactV2 {
  if (
    !exactKeys(artifact, [
      "schemaVersion",
      "modelSpecDigestHex",
      "inputContractDigestHex",
      "developmentDatasetDigestHex",
      "runtimeContractDigestHex",
      "artifactPayloadDigestHex",
      "contentDigestHex",
    ]) ||
    canonicalizeSemanticJsonString(
      buildForecastModelArtifactV2({
        modelSpecDigestHex: artifact.modelSpecDigestHex,
        inputContractDigestHex: artifact.inputContractDigestHex,
        developmentDatasetDigestHex: artifact.developmentDatasetDigestHex,
        runtimeContractDigestHex: artifact.runtimeContractDigestHex,
        artifactPayloadDigestHex: artifact.artifactPayloadDigestHex,
      }),
    ) !== canonicalizeSemanticJsonString(artifact)
  ) {
    throw new Error("FORECAST_MODEL_ARTIFACT_INVALID:digestOrSemantics");
  }
  return artifact;
}

export type ForecastInputIdentitiesV2 = Readonly<{
  anchorClosedBarAt: string;
  mathematicalInputDigestHex: string;
  applicabilityPrerequisiteDigestHex: string;
  qualifiedInputBindingDigestHex: string;
}>;

export function computeForecastInputIdentitiesV2(input: {
  contract: ForecastInputContractV2;
  anchorClosedBarAt: string;
  predictors: Readonly<{ anchorRealizedVol20m_1m: number }> & Record<string, unknown>;
  hypothesisAssessmentContentDigestHex: string;
}): ForecastInputIdentitiesV2 {
  const contract = requireForecastInputContractV2(input.contract);
  const anchorClosedBarAt = requireCanonicalInstant(input.anchorClosedBarAt, "anchorClosedBarAt");
  const anchorRealizedVol20m1m = requireFinite(
    input.predictors.anchorRealizedVol20m_1m,
    CHAMPION_FORECAST_PREDICTOR_ID,
  );
  assertDigestHex64(
    input.hypothesisAssessmentContentDigestHex,
    "hypothesisAssessmentContentDigestHex",
  );
  const mathematicalInputDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.forecast_mathematical_input_identity.v2",
    inputContractDigestHex: contract.contentDigestHex,
    anchorClosedBarAt,
    predictors: { [CHAMPION_FORECAST_PREDICTOR_ID]: anchorRealizedVol20m1m },
  });
  const applicabilityPrerequisiteDigestHex = computeSemanticSha256Hex({
    schemaVersion: "waia.trader.forecast_applicability_prerequisite_identity.v1",
    inputContractDigestHex: contract.contentDigestHex,
    anchorClosedBarAt,
    hypothesisAssessmentContentDigestHex: input.hypothesisAssessmentContentDigestHex,
  });
  return {
    anchorClosedBarAt,
    mathematicalInputDigestHex,
    applicabilityPrerequisiteDigestHex,
    qualifiedInputBindingDigestHex: computeSemanticSha256Hex({
      schemaVersion: "waia.trader.forecast_qualified_input_binding.v1",
      mathematicalInputDigestHex,
      applicabilityPrerequisiteDigestHex,
    }),
  };
}
