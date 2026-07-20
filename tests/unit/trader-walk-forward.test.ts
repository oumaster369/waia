import { describe, expect, it, vi } from "vitest";

import type { Bar } from "@/lib/trader/intelligence/types";
import {
  computeBarSetDigest,
  computeBarSetDigestFromParts,
} from "@/lib/trader/market-data/research-dataset";
import {
  buildWalkForwardWindowPlanAtIndex,
  buildWalkForwardWindowPlans,
  computeWalkForwardEvidenceDigest,
  runWalkForwardValidation,
} from "@/lib/trader/research/walk-forward-engine";
import type {
  ResearchValidationMetrics,
  StrategyCandidate,
} from "@/lib/trader/research/strategy-candidate.types";

const ORG_ID = "00000000-0000-4000-8000-00000000c001";
const CANDIDATE_ID = "00000000-0000-4000-8000-00000000c002";

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

function buildCandidate(overrides: Partial<StrategyCandidate> = {}): StrategyCandidate {
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
    ...overrides,
  };
}

describe("trader walk-forward (RI-P3)", () => {
  it("buildWalkForwardWindowPlans rolls anchored expanding windows over validation split", () => {
    const trainBars = buildBars(10, "90");
    const validationBars = buildBars(8, "110");
    const oosBarCount = 2;

    const plans = buildWalkForwardWindowPlans(trainBars, validationBars, oosBarCount);

    expect(plans).toHaveLength(4);
    expect(plans[0]).toMatchObject({
      windowIndex: 0,
      inSampleBars: trainBars,
      outOfSampleBars: validationBars.slice(0, 2),
      inSampleDigest: computeBarSetDigest(trainBars),
      outOfSampleDigest: computeBarSetDigest(validationBars.slice(0, 2)),
    });
    expect(plans[1]?.inSampleBars).toHaveLength(trainBars.length + 2);
    expect(plans[3]?.outOfSampleBars).toEqual(validationBars.slice(6, 8));
  });

  it("runWalkForwardValidation persists per-window metrics and updates candidate status", async () => {
    const trainBars = buildBars(10);
    const validationBars = buildBars(4);
    const metricsByWindow = [buildMetrics(["RANGE"]), buildMetrics(["CHOP", "TREND_BEAR"])];

    const insertWalkForwardWindow = vi.fn().mockResolvedValue(undefined);
    const updateStrategyCandidateStatus = vi.fn().mockResolvedValue(undefined);
    const runBacktest = vi
      .fn()
      .mockResolvedValueOnce(metricsByWindow[0])
      .mockResolvedValueOnce(metricsByWindow[1]);

    const result = await runWalkForwardValidation({
      context: { organizationId: ORG_ID },
      candidate: buildCandidate(),
      trainBars,
      validationBars,
      oosBarCount: 2,
      runBacktest,
      repository: {
        insertWalkForwardWindow,
        updateStrategyCandidateStatus,
      },
      newId: () => "00000000-0000-4000-8000-00000000c010",
    });

    expect(runBacktest).toHaveBeenCalledTimes(2);
    expect(runBacktest.mock.calls[0]?.[0]).toMatchObject({ windowIndex: 0 });
    expect(runBacktest.mock.calls[1]?.[0]).toMatchObject({ windowIndex: 1 });
    expect(insertWalkForwardWindow).toHaveBeenCalledTimes(2);
    expect(updateStrategyCandidateStatus).toHaveBeenCalledWith(
      { organizationId: ORG_ID },
      CANDIDATE_ID,
      "walk_forward_validated",
    );
    expect(result.windows).toHaveLength(2);
    expect(result.regimeLabels).toEqual(["CHOP", "RANGE", "TREND_BEAR"]);
    expect(computeWalkForwardEvidenceDigest(result.windows)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("runWalkForwardValidation completes when window metrics lack multi-regime coverage", async () => {
    const insertWalkForwardWindow = vi.fn().mockResolvedValue(undefined);
    const updateStrategyCandidateStatus = vi.fn().mockResolvedValue(undefined);

    const result = await runWalkForwardValidation({
      context: { organizationId: ORG_ID },
      candidate: buildCandidate(),
      trainBars: buildBars(10),
      validationBars: buildBars(2),
      oosBarCount: 2,
      runBacktest: vi.fn().mockResolvedValue(buildMetrics(["TREND_BULL"])),
      repository: {
        insertWalkForwardWindow,
        updateStrategyCandidateStatus,
      },
    });

    expect(updateStrategyCandidateStatus).toHaveBeenCalledWith(
      { organizationId: ORG_ID },
      CANDIDATE_ID,
      "walk_forward_validated",
    );
    expect(result.regimeLabels).toEqual(["TREND_BULL"]);
  });
});

/** Org-0 RI-P7 campaign split sizes (129,602 bars, 60/20/20 three-way split). */
const ORG0_TRAIN_BAR_COUNT = 77_761;
const ORG0_VALIDATION_BAR_COUNT = 25_920;
const ORG0_OOS_BAR_COUNT = 20;
const ORG0_WALK_FORWARD_WINDOW_COUNT = Math.floor(ORG0_VALIDATION_BAR_COUNT / ORG0_OOS_BAR_COUNT);

describe("trader walk-forward Org-0 scale (DEE-367)", () => {
  it("schedules 1296 walk-forward windows for Org-0 validation split", () => {
    expect(ORG0_WALK_FORWARD_WINDOW_COUNT).toBe(1_296);
  });

  it.each([0, 648, 1_295])(
    "computeBarSetDigestFromParts matches concatenated digest at window %i",
    (windowIndex) => {
      const trainBars = buildBars(ORG0_TRAIN_BAR_COUNT, "90");
      const validationBars = buildBars(ORG0_VALIDATION_BAR_COUNT, "110");
      const oosStart = windowIndex * ORG0_OOS_BAR_COUNT;

      const fromParts = computeBarSetDigestFromParts(trainBars, validationBars.slice(0, oosStart));
      const fromConcat = computeBarSetDigest([...trainBars, ...validationBars.slice(0, oosStart)]);

      expect(fromParts).toBe(fromConcat);

      const plan = buildWalkForwardWindowPlanAtIndex(
        trainBars,
        validationBars,
        windowIndex,
        ORG0_OOS_BAR_COUNT,
      );
      expect(plan.inSampleDigest).toBe(fromParts);
    },
  );
});
