import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { RealitySourceReportV2, TruthRecordV2 } from "./contracts";

export function sameRealitySubjectV2(source: RealitySourceReportV2, truth: TruthRecordV2): boolean {
  return source.subject.subjectClass === truth.subject.subjectClass &&
    source.subject.subjectKey === truth.subject.subjectKey;
}

export function sameRealityNativeFactV2(source: RealitySourceReportV2, truth: TruthRecordV2): boolean {
  const left = source.sourceNativeIdentity;
  const right = truth.sourceNativeIdentity;
  return left !== null && right !== null && source.sourceKind === truth.sourceKind &&
    left.identityKind === right.identityKind && left.nativeId === right.nativeId &&
    left.nativeRevision === right.nativeRevision && sameRealitySubjectV2(source, truth);
}

/** Existing ingestion equivalence, not provenance or current-truth authority.
 * Delivery additionally requires the matched truth's durable admission event. */
export function isRealitySemanticDuplicateV2(source: RealitySourceReportV2, truth: TruthRecordV2): boolean {
  if (!sameRealityNativeFactV2(source, truth)) return false;
  return computeStableJsonDigest({
    sourceKind: source.sourceKind,
    sourceNativeIdentity: source.sourceNativeIdentity,
    subject: source.subject,
    primitiveAssertion: source.primitiveAssertion,
    structuralVerification: source.structuralVerification,
    verificationReasonCodes: source.verificationReasonCodes,
  }) === computeStableJsonDigest({
    sourceKind: truth.sourceKind,
    sourceNativeIdentity: truth.sourceNativeIdentity,
    subject: truth.subject,
    primitiveAssertion: truth.primitiveAssertion,
    structuralVerification: "VERIFIED",
    verificationReasonCodes: [],
  });
}
