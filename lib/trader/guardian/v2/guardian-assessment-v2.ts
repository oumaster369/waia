import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const GUARDIAN_ASSESSMENT_V2_SCHEMA_VERSION =
  "waia.trader.guardian_assessment.v2" as const;

export const guardianV2RecommendationValues = [
  "HOLD",
  "REDUCE_PARTIAL",
  "REDUCE_FULL",
] as const;
export type GuardianV2Recommendation =
  (typeof guardianV2RecommendationValues)[number];

export const guardianV2SufficiencyValues = ["SUFFICIENT", "INSUFFICIENT"] as const;
export type GuardianV2Sufficiency = (typeof guardianV2SufficiencyValues)[number];

export type GuardianAssessmentV2 = Readonly<{
  schemaVersion: typeof GUARDIAN_ASSESSMENT_V2_SCHEMA_VERSION;
  assessmentId: string;
  organizationId: string;
  positionId: string;
  lotId: string;
  symbol: string;
  openingCausalLineageDigest: string;
  realityFrontierId: string;
  realityContentDigest: string;
  qualifiedEvidenceBundleId: string;
  qualifiedEvidenceContentDigest: string;
  informationSufficiencyProfile: "OPEN_POSITION_REASSESSMENT";
  openPositionSufficiency: GuardianV2Sufficiency;
  newOpportunitySufficiency: GuardianV2Sufficiency;
  recommendation: GuardianV2Recommendation;
  targetReductionBps: number;
  reasonCodes: readonly string[];
  contentDigest: string;
}>;

export type GuardianAssessmentV2Draft = Omit<
  GuardianAssessmentV2,
  "schemaVersion" | "assessmentId" | "contentDigest"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;
const KEYS = [
  "assessmentId",
  "contentDigest",
  "informationSufficiencyProfile",
  "lotId",
  "newOpportunitySufficiency",
  "openPositionSufficiency",
  "openingCausalLineageDigest",
  "organizationId",
  "positionId",
  "qualifiedEvidenceBundleId",
  "qualifiedEvidenceContentDigest",
  "realityContentDigest",
  "realityFrontierId",
  "reasonCodes",
  "recommendation",
  "schemaVersion",
  "symbol",
  "targetReductionBps",
].sort();

function digestBody(body: GuardianAssessmentV2Draft & { schemaVersion: string }): string {
  return createHash("sha256")
    .update(canonicalizeSemanticJsonString(body), "utf8")
    .digest("hex");
}

function assertRecommendationBounds(value: GuardianAssessmentV2): void {
  if (!Number.isSafeInteger(value.targetReductionBps)) {
    throw new Error("GUARDIAN_ASSESSMENT_INVALID_REDUCTION");
  }
  if (value.recommendation === "HOLD" && value.targetReductionBps !== 0) {
    throw new Error("GUARDIAN_ASSESSMENT_HOLD_MUST_NOT_REDUCE");
  }
  if (
    value.recommendation === "REDUCE_PARTIAL" &&
    (value.targetReductionBps <= 0 || value.targetReductionBps >= 10_000)
  ) {
    throw new Error("GUARDIAN_ASSESSMENT_PARTIAL_REDUCTION_OUT_OF_RANGE");
  }
  if (value.recommendation === "REDUCE_FULL" && value.targetReductionBps !== 10_000) {
    throw new Error("GUARDIAN_ASSESSMENT_FULL_REDUCTION_MUST_CLOSE");
  }
  if (
    value.openPositionSufficiency === "INSUFFICIENT" &&
    value.recommendation !== "HOLD"
  ) {
    throw new Error("GUARDIAN_ASSESSMENT_INSUFFICIENT_REASSESSMENT_MUST_HOLD");
  }
}

