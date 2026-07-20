import { describe, expect, it, vi } from "vitest";

import type { Bar } from "@/lib/trader/intelligence/types";
import * as walkForwardEngine from "@/lib/trader/research/walk-forward-engine";
import {
  buildWalkForwardWindowPlanAtIndex,
  buildWalkForwardWindowPlans,
  runWalkForwardValidation,
} from "@/lib/trader/research/walk-forward-engine";
import type {
  ResearchValidationMetrics,
  StrategyCandidate,
} from "@/lib/trader/research/strategy-candidate.types";

const ORG_ID = "00000000-0000-4000-8000-00000000c001";
const CANDIDATE_ID = "00000000-0000-4000-8000-00000000c002";

/** Org-0 RI-P7 campaign split sizes (129,602 bars, 60/20/20 three-way split). */
const ORG0_TRAIN_BAR_COUNT = 77_761;
const ORG0_VALIDATION_BAR_COUNT = 25_920;
const ORG0_OOS_BAR_COUNT = 20;
const ORG0_WALK_FORWARD_WINDOW_COUNT = Math.floor(ORG0_VALIDATION_BAR_COUNT / ORG0_OOS_BAR_COUNT);

/** Generous ceiling — indexed path should stay well below this at Org-0 scale. */
const INDEXED_PATH_HEAP_CEILING_BYTES = 512 * 1024 * 1024;

function buildBars(count: number, close = "100"): Bar[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: new Date(Date.parse("2026-06-22T09:40:00.000Z") + index * 60_000).toISOString(),
    barCloseTime: new Date(Date.parse("2026-06-22T09:41:00.000Z") + index * 60_000).toISOString(),
  }));
}

function buildMetrics(regimeLabels: string[]): ResearchValidationMetrics {
  return {
    schemaVersion: "1.0.0",
    tradeCount: regimeLabels.length,
    periodRealizedPnl: "1.0",
    periodTotalFees: "0.1",
    byRegime: regimeLabels.map((regimeLabel) => ({
      regimeLabel,
      tradeCount: 1,
      periodRealizedPnl: "1.0",
      periodTotalFees: "0.1",
    })),
  };
}

function buildCandidate(): StrategyCandidate {
  return {
    id: CANDIDATE_ID,
    organizationId: ORG_ID,
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    hypothesisId: null,
    trialId: null,
    status: "backtested",
    paramsJson: "{}",
    blindUsed: false,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
  };
}

function maybeGc(): void {
  global.gc?.();
}

function measureIndexedPathHeapDelta(trainBars: Bar[], validationBars: Bar[]): number {
  maybeGc();
  const heapBefore = process.memoryUsage().heapUsed;

  for (let windowIndex = 0; windowIndex < ORG0_WALK_FORWARD_WINDOW_COUNT; windowIndex += 1) {
    buildWalkForwardWindowPlanAtIndex(trainBars, validationBars, windowIndex, ORG0_OOS_BAR_COUNT);
  }

  maybeGc();
  return process.memoryUsage().heapUsed - heapBefore;
}

describe("trader walk-forward memory scope (DEE-367)", () => {
  it("indexed walk-forward plan generation stays bounded at Org-0 scale", () => {
    const trainBars = buildBars(ORG0_TRAIN_BAR_COUNT);
    const validationBars = buildBars(ORG0_VALIDATION_BAR_COUNT);

    const heapDelta = measureIndexedPathHeapDelta(trainBars, validationBars);

    expect(heapDelta).toBeLessThan(INDEXED_PATH_HEAP_CEILING_BYTES);
  });

  it("buildWalkForwardWindowPlanAtIndex omits inSampleBars materialization", () => {
    const trainBars = buildBars(100);
    const validationBars = buildBars(200);

    const plan = buildWalkForwardWindowPlanAtIndex(trainBars, validationBars, 5, 20);

    expect(plan).not.toHaveProperty("inSampleBars");
    expect(plan.outOfSampleBars).toHaveLength(20);
    expect(plan.inSampleDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("buildWalkForwardWindowPlans retains inSampleBars for every window at reduced scale", () => {
    const trainBars = buildBars(100);
    const validationBars = buildBars(200);
    const oosBarCount = 20;

    const plans = buildWalkForwardWindowPlans(trainBars, validationBars, oosBarCount);

    expect(plans).toHaveLength(10);
    for (const [index, plan] of plans.entries()) {
      expect(plan.inSampleBars).toHaveLength(trainBars.length + index * oosBarCount);
    }
  });

  it("runWalkForwardValidation does not call bulk buildWalkForwardWindowPlans", async () => {
    const bulkSpy = vi.spyOn(walkForwardEngine, "buildWalkForwardWindowPlans");

    await runWalkForwardValidation({
      context: { organizationId: ORG_ID },
      candidate: buildCandidate(),
      trainBars: buildBars(10),
      validationBars: buildBars(4),
      oosBarCount: 2,
      runBacktest: vi
        .fn()
        .mockResolvedValueOnce(buildMetrics(["RANGE"]))
        .mockResolvedValueOnce(buildMetrics(["CHOP", "TREND_BEAR"])),
      repository: {
        insertWalkForwardWindow: vi.fn().mockResolvedValue(undefined),
        updateStrategyCandidateStatus: vi.fn().mockResolvedValue(undefined),
      },
    });

    expect(bulkSpy).not.toHaveBeenCalled();
    bulkSpy.mockRestore();
  });

  /**
   * Full pipeline retains ~2× bar copies (campaign CLI + orchestrator) — acceptable
   * post-fix; walk-forward init is the scoped recovery target.
   */
  it.skip("eager buildWalkForwardWindowPlans at Org-0 scale exceeds CI heap (documented)", () => {
    const trainBars = buildBars(ORG0_TRAIN_BAR_COUNT);
    const validationBars = buildBars(ORG0_VALIDATION_BAR_COUNT);

    maybeGc();
    const heapBefore = process.memoryUsage().heapUsed;
    buildWalkForwardWindowPlans(trainBars, validationBars, ORG0_OOS_BAR_COUNT);
    maybeGc();
    const heapDelta = process.memoryUsage().heapUsed - heapBefore;

    expect(heapDelta).toBeGreaterThan(INDEXED_PATH_HEAP_CEILING_BYTES);
  });
});
