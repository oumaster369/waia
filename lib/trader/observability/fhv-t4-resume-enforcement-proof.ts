/**
 * DEE-436 — root-only RESUME enforcement proof (systemd campaign start).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { normalizeFhvT4BootId } from "@/lib/trader/observability/fhv-t4-boot-id";

export const FHV_T4_RESUME_ENFORCEMENT_PROOF_SCHEMA_VERSION =
  "fhv-t4-resume-enforcement-proof/v1" as const;

export const FHV_T4_RESUME_ENFORCEMENT_PROOF_FILENAME =
  "fhv-t4-resume-enforcement-proof.v1.json" as const;

export type FhvT4ResumeEnforcementProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_RESUME_ENFORCEMENT_PROOF_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  targetSha: string;
  resumeCommandId: string;
  resumeIdempotencyKey: string;
  bootId: string;
  campaignUnitName: string;
  previousInvocationId: string;
  newInvocationId: string;
  execMainPid: number;
  execMainStartTimestampMonotonic: string;
  nRestarts: number;
  enforcedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4ResumeEnforcementProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4ResumeEnforcementProofError";
  }
}

export function serializeFhvT4ResumeEnforcementProof(
  input: Omit<FhvT4ResumeEnforcementProofV1, "contentDigest">,
): FhvT4ResumeEnforcementProofV1 {
  const withoutDigest = {
    ...input,
    bootId: normalizeFhvT4BootId(input.bootId),
    targetSha: input.targetSha.trim().toLowerCase(),
  };
  return {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
}

export function parseFhvT4ResumeEnforcementProof(raw: unknown): FhvT4ResumeEnforcementProofV1 {
  if (typeof raw !== "object" || raw === null) {
    throw new FhvT4ResumeEnforcementProofError(
      "FHV_T4_RESUME_ENFORCEMENT_PROOF_INVALID",
      "Resume enforcement proof must be an object.",
    );
  }
  const proof = raw as FhvT4ResumeEnforcementProofV1;
  if (proof.schemaVersion !== FHV_T4_RESUME_ENFORCEMENT_PROOF_SCHEMA_VERSION) {
    throw new FhvT4ResumeEnforcementProofError(
      "FHV_T4_RESUME_ENFORCEMENT_PROOF_SCHEMA_MISMATCH",
      "schemaVersion mismatch.",
    );
  }
  normalizeFhvT4BootId(proof.bootId);
  if (!proof.newInvocationId.trim() || proof.newInvocationId === proof.previousInvocationId) {
    throw new FhvT4ResumeEnforcementProofError(
      "FHV_T4_RESUME_ENFORCEMENT_INVOCATION_INVALID",
      "newInvocationId must differ from previousInvocationId.",
    );
  }
  if (!Number.isInteger(proof.execMainPid) || proof.execMainPid <= 0) {
    throw new FhvT4ResumeEnforcementProofError(
      "FHV_T4_RESUME_ENFORCEMENT_PID_INVALID",
      "execMainPid must be positive.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4ResumeEnforcementProofError(
      "FHV_T4_RESUME_ENFORCEMENT_DIGEST_MISMATCH",
      "contentDigest mismatch.",
    );
  }
  return proof;
}

export function readFhvT4ResumeEnforcementProof(
  runRoot: string,
): FhvT4ResumeEnforcementProofV1 | null {
  const path = join(runRoot, "control", FHV_T4_RESUME_ENFORCEMENT_PROOF_FILENAME);
  try {
    return parseFhvT4ResumeEnforcementProof(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export function verifyFhvT4ResumeEnforcementProofMatchesRun(input: {
  runRoot: string;
  runId: string;
  organizationId: string;
  targetSha: string;
}): FhvT4ResumeEnforcementProofV1 {
  const proof = readFhvT4ResumeEnforcementProof(input.runRoot);
  if (!proof) {
    throw new FhvT4ResumeEnforcementProofError(
      "FHV_T4_RESUME_ENFORCEMENT_PROOF_MISSING",
      "Root RESUME enforcement proof missing.",
    );
  }
  if (
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId ||
    proof.targetSha !== input.targetSha.trim().toLowerCase()
  ) {
    throw new FhvT4ResumeEnforcementProofError(
      "FHV_T4_RESUME_ENFORCEMENT_PROOF_IDENTITY_MISMATCH",
      "Resume enforcement proof identity mismatch.",
    );
  }
  return proof;
}
