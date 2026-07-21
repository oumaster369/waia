import {
  assertFhvCampaignSemanticInvariant,
  assertFhvReplayNotLiveExchangePath,
  assertFhvUnauthorizedPromotionBlocked,
  type FhvCampaignSemanticAbortCode,
} from "@/lib/trader/observability/fhv-campaign-semantic-abort";

export function assertFhvDatasetDigestMatch(expected: string, actual: string): void {
  assertFhvCampaignSemanticInvariant(
    expected === actual,
    "FHV_ABORT_DATASET_DIGEST_MISMATCH",
    `Dataset digest mismatch: expected ${expected}, got ${actual}`,
  );
}

export function assertFhvNoLookaheadViolation(violated: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !violated,
    "FHV_ABORT_NO_LOOKAHEAD_VIOLATION",
    "No-lookahead violation detected during FHV replay",
  );
}

export function assertFhvDuplicateOrderBlocked(duplicateDetected: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !duplicateDetected,
    "FHV_ABORT_DUPLICATE_ORDER",
    "Duplicate order detected during FHV replay",
  );
}

export function assertFhvExecutionMismatch(detected: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !detected,
    "FHV_ABORT_EXECUTION_MISMATCH",
    "Execution mismatch detected during FHV replay",
  );
}

export function assertFhvReconciliationMismatch(detected: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !detected,
    "FHV_ABORT_RECONCILIATION_MISMATCH",
    "Reconciliation mismatch detected during FHV replay",
  );
}

export function assertFhvAccountingFrontierMismatch(detected: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !detected,
    "FHV_ABORT_ACCOUNTING_FRONTIER_MISMATCH",
    "Accounting frontier mismatch detected during FHV replay",
  );
}

export function assertFhvEvidenceWriteFailure(failed: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !failed,
    "FHV_ABORT_EVIDENCE_WRITE_FAILURE",
    "Evidence atomic write failure during FHV replay",
  );
}

export function assertFhvArtifactSealingFailure(failed: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !failed,
    "FHV_ABORT_ARTIFACT_SEALING_FAILURE",
    "Artifact sealing failure during FHV replay",
  );
}

export { assertFhvReplayNotLiveExchangePath, assertFhvUnauthorizedPromotionBlocked };

export const FHV_CAMPAIGN_SEMANTIC_ABORT_CODES: readonly FhvCampaignSemanticAbortCode[] = [
  "FHV_ABORT_DATASET_DIGEST_MISMATCH",
  "FHV_ABORT_NO_LOOKAHEAD_VIOLATION",
  "FHV_ABORT_DUPLICATE_ORDER",
  "FHV_ABORT_EXECUTION_MISMATCH",
  "FHV_ABORT_RECONCILIATION_MISMATCH",
  "FHV_ABORT_ACCOUNTING_FRONTIER_MISMATCH",
  "FHV_ABORT_EVIDENCE_WRITE_FAILURE",
  "FHV_ABORT_ARTIFACT_SEALING_FAILURE",
  "FHV_ABORT_UNEXPECTED_LIVE_EXCHANGE_PATH",
  "FHV_ABORT_UNAUTHORIZED_PROMOTION_ATTEMPT",
];
