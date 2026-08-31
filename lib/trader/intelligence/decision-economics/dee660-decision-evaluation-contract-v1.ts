import { SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import { SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";

import type {
  CashEconomicAuthorityV1,
  Dee659ExecutablePolicyInstanceV1,
  EconomicAdmissibleSizeSetV1,
  ForecastAnchorPriceAuthorityV1,
} from "./dee659-execution-payoff-authorities-v1";
import {
  DEE659_DECISION_ECONOMICS_CONTRACT_VERSION,
  DEE659_DECISION_EVALUATION_CONTRACT_ID,
  type Dee659AuthorityBindingV1,
  type Dee659ReasonCode,
  type ExecOpp13dForecastIdentityV1,
  type ExecutionPayoffAuthorityVerificationV1,
  isDee659DigestHex,
  resolveDecisionEvaluationContractV1,
} from "./dee659-execution-payoff-contract-v1";

export const DEE660_DECISION_EVALUATION_CONTRACT_VERSION =
  "dee660-decision-evaluation-contract/v1" as const;
export const DEE660_FORECAST_ECONOMIC_AUTHORITY_VERSION =
  "dee660-forecast-economic-authority/v1" as const;
export const DEE660_SCIENTIFIC_ADMISSION_AUTHORITY_VERSION =
  "dee660-scientific-admission-authority/v1" as const;
export const DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION =
  "dee660-evaluation-authority-verification/v1" as const;
export const DEE660_EV_AGGREGATION_POLICY =
  "scale8-exact-rational-mean-type7-q10-lower-q50-base-q90-base/v1" as const;

export type Dee660ReasonCode =
  | Dee659ReasonCode
  | "DECISION_NON_ACTIONABLE"
  | "EVALUATION_INPUT_MALFORMED"
  | "EV_LOWER_NON_POSITIVE"
  | "EV_RANGE_INVALID"
  | "FORECAST_ANCHOR_BINDING_MISMATCH"
  | "FORECAST_AUTHORITY_INVALID"
  | "FORECAST_AUTHORITY_NOT_VERIFIED"
  | "FORECAST_CONTENT_DIGEST_MISMATCH"
  | "FORECAST_DISTRIBUTION_DIGEST_MISMATCH"
  | "FORECAST_KM_MISMATCH"
  | "SCIENTIFIC_ADMISSION_RECEIPT_REQUIRED";

export type DecisionEvaluationContractV2 = {
  schemaVersion: typeof DEE660_DECISION_EVALUATION_CONTRACT_VERSION;
  payoffContractVersion: typeof DEE659_DECISION_ECONOMICS_CONTRACT_VERSION;
  contractId: typeof DEE659_DECISION_EVALUATION_CONTRACT_ID;
  evaluationMethod: "TYPE7_Q10_LOWER_Q50_BASE_Q90_BASE";
  aggregationPolicy: typeof DEE660_EV_AGGREGATION_POLICY;
  receiptProjection: "TRUNCATE_TOWARD_ZERO_SCALE8_EXACT_RATIONAL_GATE";
  cashBaseline: "ZERO_INCREMENTAL_RETURN";
  sizeSetShape: "SINGLETON_EXACT_QUANTITY";
  actionVocabulary: readonly ["ENTER_LONG", "CASH"];
  actionableRule: "ALL_UPSTREAM_GATES_PASS_AND_EV_LOWER_EXACT_GT_ZERO";
};

export type ForecastEconomicAuthorityV1 = Dee659AuthorityBindingV1 & {
  schemaVersion: typeof DEE660_FORECAST_ECONOMIC_AUTHORITY_VERSION;
  forecastId: string;
  identity: ExecOpp13dForecastIdentityV1;
  forecastAnchorClosedBarEpochMs: number;
  anchorAuthorityContentDigestHex: string;
  predictivePackageContentDigestHex: string;
  predictivePackageGenerationIdentityDigestHex: string;
  forecastGenerationIdentityDigestHex: string;
  forecastContentDigestHex: string;
  normalizationVersionDigestHex: string;
  k: number;
  m: number;
  distributionSemanticDigestHex: string;
  issuanceReceiptDigestHex: string;
  replicaSamples: readonly (readonly (readonly number[])[])[];
  contentDigestHex: string;
};

export type ScientificAdmissionAuthorityV1 = {
  schemaVersion: typeof DEE660_SCIENTIFIC_ADMISSION_AUTHORITY_VERSION;
  sourceReceiptSchemaVersion: typeof SCIENTIFIC_ADMISSION_RECEIPT_VERSION |
    typeof SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION;
  organizationId: string;
  wfPartition: "WF_PREDICTIVE";
  terminalStatus: "QUALIFIED";
  selectedPackageGenerationIdentityDigestHex: string;
  selectedPackageContentDigestHex: string;
  selectedKConfigDec: number;
  selectedMConfigDec: number;
  evidenceSemanticDigestHex: string;
  sourceReceiptContentDigestHex: string;
  contentDigestHex: string;
};

export type VerifiedForecastEconomicAuthorityV1 = {
  schemaVersion: typeof DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION;
  verified: boolean;
  purpose: "FORECAST_ISSUANCE";
  organizationId: string;
  accountId: string;
  instrumentIdentityDigestHex: string;
  subjectContentDigestHex: string;
  verificationReceiptDigestHex: string;
};

export type VerifiedScientificAdmissionAuthorityV1 = {
  schemaVersion: typeof DEE660_EVALUATION_AUTHORITY_VERIFICATION_VERSION;
  verified: boolean;
  purpose: "SCIENTIFIC_ADMISSION";
  organizationId: string;
  subjectContentDigestHex: string;
  verificationReceiptDigestHex: string;
};

export type DecisionEconomicAuthorityVerificationV1 = {
  forecast: VerifiedForecastEconomicAuthorityV1;
  scientificAdmission: VerifiedScientificAdmissionAuthorityV1;
  executionPayoff: ExecutionPayoffAuthorityVerificationV1;
};

export type LegacyStrategyDiagnosticsV1 = {
  legacyDiagnosticConfidence?: number;
  legacyDiagnosticExpectedEdge?: number;
  legacyDiagnosticMaxRisk?: number;
};

export type DecisionEconomicEvaluationInputV2 = {
  forecast: ForecastEconomicAuthorityV1;
  scientificAdmission: ScientificAdmissionAuthorityV1;
  anchorAuthority: ForecastAnchorPriceAuthorityV1;
  policy: Dee659ExecutablePolicyInstanceV1;
  economicSizeSet: EconomicAdmissibleSizeSetV1;
  cashAuthority: CashEconomicAuthorityV1;
  authorityVerification: DecisionEconomicAuthorityVerificationV1;
  legacyStrategyDiagnostics?: LegacyStrategyDiagnosticsV1;
};

function omitDigest<T extends { contentDigestHex: string }>(
  input: T,
): Omit<T, "contentDigestHex"> {
  const { contentDigestHex, ...payload } = input;
  void contentDigestHex;
  return payload;
}

function forecastDigestPayload(
  input: Omit<ForecastEconomicAuthorityV1, "contentDigestHex">,
): Omit<typeof input, "replicaSamples"> {
  const { replicaSamples, ...payload } = input;
  void replicaSamples;
  return payload;
}

export function computeForecastEconomicAuthorityContentDigestV1(
  input: Omit<ForecastEconomicAuthorityV1, "contentDigestHex">,
): string {
  return computeStableJsonDigest(forecastDigestPayload(input));
}

export function createForecastEconomicAuthorityV1(
  input: Omit<ForecastEconomicAuthorityV1, "schemaVersion" | "contentDigestHex">,
): ForecastEconomicAuthorityV1 {
  const payload = { ...input, schemaVersion: DEE660_FORECAST_ECONOMIC_AUTHORITY_VERSION };
  return {
    ...payload,
    contentDigestHex: computeForecastEconomicAuthorityContentDigestV1(payload),
  };
}

export function createScientificAdmissionAuthorityV1(
  input: Omit<ScientificAdmissionAuthorityV1, "schemaVersion" | "contentDigestHex">,
): ScientificAdmissionAuthorityV1 {
  const payload = { ...input, schemaVersion: DEE660_SCIENTIFIC_ADMISSION_AUTHORITY_VERSION };
  const candidate = { ...payload, contentDigestHex: computeStableJsonDigest(payload) };
  if (
    ![SCIENTIFIC_ADMISSION_RECEIPT_VERSION, SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION]
      .includes(candidate.sourceReceiptSchemaVersion) ||
    candidate.organizationId.trim() === "" ||
    candidate.wfPartition !== "WF_PREDICTIVE" ||
    candidate.terminalStatus !== "QUALIFIED" ||
    !Number.isSafeInteger(candidate.selectedKConfigDec) ||
    candidate.selectedKConfigDec <= 0 ||
    !Number.isSafeInteger(candidate.selectedMConfigDec) ||
    candidate.selectedMConfigDec <= 0 ||
    ![
      candidate.selectedPackageGenerationIdentityDigestHex,
      candidate.selectedPackageContentDigestHex,
      candidate.evidenceSemanticDigestHex,
      candidate.sourceReceiptContentDigestHex,
    ].every(isDee659DigestHex)
  ) {
    throw new Error("[dee660-scientific-admission] invalid authority");
  }
  return candidate;
}

export function validateScientificAdmissionAuthorityContentDigestV1(
  input: ScientificAdmissionAuthorityV1,
): boolean {
  return (
    isDee659DigestHex(input.contentDigestHex) &&
    computeStableJsonDigest(omitDigest(input)) === input.contentDigestHex
  );
}

const REGISTERED_EVALUATION_CONTRACT: DecisionEvaluationContractV2 = {
  schemaVersion: DEE660_DECISION_EVALUATION_CONTRACT_VERSION,
  payoffContractVersion: DEE659_DECISION_ECONOMICS_CONTRACT_VERSION,
  contractId: DEE659_DECISION_EVALUATION_CONTRACT_ID,
  evaluationMethod: "TYPE7_Q10_LOWER_Q50_BASE_Q90_BASE",
  aggregationPolicy: DEE660_EV_AGGREGATION_POLICY,
  receiptProjection: "TRUNCATE_TOWARD_ZERO_SCALE8_EXACT_RATIONAL_GATE",
  cashBaseline: "ZERO_INCREMENTAL_RETURN",
  sizeSetShape: "SINGLETON_EXACT_QUANTITY",
  actionVocabulary: ["ENTER_LONG", "CASH"],
  actionableRule: "ALL_UPSTREAM_GATES_PASS_AND_EV_LOWER_EXACT_GT_ZERO",
};

export function resolveDecisionEvaluationContractV2(
  identity: ExecOpp13dForecastIdentityV1,
):
  | { ok: true; contract: DecisionEvaluationContractV2 }
  | { ok: false; reasonCode: "FORECAST_CONTRACT_MISMATCH" } {
  return resolveDecisionEvaluationContractV1(identity).ok
    ? { ok: true, contract: REGISTERED_EVALUATION_CONTRACT }
    : { ok: false, reasonCode: "FORECAST_CONTRACT_MISMATCH" };
}
