import { describe, expect, it } from "vitest";

import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";

describe("trader replay frontier separation (HTR-WP05)", () => {
  it("does not advance safe resume when evidence is ahead of DB frontier", async () => {
    const harness = await runCheckpointResumeHarness();
    expect(harness.frontierSeparation.passed).toBe(true);
    expect(harness.frontierSeparation.safeResumeThroughCycleIndex).toBe(-1);
    expect(harness.frontierSeparation.evidenceAheadCycleIndex).toBeGreaterThanOrEqual(0);
  }, 240_000);
});
