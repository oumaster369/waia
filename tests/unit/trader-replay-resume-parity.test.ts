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

    // Phase-B core: the same semantic-parity digest is computed for BOTH runs over the same
    // normalized authoritative projection stream, and they are equal.
    expect(harness.uninterruptedSemanticParityDigest).toBeTruthy();
    expect(harness.resumedSemanticParityDigest).toBeTruthy();
    expect(harness.parity.semanticParityDigestMatch).toBe(true);
    expect(harness.resumedSemanticParityDigest).toBe(harness.uninterruptedSemanticParityDigest);

    // Authoritative composed stream: one projection per expected cycle, no duplicates, no gaps.
    expect(harness.authoritativeStream.duplicateCount).toBe(0);
    expect(harness.authoritativeStream.gapCount).toBe(0);
    expect(harness.authoritativeStream.cycleCount).toBe(harness.uninterrupted.cycleCount);
    // The interrupted partial attempt is preserved as a superseded audit segment.
    expect(harness.authoritativeStream.supersededSegmentCount).toBe(1);
    expect(harness.terminalState).toBe("REPLAY_RUN_OK");
  }, 240_000);
});
