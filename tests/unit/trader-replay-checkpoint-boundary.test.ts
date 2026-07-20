import { describe, expect, it } from "vitest";

import {
  dbPhaseFrontierFromCommittedPhases,
  resolveResumeBoundary,
} from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint";
import { runCheckpointResumeHarness } from "@/lib/trader/backtest/streaming-evidence/replay-checkpoint-resume-harness";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { Bar } from "@/lib/trader/intelligence/types";

function makeBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => ({
    symbol: "BTC-USD",
    interval: "1h",
    barOpenTime: new Date(i * 3_600_000).toISOString(),
    barCloseTime: new Date((i + 1) * 3_600_000).toISOString(),
    open: "100",
    high: "101",
    low: "99",
    close: "100",
    volume: "1",
  })) as unknown as Bar[];
}

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

  it("FULL-mode safety: resume cursor is opt-in and advanceToCycleIndex(0) is a no-op", () => {
    const source = new HistoricalBarReplaySource({ bars: makeBars(40) });
    expect(source.currentCycleIndex).toBe(0);
    source.advanceToCycleIndex(0);
    expect(source.currentCycleIndex).toBe(0);
    const first = source.next();
    expect(first.done).toBe(false);
    // A fresh source (no resume) still begins at cycle 0 — unchanged behavior for every caller.
    expect(source.currentCycleIndex).toBe(1);
  });

  it("harness checkpoint records partial resumable terminal state", async () => {
    const harness = await runCheckpointResumeHarness();
    expect(harness.checkpointRecord.replayTerminalState).toBe(
      "REPLAY_RUN_SEALED_PARTIAL_RESUMABLE",
    );
    expect(harness.checkpointRecord.safeResumeThroughCycleIndex).toBe(-1);
  }, 240_000);
});
