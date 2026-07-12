import { describe, expect, it } from "vitest";

import {
  dbPhaseFrontierFromCommittedPhases,
  resolveResumeBoundary,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";

describe("trader replay checkpoint boundary (HTR-WP05)", () => {
  it("allows checkpoint only at DB-durable phase boundary", () => {
    const frontier = dbPhaseFrontierFromCommittedPhases({
      validationResultCommitted: true,
      validationLastCycleIndex: 80,
      walkForwardWindowCount: 0,
      walkForwardLastCycleIndex: -1,
      blindResultCommitted: false,
      blindLastCycleIndex: -1,
    });
    const boundary = resolveResumeBoundary({
      activePhase: "walk-forward:0",
      dbDurablePhaseRunDir: null,
      dbFrontier: frontier,
      phaseLastCycleIndex: { validation: 80 },
    });
    expect(boundary.dbDurableThroughPhase).toBe("validation");
    expect(boundary.dbDurableThroughCycleIndex).toBe(80);
  });

  it("harness checkpoint records partial resumable terminal state", async () => {
    const harness = await runCheckpointResumeHarness();
    expect(harness.checkpointRecord.replayTerminalState).toBe(
      "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
    );
    expect(harness.checkpointRecord.safeResumeThroughCycleIndex).toBe(-1);
  }, 240_000);
});
