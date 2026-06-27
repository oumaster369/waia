import { describe, expect, it } from "vitest";

import {
  analyzePaperSoakLog,
  P5_TWO_STRATEGY_SOAK_IDS,
} from "@/lib/trader/paper/analyze-paper-soak-log";

function cycleCompleteLine(options: {
  cycleId: string;
  severity?: "info" | "critical";
  strategyIds?: string;
}): string {
  return JSON.stringify({
    event: "waia_trader_event",
    kind: "paper_loop",
    organization_id: "org-soak",
    outcome: "cycle_complete",
    severity: options.severity ?? "info",
    cycle_id: options.cycleId,
    strategy_ids: options.strategyIds ?? P5_TWO_STRATEGY_SOAK_IDS.join(","),
  });
}

describe("analyzePaperSoakLog (DEE-337)", () => {
  it("passes when duration, both strategies, and critical=0 are satisfied", () => {
    const cycles = Array.from({ length: 10 }, (_, index) =>
      cycleCompleteLine({ cycleId: `paper-loop-${index}` }),
    );
    const analysis = analyzePaperSoakLog({
      logContent: cycles.join("\n"),
      minDurationHours: 1 / 60,
      barIntervalMs: 60_000,
    });

    expect(analysis.meetsCriticalZero).toBe(true);
    expect(analysis.meetsBothStrategiesObserved).toBe(true);
    expect(analysis.meetsCycleDurationThreshold).toBe(true);
    expect(analysis.logEvidenceReadyForClosure).toBe(true);
    expect(analysis.blockingReasons).toHaveLength(0);
  });

  it("fails when critical telemetry is present", () => {
    const analysis = analyzePaperSoakLog({
      logContent: cycleCompleteLine({ cycleId: "bad-1", severity: "critical" }),
      minDurationHours: 0.001,
      barIntervalMs: 60_000,
    });

    expect(analysis.paperLoopCriticalCount).toBe(1);
    expect(analysis.meetsCriticalZero).toBe(false);
    expect(analysis.logEvidenceReadyForClosure).toBe(false);
  });

  it("fails when only one strategy appears in telemetry", () => {
    const analysis = analyzePaperSoakLog({
      logContent: cycleCompleteLine({
        cycleId: "single-strategy",
        strategyIds: P5_TWO_STRATEGY_SOAK_IDS[0],
      }),
      minDurationHours: 0.001,
      barIntervalMs: 60_000,
    });

    expect(analysis.meetsBothStrategiesObserved).toBe(false);
    expect(analysis.blockingReasons.some((reason) => reason.includes("strategy_ids missing"))).toBe(
      true,
    );
  });

  it("counts worker cycle_error lines as blocking", () => {
    const analysis = analyzePaperSoakLog({
      logContent: [
        cycleCompleteLine({ cycleId: "ok-1" }),
        JSON.stringify({ event: "waia_paper_loop", phase: "cycle_error", error: "boom" }),
      ].join("\n"),
      minDurationHours: 0.001,
      barIntervalMs: 60_000,
    });

    expect(analysis.paperLoopWorkerErrorCount).toBe(1);
    expect(analysis.meetsCriticalZero).toBe(false);
  });
});
