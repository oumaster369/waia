import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  requireForecastInputContractV2,
  requireForecastModelSpecV2,
  type ForecastInputContractV2,
  type ForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";

export const MODEL_TRIAL_SPEC_V2_VERSION = "waia.trader.model_trial_spec.v2" as const;

export type ModelTrialReadinessV2 = "EXECUTOR_READY" | `RESEARCH_ONLY_UNIMPLEMENTED_${string}`;

export type ModelTrialSpecV2 = Readonly<{
  schemaVersion: typeof MODEL_TRIAL_SPEC_V2_VERSION;
  modelSpec: ForecastModelSpecV2;
  equations: readonly string[];
  parameterConstraints: readonly string[];
  pitFeatureVector: readonly string[];
  initialization: string;
  fittingAlgorithm: string;
  convergenceAndFailure: string;
  developmentHyperparameterGrid: readonly string[];
  tieBreak: string;
  forecastTransform: string;
  artifactSchema: string;
  scoringTargets: readonly ["TERMINAL_7_BUCKET_LOG_SCORE", "JOINT_13D_ENERGY_SCORE"];
  knownAnswerFixtureIds: readonly string[];
  computeBudget: Readonly<{
    maxObservations: number;
    maxIterations: number;
    maxWallClockMs: number;
  }>;
  readiness: ModelTrialReadinessV2;
  contentDigestHex: string;
}>;

function nonEmpty(values: readonly string[], field: string): void {
  if (values.length === 0 || values.some((value) => !value.trim())) {
    throw new Error(`MODEL_TRIAL_SPEC_INVALID:${field}`);
  }
}

export function buildModelTrialSpecV2(
  input: Omit<ModelTrialSpecV2, "schemaVersion" | "contentDigestHex">,
): ModelTrialSpecV2 {
  const modelSpec = requireForecastModelSpecV2(input.modelSpec);
  for (const [field, values] of [
    ["equations", input.equations],
    ["parameterConstraints", input.parameterConstraints],
    ["pitFeatureVector", input.pitFeatureVector],
    ["knownAnswerFixtureIds", input.knownAnswerFixtureIds],
  ] as const)
    nonEmpty(values, field);
  for (const [field, value] of [
    ["initialization", input.initialization],
    ["fittingAlgorithm", input.fittingAlgorithm],
    ["convergenceAndFailure", input.convergenceAndFailure],
    ["tieBreak", input.tieBreak],
    ["forecastTransform", input.forecastTransform],
    ["artifactSchema", input.artifactSchema],
  ] as const) {
    if (!value.trim()) throw new Error(`MODEL_TRIAL_SPEC_INVALID:${field}`);
  }
  if (
    input.scoringTargets.length !== 2 ||
    input.scoringTargets[0] !== "TERMINAL_7_BUCKET_LOG_SCORE" ||
    input.scoringTargets[1] !== "JOINT_13D_ENERGY_SCORE"
  )
    throw new Error("MODEL_TRIAL_SPEC_INVALID:scoringTargets");
  if (
    input.readiness !== "EXECUTOR_READY" &&
    !input.readiness.startsWith("RESEARCH_ONLY_UNIMPLEMENTED_")
  ) {
    throw new Error("MODEL_TRIAL_SPEC_INVALID:readiness");
  }
  for (const [field, value] of Object.entries(input.computeBudget)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`MODEL_TRIAL_SPEC_INVALID:${field}`);
  }
  if (JSON.stringify(input.pitFeatureVector) !== JSON.stringify(["anchorRealizedVol20m_1m"])) {
    throw new Error("MODEL_TRIAL_SPEC_INVALID:pitFeatureVector");
  }
  const body = { schemaVersion: MODEL_TRIAL_SPEC_V2_VERSION, ...input, modelSpec };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

export function requireModelTrialSpecV2(spec: ModelTrialSpecV2): ModelTrialSpecV2 {
  const rebuilt = buildModelTrialSpecV2({
    modelSpec: spec.modelSpec,
    equations: spec.equations,
    parameterConstraints: spec.parameterConstraints,
    pitFeatureVector: spec.pitFeatureVector,
    initialization: spec.initialization,
    fittingAlgorithm: spec.fittingAlgorithm,
    convergenceAndFailure: spec.convergenceAndFailure,
    developmentHyperparameterGrid: spec.developmentHyperparameterGrid,
    tieBreak: spec.tieBreak,
    forecastTransform: spec.forecastTransform,
    artifactSchema: spec.artifactSchema,
    scoringTargets: spec.scoringTargets,
    knownAnswerFixtureIds: spec.knownAnswerFixtureIds,
    computeBudget: spec.computeBudget,
    readiness: spec.readiness,
  });
  if (canonicalizeSemanticJsonString(rebuilt) !== canonicalizeSemanticJsonString(spec)) {
    throw new Error("MODEL_TRIAL_SPEC_INVALID:digestOrSemantics");
  }
  return spec;
}

export class ForecastModelRegistryV2 {
  readonly #inputContract: ForecastInputContractV2;
  readonly #trials = new Map<string, ModelTrialSpecV2>();

  constructor(inputContract: ForecastInputContractV2) {
    this.#inputContract = requireForecastInputContractV2(inputContract);
  }

  register(spec: ModelTrialSpecV2): void {
    const exact = requireModelTrialSpecV2(spec);
    if (exact.modelSpec.inputContractDigestHex !== this.#inputContract.contentDigestHex) {
      throw new Error("MODEL_REGISTRY_INPUT_CONTRACT_MISMATCH");
    }
    const prior = this.#trials.get(exact.modelSpec.modelId);
    if (prior && prior.contentDigestHex !== exact.contentDigestHex) {
      throw new Error("MODEL_REGISTRY_CONFLICTING_MODEL_ID");
    }
    this.#trials.set(exact.modelSpec.modelId, exact);
  }

  get(modelId: string): ModelTrialSpecV2 | undefined {
    return this.#trials.get(modelId);
  }

  list(): readonly ModelTrialSpecV2[] {
    return [...this.#trials.values()].sort((a, b) =>
      a.modelSpec.modelId.localeCompare(b.modelSpec.modelId),
    );
  }

  requireExecutable(modelId: string): ModelTrialSpecV2 {
    const spec = this.#trials.get(modelId);
    if (!spec) throw new Error("MODEL_REGISTRY_UNKNOWN_MODEL");
    if (spec.readiness !== "EXECUTOR_READY")
      throw new Error(`MODEL_REGISTRY_NOT_EXECUTABLE:${spec.readiness}`);
    return spec;
  }
}

export const TIER_B_RESEARCH_BLOCKS_V2 = Object.freeze({
  "garch11-terminal/v1": "RESEARCH_ONLY_UNIMPLEMENTED_NONLINEAR_OPTIMIZER_NOT_FROZEN",
  "har-rv-terminal/v1": "RESEARCH_ONLY_UNIMPLEMENTED_HAR_JOINT_SPEC_NOT_FROZEN",
  "ordinal-ridge-terminal/v1": "RESEARCH_ONLY_UNIMPLEMENTED_FEATURE_SET_NOT_PINNED",
  "joint-locscale-execopp/v1": "RESEARCH_ONLY_UNIMPLEMENTED_MULTIVARIATE_DENSITY_NOT_FROZEN",
  "dynamic-state-transition-hazard/v1":
    "RESEARCH_ONLY_UNIMPLEMENTED_TRANSITION_TRIAL_SPEC_NOT_FROZEN",
} as const);
