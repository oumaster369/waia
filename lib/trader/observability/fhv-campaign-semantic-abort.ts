export type FhvCampaignSemanticAbortCode =
  | "FHV_ABORT_DATASET_DIGEST_MISMATCH"
  | "FHV_ABORT_NO_LOOKAHEAD_VIOLATION"
  | "FHV_ABORT_DUPLICATE_ORDER"
  | "FHV_ABORT_EXECUTION_MISMATCH"
  | "FHV_ABORT_RECONCILIATION_MISMATCH"
  | "FHV_ABORT_ACCOUNTING_FRONTIER_MISMATCH"
  | "FHV_ABORT_EVIDENCE_WRITE_FAILURE"
  | "FHV_ABORT_ARTIFACT_SEALING_FAILURE"
  | "FHV_ABORT_UNEXPECTED_LIVE_EXCHANGE_PATH"
  | "FHV_ABORT_UNAUTHORIZED_PROMOTION_ATTEMPT";

export class FhvCampaignSemanticAbortError extends Error {
  readonly code: FhvCampaignSemanticAbortCode;
  readonly terminalReason: string;

  constructor(code: FhvCampaignSemanticAbortCode, message: string) {
    super(message);
    this.name = "FhvCampaignSemanticAbortError";
    this.code = code;
    this.terminalReason = code;
  }
}

export function assertFhvCampaignSemanticInvariant(
  condition: boolean,
  code: FhvCampaignSemanticAbortCode,
  message: string,
): asserts condition {
  if (!condition) {
    throw new FhvCampaignSemanticAbortError(code, message);
  }
}

export function isFhvCampaignSemanticAbortError(
  error: unknown,
): error is FhvCampaignSemanticAbortError {
  return error instanceof FhvCampaignSemanticAbortError;
}

/** Tripwire for live-exchange code paths during FHV replay (campaign-owned). */
export function assertFhvReplayNotLiveExchangePath(livePathInvoked: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !livePathInvoked,
    "FHV_ABORT_UNEXPECTED_LIVE_EXCHANGE_PATH",
    "Live exchange path invoked during FHV replay",
  );
}

export function assertFhvUnauthorizedPromotionBlocked(promotionAttempted: boolean): void {
  assertFhvCampaignSemanticInvariant(
    !promotionAttempted,
    "FHV_ABORT_UNAUTHORIZED_PROMOTION_ATTEMPT",
    "Unauthorized strategy promotion attempt during FHV campaign",
  );
}
