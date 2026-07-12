import { describe, expect, it } from "vitest";

import {
  assertCheckpointResumeHarness,
  runCheckpointResumeHarness,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";

describe("trader replay resume parity (HTR-WP05)", () => {
  it("resumed composed outputs match uninterrupted execution", async () => {
    const harness = await runCheckpointResumeHarness();
    assertCheckpointResumeHarness(harness);
    expect(harness.parity.evidenceDigestMatch).toBe(true);
    expect(harness.parity.semanticReproDigestMatch).toBe(true);
    expect(harness.parity.cycleCountMatch).toBe(true);
  }, 240_000);
});
