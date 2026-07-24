/**
 * DEE-436 — immutable paused / final verification proofs.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export const FHV_T4_PAUSED_PROOF_SCHEMA_VERSION = "fhv-t4-paused-verification-proof/v1" as const;
export const FHV_T4_PAUSED_PROOF_FILENAME = "fhv-t4-paused-verification-proof.v1.json" as const;
export const FHV_T4_FINAL_PROOF_SCHEMA_VERSION = "fhv-t4-final-verification-proof/v1" as const;
export const FHV_T4_FINAL_PROOF_FILENAME = "fhv-t4-final-verification-proof.v1.json" as const;
export const FHV_T4_PAUSED_PROOF_CLASSIFICATION = "FHV_T4_PAUSED_VERIFICATION_PASS" as const;
export const FHV_T4_FINAL_PROOF_CLASSIFICATION = "FHV_T4_FINAL_VERIFICATION_PASS" as const;

export type FhvT4PausedVerificationProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_PAUSED_PROOF_SCHEMA_VERSION;
  releaseSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  actualPauseCycle: number;
  classification: typeof FHV_T4_PAUSED_PROOF_CLASSIFICATION;
  pauseCommandId: string;
  pauseIdempotencyKey: string;
  checkpointSafeResumeThroughCycleIndex: number;
  partialEvidenceTerminal: string;
  alertPolicyDigest: string;
  checks: readonly string[];
  capturedAtUtc: string;
  contentDigest: string;
}>;

export type FhvT4FinalVerificationProofV1 = Readonly<{
  schemaVersion: typeof FHV_T4_FINAL_PROOF_SCHEMA_VERSION;
  releaseSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
  classification: typeof FHV_T4_FINAL_PROOF_CLASSIFICATION;
  resumeCommandId: string;
  resumeIdempotencyKey: string;
  fullHistoryRescanDelta: 0;
  canonicalRunChainResult: "PASS";
  runtimeBudgetResult: "PASS";
  finalTerminal: "REHEARSAL_OK";
  checks: readonly string[];
  capturedAtUtc: string;
  contentDigest: string;
}>;

export class FhvT4PausedFinalProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvT4PausedFinalProofError";
  }
}

export function resolveFhvT4PausedProofPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_PAUSED_PROOF_FILENAME);
}

export function resolveFhvT4FinalProofPath(runRoot: string): string {
  return join(runRoot, "control", FHV_T4_FINAL_PROOF_FILENAME);
}

export function writeFhvT4PausedVerificationProofAtomic(
  runRoot: string,
  input: Omit<FhvT4PausedVerificationProofV1, "schemaVersion" | "contentDigest">,
): FhvT4PausedVerificationProofV1 {
  const withoutDigest = {
    schemaVersion: FHV_T4_PAUSED_PROOF_SCHEMA_VERSION,
    ...input,
  };
  const proof: FhvT4PausedVerificationProofV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(resolveFhvT4PausedProofPath(runRoot), `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

export function writeFhvT4FinalVerificationProofAtomic(
  runRoot: string,
  input: Omit<FhvT4FinalVerificationProofV1, "schemaVersion" | "contentDigest">,
): FhvT4FinalVerificationProofV1 {
  const withoutDigest = {
    schemaVersion: FHV_T4_FINAL_PROOF_SCHEMA_VERSION,
    ...input,
  };
  const proof: FhvT4FinalVerificationProofV1 = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(resolveFhvT4FinalProofPath(runRoot), `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

export function readFhvT4PausedVerificationProof(
  runRoot: string,
): FhvT4PausedVerificationProofV1 | null {
  const path = resolveFhvT4PausedProofPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4PausedVerificationProofV1;
}

export function readFhvT4FinalVerificationProof(
  runRoot: string,
): FhvT4FinalVerificationProofV1 | null {
  const path = resolveFhvT4FinalProofPath(runRoot);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvT4FinalVerificationProofV1;
}

export function verifyFhvT4PausedVerificationProofArtifact(input: {
  runRoot: string;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
}): FhvT4PausedVerificationProofV1 {
  const proof = readFhvT4PausedVerificationProof(input.runRoot);
  if (!proof) {
    throw new FhvT4PausedFinalProofError(
      "FHV_T4_PAUSED_PROOF_MISSING",
      "Paused verification proof is required.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4PausedFinalProofError(
      "FHV_T4_PAUSED_PROOF_DIGEST_MISMATCH",
      "Paused verification proof contentDigest mismatch.",
    );
  }
  if (
    proof.releaseSha !== input.targetSha ||
    proof.releaseTag !== input.releaseTag ||
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId ||
    proof.actualPauseCycle !== 40 ||
    proof.classification !== FHV_T4_PAUSED_PROOF_CLASSIFICATION
  ) {
    throw new FhvT4PausedFinalProofError(
      "FHV_T4_PAUSED_PROOF_IDENTITY_MISMATCH",
      "Paused verification proof identity/classification mismatch.",
    );
  }
  return proof;
}

export function verifyFhvT4FinalVerificationProofArtifact(input: {
  runRoot: string;
  targetSha: string;
  releaseTag: string;
  runId: string;
  organizationId: string;
}): FhvT4FinalVerificationProofV1 {
  const proof = readFhvT4FinalVerificationProof(input.runRoot);
  if (!proof) {
    throw new FhvT4PausedFinalProofError(
      "FHV_T4_FINAL_PROOF_MISSING",
      "Final verification proof is required.",
    );
  }
  const { contentDigest, ...withoutDigest } = proof;
  if (computePayloadDigest(withoutDigest) !== contentDigest) {
    throw new FhvT4PausedFinalProofError(
      "FHV_T4_FINAL_PROOF_DIGEST_MISMATCH",
      "Final verification proof contentDigest mismatch.",
    );
  }
  if (
    proof.releaseSha !== input.targetSha ||
    proof.releaseTag !== input.releaseTag ||
    proof.runId !== input.runId ||
    proof.organizationId !== input.organizationId ||
    proof.fullHistoryRescanDelta !== 0 ||
    proof.finalTerminal !== "REHEARSAL_OK" ||
    proof.classification !== FHV_T4_FINAL_PROOF_CLASSIFICATION
  ) {
    throw new FhvT4PausedFinalProofError(
      "FHV_T4_FINAL_PROOF_IDENTITY_MISMATCH",
      "Final verification proof identity/classification mismatch.",
    );
  }
  return proof;
}
