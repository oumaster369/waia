import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const RUNTIME_AUTHORITY_ASSESSMENT_V2_SCHEMA_VERSION =
  "waia.trader.runtime_authority_assessment.v2" as const;

export const runtimePosturesV2 = [
  "FULL_ANALYSIS_AND_NEW_RISK",
  "NO_NEW_RISK",
  "CLOSE_ONLY",
  "HALT",
] as const;
export type RuntimePostureV2 = (typeof runtimePosturesV2)[number];

export type RuntimeAuthorityEvidenceV2 = Readonly<{
  realityRebuildComplete: boolean;
  executionUncertaintyResolved: boolean;
  guardianCoverageComplete: boolean;
  allowancesValid: boolean;
  releaseIdentityValid: boolean;
  promotionIdentityValid: boolean;
  credentialsReady: boolean;
  persistenceReady: boolean;
  exclusiveControlLeaseValid: boolean;
}>;

export type RuntimeAuthorityAssessmentV2 = Readonly<{
  schemaVersion: typeof RUNTIME_AUTHORITY_ASSESSMENT_V2_SCHEMA_VERSION;
  assessmentId: string;
  organizationId: string;
  runtimeInstanceId: string;
  releaseId: string;
  releaseContentDigest: string;
  realityFrontierId: string;
  realityContentDigest: string;
  controlLeaseEpoch: number;
  controlLeaseContentDigest: string;
  adjudicatedAtUtc: string;
  evidence: RuntimeAuthorityEvidenceV2;
  posture: RuntimePostureV2;
  reasonCodes: readonly string[];
  contentDigest: string;
}>;

export type RuntimeAuthorityAssessmentV2Draft = Omit<
  RuntimeAuthorityAssessmentV2,
  "schemaVersion" | "assessmentId" | "contentDigest" | "posture" | "reasonCodes"
>;

const DIGEST = /^[0-9a-f]{64}$/;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,127}$/;

const evidenceReasonCodes: ReadonlyArray<
  readonly [keyof RuntimeAuthorityEvidenceV2, string, RuntimePostureV2]
> = [
  ["realityRebuildComplete", "RUNTIME_REALITY_REBUILD_INCOMPLETE", "HALT"],
  ["persistenceReady", "RUNTIME_PERSISTENCE_NOT_READY", "HALT"],
  ["exclusiveControlLeaseValid", "RUNTIME_CONTROL_LEASE_INVALID", "HALT"],
  ["executionUncertaintyResolved", "RUNTIME_EXECUTION_UNCERTAINTY", "CLOSE_ONLY"],
  ["guardianCoverageComplete", "RUNTIME_GUARDIAN_COVERAGE_INCOMPLETE", "NO_NEW_RISK"],
  ["allowancesValid", "RUNTIME_ALLOWANCE_REVALIDATION_REQUIRED", "NO_NEW_RISK"],
  ["releaseIdentityValid", "RUNTIME_RELEASE_IDENTITY_INVALID", "NO_NEW_RISK"],
  ["promotionIdentityValid", "RUNTIME_PROMOTION_IDENTITY_INVALID", "NO_NEW_RISK"],
  ["credentialsReady", "RUNTIME_CREDENTIALS_NOT_READY", "NO_NEW_RISK"],
] as const;

const postureRank: Record<RuntimePostureV2, number> = {
  FULL_ANALYSIS_AND_NEW_RISK: 0,
  NO_NEW_RISK: 1,
  CLOSE_ONLY: 2,
  HALT: 3,
};

function digestBody(body: object): string {
  return createHash("sha256")
    .update(canonicalizeSemanticJsonString(body), "utf8")
    .digest("hex");
}

function deriveAuthority(evidence: RuntimeAuthorityEvidenceV2): {
  posture: RuntimePostureV2;
  reasonCodes: readonly string[];
} {
  let posture: RuntimePostureV2 = "FULL_ANALYSIS_AND_NEW_RISK";
  const reasonCodes: string[] = [];
  for (const [field, reasonCode, failurePosture] of evidenceReasonCodes) {
    if (!evidence[field]) {
      reasonCodes.push(reasonCode);
      if (postureRank[failurePosture] > postureRank[posture]) posture = failurePosture;
    }
  }
  if (reasonCodes.length === 0) reasonCodes.push("RUNTIME_AUTHORITY_READY");
  return { posture, reasonCodes: Object.freeze(reasonCodes.sort()) };
}

