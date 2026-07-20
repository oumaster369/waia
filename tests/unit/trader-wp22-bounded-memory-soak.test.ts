import { describe, expect, it } from "vitest";

import {
  evaluateHtrWp22BoundedMemorySoak,
  HTR_WP22_BOUNDED_MEMORY_SOAK_SCHEMA,
  runHtrWp22BoundedMemorySoak,
} from "@/lib/trader/backtest/htr-wp22-bounded-memory-soak";
import { D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS } from "@/lib/trader/backtest/replay-qualification-harness";

describe("HTR-WP22 bounded memory soak", () => {
  it("binds amendment v1 buffered projection gate unchanged", () => {
    expect(D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxBufferedProjections).toBe(32);
  });

  it("declares schema version", () => {
    expect(HTR_WP22_BOUNDED_MEMORY_SOAK_SCHEMA).toBe("htr-wp22-bounded-memory-soak/v1");
  });

  it("proves STREAM_ONLY retention stays bounded across fixture cycle counts", async () => {
    const result = await runHtrWp22BoundedMemorySoak();
    expect(result.retainedPaperCycleResults).toBe(0);
    expect(result.peakBufferedProjections).toBeLessThanOrEqual(
      D11B_MEMORY_GATE_AMENDMENT_V1_THRESHOLDS.maxBufferedProjections,
    );
    expect(result.boundednessObservations.length).toBeGreaterThan(0);
    expect(["HTR_WP22_BOUNDED_MEMORY_PASS", "HTR_WP22_BOUNDED_MEMORY_FAIL"]).toContain(
      result.terminalState,
    );
    expect(evaluateHtrWp22BoundedMemorySoak(result)).toBe(
      result.terminalState === "HTR_WP22_BOUNDED_MEMORY_PASS",
    );
  }, 240_000);
});
