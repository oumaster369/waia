import { describe, expect, it } from "vitest";

import {
  evaluateHtrWp22CheckpointResumeParity,
  HTR_WP22_CHECKPOINT_RESUME_PARITY_SCHEMA,
  runHtrWp22CheckpointResumeParity,
} from "@/lib/trader/backtest/htr-wp22-checkpoint-resume-parity";

describe("HTR-WP22 checkpoint/resume parity", () => {
  it("declares schema version", () => {
    expect(HTR_WP22_CHECKPOINT_RESUME_PARITY_SCHEMA).toBe("htr-wp22-checkpoint-resume-parity/v1");
  });

  it("runs upstream WP05 checkpoint/resume harness with semantic parity binding", async () => {
    const result = await runHtrWp22CheckpointResumeParity();
    expect(result.upstreamHarness.parity.evidenceDigestMatch).toBe(true);
    expect(result.upstreamHarness.parity.semanticParityDigestMatch).toBe(true);
    expect(result.upstreamHarness.disconnectTerminal.passed).toBe(true);
    expect(result.upstreamHarness.uninterruptedSemanticParityDigest).toBe(
      result.upstreamHarness.resumedSemanticParityDigest,
    );
    expect(["HTR_WP22_CHECKPOINT_RESUME_PASS", "HTR_WP22_CHECKPOINT_RESUME_FAIL"]).toContain(
      result.terminalState,
    );
    expect(evaluateHtrWp22CheckpointResumeParity(result)).toBe(
      result.terminalState === "HTR_WP22_CHECKPOINT_RESUME_PASS",
    );
  }, 240_000);
});
