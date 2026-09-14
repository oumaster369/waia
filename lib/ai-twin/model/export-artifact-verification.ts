import type { ModelScope } from "./contracts";
import { type PrivateExportManifest, assertModelJsonData } from "./persistence-contracts";
import type { RightsOperationHistory } from "./rights-operation";

/** Distinguishes artifact lifetime from source-record lifetime. Not a download
 * endpoint, object-storage worker, or production deletion proof. */
export const TWIN_EXPORT_ARTIFACT_VERIFICATION = "contract-qualification-2026-09-14/v1";

export type ExportArtifactDisposition =
  | "artifact_valid"
  | "artifact_removal_required"
  | "artifact_removal_verified";

export type ExportArtifactQualification = Readonly<{
  policyVersion: typeof TWIN_EXPORT_ARTIFACT_VERIFICATION;
  requestId: string;
  originalCreatedAt: string;
  expiresAt: string;
  disposition: ExportArtifactDisposition;
  sourceRecordsDeleted: false;
  exportOperationClosedIsNotArtifactRemoval: true;
  retryRefreshesLifetime: false;
  evidenceQualification: "trusted_artifact_removal_digest_only";
  authority: "none";
  deliveryAuthority: "none";
  productionClaim: "contract_qualification_only";
}>;

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function fail(code = "INVALID_INPUT"): never {
  throw new Error(code);
}
function requireValue(ok: unknown, code = "INVALID_INPUT"): asserts ok {
  if (!ok) fail(code);
}
function keys(
  value: unknown,
  expected: readonly string[],
): asserts value is Record<string, unknown> {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value));
  requireValue(
    Object.keys(value).length === expected.length &&
      expected.every((key) => Object.hasOwn(value, key)),
  );
}
function instant(value: unknown): number {
  requireValue(typeof value === "string");
  const parsed = Date.parse(value);
  requireValue(Number.isFinite(parsed) && new Date(parsed).toISOString() === value, "INVALID_TIME");
  return parsed;
}
function freeze<T>(value: T): T {
  const clone = structuredClone(value);
  const walk = (part: unknown): void => {
    if (part && typeof part === "object") {
      Object.values(part).forEach(walk);
      Object.freeze(part);
    }
  };
  walk(clone);
  return clone;
}

/**
 * Qualifies generated-export-artifact retention against the original creation
 * clock. Recomposition/retry may not extend expiry. EXPORT RightsOperation
 * CLOSED / EXPORT_ARTIFACT_CREATED is not artifact deletion.
 */
export function qualifyExportArtifactRetention(input: unknown): ExportArtifactQualification {
  assertModelJsonData(input);
  keys(input, [
    "manifest",
    "now",
    "retryNow",
    "exportOperation",
    "artifactRemovalEvidence",
    "admittedCompletionEvidenceDigests",
  ]);
  keys(input.manifest, [
    "scope",
    "requestId",
    "requesterSubjectId",
    "createdAt",
    "expiresAt",
    "records",
    "excluded",
    "deliveryAuthority",
  ]);
  const manifest = input.manifest as PrivateExportManifest;
  requireValue(manifest.deliveryAuthority === "none");
  requireValue(typeof manifest.requestId === "string" && identifier.test(manifest.requestId));
  const createdAt = instant(manifest.createdAt);
  const expiresAt = instant(manifest.expiresAt);
  requireValue(expiresAt === createdAt + 86_400_000, "EXPORT_DEADLINE_MISMATCH");
  const now = instant(input.now);
  if (input.retryNow !== null) {
    const retryNow = instant(input.retryNow);
    requireValue(retryNow >= createdAt, "INVALID_TIME");
  }
  requireValue(Array.isArray(input.admittedCompletionEvidenceDigests));
  const admitted = new Set<string>();
  for (const digest of input.admittedCompletionEvidenceDigests) {
    requireValue(typeof digest === "string" && digestPattern.test(digest), "INVALID_DIGEST");
    requireValue(!admitted.has(digest), "DUPLICATE_EVIDENCE_REFERENCE");
    admitted.add(digest);
  }

  if (input.exportOperation !== null) {
    keys(input.exportOperation, [
      "operationId",
      "policyVersion",
      "scope",
      "type",
      "target",
      "requestedAt",
      "requestedBy",
      "acceptedBy",
      "history",
      "attempts",
      "effect",
    ]);
    const operation = input.exportOperation as RightsOperationHistory;
    requireValue(operation.type === "EXPORT", "EXPORT_OPERATION_REQUIRED");
    requireValue(
      operation.scope.organizationId === manifest.scope.organizationId &&
        operation.scope.subjectId === manifest.scope.subjectId,
      "SCOPE_MISMATCH",
    );
  }

  let removalVerified = false;
  if (input.artifactRemovalEvidence !== null) {
    keys(input.artifactRemovalEvidence, [
      "digest",
      "requestId",
      "scope",
      "producerReference",
      "admittedByReference",
    ]);
    const evidence = input.artifactRemovalEvidence as {
      digest: string;
      requestId: string;
      scope: ModelScope;
      producerReference: string;
      admittedByReference: string;
    };
    requireValue(digestPattern.test(evidence.digest), "INVALID_DIGEST");
    requireValue(evidence.requestId === manifest.requestId, "EXPORT_REQUEST_MISMATCH");
    requireValue(
      evidence.scope.organizationId === manifest.scope.organizationId &&
        evidence.scope.subjectId === manifest.scope.subjectId,
      "SCOPE_MISMATCH",
    );
    requireValue(
      identifier.test(evidence.producerReference) && identifier.test(evidence.admittedByReference),
    );
    requireValue(admitted.has(evidence.digest), "EVIDENCE_NOT_ADMITTED");
    requireValue(input.exportOperation !== null, "EXPORT_OPERATION_REQUIRED");
    if (input.exportOperation !== null) {
      const operation = input.exportOperation as RightsOperationHistory;
      const used = new Set(
        [
          operation.effect?.completionEvidenceDigest ?? null,
          ...operation.history.map((event) => event.completionEvidenceDigest),
          ...operation.attempts.map((attempt) => attempt.completionEvidenceDigest),
        ].filter((value): value is string => value !== null),
      );
      requireValue(!used.has(evidence.digest), "EXPORT_EFFECT_IS_NOT_ARTIFACT_REMOVAL");
    }
    removalVerified = true;
  }

  let disposition: ExportArtifactDisposition;
  if (removalVerified) disposition = "artifact_removal_verified";
  else if (now >= expiresAt) disposition = "artifact_removal_required";
  else disposition = "artifact_valid";

  return freeze({
    policyVersion: TWIN_EXPORT_ARTIFACT_VERIFICATION,
    requestId: manifest.requestId,
    originalCreatedAt: manifest.createdAt,
    expiresAt: manifest.expiresAt,
    disposition,
    sourceRecordsDeleted: false,
    exportOperationClosedIsNotArtifactRemoval: true,
    retryRefreshesLifetime: false,
    evidenceQualification: "trusted_artifact_removal_digest_only",
    authority: "none",
    deliveryAuthority: "none",
    productionClaim: "contract_qualification_only",
  });
}
