import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import {
  CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1,
  type CanonicalPrimitiveObservationKindV1,
} from "@/lib/trader/mi/canonical-observation-v1";
import { canonicalJsonString } from "@/lib/trader/research/digest";

export const REQUIRED_INFORMATION_PROFILE_V2_SCHEMA_VERSION =
  "required-information-profile-v2" as const;
export const INFORMATION_SUFFICIENCY_RECEIPT_V2_SCHEMA_VERSION =
  "information-sufficiency-receipt-v2" as const;

export const INFORMATION_ANALYSIS_PURPOSES_V2 = [
  "NEW_OPPORTUNITY",
  "OPEN_POSITION_REASSESSMENT",
  "RESEARCH_NON_CAPITAL",
] as const;
export type InformationAnalysisPurposeV2 = (typeof INFORMATION_ANALYSIS_PURPOSES_V2)[number];

export const INFORMATION_QUESTION_IDS_V2 = [
  "Q_WHAT_HAPPENING",
  "Q_WHY_HAPPENING",
  "Q_CROSS_TIMEFRAME_RELATIONSHIP",
  "Q_UNKNOWN_OR_CONTRADICTORY",
  "Q_EXECUTION_LIQUIDITY",
  "Q_HISTORICAL_ANALOGUES",
] as const;
export type InformationQuestionIdV2 = (typeof INFORMATION_QUESTION_IDS_V2)[number];

export const INFORMATION_REQUIREMENT_CLASSES_V2 = [
  "MANDATORY",
  "CONTEXT_TRIGGERED",
  "OPTIONAL_ENRICHMENT",
] as const;
export type InformationRequirementClassV2 = (typeof INFORMATION_REQUIREMENT_CLASSES_V2)[number];

export type InformationContradictionPolicyV2 =
  | "RECORD_ONLY"
  | "FAIL_UNRESOLVED"
  | "REQUIRE_AGREEMENT";

export type InformationSatisfierV2 = Readonly<{
  evidenceFamily: string;
  providerIds: readonly string[];
  substitutionRuleId: string | null;
}>;

export type InformationQuestionRequirementV2 = Readonly<{
  id: string;
  questionId: InformationQuestionIdV2;
  classification: InformationRequirementClassV2;
  contextTriggerKey: string | null;
  satisfiers: readonly InformationSatisfierV2[];
  allowedObservationKinds: readonly CanonicalPrimitiveObservationKindV1[];
  allowedObservationSchemaVersions: readonly string[];
  allowedMeasurementDefinitionDigests: readonly string[];
  maxStalenessMs: number | null;
  minimumTrustScore: number | null;
  minimumIndependentGroups: number;
  contradictionPolicy: InformationContradictionPolicyV2;
  requirePitQualified: boolean;
  requireReplayEligible: boolean;
  inquiryBounds: Readonly<{
    maxDepth: number;
    maxDurationMs: number;
    maxProviderFanout: number;
  }>;
}>;

export type AggregateQualityContractV2 = Readonly<{
  evaluatorVersion: string;
  evaluatorContentDigest: string;
}>;

export type RequiredInformationProfileV2 = Readonly<{
  id: string;
  schemaVersion: typeof REQUIRED_INFORMATION_PROFILE_V2_SCHEMA_VERSION;
  organizationId: string;
  accountId: string | null;
  profileVersion: string;
  purpose: InformationAnalysisPurposeV2;
  symbol: string;
  venue: string;
  analyticalTimeframe: string;
  horizon: string;
  forecastPackageId: string | null;
  forecastPackageContentDigest: string | null;
  inputContractContentDigest: string | null;
  requirements: readonly InformationQuestionRequirementV2[];
  aggregateQualityContract: AggregateQualityContractV2 | null;
  authority: "EPISTEMIC_PREREQUISITE_ONLY";
  contentDigest: string;
}>;

export type InformationEvidenceAvailabilityV2 = "AVAILABLE" | "UNAVAILABLE" | "REJECTED";
export type InformationEvidenceTrustV2 = "TRUSTED" | "UNTRUSTED" | "UNKNOWN";
export type InformationEvidenceRoleV2 =
  | "PRICE_STATE"
  | "CAUSAL"
  | "CORROBORATING"
  | "EXECUTION_LIQUIDITY"
  | "HISTORICAL_ANALOGUE";
export type InformationEvidenceHistoryScopeV2 =
  | "NOT_HISTORICAL"
  | "DEVELOPMENT"
  | "WALK_FORWARD_PREDICTIVE"
  | "ADMISSIBLE_PATTERN_KNOWLEDGE"
  | "BLIND_HOLDOUT";
export type InformationEvidenceContradictionV2 = "NONE" | "SUPPORTS" | "CONTRADICTS" | "UNRESOLVED";

export type HistoricalDatasetTrustAuthorityV2 = Readonly<{
  schemaVersion: "historical-dataset-trust-authority-v2";
  organizationId: string;
  symbol: string;
  runId: string;
  releaseSha: string;
  ratifiedAdmissionId: string;
  ratifiedAdmissionContentDigestHex: string;
  epistemicRecordCutoff: string;
  datasetAuthorityId: string;
  datasetAuthorityContentDigestHex: string;
  datasetAuthorityDigestHex: string;
  partitionRawSha256Hex: string;
  membershipContentDigestHex: string;
  sealedCycleContentDigestHex: string;
  wfPredictiveSemanticContentDigestHex: string;
  wfPredictiveStartUtc: string;
  wfPredictiveEndUtc: string;
  publicAvailableAt: string;
  canonicalRecordAvailableAt: string;
  canonicalRecordIngestTime: string;
  sourceId: string;
  trustAsOfReceiptId: string;
  trustRevisionId: string;
  trustRevisionContentDigestHex: string;
  trustScore: number;
  observationId: string;
  observationContentDigestHex: string;
  contentDigestHex: string;
}>;

export type InformationEvidenceV2 = Readonly<{
  evidenceId: string;
  evidenceFamily: string;
  providerId: string;
  sourceId: string;
  observationId: string;
  observationKind: CanonicalPrimitiveObservationKindV1;
  observationSchemaVersion: string;
  observationContentDigest: string;
  trustAsOfReceiptId: string | null;
  trustRevisionId: string | null;
  trustRevisionContentDigest: string | null;
  measurementDefinitionId: string | null;
  measurementDefinitionContentDigest: string | null;
  measurementValueId: string | null;
  measurementValueContentDigest: string | null;
  availability: InformationEvidenceAvailabilityV2;
  availableAt: string;
  trust: InformationEvidenceTrustV2;
  trustScore: number | null;
  pitQualified: boolean;
  replayEligible: boolean;
  dependenceGroup: string;
  contradictionGroup: string | null;
  contradiction: InformationEvidenceContradictionV2;
  epistemicRole: InformationEvidenceRoleV2;
  historyScope: InformationEvidenceHistoryScopeV2;
  degradationReasonCodes: readonly string[];
  /** Absent for the legacy/live contract; present only for sealed historical replay. */
  historicalDatasetTrustAuthority?: HistoricalDatasetTrustAuthorityV2;
}>;

