/**
 * DEE-436 — immutable observer qualification proof (pre-campaign / post-restart).
 */

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";

export const FHV_T4_OBSERVER_QUALIFICATION_PROOF_SCHEMA_VERSION =
  "fhv-t4-observer-qualification-proof/v1" as const;

export type FhvT4ObserverQualificationPhase = "PRE_CAMPAIGN" | "POST_RESTART";

export type FhvT4ObserverQualificationProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_OBSERVER_QUALIFICATION_PROOF_SCHEMA_VERSION;
  phase: FhvT4ObserverQualificationPhase;
  runId: string;
  organizationId: string;
  targetSha: string;
  bootId: string;
  unitName: string;
  identityBeforeCapture: Readonly<{
    invocationId: string;
    mainPid: number;
    activeEnterTimestampMonotonicUs: string;
    activeState: string;
  }>;
  identityAfterCapture: Readonly<{
    invocationId: string;
    mainPid: number;
    activeEnterTimestampMonotonicUs: string;
    activeState: string;
  }>;
  statusDigest: string;
  capturedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4ObserverQualificationProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ObserverQualificationProofError";
  }
}

export function serializeFhvT4ObserverQualificationProof(
  input: Omit<FhvT4ObserverQualificationProofV1, "contentDigest">,
): FhvT4ObserverQualificationProofV1 {
  const normalized = {
    ...input,
    bootId: normalizeFhvT4BootId(input.bootId),
    targetSha: input.targetSha.trim().toLowerCase(),
  };
  if (
    normalized.identityBeforeCapture.invocationId !== normalized.identityAfterCapture.invocationId
  ) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_INVOCATION_DRIFT",
      "Observer identity drift between health and second capture.",
    );
  }
  if (normalized.identityBeforeCapture.mainPid !== normalized.identityAfterCapture.mainPid) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_PID_DRIFT",
      "Observer MainPID drift between health and second capture.",
    );
  }
  if (normalized.identityBeforeCapture.activeState !== "active") {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_NOT_ACTIVE",
      "Observer must be active at qualification.",
    );
  }
  return {
    ...normalized,
    contentDigest: computePayloadDigest(normalized),
  };
}

export function parseFhvT4ObserverQualificationProof(
  raw: unknown,
): FhvT4ObserverQualificationProofV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_INVALID",
      "Observer qualification proof must be an object.",
    );
  }
  const proof = raw as FhvT4ObserverQualificationProofV1;
  if (proof.schemaVersion !== FHV_T4_OBSERVER_QUALIFICATION_PROOF_SCHEMA_VERSION) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_SCHEMA_MISMATCH",
      "schemaVersion mismatch.",
    );
  }
  normalizeFhvT4BootId(proof.bootId);
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4ObserverQualificationProofError(
      "FHV_T4_OBSERVER_QUALIFICATION_DIGEST_MISMATCH",
      "contentDigest mismatch.",
    );
  }
  return proof;
}
