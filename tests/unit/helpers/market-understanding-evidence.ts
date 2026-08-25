import { createHash } from "node:crypto";

import {
  defineRequiredInformationProfileV2,
  evaluateInformationSufficiencyV2,
  type InformationEvidenceV2,
  type InformationQuestionRequirementV2,
} from "@/lib/trader/intelligence/information-sufficiency";
import { CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION } from "@/lib/trader/mi/canonical-observation-v1";

export const UNDERSTANDING_TEST_PIT = "2026-08-23T12:00:00.000Z";
export const understandingTestDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export function makeUnderstandingRequirement(
  overrides: Partial<InformationQuestionRequirementV2> = {},
): InformationQuestionRequirementV2 {
  return {
    id: "price-state",
    questionId: "Q_WHAT_HAPPENING",
    classification: "MANDATORY",
    contextTriggerKey: null,
    satisfiers: [{ evidenceFamily: "price", providerIds: ["htx_spot"], substitutionRuleId: null }],
    allowedObservationKinds: ["ohlcv_bar"],
    allowedObservationSchemaVersions: [CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION],
    allowedMeasurementDefinitionDigests: [],
    maxStalenessMs: 60_000,
    minimumTrustScore: 0.5,
    minimumIndependentGroups: 1,
    contradictionPolicy: "FAIL_UNRESOLVED",
    requirePitQualified: true,
    requireReplayEligible: true,
    inquiryBounds: { maxDepth: 2, maxDurationMs: 1_000, maxProviderFanout: 2 },
    ...overrides,
  };
}

export function makeUnderstandingEvidence(
  overrides: Partial<InformationEvidenceV2> = {},
): InformationEvidenceV2 {
  return {
    evidenceId: "evidence-price-1",
    evidenceFamily: "price",
    providerId: "htx_spot",
    sourceId: "00000000-0000-4000-8000-000000000001",
    observationId: "00000000-0000-4000-8000-000000000002",
    observationKind: "ohlcv_bar",
    observationSchemaVersion: CANONICAL_PIT_OBSERVATION_SCHEMA_VERSION,
    observationContentDigest: understandingTestDigest("observation-price"),
    trustAsOfReceiptId: understandingTestDigest("trust-receipt-price"),
    trustRevisionId: "00000000-0000-4000-8000-000000000003",
    trustRevisionContentDigest: understandingTestDigest("trust-revision-price"),
    measurementDefinitionId: null,
    measurementDefinitionContentDigest: null,
    measurementValueId: null,
    measurementValueContentDigest: null,
    availability: "AVAILABLE",
    availableAt: "2026-08-23T11:59:30.000Z",
    trust: "TRUSTED",
    trustScore: 0.9,
    pitQualified: true,
    replayEligible: true,
    dependenceGroup: "htx-price",
    contradictionGroup: null,
    contradiction: "NONE",
    epistemicRole: "PRICE_STATE",
    historyScope: "NOT_HISTORICAL",
    degradationReasonCodes: [],
    ...overrides,
  };
}

export function makeUnderstandingProfileReceipt(input: {
  requirements?: readonly InformationQuestionRequirementV2[];
  evidence?: readonly InformationEvidenceV2[];
  pitAnchor?: string;
} = {}) {
  const requirements = input.requirements ?? [makeUnderstandingRequirement()];
  const evidence = input.evidence ?? [makeUnderstandingEvidence()];
  const profile = defineRequiredInformationProfileV2({
    organizationId: "org-a",
    accountId: "account-a",
    profileVersion: "understanding-test-profile-v1",
    purpose: "NEW_OPPORTUNITY",
    symbol: "BTC/USDT",
    venue: "HTX",
    analyticalTimeframe: "1m",
    horizon: "15m",
    forecastPackageId: null,
    forecastPackageContentDigest: null,
    inputContractContentDigest: null,
    requirements,
    aggregateQualityContract: null,
  });
  const receipt = evaluateInformationSufficiencyV2({
    profile,
    organizationId: profile.organizationId,
    accountId: profile.accountId,
    purpose: profile.purpose,
    symbol: profile.symbol,
    venue: profile.venue,
    analyticalTimeframe: profile.analyticalTimeframe,
    horizon: profile.horizon,
    pitAnchor: input.pitAnchor ?? UNDERSTANDING_TEST_PIT,
    activeContextTriggers: [],
    evidence,
  });
  return { profile, receipt };
}