export function assertGuardianAssessmentV2(value: GuardianAssessmentV2): void {
  if (value.schemaVersion !== GUARDIAN_ASSESSMENT_V2_SCHEMA_VERSION) {
    throw new Error("GUARDIAN_ASSESSMENT_UNSUPPORTED_VERSION");
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(KEYS)) {
    throw new Error("GUARDIAN_ASSESSMENT_UNEXPECTED_FIELD");
  }
  for (const field of [
    "organizationId",
    "positionId",
    "lotId",
    "symbol",
    "realityFrontierId",
    "qualifiedEvidenceBundleId",
  ] as const) {
    if (!value[field]) throw new Error("GUARDIAN_ASSESSMENT_INCOMPLETE");
  }
  for (const field of [
    "openingCausalLineageDigest",
    "realityContentDigest",
    "qualifiedEvidenceContentDigest",
    "contentDigest",
  ] as const) {
    if (!DIGEST.test(value[field])) throw new Error("GUARDIAN_ASSESSMENT_INVALID_DIGEST");
  }
  if (value.informationSufficiencyProfile !== "OPEN_POSITION_REASSESSMENT") {
    throw new Error("GUARDIAN_ASSESSMENT_INVALID_SUFFICIENCY_PROFILE");
  }
  if (!guardianV2SufficiencyValues.includes(value.openPositionSufficiency)) {
    throw new Error("GUARDIAN_ASSESSMENT_INVALID_SUFFICIENCY");
  }
  if (!guardianV2SufficiencyValues.includes(value.newOpportunitySufficiency)) {
    throw new Error("GUARDIAN_ASSESSMENT_INVALID_SUFFICIENCY");
  }
  if (!guardianV2RecommendationValues.includes(value.recommendation)) {
    throw new Error("GUARDIAN_ASSESSMENT_INVALID_RECOMMENDATION");
  }
  if (
    value.reasonCodes.length === 0 ||
    value.reasonCodes.some((code) => !REASON_CODE.test(code)) ||
    new Set(value.reasonCodes).size !== value.reasonCodes.length ||
    [...value.reasonCodes].sort().some((code, index) => code !== value.reasonCodes[index])
  ) {
    throw new Error("GUARDIAN_ASSESSMENT_INVALID_REASON_CODES");
  }
  assertRecommendationBounds(value);
  const { assessmentId, contentDigest, ...body } = value;
  const expectedDigest = digestBody(body);
  if (contentDigest !== expectedDigest) {
    throw new Error("GUARDIAN_ASSESSMENT_DIGEST_MISMATCH");
  }
  if (assessmentId !== `guardian-assessment-v2:${expectedDigest}`) {
    throw new Error("GUARDIAN_ASSESSMENT_ID_MISMATCH");
  }
}

export function buildGuardianAssessmentV2(
  draft: GuardianAssessmentV2Draft,
): GuardianAssessmentV2 {
  const normalizedDraft = {
    ...draft,
    reasonCodes: Object.freeze([...draft.reasonCodes].sort()),
  };
  const body = {
    schemaVersion: GUARDIAN_ASSESSMENT_V2_SCHEMA_VERSION,
    ...normalizedDraft,
  };
  const contentDigest = digestBody(body);
  const value = Object.freeze({
    ...body,
    assessmentId: `guardian-assessment-v2:${contentDigest}`,
    contentDigest,
  });
  assertGuardianAssessmentV2(value);
  return value;
}

export function serializeGuardianAssessmentV2(value: GuardianAssessmentV2): string {
  assertGuardianAssessmentV2(value);
  return canonicalizeSemanticJsonString(value);
}

export function parseGuardianAssessmentV2(json: string): GuardianAssessmentV2 {
  let value: GuardianAssessmentV2;
  try {
    value = JSON.parse(json) as GuardianAssessmentV2;
  } catch {
    throw new Error("GUARDIAN_ASSESSMENT_INVALID_JSON");
  }
  assertGuardianAssessmentV2(value);
  if (serializeGuardianAssessmentV2(value) !== json) {
    throw new Error("GUARDIAN_ASSESSMENT_NON_CANONICAL_JSON");
  }
  return value;
}