export type AggregateQualityEvaluationV2 = Readonly<{
  evaluatorVersion: string;
  evaluatorContentDigest: string;
  status: "PASS" | "FAIL" | "UNAVAILABLE";
  componentReceipts: readonly Readonly<{
    componentId: string;
    valueDigest: string;
  }>[];
  aggregateValueDigest: string | null;
  reasonCodes: readonly string[];
}>;

export const INFORMATION_REQUIREMENT_TERMINAL_STATUSES_V2 = [
  "ANSWERED_SUFFICIENTLY",
  "INSUFFICIENT_NON_BLOCKING",
  "INSUFFICIENT_BLOCKING",
  "UNRESOLVED_CONTRADICTION",
  "UNAVAILABLE",
  "NOT_REQUIRED",
  "NOT_APPLICABLE",
] as const;
export type InformationRequirementTerminalStatusV2 =
  (typeof INFORMATION_REQUIREMENT_TERMINAL_STATUSES_V2)[number];

export type InformationRequirementReceiptV2 = Readonly<{
  requirementId: string;
  questionId: InformationQuestionIdV2;
  classification: InformationRequirementClassV2;
  active: boolean;
  terminalStatus: InformationRequirementTerminalStatusV2;
  blocking: boolean;
  matchedEvidenceIds: readonly string[];
  acceptedEvidenceIds: readonly string[];
  effectiveIndependentGroups: readonly string[];
  substitutionsUsed: readonly Readonly<{
    evidenceId: string;
    substitutionRuleId: string;
  }>[];
  reasonCodes: readonly string[];
}>;

export type InformationSufficiencyReceiptV2 = Readonly<{
  id: string;
  schemaVersion: typeof INFORMATION_SUFFICIENCY_RECEIPT_V2_SCHEMA_VERSION;
  organizationId: string;
  accountId: string | null;
  profileId: string;
  profileVersion: string;
  profileContentDigest: string;
  purpose: InformationAnalysisPurposeV2;
  symbol: string;
  venue: string;
  analyticalTimeframe: string;
  horizon: string;
  pitAnchor: string;
  forecastPackageId: string | null;
  forecastPackageContentDigest: string | null;
  inputContractContentDigest: string | null;
  activeContextTriggers: readonly string[];
  evidenceInventory: readonly InformationEvidenceV2[];
  requirementReceipts: readonly InformationRequirementReceiptV2[];
  aggregateQualityEvaluation: AggregateQualityEvaluationV2 | null;
  status: "SUFFICIENT" | "INSUFFICIENT" | "UNAVAILABLE";
  reasonCodes: readonly string[];
  authority: "EPISTEMIC_PREREQUISITE_ONLY";
  contentDigest: string;
}>;

const HEX_64 = /^[0-9a-f]{64}$/;

/** Matches PostgreSQL text ordering under COLLATE "C" for canonical collection identities. */
function postgresCanonicalTextCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256Canonical(value: unknown): string {
  return createHash("sha256").update(postgresCanonicalJsonString(value), "utf8").digest("hex");
}

const HISTORICAL_DATASET_TRUST_KEYS_V2 = [
  "canonicalRecordAvailableAt", "canonicalRecordIngestTime", "contentDigestHex",
  "datasetAuthorityContentDigestHex", "datasetAuthorityDigestHex", "datasetAuthorityId",
  "epistemicRecordCutoff", "membershipContentDigestHex", "organizationId",
  "symbol", "publicAvailableAt",
  "partitionRawSha256Hex", "ratifiedAdmissionContentDigestHex", "ratifiedAdmissionId",
  "releaseSha", "runId", "schemaVersion", "sealedCycleContentDigestHex",
  "sourceId", "trustAsOfReceiptId", "trustRevisionContentDigestHex", "trustRevisionId",
  "trustScore", "observationId", "observationContentDigestHex",
  "wfPredictiveEndUtc", "wfPredictiveSemanticContentDigestHex", "wfPredictiveStartUtc",
] as const;

export function buildHistoricalDatasetTrustAuthorityV2(
  input: Omit<HistoricalDatasetTrustAuthorityV2, "schemaVersion" | "contentDigestHex">,
): HistoricalDatasetTrustAuthorityV2 {
  const body = {
    schemaVersion: "historical-dataset-trust-authority-v2" as const,
    organizationId: input.organizationId,
    runId: input.runId,
    releaseSha: input.releaseSha,
    ratifiedAdmissionId: input.ratifiedAdmissionId,
    ratifiedAdmissionContentDigestHex: input.ratifiedAdmissionContentDigestHex,
    epistemicRecordCutoff: input.epistemicRecordCutoff,
    symbol: input.symbol,
    datasetAuthorityId: input.datasetAuthorityId,
    datasetAuthorityContentDigestHex: input.datasetAuthorityContentDigestHex,
    datasetAuthorityDigestHex: input.datasetAuthorityDigestHex,
    partitionRawSha256Hex: input.partitionRawSha256Hex,
    membershipContentDigestHex: input.membershipContentDigestHex,
    sealedCycleContentDigestHex: input.sealedCycleContentDigestHex,
    wfPredictiveStartUtc: input.wfPredictiveStartUtc,
    wfPredictiveEndUtc: input.wfPredictiveEndUtc,
    wfPredictiveSemanticContentDigestHex: input.wfPredictiveSemanticContentDigestHex,
    publicAvailableAt: input.publicAvailableAt,
    sourceId: input.sourceId,
    trustRevisionId: input.trustRevisionId,
    trustRevisionContentDigestHex: input.trustRevisionContentDigestHex,
    trustAsOfReceiptId: input.trustAsOfReceiptId,
    trustScore: input.trustScore,
    observationId: input.observationId,
    observationContentDigestHex: input.observationContentDigestHex,
    canonicalRecordAvailableAt: input.canonicalRecordAvailableAt,
    canonicalRecordIngestTime: input.canonicalRecordIngestTime,
  };
  const authority = { ...body, contentDigestHex: sha256Canonical(body) };
  assertHistoricalDatasetTrustAuthorityV2(authority);
  return Object.freeze(authority);
}

