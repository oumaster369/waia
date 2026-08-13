export {
  beatAllMandatoryBaselinesV1,
  gaussianCdfBaselineV1,
  MANDATORY_BASELINES_V1,
} from "./baseline-models-v1";
export type {
  BaselineContext,
  BaselineForecastResult as BaselineForecast,
} from "./baseline-models-v1";
export {
  BetaincDomainError,
  BetaincNonConvergentError,
  BetaincOverflowError,
  betaincLentzV1,
  BETAINC_LENTZ_VERSION,
} from "./betainc-lentz-v1";
export { CDF_ERF_CODY715_VERSION, erfCody715V1, normalCdfCody715V1 } from "./cdf-erf-cody715-v1";
export { energyMcFromNestedCubeV1, energyMcV1, ENERGY_MC_VERSION } from "./energy-mc-v1";
export { holmFamilyPassV1, holmFwerV1, HOLM_FWER_VERSION } from "./holm-fwer-v1";
export type { HolmComparison, HolmResult } from "./holm-fwer-v1";
export {
  STUDENT_T5_CDF_BETAINC_VERSION,
  STUDENT_T5_KNOWN_ANSWERS,
  studentT5BaselineScaleV1,
  studentT5CdfBetaincV1,
} from "./student-t5-cdf-betainc-v1";
export {
  TYPE7_QUANTILE_VERSION,
  Type7QuantileDomainError,
  type7QuantileFromUnsorted,
  type7QuantileV1,
  type7TertileEdgesV1,
} from "./type7-quantile-v1";
export {
  computeTrialIdentityDigestV2,
  digestHex,
  serializeTrialIdentityV2,
  TRIAL_ID_VERSION,
} from "./trial-identity-v2";
export type { TrialIdentityInput } from "./trial-identity-v2";
export {
  deriveValidationBootstrapRoot,
  epistemicBootstrapResampleV1,
  nullCenterPairedDifferentials,
  observedNullCenteredBootstrapStatistic,
  VALIDATION_BOOTSTRAP_B,
  VALIDATION_BOOTSTRAP_MONTE_CARLO_DENOMINATOR,
  VALIDATION_BOOTSTRAP_VERSION,
  validationBootstrapPValueV1,
  validationBootstrapResampleV1,
} from "./validation-bootstrap-v1";
export type { ValidationBootstrapNullCenteredResultV1 } from "./validation-bootstrap-v1";

export const RESEARCH_HARNESS_VERSION = "research-harness/v1" as const;

export const FORBIDDEN_RESEARCH_BASELINES = [
  "bh-fdr",
  "sha256-mod-prng",
  "executor-chosen-stats",
] as const;

export const TARGET_GRID_QUANTILES_V1 = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95] as const;

export {
  runResearchHarnessAdmissionV1,
  RESEARCH_HARNESS_ADMISSION_VERSION,
} from "./research-harness-admission-orchestrator-v1";
export type {
  ResearchHarnessAdmissionInputV1,
  ResearchHarnessAdmissionResultV1,
  ResearchHarnessAnchorV1,
} from "./research-harness-admission-orchestrator-v1";
export {
  assertResearchTrialRegistrationNonCapitalAuthority,
  buildResearchTrialRegistrationRecord,
  readResearchTrialRegistrationV1,
  registerResearchTrialV1,
  ResearchTrialRegistrationConflictError,
  RESEARCH_TRIAL_REGISTRATION_AUTHORITY_STATUS,
  RESEARCH_TRIAL_REGISTRATION_SCHEMA_VERSION,
} from "./research-trial-registration-service-v1";
export type {
  RegisterResearchTrialResult,
  ResearchTrialRegistrationInput,
  ResearchTrialRegistrationRecord,
} from "./research-trial-registration-service-v1";
