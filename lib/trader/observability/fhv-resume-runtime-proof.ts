import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";

export const FHV_RESUME_RUNTIME_PROOF_SCHEMA_VERSION = "fhv-resume-runtime-proof/v1" as const;
export const FHV_RESUME_RUNTIME_PROOF_FILENAME = "fhv-resume-runtime-proof.v1.json";

export type FhvResumeRuntimeProofV1 = Readonly<{
  schemaVersion: typeof FHV_RESUME_RUNTIME_PROOF_SCHEMA_VERSION;
  runId: string;
  organizationId: string;
  processPid: number;
  resumeCycleStartIndex: number;
  firstExecutedCycleIndex: number;
  lastExecutedCycleIndex: number;
  fullHistoryRescanCountBefore: number;
  fullHistoryRescanCountAfter: number;
  fullHistoryRescanDelta: number;
  contentDigest: string;
}>;

export class FhvResumeRuntimeProofError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvResumeRuntimeProofError";
  }
}

function digestProofPayload(record: Omit<FhvResumeRuntimeProofV1, "contentDigest">): string {
  return computePayloadDigest(record);
}

export function serializeFhvResumeRuntimeProof(
  record: Omit<FhvResumeRuntimeProofV1, "contentDigest">,
): FhvResumeRuntimeProofV1 {
  return { ...record, contentDigest: digestProofPayload(record) };
}

export function writeFhvResumeRuntimeProof(
  runRoot: string,
  record: Omit<FhvResumeRuntimeProofV1, "contentDigest">,
): FhvResumeRuntimeProofV1 {
  const payload = serializeFhvResumeRuntimeProof(record);
  writeFileAtomic(
    join(runRoot, FHV_RESUME_RUNTIME_PROOF_FILENAME),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  return payload;
}

export function readFhvResumeRuntimeProof(runRoot: string): FhvResumeRuntimeProofV1 | null {
  const path = join(runRoot, FHV_RESUME_RUNTIME_PROOF_FILENAME);
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as FhvResumeRuntimeProofV1;
}

export function validateFhvResumeRuntimeProof(input: {
  proof: FhvResumeRuntimeProofV1;
  runId: string;
  organizationId: string;
  expectedProcessPid: number;
  resumeCycleStartIndex: number;
}): void {
  const { contentDigest, ...withoutDigest } = input.proof;
  if (digestProofPayload(withoutDigest) !== contentDigest) {
    throw new FhvResumeRuntimeProofError(
      "FHV_RESUME_RUNTIME_PROOF_INVALID",
      "Resume runtime proof digest mismatch.",
    );
  }
  if (input.proof.runId !== input.runId) {
    throw new FhvResumeRuntimeProofError(
      "FHV_RESUME_RUNTIME_PROOF_INVALID",
      "Resume runtime proof runId mismatch.",
    );
  }
  if (input.proof.organizationId !== input.organizationId) {
    throw new FhvResumeRuntimeProofError(
      "FHV_RESUME_RUNTIME_PROOF_INVALID",
      "Resume runtime proof organizationId mismatch.",
    );
  }
  if (input.proof.processPid !== input.expectedProcessPid) {
    throw new FhvResumeRuntimeProofError(
      "FHV_RESUME_RUNTIME_PROOF_INVALID",
      "Resume runtime proof processPid mismatch.",
    );
  }
  if (input.proof.resumeCycleStartIndex !== input.resumeCycleStartIndex) {
    throw new FhvResumeRuntimeProofError(
      "FHV_RESUME_RUNTIME_PROOF_INVALID",
      "Resume runtime proof resumeCycleStartIndex mismatch.",
    );
  }
  if (input.proof.fullHistoryRescanDelta !== 0) {
    throw new FhvResumeRuntimeProofError(
      "FHV_RESUME_RUNTIME_PROOF_RESCAN",
      "Resume runtime proof reports full-history rescan.",
    );
  }
  if (
    input.proof.fullHistoryRescanCountAfter - input.proof.fullHistoryRescanCountBefore !==
    input.proof.fullHistoryRescanDelta
  ) {
    throw new FhvResumeRuntimeProofError(
      "FHV_RESUME_RUNTIME_PROOF_INVALID",
      "Resume runtime proof rescan delta inconsistent.",
    );
  }
}
