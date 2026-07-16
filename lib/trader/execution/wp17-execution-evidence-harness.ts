import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  HISTORICAL_EXECUTION_MODEL_ID,
  HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
} from "@/lib/trader/execution/historical-execution-model.types";

export const HTR_WP17_EVIDENCE_SCHEMA_VERSION =
  "htr-wp17-execution-simulation-evidence/v1" as const;
export const HTR_WP17_STAGING_ROOT = ".cursor/plans/dee-415-wp17/evidence-staging";

export function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildWp17ExecutionEvidenceManifest(input: {
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  replayParityDigest: string;
  checkpointResumeParity: string;
  gap035ContractA: string;
  gap035ContractB: string;
  gap035ContractC: string;
}): Record<string, unknown> {
  const semanticBody = {
    schemaVersion: HTR_WP17_EVIDENCE_SCHEMA_VERSION,
    sourceGitSha: input.sourceGitSha,
    dirtyTree: input.sourceDirtyTree,
    executionModelId: HISTORICAL_EXECUTION_MODEL_ID,
    executionModelSchemaVersion: HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
    migrationSchemaVersion: "0098-0099",
    noSameBarFillProof: true,
    multiBarPartialCases: true,
    cancelExpiryCases: true,
    grossNetDecompositionProof: true,
    noDoubleCostProof: true,
    replayParityDigest: input.replayParityDigest,
    checkpointResumeParity: input.checkpointResumeParity,
    gap035ContractA: input.gap035ContractA,
    gap035ContractB: input.gap035ContractB,
    gap035ContractC: input.gap035ContractC,
    candidateStatus: "COMPLETE_PENDING_INDEPENDENT_REVIEW",
    outputMode: "GITIGNORED_STAGING",
  };
  const semanticDigest = sha256Utf8(canonicalJsonString(semanticBody));
  return {
    command: "pnpm trader:wp17:evidence",
    ...semanticBody,
    semanticDigest,
    manifestDigest: sha256Utf8(canonicalJsonString({ ...semanticBody, semanticDigest })),
  };
}
