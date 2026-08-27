import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type {
  InformationAnalysisPurposeV2,
  InformationSufficiencyReceiptV2,
} from "@/lib/trader/intelligence/information-sufficiency/information-sufficiency-v2";
import {
  type ForecastContractBindingV1,
  requireForecastContractBindingV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  CHAMPION_FORECAST_PREDICTOR_ID,
  computeForecastInputIdentitiesV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";
import { assertDigestHex64 } from "@/lib/trader/intelligence/forecast-v2/scientific-identity-validators-v1";
import {
  type ScientificAdmissionExpectedBindingsV2,
  type ScientificAdmissionReceiptV2,
  requireScientificAdmissionV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";

export const MARKET_STATE_SNAPSHOT_V2_VERSION =
  "waia.trader.market_state_snapshot.v2" as const;
export const PREDICTIVE_ADMISSION_RECEIPT_V1_VERSION =
  "waia.trader.predictive_admission_receipt.v1" as const;

export type RuntimeAnalysisPostureV1 =
  | "FULL_ANALYSIS_AND_NEW_RISK"
  | "NO_NEW_RISK"
  | "CLOSE_ONLY"
  | "HALT";

export type HypothesisApplicabilityAssessmentV1 = Readonly<{
  hypothesisAssessmentContentDigestHex: string;
  evaluatorIdentityDigestHex: string;
  status: "APPLICABLE" | "NOT_APPLICABLE" | "BLOCKED";
}>;

export type MarketStateSnapshotV2 = Readonly<{
  schemaVersion: typeof MARKET_STATE_SNAPSHOT_V2_VERSION;
  organizationId: string;
  accountId: string | null;
  instrumentId: string;
  symbol: string;
  venue: string;
  analysisPurpose: InformationAnalysisPurposeV2;
  analyticalTimeframe: string;
  horizon: string;
  pitAnchor: string;
  runtimeContextDigestHex: string;
  runtimePosture: RuntimeAnalysisPostureV1;
  requiredInformationProfileDigestHex: string;
  informationSufficiencyReceiptDigestHex: string;
  reconstructionDigestHex: string;
  stateRepresentationSpecDigestHex: string;
  dynamicStateDescriptorDigestHex: string;
  understandingClaimSetDigestHex: string;
  activeKnowledgeStateDigestHex: string;
  selectedKnowledgeClaimDigestsHex: readonly string[];
  selectedFailureBoundaryDigestsHex: readonly string[];
  hypothesisAssessmentSetDigestHex: string;
  consumedHypothesisAssessments: readonly HypothesisApplicabilityAssessmentV1[];
  sourceProfileDigestHex: string;
  representationProfileDigestHex: string;
  anchorRealizedVol20m_1m: number;
  mathematicalInputDigestHex: string;
  applicabilityPrerequisiteDigestHex: string;
  qualifiedInputBindingDigestHex: string;
  contentDigestHex: string;
}>;

export type PredictiveAdmissionReasonV1 =
  | "RUNTIME_HALTED"
  | "NEW_RISK_NOT_PERMITTED"
  | "ISG_NOT_SUFFICIENT"
  | "ISG_IDENTITY_MISMATCH"
  | "PIT_OR_INTEGRITY_INVALID"
  | "PACKAGE_COMPATIBILITY_MISMATCH"
  | "HYPOTHESIS_APPLICABILITY_MISSING"
  | "HYPOTHESIS_NOT_APPLICABLE"
  | "FORECAST_CONTRACT_BINDING_MISMATCH"
  | "SCIENTIFIC_ADMISSION_MISSING_OR_MISMATCHED"
  | "PACKAGE_QUARANTINED_OR_STALE";

type ReceiptBody = Readonly<{
  schemaVersion: typeof PREDICTIVE_ADMISSION_RECEIPT_V1_VERSION;
  verdict: "ADMITTED" | "NOT_ADMITTED" | "RESEARCH_ONLY";
  capitalAuthority: "NONE";
  analysisPurpose: InformationAnalysisPurposeV2;
  pitAnchor: string;
  marketStateSnapshotContentDigestHex: string;
  selectedPredictivePackageContentDigestHex: string;
  scientificAdmissionReceiptContentDigestHex: string | null;
  inputContractDigestHex: string;
  modelSpecDigestHex: string;
  modelArtifactDigestHex: string;
  qualifiedInputBindingDigestHex: string;
  blockingReasons: readonly PredictiveAdmissionReasonV1[];
}>;

export type PredictiveAdmissionReceiptV1 = ReceiptBody & Readonly<{ contentDigestHex: string }>;
export type ForecastRuntimeAdmittedPredictiveAdmissionReceiptV1 = PredictiveAdmissionReceiptV1 &
  Readonly<{ verdict: "ADMITTED" }>;
export type ResearchOnlyPredictiveAdmissionReceiptV1 = PredictiveAdmissionReceiptV1 &
  Readonly<{ verdict: "RESEARCH_ONLY"; capitalAuthority: "NONE" }>;

type SnapshotInput = Omit<
  MarketStateSnapshotV2,
  | "schemaVersion"
  | "mathematicalInputDigestHex"
  | "applicabilityPrerequisiteDigestHex"
  | "qualifiedInputBindingDigestHex"
  | "contentDigestHex"
> & { forecastContractBinding: ForecastContractBindingV1 };

function requireText(value: string, field: string): string {
  if (!value.trim()) throw new Error(`PREDICTIVE_ADMISSION_INVALID:${field}`);
  return value;
}

function requireInstant(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error("PREDICTIVE_ADMISSION_INVALID:pitAnchor");
  }
  return value;
}

function canonicalDigests(values: readonly string[], field: string): readonly string[] {
  const result = [...new Set(values)].sort();
  for (const digest of result) assertDigestHex64(digest, field);
  return result;
}

export function buildMarketStateSnapshotV2(input: SnapshotInput): MarketStateSnapshotV2 {
  const binding = requireForecastContractBindingV1(input.forecastContractBinding);
  const digestFields = {
    runtimeContextDigestHex: input.runtimeContextDigestHex,
    requiredInformationProfileDigestHex: input.requiredInformationProfileDigestHex,
    informationSufficiencyReceiptDigestHex: input.informationSufficiencyReceiptDigestHex,
    reconstructionDigestHex: input.reconstructionDigestHex,
    stateRepresentationSpecDigestHex: input.stateRepresentationSpecDigestHex,
    dynamicStateDescriptorDigestHex: input.dynamicStateDescriptorDigestHex,
    understandingClaimSetDigestHex: input.understandingClaimSetDigestHex,
    activeKnowledgeStateDigestHex: input.activeKnowledgeStateDigestHex,
    hypothesisAssessmentSetDigestHex: input.hypothesisAssessmentSetDigestHex,
    sourceProfileDigestHex: input.sourceProfileDigestHex,
    representationProfileDigestHex: input.representationProfileDigestHex,
  };
  for (const [field, digest] of Object.entries(digestFields)) assertDigestHex64(digest, field);
  const assessments = [...input.consumedHypothesisAssessments]
    .map((assessment) => {
      assertDigestHex64(
        assessment.hypothesisAssessmentContentDigestHex,
        "hypothesisAssessmentContentDigestHex",
      );
      assertDigestHex64(assessment.evaluatorIdentityDigestHex, "evaluatorIdentityDigestHex");
      return assessment;
    })
    .sort((left, right) =>
      left.hypothesisAssessmentContentDigestHex.localeCompare(
        right.hypothesisAssessmentContentDigestHex,
      ),
    );
  if (assessments.length === 0) {
    throw new Error("PREDICTIVE_ADMISSION_INVALID:hypothesisAssessmentMissing");
  }
  const inputIdentities = computeForecastInputIdentitiesV2({
    contract: binding.inputContract,
    anchorClosedBarAt: requireInstant(input.pitAnchor),
    predictors: { [CHAMPION_FORECAST_PREDICTOR_ID]: input.anchorRealizedVol20m_1m },
    hypothesisAssessmentContentDigestHex: input.hypothesisAssessmentSetDigestHex,
  });
  const body = {
    schemaVersion: MARKET_STATE_SNAPSHOT_V2_VERSION,
    organizationId: requireText(input.organizationId, "organizationId"),
    accountId: input.accountId,
    instrumentId: requireText(input.instrumentId, "instrumentId"),
    symbol: requireText(input.symbol, "symbol"),
    venue: requireText(input.venue, "venue"),
    analysisPurpose: input.analysisPurpose,
    analyticalTimeframe: requireText(input.analyticalTimeframe, "analyticalTimeframe"),
    horizon: requireText(input.horizon, "horizon"),
    pitAnchor: inputIdentities.anchorClosedBarAt,
    runtimeContextDigestHex: input.runtimeContextDigestHex,
    runtimePosture: input.runtimePosture,
    requiredInformationProfileDigestHex: input.requiredInformationProfileDigestHex,
    informationSufficiencyReceiptDigestHex: input.informationSufficiencyReceiptDigestHex,
    reconstructionDigestHex: input.reconstructionDigestHex,
    stateRepresentationSpecDigestHex: input.stateRepresentationSpecDigestHex,
    dynamicStateDescriptorDigestHex: input.dynamicStateDescriptorDigestHex,
    understandingClaimSetDigestHex: input.understandingClaimSetDigestHex,
    activeKnowledgeStateDigestHex: input.activeKnowledgeStateDigestHex,
    selectedKnowledgeClaimDigestsHex: canonicalDigests(
      input.selectedKnowledgeClaimDigestsHex,
      "selectedKnowledgeClaimDigestHex",
    ),
    selectedFailureBoundaryDigestsHex: canonicalDigests(
      input.selectedFailureBoundaryDigestsHex,
      "selectedFailureBoundaryDigestHex",
    ),
    hypothesisAssessmentSetDigestHex: input.hypothesisAssessmentSetDigestHex,
    consumedHypothesisAssessments: assessments,
    sourceProfileDigestHex: input.sourceProfileDigestHex,
    representationProfileDigestHex: input.representationProfileDigestHex,
    anchorRealizedVol20m_1m: input.anchorRealizedVol20m_1m,
    mathematicalInputDigestHex: inputIdentities.mathematicalInputDigestHex,
    applicabilityPrerequisiteDigestHex:
      inputIdentities.applicabilityPrerequisiteDigestHex,
    qualifiedInputBindingDigestHex: inputIdentities.qualifiedInputBindingDigestHex,
  } as const;
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

export type PredictiveAdmissionInputV1 = Readonly<{
  snapshot: MarketStateSnapshotV2;
  informationSufficiencyReceipt: InformationSufficiencyReceiptV2;
  forecastContractBinding: ForecastContractBindingV1;
  scientificAdmissionReceipt: ScientificAdmissionReceiptV2 | null;
  scientificAdmissionExpectedBindings: ScientificAdmissionExpectedBindingsV2;
  expected: Readonly<{
    organizationId: string;
    symbol: string;
    venue: string;
    analyticalTimeframe: string;
    horizon: string;
    sourceProfileDigestHex: string;
    representationProfileDigestHex: string;
    stateRepresentationSpecDigestHex: string;
    selectedPredictivePackageContentDigestHex: string;
    inputContractDigestHex: string;
    modelSpecDigestHex: string;
    modelArtifactDigestHex: string;
  }>;
  integrityAndPitValid: boolean;
  packageQuarantinedOrStale: boolean;
}>;

function receipt(input: PredictiveAdmissionInputV1, reasons: PredictiveAdmissionReasonV1[]) {
  const binding = input.forecastContractBinding;
  const verdict =
    reasons.length > 0
      ? "NOT_ADMITTED"
      : input.snapshot.analysisPurpose === "RESEARCH_NON_CAPITAL"
        ? "RESEARCH_ONLY"
        : "ADMITTED";
  const body: ReceiptBody = {
    schemaVersion: PREDICTIVE_ADMISSION_RECEIPT_V1_VERSION,
    verdict,
    capitalAuthority: "NONE",
    analysisPurpose: input.snapshot.analysisPurpose,
    pitAnchor: input.snapshot.pitAnchor,
    marketStateSnapshotContentDigestHex: input.snapshot.contentDigestHex,
    selectedPredictivePackageContentDigestHex:
      binding.selectedPredictivePackageContentDigestHex,
    scientificAdmissionReceiptContentDigestHex:
      input.scientificAdmissionReceipt?.contentDigestHex ?? null,
    inputContractDigestHex: binding.inputContract.contentDigestHex,
    modelSpecDigestHex: binding.modelSpec.contentDigestHex,
    modelArtifactDigestHex: binding.modelArtifact.contentDigestHex,
    qualifiedInputBindingDigestHex: input.snapshot.qualifiedInputBindingDigestHex,
    blockingReasons: [...new Set(reasons)].sort(),
  };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

export function assessPredictiveAdmissionV1(
  input: PredictiveAdmissionInputV1,
): PredictiveAdmissionReceiptV1 {
  const reasons: PredictiveAdmissionReasonV1[] = [];
  let binding: ForecastContractBindingV1 | null = null;
  try {
    binding = requireForecastContractBindingV1(input.forecastContractBinding);
  } catch {
    reasons.push("FORECAST_CONTRACT_BINDING_MISMATCH");
  }
  const snapshot = input.snapshot;
  const { contentDigestHex: ignoredDigest, ...snapshotBody } = snapshot;
  if (computeSemanticSha256Hex(snapshotBody) !== ignoredDigest) {
    reasons.push("PIT_OR_INTEGRITY_INVALID");
  }
  if (binding) {
    try {
      const identities = computeForecastInputIdentitiesV2({
        contract: binding.inputContract,
        anchorClosedBarAt: snapshot.pitAnchor,
        predictors: {
          [CHAMPION_FORECAST_PREDICTOR_ID]: snapshot.anchorRealizedVol20m_1m,
        },
        hypothesisAssessmentContentDigestHex: snapshot.hypothesisAssessmentSetDigestHex,
      });
      if (
        identities.mathematicalInputDigestHex !== snapshot.mathematicalInputDigestHex ||
        identities.applicabilityPrerequisiteDigestHex !==
          snapshot.applicabilityPrerequisiteDigestHex ||
        identities.qualifiedInputBindingDigestHex !== snapshot.qualifiedInputBindingDigestHex
      ) {
        reasons.push("PACKAGE_COMPATIBILITY_MISMATCH");
      }
    } catch {
      reasons.push("PACKAGE_COMPATIBILITY_MISMATCH");
    }
  }
  if (!input.integrityAndPitValid) reasons.push("PIT_OR_INTEGRITY_INVALID");
  if (snapshot.runtimePosture === "HALT") reasons.push("RUNTIME_HALTED");
  if (
    snapshot.analysisPurpose === "NEW_OPPORTUNITY" &&
    snapshot.runtimePosture !== "FULL_ANALYSIS_AND_NEW_RISK"
  ) {
    reasons.push("NEW_RISK_NOT_PERMITTED");
  }
  const isg = input.informationSufficiencyReceipt;
  if (isg.status !== "SUFFICIENT") reasons.push("ISG_NOT_SUFFICIENT");
  if (
    isg.contentDigest !== snapshot.informationSufficiencyReceiptDigestHex ||
    isg.profileContentDigest !== snapshot.requiredInformationProfileDigestHex ||
    isg.organizationId !== snapshot.organizationId ||
    isg.accountId !== snapshot.accountId ||
    isg.purpose !== snapshot.analysisPurpose ||
    isg.symbol !== snapshot.symbol ||
    isg.venue !== snapshot.venue ||
    isg.analyticalTimeframe !== snapshot.analyticalTimeframe ||
    isg.horizon !== snapshot.horizon ||
    isg.pitAnchor !== snapshot.pitAnchor
  ) {
    reasons.push("ISG_IDENTITY_MISMATCH");
  }
  if (
    snapshot.consumedHypothesisAssessments.length === 0 ||
    !snapshot.hypothesisAssessmentSetDigestHex
  ) {
    reasons.push("HYPOTHESIS_APPLICABILITY_MISSING");
  } else if (snapshot.consumedHypothesisAssessments.some((value) => value.status !== "APPLICABLE")) {
    reasons.push("HYPOTHESIS_NOT_APPLICABLE");
  }
  if (input.packageQuarantinedOrStale) reasons.push("PACKAGE_QUARANTINED_OR_STALE");
  const expected = input.expected;
  if (
    snapshot.organizationId !== expected.organizationId ||
    snapshot.symbol !== expected.symbol ||
    snapshot.venue !== expected.venue ||
    snapshot.analyticalTimeframe !== expected.analyticalTimeframe ||
    snapshot.horizon !== expected.horizon ||
    snapshot.sourceProfileDigestHex !== expected.sourceProfileDigestHex ||
    snapshot.representationProfileDigestHex !== expected.representationProfileDigestHex ||
    snapshot.stateRepresentationSpecDigestHex !== expected.stateRepresentationSpecDigestHex ||
    !binding ||
    binding.organizationId !== expected.organizationId ||
    binding.selectedPredictivePackageContentDigestHex !==
      expected.selectedPredictivePackageContentDigestHex ||
    binding.inputContract.contentDigestHex !== expected.inputContractDigestHex ||
    binding.modelSpec.contentDigestHex !== expected.modelSpecDigestHex ||
    binding.modelArtifact.contentDigestHex !== expected.modelArtifactDigestHex ||
    isg.forecastPackageContentDigest !== expected.selectedPredictivePackageContentDigestHex ||
    isg.inputContractContentDigest !== expected.inputContractDigestHex
  ) {
    reasons.push("PACKAGE_COMPATIBILITY_MISMATCH");
  }
  if (
    !binding ||
    binding.scientificAdmissionReceiptContentDigestHex !==
      input.scientificAdmissionReceipt?.contentDigestHex
  ) {
    reasons.push("SCIENTIFIC_ADMISSION_MISSING_OR_MISMATCHED");
  } else {
    try {
      requireScientificAdmissionV2(
        input.scientificAdmissionReceipt,
        input.scientificAdmissionExpectedBindings,
      );
    } catch {
      reasons.push("SCIENTIFIC_ADMISSION_MISSING_OR_MISMATCHED");
    }
  }
  return receipt(input, reasons);
}

export function requireForecastRuntimeAdmittedPredictiveAdmissionV1(
  value: PredictiveAdmissionReceiptV1,
): ForecastRuntimeAdmittedPredictiveAdmissionReceiptV1 {
  if (value.verdict !== "ADMITTED" || value.blockingReasons.length !== 0) {
    throw new Error("PREDICTIVE_ADMISSION_NOT_FORECAST_RUNTIME_ADMITTED");
  }
  return value as ForecastRuntimeAdmittedPredictiveAdmissionReceiptV1;
}

export function serializePredictiveAdmissionV1(value: PredictiveAdmissionReceiptV1): string {
  return canonicalizeSemanticJsonString(value);
}
