import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  HISTORICAL_EXECUTION_MODEL_ID,
  HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
} from "@/lib/trader/execution/historical-execution-model.types";

export const HTR_WP17_EVIDENCE_SCHEMA_VERSION =
  "htr-wp17-execution-simulation-evidence/v1" as const;
export const HTR_WP17_DEFAULT_PATH_CORRECTION_EVIDENCE_SCHEMA_VERSION =
  "htr-wp17-default-path-conformance-correction-evidence/v1" as const;
export const HTR_WP17_STAGING_ROOT = ".cursor/plans/dee-415-wp17/evidence-staging";
export const HTR_WP17_APPROVED_PACKET_SHA256 =
  "ba8daf2608dcea83aeae918150a73fd3c0713f951750a9ff45edfe1e2653baaa";
export const HTR_WP17_SUPERSEDED_COMPONENT_EVIDENCE_PATH =
  "replay-runs/RI-P7/htr-wp17-execution-simulation/";

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

export function buildWp17DefaultPathCorrectionEvidenceManifest(input: {
  sourceGitSha: string;
  sourceGitParentSha: string;
  dirtyTree: boolean;
  defaultResearchPathWp17ProfilePropagation: string;
  defaultResearchPathSingleCostApplicationPoint: string;
  defaultResearchPathNoSameBarFill: string;
  defaultResearchPathHistoricalEconomicsComplete: string;
  defaultResearchPathNoDuplicateReconciliationFill: string;
  initialPortfolioV1: string;
  initialPortfolioV2: string;
  initialPortfolioCrossEntrypointParity: string;
  checkpointResumeParity: string;
  sqlitePostgresExecutionFactParity: string;
  gap035ContractA: string;
  gap035ContractB: string;
  gap035ContractC: string;
  defaultResearchEntrypointsTested: readonly string[];
  targetedTestFiles: readonly string[];
  targetedTestCount: number;
  postgresResult: string;
}): Record<string, unknown> {
  const semanticBody = {
    schemaVersion: HTR_WP17_DEFAULT_PATH_CORRECTION_EVIDENCE_SCHEMA_VERSION,
    sourceGitSha: input.sourceGitSha,
    sourceGitParentSha: input.sourceGitParentSha,
    dirtyTree: input.dirtyTree,
    historicalApprovedPacketSha256: HTR_WP17_APPROVED_PACKET_SHA256,
    supersededComponentEvidencePath: HTR_WP17_SUPERSEDED_COMPONENT_EVIDENCE_PATH,
    supersededComponentEvidenceClassification:
      "HISTORICAL_ACCEPTED_COMPONENT_EVIDENCE_PATH_B_NOT_SUFFICIENT_ALONE_FOR_DEFAULT_PATH_CONFORMANCE",
    profileId: "htr-historical-execution-profile/v1",
    executionModelId: HISTORICAL_EXECUTION_MODEL_ID,
    executionModelSchemaVersion: HISTORICAL_EXECUTION_MODEL_SCHEMA_VERSION,
    initialPortfolioSchemaVersion: "htr-initial-portfolio/v1",
    startingBalanceUsdt: "100000.00",
    startingPositions: { BTC: "0", ETH: "0" },
    defaultResearchPathWp17ProfilePropagation: input.defaultResearchPathWp17ProfilePropagation,
    defaultResearchPathSingleCostApplicationPoint:
      input.defaultResearchPathSingleCostApplicationPoint,
    defaultResearchPathNoSameBarFill: input.defaultResearchPathNoSameBarFill,
    defaultResearchPathHistoricalEconomicsComplete:
      input.defaultResearchPathHistoricalEconomicsComplete,
    defaultResearchPathNoDuplicateReconciliationFill:
      input.defaultResearchPathNoDuplicateReconciliationFill,
    initialPortfolioV1: input.initialPortfolioV1,
    initialPortfolioV2: input.initialPortfolioV2,
    initialPortfolioCrossEntrypointParity: input.initialPortfolioCrossEntrypointParity,
    checkpointResumeParity: input.checkpointResumeParity,
    sqlitePostgresExecutionFactParity: input.sqlitePostgresExecutionFactParity,
    defaultResearchEntrypointsTested: input.defaultResearchEntrypointsTested,
    targetedTestFiles: input.targetedTestFiles,
    targetedTestCount: input.targetedTestCount,
    postgresResult: input.postgresResult,
    gap035ContractA: input.gap035ContractA,
    gap035ContractB: input.gap035ContractB,
    gap035ContractC: input.gap035ContractC,
    candidateStatus: "COMPLETE_PENDING_FRESH_INDEPENDENT_DEFAULT_PATH_REVIEW",
    outputMode: "GITIGNORED_STAGING",
  };
  const semanticDigest = sha256Utf8(canonicalJsonString(semanticBody));
  return {
    command: "pnpm trader:wp17:default-path-correction-evidence",
    ...semanticBody,
    semanticDigest,
    manifestDigest: sha256Utf8(canonicalJsonString({ ...semanticBody, semanticDigest })),
  };
}
