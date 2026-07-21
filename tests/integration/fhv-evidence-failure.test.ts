import { describe, expect, it } from "vitest";

import {
  FhvCampaignSemanticAbortError,
  isFhvCampaignSemanticAbortError,
} from "@/lib/trader/observability/fhv-campaign-semantic-abort";
import { assertFhvEvidenceWriteFailure } from "@/lib/trader/observability/fhv-campaign-semantic-guards";

describe("DEE-416 FHV campaign-owned evidence failure guard", () => {
  it("throws FhvCampaignSemanticAbortError with FHV_ABORT_EVIDENCE_WRITE_FAILURE", () => {
    expect(() => assertFhvEvidenceWriteFailure(true)).toThrow(FhvCampaignSemanticAbortError);

    try {
      assertFhvEvidenceWriteFailure(true);
      expect.unreachable("Expected evidence write failure guard to throw");
    } catch (error) {
      expect(isFhvCampaignSemanticAbortError(error)).toBe(true);
      expect((error as FhvCampaignSemanticAbortError).code).toBe(
        "FHV_ABORT_EVIDENCE_WRITE_FAILURE",
      );
      expect((error as FhvCampaignSemanticAbortError).terminalReason).toBe(
        "FHV_ABORT_EVIDENCE_WRITE_FAILURE",
      );
    }
  });

  it("allows replay to continue when evidence write succeeds", () => {
    expect(() => assertFhvEvidenceWriteFailure(false)).not.toThrow();
  });
});
