import { createHash } from "node:crypto";

export const KNOWLEDGE_STATE_CHECKPOINT_SCHEMA_VERSION = "knowledge-state-checkpoint/v2" as const;

export type KnowledgeCheckpointInput = {
  organizationId: string;
  checkpointSeq: number;
  modelVersion: string;
  calibrationSnapshotDigest: string;
  rejectedResearchStates: readonly string[];
  promotedResearchStates: readonly string[];
  forecastPackageGenerationDigest?: string;
};

function canonicalizeCheckpoint(input: KnowledgeCheckpointInput): string {
  return JSON.stringify({
    schema: KNOWLEDGE_STATE_CHECKPOINT_SCHEMA_VERSION,
    organizationId: input.organizationId,
    checkpointSeq: input.checkpointSeq,
    modelVersion: input.modelVersion,
    calibrationSnapshotDigest: input.calibrationSnapshotDigest,
    rejectedResearchStates: [...input.rejectedResearchStates].sort(),
    promotedResearchStates: [...input.promotedResearchStates].sort(),
    forecastPackageGenerationDigest: input.forecastPackageGenerationDigest ?? null,
  });
}

export function computeKnowledgeSemanticDigest(input: KnowledgeCheckpointInput): string {
  return createHash("sha256").update(canonicalizeCheckpoint(input), "utf8").digest("hex");
}

export function computeKnowledgeCheckpointContentDigest(input: KnowledgeCheckpointInput): string {
  const semantic = computeKnowledgeSemanticDigest(input);
  return createHash("sha256")
    .update(`${KNOWLEDGE_STATE_CHECKPOINT_SCHEMA_VERSION}\n${semantic}\n`, "utf8")
    .digest("hex");
}

export class KnowledgeCheckpointMismatchError extends Error {
  readonly code = "KNOWLEDGE_CHECKPOINT_MISMATCH" as const;

  constructor(message: string) {
    super(message);
    this.name = "KnowledgeCheckpointMismatchError";
  }
}

export function assertKnowledgeCheckpointRoundtrip(
  expected: KnowledgeCheckpointInput,
  restored: KnowledgeCheckpointInput,
): void {
  const expectedDigest = computeKnowledgeSemanticDigest(expected);
  const restoredDigest = computeKnowledgeSemanticDigest(restored);
  if (expectedDigest !== restoredDigest) {
    throw new KnowledgeCheckpointMismatchError(
      `semantic digest mismatch expected=${expectedDigest} restored=${restoredDigest}`,
    );
  }
}
