import { describe, expect, it } from "vitest";

import { isTransientConnectionError } from "@/db/postgres-client";
import { resolveResearchCampaignCrashFailureCode } from "@/lib/trader/research/finalize-research-campaign-outcome";
import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";

describe("trader db disconnect terminal (HTR-WP05)", () => {
  it("classifies transient disconnect as CAMPAIGN_INFRA_DISCONNECT", () => {
    const error = new Error("CONNECTION_CLOSED");
    expect(isTransientConnectionError(error)).toBe(true);
    expect(resolveResearchCampaignCrashFailureCode(error)).toBe("CAMPAIGN_INFRA_DISCONNECT");
  });

  it("harness disconnect terminal report passes", async () => {
    const harness = await runCheckpointResumeHarness();
    expect(harness.disconnectTerminal.passed).toBe(true);
  }, 240_000);
});
