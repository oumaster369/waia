import { describe, expect, it } from "vitest";

import {
  FhvCampaignSemanticAbortError,
  type FhvCampaignSemanticAbortCode,
} from "@/lib/trader/observability/fhv-campaign-semantic-abort";
import {
  assertFhvAccountingFrontierMismatch,
  assertFhvArtifactSealingFailure,
  assertFhvDatasetDigestMatch,
  assertFhvDuplicateOrderBlocked,
  assertFhvEvidenceWriteFailure,
  assertFhvExecutionMismatch,
  assertFhvNoLookaheadViolation,
  assertFhvReconciliationMismatch,
  assertFhvReplayNotLiveExchangePath,
  assertFhvUnauthorizedPromotionBlocked,
  FHV_CAMPAIGN_SEMANTIC_ABORT_CODES,
} from "@/lib/trader/observability/fhv-campaign-semantic-guards";

type GuardTrigger = () => void;

const GUARD_BY_CODE: Record<FhvCampaignSemanticAbortCode, GuardTrigger> = {
  FHV_ABORT_DATASET_DIGEST_MISMATCH: () => assertFhvDatasetDigestMatch("expected", "actual"),
  FHV_ABORT_NO_LOOKAHEAD_VIOLATION: () => assertFhvNoLookaheadViolation(true),
  FHV_ABORT_DUPLICATE_ORDER: () => assertFhvDuplicateOrderBlocked(true),
  FHV_ABORT_EXECUTION_MISMATCH: () => assertFhvExecutionMismatch(true),
  FHV_ABORT_RECONCILIATION_MISMATCH: () => assertFhvReconciliationMismatch(true),
  FHV_ABORT_ACCOUNTING_FRONTIER_MISMATCH: () => assertFhvAccountingFrontierMismatch(true),
  FHV_ABORT_EVIDENCE_WRITE_FAILURE: () => assertFhvEvidenceWriteFailure(true),
  FHV_ABORT_ARTIFACT_SEALING_FAILURE: () => assertFhvArtifactSealingFailure(true),
  FHV_ABORT_UNEXPECTED_LIVE_EXCHANGE_PATH: () => assertFhvReplayNotLiveExchangePath(true),
  FHV_ABORT_UNAUTHORIZED_PROMOTION_ATTEMPT: () => assertFhvUnauthorizedPromotionBlocked(true),
};

describe("DEE-416 FHV campaign semantic abort integration", () => {
  it("covers every FHV_CAMPAIGN_SEMANTIC_ABORT_CODES entry via campaign guards", () => {
    expect(FHV_CAMPAIGN_SEMANTIC_ABORT_CODES).toHaveLength(10);
    for (const code of FHV_CAMPAIGN_SEMANTIC_ABORT_CODES) {
      const trigger = GUARD_BY_CODE[code];
      expect(trigger).toBeDefined();
      try {
        trigger();
        expect.unreachable(`Expected ${code} to throw`);
      } catch (error) {
        expect(error).toBeInstanceOf(FhvCampaignSemanticAbortError);
        expect((error as FhvCampaignSemanticAbortError).code).toBe(code);
        expect((error as FhvCampaignSemanticAbortError).terminalReason).toBe(code);
      }
    }
  });
});