export function assertHistoricalDatasetTrustAuthorityV2(
  authority: HistoricalDatasetTrustAuthorityV2,
): HistoricalDatasetTrustAuthorityV2 {
  if (!authority || typeof authority !== "object" || Array.isArray(authority) ||
      Object.keys(authority).sort(postgresCanonicalTextCompare).join("\u0000") !==
        [...HISTORICAL_DATASET_TRUST_KEYS_V2].sort(postgresCanonicalTextCompare).join("\u0000") ||
      authority.schemaVersion !== "historical-dataset-trust-authority-v2") {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:historicalDatasetTrustAuthority");
  }
  requireNonEmpty(authority.organizationId, "historical.organizationId");
  requireNonEmpty(authority.runId, "historical.runId");
  if (!/^[0-9a-f]{40}$/.test(authority.releaseSha)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:historical.releaseSha");
  }
  requireNonEmpty(authority.ratifiedAdmissionId, "historical.ratifiedAdmissionId");
  requireNonEmpty(authority.datasetAuthorityId, "historical.datasetAuthorityId");
  requireNonEmpty(authority.sourceId, "historical.sourceId");
  requireNonEmpty(authority.trustRevisionId, "historical.trustRevisionId");
  requireNonEmpty(authority.observationId, "historical.observationId");
  for (const value of [authority.ratifiedAdmissionContentDigestHex,
    authority.datasetAuthorityContentDigestHex, authority.datasetAuthorityDigestHex,
    authority.partitionRawSha256Hex, authority.membershipContentDigestHex,
    authority.sealedCycleContentDigestHex, authority.wfPredictiveSemanticContentDigestHex,
    authority.trustAsOfReceiptId, authority.trustRevisionContentDigestHex,
    authority.observationContentDigestHex]) {
    requireDigest(value, "historical.digest");
  }
  if (!Number.isFinite(authority.trustScore) || authority.trustScore < 0 ||
      authority.trustScore > 1) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:historical.trustScore");
  }
  const times = [authority.epistemicRecordCutoff, authority.wfPredictiveStartUtc,
    authority.wfPredictiveEndUtc, authority.publicAvailableAt,
    authority.canonicalRecordAvailableAt,
    authority.canonicalRecordIngestTime];
  if (times.some((value) => !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString() !== value) ||
      Date.parse(authority.wfPredictiveStartUtc) >= Date.parse(authority.wfPredictiveEndUtc) ||
      Date.parse(authority.publicAvailableAt) < Date.parse(authority.wfPredictiveEndUtc) ||
      Date.parse(authority.publicAvailableAt) >
        Date.parse(authority.canonicalRecordAvailableAt) ||
      Date.parse(authority.canonicalRecordAvailableAt) >
        Date.parse(authority.canonicalRecordIngestTime) ||
      Date.parse(authority.canonicalRecordIngestTime) >
        Date.parse(authority.epistemicRecordCutoff)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:historicalDatasetTrustChronology");
  }
  const { contentDigestHex, ...body } = authority;
  if (sha256Canonical(body) !== contentDigestHex) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:historicalDatasetTrustDigest");
  }
  return authority;
}

function expandFiniteNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:nonFiniteCanonicalNumber");
  }
  if (Object.is(value, -0)) return "0";
  const encoded = String(value).toLowerCase();
  if (!encoded.includes("e")) return encoded;
  const [mantissa, exponentText] = encoded.split("e");
  const exponent = Number(exponentText);
  const negative = mantissa!.startsWith("-");
  const unsigned = negative ? mantissa!.slice(1) : mantissa!;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`;
  const decimalIndex = whole!.length + exponent;
  const expanded =
    decimalIndex <= 0
      ? `0.${"0".repeat(-decimalIndex)}${digits}`
      : decimalIndex >= digits.length
        ? `${digits}${"0".repeat(decimalIndex - digits.length)}`
        : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return negative ? `-${expanded}` : expanded;
}

/** Matches public.waia_canonical_jsonb_v1, including jsonb's non-exponent numeric text. */
function postgresCanonicalJsonString(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return expandFiniteNumber(value);
  if (Array.isArray(value)) {
    return `[${value.map(postgresCanonicalJsonString).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(postgresCanonicalTextCompare)
      .map((key) => `${JSON.stringify(key)}:${postgresCanonicalJsonString(record[key])}`)
      .join(",")}}`;
  }
  throw new Error("INFORMATION_SUFFICIENCY_INVALID:canonicalJsonType");
}

function requireNonEmpty(value: string, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`INFORMATION_SUFFICIENCY_INVALID:${field}`);
  }
  return value;
}

function requireDigest(value: string, field: string): string {
  if (!HEX_64.test(value)) {
    throw new Error(`INFORMATION_SUFFICIENCY_INVALID:${field}`);
  }
  return value;
}

function requireOptionalDigest(value: string | null, field: string): void {
  if (value !== null) requireDigest(value, field);
}

function sortUniqueStrings(values: readonly string[], field: string): string[] {
  const sorted = [...values]
    .map((value) => requireNonEmpty(value, field))
    .sort(postgresCanonicalTextCompare);
  if (new Set(sorted).size !== sorted.length) {
    throw new Error(`INFORMATION_SUFFICIENCY_INVALID:duplicate_${field}`);
  }
  return sorted;
}

function normalizeRequirement(
  requirement: InformationQuestionRequirementV2,
): InformationQuestionRequirementV2 {
  requireNonEmpty(requirement.id, "requirementId");
  if (!(INFORMATION_QUESTION_IDS_V2 as readonly string[]).includes(requirement.questionId)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:questionId");
  }
  if (
    !(INFORMATION_REQUIREMENT_CLASSES_V2 as readonly string[]).includes(requirement.classification)
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:classification");
  }
  if (requirement.classification === "CONTEXT_TRIGGERED" && !requirement.contextTriggerKey) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:contextTriggerKey");
  }
  if (
    requirement.classification !== "CONTEXT_TRIGGERED" &&
    requirement.contextTriggerKey !== null
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:unexpectedContextTriggerKey");
  }
  if (requirement.satisfiers.length === 0) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:satisfiers");
  }
  const normalizedSatisfiers = [...requirement.satisfiers].map((satisfier, index) => {
    requireNonEmpty(satisfier.evidenceFamily, "evidenceFamily");
    if (index === 0 && satisfier.substitutionRuleId !== null) {
      throw new Error("INFORMATION_SUFFICIENCY_INVALID:primarySubstitutionRule");
    }
    if (index > 0 && !satisfier.substitutionRuleId) {
      throw new Error("INFORMATION_SUFFICIENCY_INVALID:substitutionRuleId");
    }
    return {
      evidenceFamily: satisfier.evidenceFamily,
      providerIds: sortUniqueStrings(satisfier.providerIds, "providerId"),
      substitutionRuleId: satisfier.substitutionRuleId,
    };
  });
  const satisfiers = [
    normalizedSatisfiers[0]!,
    ...normalizedSatisfiers
      .slice(1)
      .sort((left, right) =>
        postgresCanonicalTextCompare(
          `${left.evidenceFamily}:${left.substitutionRuleId ?? ""}`,
          `${right.evidenceFamily}:${right.substitutionRuleId ?? ""}`,
        ),
      ),
  ];
  if (new Set(satisfiers.map((entry) => entry.evidenceFamily)).size !== satisfiers.length) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:duplicateSatisfierFamily");
  }
  if (
    requirement.minimumIndependentGroups < 1 ||
    !Number.isSafeInteger(requirement.minimumIndependentGroups)
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:minimumIndependentGroups");
  }
  if (
    requirement.maxStalenessMs !== null &&
    (!Number.isSafeInteger(requirement.maxStalenessMs) || requirement.maxStalenessMs < 0)
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:maxStalenessMs");
  }
  if (
    requirement.minimumTrustScore !== null &&
    (!Number.isFinite(requirement.minimumTrustScore) ||
      requirement.minimumTrustScore < 0 ||
      requirement.minimumTrustScore > 1)
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:minimumTrustScore");
  }
  if (
    !(["RECORD_ONLY", "FAIL_UNRESOLVED", "REQUIRE_AGREEMENT"] as const).includes(
      requirement.contradictionPolicy,
    )
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:contradictionPolicy");
  }
  for (const [field, value] of Object.entries(requirement.inquiryBounds)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`INFORMATION_SUFFICIENCY_INVALID:${field}`);
    }
  }
  const allowedObservationKinds = [...requirement.allowedObservationKinds].sort(
    postgresCanonicalTextCompare,
  );
  if (
    allowedObservationKinds.length === 0 ||
    new Set(allowedObservationKinds).size !== allowedObservationKinds.length ||
    allowedObservationKinds.some(
      (kind) => !(CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 as readonly string[]).includes(kind),
    )
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:allowedObservationKinds");
  }
  if (requirement.allowedObservationSchemaVersions.length === 0) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:allowedObservationSchemaVersions");
  }
  return {
    id: requirement.id,
    questionId: requirement.questionId,
    classification: requirement.classification,
    contextTriggerKey: requirement.contextTriggerKey,
    satisfiers,
    allowedObservationKinds,
    allowedObservationSchemaVersions: sortUniqueStrings(
      requirement.allowedObservationSchemaVersions,
      "observationSchemaVersion",
    ),
    allowedMeasurementDefinitionDigests: sortUniqueStrings(
      requirement.allowedMeasurementDefinitionDigests,
      "measurementDefinitionDigest",
    ).map((digest) => requireDigest(digest, "measurementDefinitionDigest")),
    maxStalenessMs: requirement.maxStalenessMs,
    minimumTrustScore: requirement.minimumTrustScore,
    minimumIndependentGroups: requirement.minimumIndependentGroups,
    contradictionPolicy: requirement.contradictionPolicy,
    requirePitQualified: requirement.requirePitQualified,
    requireReplayEligible: requirement.requireReplayEligible,
    inquiryBounds: {
      maxDepth: requirement.inquiryBounds.maxDepth,
      maxDurationMs: requirement.inquiryBounds.maxDurationMs,
      maxProviderFanout: requirement.inquiryBounds.maxProviderFanout,
    },
  };
}

export function defineRequiredInformationProfileV2(input: {
  organizationId: string;
  accountId: string | null;
  profileVersion: string;
  purpose: InformationAnalysisPurposeV2;
  symbol: string;
  venue: string;
  analyticalTimeframe: string;
  horizon: string;
  forecastPackageId: string | null;
  forecastPackageContentDigest: string | null;
  inputContractContentDigest: string | null;
  requirements: readonly InformationQuestionRequirementV2[];
  aggregateQualityContract: AggregateQualityContractV2 | null;
}): RequiredInformationProfileV2 {
  requireNonEmpty(input.organizationId, "organizationId");
  if (input.accountId !== null) requireNonEmpty(input.accountId, "accountId");
  requireNonEmpty(input.profileVersion, "profileVersion");
  requireNonEmpty(input.symbol, "symbol");
  requireNonEmpty(input.venue, "venue");
  requireNonEmpty(input.analyticalTimeframe, "analyticalTimeframe");
  requireNonEmpty(input.horizon, "horizon");
  if (!(INFORMATION_ANALYSIS_PURPOSES_V2 as readonly string[]).includes(input.purpose)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:purpose");
  }
  if (input.forecastPackageId !== null)
    requireNonEmpty(input.forecastPackageId, "forecastPackageId");
  requireOptionalDigest(input.forecastPackageContentDigest, "forecastPackageContentDigest");
  requireOptionalDigest(input.inputContractContentDigest, "inputContractContentDigest");
  if ((input.forecastPackageId === null) !== (input.forecastPackageContentDigest === null)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:forecastPackageIdentity");
  }
  if (input.requirements.length === 0) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:requirements");
  }
  const requirements = [...input.requirements]
    .map(normalizeRequirement)
    .sort((left, right) => postgresCanonicalTextCompare(left.id, right.id));
  if (new Set(requirements.map((entry) => entry.id)).size !== requirements.length) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:duplicateRequirementId");
  }
  let aggregateQualityContract: AggregateQualityContractV2 | null = null;
  if (input.aggregateQualityContract) {
    aggregateQualityContract = {
      evaluatorVersion: requireNonEmpty(
        input.aggregateQualityContract.evaluatorVersion,
        "aggregateEvaluatorVersion",
      ),
      evaluatorContentDigest: requireDigest(
        input.aggregateQualityContract.evaluatorContentDigest,
        "aggregateEvaluatorContentDigest",
      ),
    };
  }
  const body = {
    schemaVersion: REQUIRED_INFORMATION_PROFILE_V2_SCHEMA_VERSION,
    organizationId: input.organizationId,
    accountId: input.accountId,
    profileVersion: input.profileVersion,
    purpose: input.purpose,
    symbol: input.symbol,
    venue: input.venue,
    analyticalTimeframe: input.analyticalTimeframe,
    horizon: input.horizon,
    forecastPackageId: input.forecastPackageId,
    forecastPackageContentDigest: input.forecastPackageContentDigest,
    inputContractContentDigest: input.inputContractContentDigest,
    requirements,
    aggregateQualityContract,
    authority: "EPISTEMIC_PREREQUISITE_ONLY" as const,
  };
  const contentDigest = sha256Canonical(body);
  return { ...body, id: contentDigest, contentDigest };
}

export function assertRequiredInformationProfileV2(
  profile: RequiredInformationProfileV2,
): RequiredInformationProfileV2 {
  try {
    const expected = defineRequiredInformationProfileV2({
      organizationId: profile.organizationId,
      accountId: profile.accountId,
      profileVersion: profile.profileVersion,
      purpose: profile.purpose,
      symbol: profile.symbol,
      venue: profile.venue,
      analyticalTimeframe: profile.analyticalTimeframe,
      horizon: profile.horizon,
      forecastPackageId: profile.forecastPackageId,
      forecastPackageContentDigest: profile.forecastPackageContentDigest,
      inputContractContentDigest: profile.inputContractContentDigest,
      requirements: profile.requirements,
      aggregateQualityContract: profile.aggregateQualityContract,
    });
    if (canonicalJsonString(expected) !== canonicalJsonString(profile)) {
      throw new Error("identity mismatch");
    }
  } catch {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:profileIdentity");
  }
  return profile;
}

function evidenceSortKey(evidence: InformationEvidenceV2): string {
  return [
    evidence.evidenceId,
    evidence.observationContentDigest,
    evidence.measurementValueContentDigest ?? "",
  ].join(":");
}

function validateEvidence(evidence: InformationEvidenceV2): InformationEvidenceV2 {
  requireNonEmpty(evidence.evidenceId, "evidenceId");
  requireNonEmpty(evidence.evidenceFamily, "evidenceFamily");
  requireNonEmpty(evidence.providerId, "providerId");
  requireNonEmpty(evidence.sourceId, "sourceId");
  requireNonEmpty(evidence.observationId, "observationId");
  requireNonEmpty(evidence.observationSchemaVersion, "observationSchemaVersion");
  requireDigest(evidence.observationContentDigest, "observationContentDigest");
  requireNonEmpty(evidence.availableAt, "availableAt");
  requireNonEmpty(evidence.dependenceGroup, "dependenceGroup");
  if (!Number.isFinite(Date.parse(evidence.availableAt))) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:availableAt");
  }
  if (evidence.historyScope === "BLIND_HOLDOUT") {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:blindHoldoutEvidenceForbidden");
  }
  if (
    !(["AVAILABLE", "UNAVAILABLE", "REJECTED"] as readonly string[]).includes(
      evidence.availability,
    ) ||
    !(["TRUSTED", "UNTRUSTED", "UNKNOWN"] as readonly string[]).includes(evidence.trust) ||
    !(
      [
        "PRICE_STATE",
        "CAUSAL",
        "CORROBORATING",
        "EXECUTION_LIQUIDITY",
        "HISTORICAL_ANALOGUE",
      ] as readonly string[]
    ).includes(evidence.epistemicRole) ||
    !(
      ["NOT_HISTORICAL", "DEVELOPMENT", "WALK_FORWARD_PREDICTIVE",
        "ADMISSIBLE_PATTERN_KNOWLEDGE"] as readonly string[]
    ).includes(evidence.historyScope) ||
    !(["NONE", "SUPPORTS", "CONTRADICTS", "UNRESOLVED"] as readonly string[]).includes(
      evidence.contradiction,
    )
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:evidenceVocabulary");
  }
  if (
    !(CANONICAL_PRIMITIVE_OBSERVATION_KINDS_V1 as readonly string[]).includes(
      evidence.observationKind,
    ) ||
    typeof evidence.pitQualified !== "boolean" ||
    typeof evidence.replayEligible !== "boolean"
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:evidenceHardFloorTypes");
  }
  requireOptionalDigest(evidence.trustAsOfReceiptId, "trustAsOfReceiptId");
  requireOptionalDigest(evidence.trustRevisionContentDigest, "trustRevisionContentDigest");
  requireOptionalDigest(
    evidence.measurementDefinitionContentDigest,
    "measurementDefinitionContentDigest",
  );
  requireOptionalDigest(evidence.measurementValueContentDigest, "measurementValueContentDigest");
  if (
    evidence.trustScore !== null &&
    (!Number.isFinite(evidence.trustScore) || evidence.trustScore < 0 || evidence.trustScore > 1)
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:trustScore");
  }
  if (evidence.observationKind === "msv_envelope") {
    if (
      evidence.trustAsOfReceiptId !== null ||
      evidence.trustRevisionId !== null ||
      evidence.trustRevisionContentDigest !== null
    ) {
      throw new Error("INFORMATION_SUFFICIENCY_INVALID:internalTrustLineage");
    }
  } else if (
    evidence.trustAsOfReceiptId === null ||
    evidence.trustRevisionId === null ||
    evidence.trustRevisionContentDigest === null
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:externalTrustLineage");
  } else {
    requireNonEmpty(evidence.trustRevisionId, "trustRevisionId");
  }
  const hasHistoricalAuthority = Object.prototype.hasOwnProperty.call(
    evidence, "historicalDatasetTrustAuthority",
  );
  const historicalAuthority = evidence.historicalDatasetTrustAuthority;
  if (hasHistoricalAuthority !== (evidence.historyScope === "WALK_FORWARD_PREDICTIVE")) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:historicalDatasetTrustScope");
  }
  if (hasHistoricalAuthority) {
    if (!historicalAuthority) {
      throw new Error("INFORMATION_SUFFICIENCY_INVALID:historicalDatasetTrustAuthority");
    }
    assertHistoricalDatasetTrustAuthorityV2(historicalAuthority);
    if (evidence.observationKind === "msv_envelope" ||
        historicalAuthority.sourceId !== evidence.sourceId ||
        historicalAuthority.trustAsOfReceiptId !== evidence.trustAsOfReceiptId ||
        historicalAuthority.trustRevisionId !== evidence.trustRevisionId ||
        historicalAuthority.trustRevisionContentDigestHex !==
          evidence.trustRevisionContentDigest ||
        historicalAuthority.trustScore !== evidence.trustScore ||
        historicalAuthority.observationId !== evidence.observationId ||
        historicalAuthority.observationContentDigestHex !==
          evidence.observationContentDigest ||
        historicalAuthority.publicAvailableAt !== evidence.availableAt) {
      throw new Error("INFORMATION_SUFFICIENCY_INVALID:historicalDatasetTrustBinding");
    }
  }
  const measurementIdentity = [
    evidence.measurementDefinitionId,
    evidence.measurementDefinitionContentDigest,
    evidence.measurementValueId,
    evidence.measurementValueContentDigest,
  ];
  if (
    measurementIdentity.some((value) => value !== null) &&
    measurementIdentity.some((value) => value === null)
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:measurementLineage");
  }
  if (evidence.measurementDefinitionId !== null) {
    requireNonEmpty(evidence.measurementDefinitionId, "measurementDefinitionId");
    requireNonEmpty(evidence.measurementValueId!, "measurementValueId");
  }
  return {
    evidenceId: evidence.evidenceId,
    evidenceFamily: evidence.evidenceFamily,
    providerId: evidence.providerId,
    sourceId: evidence.sourceId,
    observationId: evidence.observationId,
    observationKind: evidence.observationKind,
    observationSchemaVersion: evidence.observationSchemaVersion,
    observationContentDigest: evidence.observationContentDigest,
    trustAsOfReceiptId: evidence.trustAsOfReceiptId,
    trustRevisionId: evidence.trustRevisionId,
    trustRevisionContentDigest: evidence.trustRevisionContentDigest,
    measurementDefinitionId: evidence.measurementDefinitionId,
    measurementDefinitionContentDigest: evidence.measurementDefinitionContentDigest,
    measurementValueId: evidence.measurementValueId,
    measurementValueContentDigest: evidence.measurementValueContentDigest,
    availability: evidence.availability,
    availableAt: new Date(evidence.availableAt).toISOString(),
    trust: evidence.trust,
    trustScore: evidence.trustScore,
    pitQualified: evidence.pitQualified,
    replayEligible: evidence.replayEligible,
    dependenceGroup: evidence.dependenceGroup,
    contradictionGroup: evidence.contradictionGroup,
    contradiction: evidence.contradiction,
    epistemicRole: evidence.epistemicRole,
    historyScope: evidence.historyScope,
    degradationReasonCodes: sortUniqueStrings(
      evidence.degradationReasonCodes,
      "degradationReasonCode",
    ),
    ...(historicalAuthority ? { historicalDatasetTrustAuthority: historicalAuthority } : {}),
  };
}

function requirementActive(
  requirement: InformationQuestionRequirementV2,
  triggers: ReadonlySet<string>,
): boolean {
  if (requirement.classification === "MANDATORY") return true;
  if (requirement.classification === "OPTIONAL_ENRICHMENT") return false;
  return triggers.has(requirement.contextTriggerKey!);
}

type CandidateCheck = {
  evidence: InformationEvidenceV2;
  substitutionRuleId: string | null;
  reasonCodes: string[];
  unavailable: boolean;
};

function checkCandidate(
  evidence: InformationEvidenceV2,
  requirement: InformationQuestionRequirementV2,
  pitAnchorMs: number,
  substitutionRuleId: string | null,
): CandidateCheck {
  const reasonCodes: string[] = [];
  let unavailable = false;
  if (evidence.availability !== "AVAILABLE") {
    reasonCodes.push(`EVIDENCE_${evidence.availability}`);
    unavailable = true;
  }
  if (evidence.degradationReasonCodes.includes("SOURCE_REVISION_MISMATCH")) {
    reasonCodes.push("EVIDENCE_SOURCE_REVISION_MISMATCH");
  }
  const availableAtMs = Date.parse(evidence.availableAt);
  if (availableAtMs > pitAnchorMs) reasonCodes.push("EVIDENCE_FUTURE_AT_PIT");
  if (
    requirement.maxStalenessMs !== null &&
    pitAnchorMs - availableAtMs > requirement.maxStalenessMs
  ) {
    reasonCodes.push("EVIDENCE_STALE");
  }
  if (evidence.trust === "UNKNOWN") {
    reasonCodes.push("EVIDENCE_TRUST_UNKNOWN");
    unavailable = true;
  } else if (evidence.trust === "UNTRUSTED") {
    reasonCodes.push("EVIDENCE_UNTRUSTED");
  }
  if (
    requirement.minimumTrustScore !== null &&
    (evidence.trustScore === null || evidence.trustScore < requirement.minimumTrustScore)
  ) {
    reasonCodes.push("EVIDENCE_TRUST_BELOW_PROFILE_FLOOR");
  }
  if (requirement.requirePitQualified && !evidence.pitQualified) {
    reasonCodes.push("EVIDENCE_NOT_PIT_QUALIFIED");
  }
  if (requirement.requireReplayEligible && !evidence.replayEligible) {
    reasonCodes.push("EVIDENCE_NOT_REPLAY_ELIGIBLE");
  }
  if (
    requirement.allowedObservationKinds.length > 0 &&
    !requirement.allowedObservationKinds.includes(evidence.observationKind)
  ) {
    reasonCodes.push("EVIDENCE_OBSERVATION_KIND_INCOMPATIBLE");
  }
  if (
    requirement.allowedObservationSchemaVersions.length > 0 &&
    !requirement.allowedObservationSchemaVersions.includes(evidence.observationSchemaVersion)
  ) {
    reasonCodes.push("EVIDENCE_SCHEMA_VERSION_INCOMPATIBLE");
  }
  if (
    requirement.allowedMeasurementDefinitionDigests.length > 0 &&
    (evidence.measurementDefinitionContentDigest === null ||
      !requirement.allowedMeasurementDefinitionDigests.includes(
        evidence.measurementDefinitionContentDigest,
      ))
  ) {
    reasonCodes.push("EVIDENCE_MEASUREMENT_VERSION_INCOMPATIBLE");
  }
  if (requirement.questionId === "Q_WHY_HAPPENING" && evidence.epistemicRole !== "CAUSAL") {
    reasonCodes.push("WHY_REQUIRES_CAUSAL_EVIDENCE");
  }
  if (
    requirement.questionId === "Q_HISTORICAL_ANALOGUES" &&
    evidence.epistemicRole !== "HISTORICAL_ANALOGUE"
  ) {
    reasonCodes.push("HISTORICAL_ANALOGUE_ROLE_REQUIRED");
  }
  if (
    requirement.questionId === "Q_HISTORICAL_ANALOGUES" &&
    !["DEVELOPMENT", "WALK_FORWARD_PREDICTIVE", "ADMISSIBLE_PATTERN_KNOWLEDGE"]
      .includes(evidence.historyScope)
  ) {
    reasonCodes.push("HISTORICAL_ANALOGUE_SCOPE_INADMISSIBLE");
  }
  if (
    requirement.contradictionPolicy !== "RECORD_ONLY" &&
    evidence.contradiction === "UNRESOLVED"
  ) {
    reasonCodes.push("EVIDENCE_CONTRADICTION_UNRESOLVED");
  }
  if (
    requirement.contradictionPolicy === "REQUIRE_AGREEMENT" &&
    evidence.contradiction === "CONTRADICTS"
  ) {
    reasonCodes.push("EVIDENCE_AGREEMENT_REQUIRED");
  }
  return {
    evidence,
    substitutionRuleId,
    reasonCodes: [...new Set(reasonCodes)].sort(postgresCanonicalTextCompare),
    unavailable,
  };
}

function evaluateRequirement(input: {
  requirement: InformationQuestionRequirementV2;
  evidence: readonly InformationEvidenceV2[];
  pitAnchorMs: number;
  activeContextTriggers: ReadonlySet<string>;
  profileApplicable: boolean;
}): InformationRequirementReceiptV2 {
  const { requirement } = input;
  if (!input.profileApplicable) {
    return {
      requirementId: requirement.id,
      questionId: requirement.questionId,
      classification: requirement.classification,
      active: false,
      terminalStatus: "NOT_APPLICABLE",
      blocking: false,
      matchedEvidenceIds: [],
      acceptedEvidenceIds: [],
      effectiveIndependentGroups: [],
      substitutionsUsed: [],
      reasonCodes: ["PROFILE_NOT_APPLICABLE"],
    };
  }
  const active = requirementActive(requirement, input.activeContextTriggers);
  if (requirement.classification === "CONTEXT_TRIGGERED" && !active) {
    return {
      requirementId: requirement.id,
      questionId: requirement.questionId,
      classification: requirement.classification,
      active: false,
      terminalStatus: "NOT_REQUIRED",
      blocking: false,
      matchedEvidenceIds: [],
      acceptedEvidenceIds: [],
      effectiveIndependentGroups: [],
      substitutionsUsed: [],
      reasonCodes: ["CONTEXT_TRIGGER_NOT_ACTIVE"],
    };
  }
  const candidates: CandidateCheck[] = [];
  for (const evidence of input.evidence) {
    const satisfier = requirement.satisfiers.find(
      (entry) =>
        entry.evidenceFamily === evidence.evidenceFamily &&
        (entry.providerIds.length === 0 || entry.providerIds.includes(evidence.providerId)),
    );
    if (!satisfier) continue;
    candidates.push(
      checkCandidate(evidence, requirement, input.pitAnchorMs, satisfier.substitutionRuleId),
    );
  }
  candidates.sort((left, right) =>
    postgresCanonicalTextCompare(evidenceSortKey(left.evidence), evidenceSortKey(right.evidence)),
  );
  const accepted = candidates.filter((candidate) => candidate.reasonCodes.length === 0);
  const effectiveAccepted = accepted.filter(
    (candidate, index, all) =>
      all.findIndex(
        (other) =>
          other.evidence.observationId === candidate.evidence.observationId &&
          other.evidence.observationContentDigest === candidate.evidence.observationContentDigest,
      ) === index,
  );
  const groups = [
    ...new Set(effectiveAccepted.map((candidate) => candidate.evidence.dependenceGroup)),
  ].sort(postgresCanonicalTextCompare);
  const reasonCodes = [...new Set(candidates.flatMap((candidate) => candidate.reasonCodes))].sort(
    postgresCanonicalTextCompare,
  );
  if (groups.length < requirement.minimumIndependentGroups) {
    reasonCodes.push("EFFECTIVE_INDEPENDENT_INFORMATION_BELOW_PROFILE_FLOOR");
  }
  if (candidates.length === 0) reasonCodes.push("EVIDENCE_MISSING");
  const agreementFailure =
    requirement.contradictionPolicy === "REQUIRE_AGREEMENT" &&
    candidates.some((candidate) =>
      ["CONTRADICTS", "UNRESOLVED"].includes(candidate.evidence.contradiction),
    );
  if (agreementFailure) reasonCodes.push("EVIDENCE_AGREEMENT_REQUIRED");
  const passed =
    effectiveAccepted.length > 0 &&
    groups.length >= requirement.minimumIndependentGroups &&
    !agreementFailure;
  const blocking = active && requirement.classification !== "OPTIONAL_ENRICHMENT";
  let terminalStatus: InformationRequirementTerminalStatusV2;
  if (passed) {
    terminalStatus = "ANSWERED_SUFFICIENTLY";
  } else if (
    candidates.some(
      (candidate) =>
        candidate.reasonCodes.includes("EVIDENCE_CONTRADICTION_UNRESOLVED") ||
        candidate.reasonCodes.includes("EVIDENCE_AGREEMENT_REQUIRED"),
    )
  ) {
    terminalStatus = "UNRESOLVED_CONTRADICTION";
  } else if (candidates.length === 0 || candidates.every((candidate) => candidate.unavailable)) {
    terminalStatus = blocking ? "UNAVAILABLE" : "INSUFFICIENT_NON_BLOCKING";
  } else {
    terminalStatus = blocking ? "INSUFFICIENT_BLOCKING" : "INSUFFICIENT_NON_BLOCKING";
  }
  return {
    requirementId: requirement.id,
    questionId: requirement.questionId,
    classification: requirement.classification,
    active,
    terminalStatus,
    blocking,
    matchedEvidenceIds: candidates.map((candidate) => candidate.evidence.evidenceId),
    acceptedEvidenceIds: accepted.map((candidate) => candidate.evidence.evidenceId),
    effectiveIndependentGroups: groups,
    substitutionsUsed: accepted
      .filter((candidate) => candidate.substitutionRuleId !== null)
      .map((candidate) => ({
        evidenceId: candidate.evidence.evidenceId,
        substitutionRuleId: candidate.substitutionRuleId!,
      })),
    reasonCodes: [...new Set(reasonCodes)].sort(postgresCanonicalTextCompare),
  };
}

export function evaluateInformationSufficiencyV2(input: {
  profile: RequiredInformationProfileV2;
  organizationId: string;
  accountId: string | null;
  purpose: InformationAnalysisPurposeV2;
  symbol: string;
  venue: string;
  analyticalTimeframe: string;
  horizon: string;
  pitAnchor: string;
  activeContextTriggers: readonly string[];
  evidence: readonly InformationEvidenceV2[];
  aggregateQualityEvaluation?: AggregateQualityEvaluationV2 | null;
}): InformationSufficiencyReceiptV2 {
  assertRequiredInformationProfileV2(input.profile);
  const pitAnchorMs = Date.parse(input.pitAnchor);
  if (!Number.isFinite(pitAnchorMs)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:pitAnchor");
  }
  const activeContextTriggers = sortUniqueStrings(
    input.activeContextTriggers,
    "activeContextTrigger",
  );
  const evidenceInventory = [...input.evidence]
    .map(validateEvidence)
    .sort((left, right) =>
      postgresCanonicalTextCompare(evidenceSortKey(left), evidenceSortKey(right)),
    );
  if (
    new Set(evidenceInventory.map((entry) => entry.evidenceId)).size !== evidenceInventory.length
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:duplicateEvidenceId");
  }
  const profileApplicable =
    input.profile.organizationId === input.organizationId &&
    input.profile.accountId === input.accountId &&
    input.profile.purpose === input.purpose &&
    input.profile.symbol === input.symbol &&
    input.profile.venue === input.venue &&
    input.profile.analyticalTimeframe === input.analyticalTimeframe &&
    input.profile.horizon === input.horizon;
  if (evidenceInventory.some((entry) =>
    entry.historyScope === "WALK_FORWARD_PREDICTIVE" &&
    (!entry.historicalDatasetTrustAuthority ||
      entry.historicalDatasetTrustAuthority.organizationId !== input.organizationId ||
      entry.historicalDatasetTrustAuthority.symbol !== input.symbol))) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:historicalDatasetTrustScope");
  }
  const triggerSet = new Set(activeContextTriggers);
  const requirementReceipts = input.profile.requirements.map((requirement) =>
    evaluateRequirement({
      requirement,
      evidence: evidenceInventory,
      pitAnchorMs,
      activeContextTriggers: triggerSet,
      profileApplicable,
    }),
  );

  const blockingFailures = requirementReceipts.filter(
    (receipt) => receipt.blocking && receipt.terminalStatus !== "ANSWERED_SUFFICIENTLY",
  );
  const layerAPassed = profileApplicable && blockingFailures.length === 0;

  let aggregateQualityEvaluation: AggregateQualityEvaluationV2 | null = null;
  const aggregateReasons: string[] = [];
  if (layerAPassed && input.profile.aggregateQualityContract) {
    const supplied = input.aggregateQualityEvaluation ?? null;
    if (
      supplied === null ||
      supplied.evaluatorVersion !== input.profile.aggregateQualityContract.evaluatorVersion ||
      supplied.evaluatorContentDigest !==
        input.profile.aggregateQualityContract.evaluatorContentDigest
    ) {
      aggregateReasons.push("AGGREGATE_QUALITY_CONTRACT_UNAVAILABLE_OR_MISMATCHED");
    } else {
      if (!(["PASS", "FAIL", "UNAVAILABLE"] as readonly string[]).includes(supplied.status)) {
        throw new Error("INFORMATION_SUFFICIENCY_INVALID:aggregateStatus");
      }
      requireDigest(supplied.evaluatorContentDigest, "aggregateEvaluatorContentDigest");
      if (supplied.aggregateValueDigest !== null) {
        requireDigest(supplied.aggregateValueDigest, "aggregateValueDigest");
      }
      const componentReceipts = [...supplied.componentReceipts]
        .map((component) => ({
          componentId: requireNonEmpty(component.componentId, "aggregateComponentId"),
          valueDigest: requireDigest(component.valueDigest, "aggregateComponentValueDigest"),
        }))
        .sort((left, right) =>
          postgresCanonicalTextCompare(left.componentId, right.componentId),
        );
      if (
        new Set(componentReceipts.map((entry) => entry.componentId)).size !==
        componentReceipts.length
      ) {
        throw new Error("INFORMATION_SUFFICIENCY_INVALID:duplicateAggregateComponentId");
      }
      aggregateQualityEvaluation = {
        evaluatorVersion: supplied.evaluatorVersion,
        evaluatorContentDigest: supplied.evaluatorContentDigest,
        status: supplied.status,
        componentReceipts,
        aggregateValueDigest: supplied.aggregateValueDigest,
        reasonCodes: sortUniqueStrings(supplied.reasonCodes, "aggregateReasonCode"),
      };
    }
  } else if (
    layerAPassed &&
    !input.profile.aggregateQualityContract &&
    input.aggregateQualityEvaluation != null
  ) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:unexpectedAggregateEvaluation");
  }
  let status: InformationSufficiencyReceiptV2["status"];
  if (!profileApplicable) {
    status = "UNAVAILABLE";
  } else if (blockingFailures.some((receipt) => receipt.terminalStatus === "UNAVAILABLE")) {
    status = "UNAVAILABLE";
  } else if (blockingFailures.length > 0) {
    status = "INSUFFICIENT";
  } else if (aggregateReasons.length > 0 || aggregateQualityEvaluation?.status === "UNAVAILABLE") {
    status = "UNAVAILABLE";
  } else if (aggregateQualityEvaluation?.status === "FAIL") {
    status = "INSUFFICIENT";
  } else {
    status = "SUFFICIENT";
  }
  const reasonCodes = [
    ...(!profileApplicable ? ["PROFILE_NOT_APPLICABLE"] : []),
    ...blockingFailures.flatMap((receipt) => receipt.reasonCodes),
    ...aggregateReasons,
    ...(aggregateQualityEvaluation?.reasonCodes ?? []),
  ];
  const body = {
    schemaVersion: INFORMATION_SUFFICIENCY_RECEIPT_V2_SCHEMA_VERSION,
    organizationId: input.organizationId,
    accountId: input.accountId,
    profileId: input.profile.id,
    profileVersion: input.profile.profileVersion,
    profileContentDigest: input.profile.contentDigest,
    purpose: input.purpose,
    symbol: input.symbol,
    venue: input.venue,
    analyticalTimeframe: input.analyticalTimeframe,
    horizon: input.horizon,
    pitAnchor: new Date(pitAnchorMs).toISOString(),
    forecastPackageId: input.profile.forecastPackageId,
    forecastPackageContentDigest: input.profile.forecastPackageContentDigest,
    inputContractContentDigest: input.profile.inputContractContentDigest,
    activeContextTriggers,
    evidenceInventory,
    requirementReceipts,
    aggregateQualityEvaluation,
    status,
    reasonCodes: [...new Set(reasonCodes)].sort(postgresCanonicalTextCompare),
    authority: "EPISTEMIC_PREREQUISITE_ONLY" as const,
  };
  const contentDigest = sha256Canonical(body);
  return { ...body, id: contentDigest, contentDigest };
}

export function assertInformationSufficiencyReceiptV2(
  receipt: InformationSufficiencyReceiptV2,
  profile: RequiredInformationProfileV2,
): InformationSufficiencyReceiptV2 {
  const expected = evaluateInformationSufficiencyV2({
    profile,
    organizationId: receipt.organizationId,
    accountId: receipt.accountId,
    purpose: receipt.purpose,
    symbol: receipt.symbol,
    venue: receipt.venue,
    analyticalTimeframe: receipt.analyticalTimeframe,
    horizon: receipt.horizon,
    pitAnchor: receipt.pitAnchor,
    activeContextTriggers: receipt.activeContextTriggers,
    evidence: receipt.evidenceInventory,
    aggregateQualityEvaluation: receipt.aggregateQualityEvaluation,
  });
  if (canonicalJsonString(expected) !== canonicalJsonString(receipt)) {
    throw new Error("INFORMATION_SUFFICIENCY_INVALID:receiptIdentity");
  }
  return receipt;
}