export function buildRuntimeAuthorityAssessmentV2(
  draft: RuntimeAuthorityAssessmentV2Draft,
): RuntimeAuthorityAssessmentV2 {
  const adjudicatedAtMs = Date.parse(draft.adjudicatedAtUtc);
  if (!Number.isFinite(adjudicatedAtMs) || new Date(adjudicatedAtMs).toISOString() !== draft.adjudicatedAtUtc) {
    throw new Error("RUNTIME_AUTHORITY_INVALID_ADJUDICATION_TIME");
  }
  if (!Number.isSafeInteger(draft.controlLeaseEpoch) || draft.controlLeaseEpoch < 1) {
    throw new Error("RUNTIME_AUTHORITY_INVALID_LEASE_EPOCH");
  }
  for (const value of [
    draft.organizationId,
    draft.runtimeInstanceId,
    draft.releaseId,
    draft.realityFrontierId,
  ]) {
    if (!value) throw new Error("RUNTIME_AUTHORITY_INCOMPLETE");
  }
  for (const digest of [
    draft.releaseContentDigest,
    draft.realityContentDigest,
    draft.controlLeaseContentDigest,
  ]) {
    if (!DIGEST.test(digest)) throw new Error("RUNTIME_AUTHORITY_INVALID_DIGEST");
  }
  const authority = deriveAuthority(draft.evidence);
  const body = {
    schemaVersion: RUNTIME_AUTHORITY_ASSESSMENT_V2_SCHEMA_VERSION,
    ...draft,
    evidence: Object.freeze({ ...draft.evidence }),
    ...authority,
  };
  const contentDigest = digestBody(body);
  return Object.freeze({
    ...body,
    assessmentId: `runtime-authority-v2:${contentDigest}`,
    contentDigest,
  });
}

export function assertRuntimeAuthorityAssessmentV2(
  value: RuntimeAuthorityAssessmentV2,
): void {
  if (value.schemaVersion !== RUNTIME_AUTHORITY_ASSESSMENT_V2_SCHEMA_VERSION) {
    throw new Error("RUNTIME_AUTHORITY_UNSUPPORTED_VERSION");
  }
  if (!runtimePosturesV2.includes(value.posture)) {
    throw new Error("RUNTIME_AUTHORITY_INVALID_POSTURE");
  }
  if (
    value.reasonCodes.length === 0 ||
    value.reasonCodes.some((code) => !REASON_CODE.test(code)) ||
    [...value.reasonCodes].sort().some((code, index) => code !== value.reasonCodes[index])
  ) {
    throw new Error("RUNTIME_AUTHORITY_INVALID_REASON_CODES");
  }
  const rebuilt = buildRuntimeAuthorityAssessmentV2({
    organizationId: value.organizationId,
    runtimeInstanceId: value.runtimeInstanceId,
    releaseId: value.releaseId,
    releaseContentDigest: value.releaseContentDigest,
    realityFrontierId: value.realityFrontierId,
    realityContentDigest: value.realityContentDigest,
    controlLeaseEpoch: value.controlLeaseEpoch,
    controlLeaseContentDigest: value.controlLeaseContentDigest,
    adjudicatedAtUtc: value.adjudicatedAtUtc,
    evidence: value.evidence,
  });
  if (rebuilt.contentDigest !== value.contentDigest || rebuilt.assessmentId !== value.assessmentId) {
    throw new Error("RUNTIME_AUTHORITY_DIGEST_MISMATCH");
  }
  if (rebuilt.posture !== value.posture || JSON.stringify(rebuilt.reasonCodes) !== JSON.stringify(value.reasonCodes)) {
    throw new Error("RUNTIME_AUTHORITY_DERIVATION_MISMATCH");
  }
}

export function serializeRuntimeAuthorityAssessmentV2(
  value: RuntimeAuthorityAssessmentV2,
): string {
  assertRuntimeAuthorityAssessmentV2(value);
  return canonicalizeSemanticJsonString(value);
}

export function parseRuntimeAuthorityAssessmentV2(json: string): RuntimeAuthorityAssessmentV2 {
  let value: RuntimeAuthorityAssessmentV2;
  try {
    value = JSON.parse(json) as RuntimeAuthorityAssessmentV2;
  } catch {
    throw new Error("RUNTIME_AUTHORITY_INVALID_JSON");
  }
  assertRuntimeAuthorityAssessmentV2(value);
  if (serializeRuntimeAuthorityAssessmentV2(value) !== json) {
    throw new Error("RUNTIME_AUTHORITY_NON_CANONICAL_JSON");
  }
  return value;
}
