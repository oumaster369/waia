import { describe, expect, it } from "vitest";

import {
  assertFhvReplayNotLiveExchangePath,
  FhvCampaignSemanticAbortError,
} from "@/lib/trader/observability/fhv-campaign-semantic-abort";

describe("DEE-416 FHV live-path tripwire", () => {
  it("allows replay when live exchange path is not invoked", () => {
    expect(() => assertFhvReplayNotLiveExchangePath(false)).not.toThrow();
  });

  it("aborts replay when live exchange path is invoked", () => {
    expect(() => assertFhvReplayNotLiveExchangePath(true)).toThrow(FhvCampaignSemanticAbortError);
    try {
      assertFhvReplayNotLiveExchangePath(true);
    } catch (error) {
      expect(error).toMatchObject({
        code: "FHV_ABORT_UNEXPECTED_LIVE_EXCHANGE_PATH",
        terminalReason: "FHV_ABORT_UNEXPECTED_LIVE_EXCHANGE_PATH",
      });
    }
  });
});
