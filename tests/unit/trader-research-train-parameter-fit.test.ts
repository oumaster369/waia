import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { Bar } from "@/lib/trader/intelligence/types";
import { splitBarsThreeWay } from "@/lib/trader/market-data/research-dataset";
import {
  RESEARCH_TRAIN_FIT_FEE_BPS,
  RESEARCH_TRAIN_FIT_SLIPPAGE_BPS,
  RESEARCH_TRAIN_LOOKBACK_GRID,
  buildResearchEvaluationPlan,
  fitResearchParametersOnTrain,
  scoreLookbackOnBars,
} from "@/lib/trader/research/research-train-parameter-fit";
import { accountWalkForwardFromSingleEvaluation } from "@/lib/trader/research/walk-forward-engine";
import type {
  ResearchValidationMetrics,
  StrategyCandidate,
} from "@/lib/trader/research/strategy-candidate.types";

function bar(index: number, close: string, day = "2026-03-01", openPrice = close): Bar {
  const open = new Date(`${day}T00:00:00.000Z`);
  open.setUTCMinutes(index);
  const closeTime = new Date(open.getTime() + 60_000);
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: openPrice,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: open.toISOString(),
    barCloseTime: closeTime.toISOString(),
  };
}

function barsFromCloses(closes: readonly string[], day = "2026-03-01"): Bar[] {
  return closes.map((close, index) => bar(index, close, day));
}

const TRAIN_CLOSES = ["90", "90", "90", "90", "90", "100", "100", "100", "100", "110", "90", "110"];

describe("research train parameter fit", () => {
  it("fits only on train, scores validation once, and keeps 20 bps fee plus 15 bps slippage", () => {
    const train = barsFromCloses(TRAIN_CLOSES, "2026-03-01");
    const validationACloses = [
      "100",
      "101",
      "100",
      "101",
      "100",
      "101",
      "100",
      "101",
      "100",
      "101",
      "100",
      "101",
    ];
    const validationBCloses = [
      "80",
      "120",
      "80",
      "120",
      "80",
      "120",
      "80",
      "120",
      "80",
      "120",
      "70",
      "130",
    ];
    // Open differs from close so the next-bar entry is not a pure cost drag.
    const validationA = validationACloses.map((close, index) =>
      bar(index, close, "2026-03-02", String(Number(close) - 1)),
    );
    const validationB = validationBCloses.map((close, index) =>
      bar(index, close, "2026-03-03", String(Number(close) + 5)),
    );
    const trainFit = fitResearchParametersOnTrain(train);
    const planA = buildResearchEvaluationPlan({ trainBars: train, validationBars: validationA });
    const planB = buildResearchEvaluationPlan({ trainBars: train, validationBars: validationB });

    expect(RESEARCH_TRAIN_LOOKBACK_GRID).toEqual([5, 8, 10]);
    expect(trainFit.selectedLookback).toBe(5);
    expect(trainFit.tradeCount).toBeGreaterThan(0);
    expect(planA.fit).toEqual(trainFit);
    expect(planB.fit).toEqual(trainFit);
    expect(planA.validation.lookback).toBe(trainFit.selectedLookback);
    expect(planA.validation.evaluations).toBe(1);
    expect(planA.validationEvaluations).toBe(1);
    expect(planB.validationEvaluations).toBe(1);
    expect(planA.walkForwardRescore).toBe(false);
    expect(planA.chronological).toBe(true);
    expect(planA.fit.feeBps).toBe(RESEARCH_TRAIN_FIT_FEE_BPS);
    expect(planA.fit.slippageBps).toBe(RESEARCH_TRAIN_FIT_SLIPPAGE_BPS);
    expect(planA.fit.feeBps).toBe("20");
    expect(planA.fit.slippageBps).toBe("15");
    expect(planA.validation.validationNet).not.toBe(planB.validation.validationNet);
  });

  it("keeps the chronological 60/20/20 split and refuses a train that does not precede validation", () => {
    const bars = Array.from({ length: 100 }, (_, index) => bar(index, "100", "2026-04-01"));
    const splits = splitBarsThreeWay(bars);
    expect(splits.train).toHaveLength(60);
    expect(splits.validation).toHaveLength(20);
    expect(splits.blind).toHaveLength(20);
    const lastTrainOpen = splits.train.at(-1)?.barOpenTime;
    const firstValidationOpen = splits.validation[0]?.barOpenTime;
    const lastValidationOpen = splits.validation.at(-1)?.barOpenTime;
    const firstBlindOpen = splits.blind[0]?.barOpenTime;
    expect(
      lastTrainOpen !== undefined &&
        firstValidationOpen !== undefined &&
        lastTrainOpen <= firstValidationOpen,
    ).toBe(true);
    expect(
      lastValidationOpen !== undefined &&
        firstBlindOpen !== undefined &&
        lastValidationOpen <= firstBlindOpen,
    ).toBe(true);

    const plan = buildResearchEvaluationPlan({
      trainBars: splits.train,
      validationBars: splits.validation,
    });
    expect(plan.validationEvaluations).toBe(1);
    expect(plan.chronological).toBe(true);

    expect(() =>
      buildResearchEvaluationPlan({
        trainBars: splits.validation,
        validationBars: splits.train,
      }),
    ).toThrow(/chronological order/);
  });

  it("does not let a later bar enter the signal window of an earlier bar", () => {
    const calm = barsFromCloses(Array.from({ length: 20 }, () => "100"));
    const withFutureSpike = [...calm, bar(20, "100000", "2026-03-01")];
    expect(scoreLookbackOnBars(calm, 5)).toEqual({ net: 0, tradeCount: 0 });
    expect(scoreLookbackOnBars(withFutureSpike, 5)).toEqual({ net: 0, tradeCount: 0 });
    expect(scoreLookbackOnBars(withFutureSpike, 10).tradeCount).toBe(0);
  });

  it("accounts walk-forward from the single validation evaluation without a second backtest", async () => {
    const train = barsFromCloses(TRAIN_CLOSES);
    const validation = Array.from({ length: 4 }, (_, index) => bar(index, "100", "2026-03-02"));
    const singleEvaluation: ResearchValidationMetrics = {
      schemaVersion: "1.0.0",
      tradeCount: 4,
      periodRealizedPnl: "1.5",
      periodTotalFees: "0.2",
      byRegime: [
        { regimeLabel: "RANGE", tradeCount: 4, periodRealizedPnl: "1.5", periodTotalFees: "0.2" },
      ],
    };
    const insertWalkForwardWindow = vi.fn().mockResolvedValue(undefined);
    const updateStrategyCandidateStatus = vi.fn().mockResolvedValue(undefined);
    const candidate: StrategyCandidate = {
      id: "cand-fit",
      organizationId: "org-fit",
      strategyId: "mean_reversion_research",
      strategyVersion: "1.0.0",
      hypothesisId: null,
      trialId: null,
      status: "backtested",
      paramsJson: "{}",
      blindUsed: false,
      createdAt: new Date("2026-03-02T00:00:00.000Z"),
      updatedAt: new Date("2026-03-02T00:00:00.000Z"),
    };

    const result = await accountWalkForwardFromSingleEvaluation({
      context: { organizationId: "org-fit" },
      candidate,
      trainBars: train,
      validationBars: validation,
      oosBarCount: 2,
      singleEvaluation,
      repository: { insertWalkForwardWindow, updateStrategyCandidateStatus },
      newId: () => "window-id",
    });

    expect(result.windows).toHaveLength(2);
    expect(result.windows[0]?.metrics).toEqual(singleEvaluation);
    expect(result.windows[1]?.metrics).toMatchObject({
      tradeCount: 0,
      periodRealizedPnl: "0",
      byRegime: [],
    });
    expect(insertWalkForwardWindow).toHaveBeenCalledTimes(2);
    expect(updateStrategyCandidateStatus).toHaveBeenCalledWith(
      { organizationId: "org-fit" },
      "cand-fit",
      "walk_forward_validated",
    );

    const orchestrator = readFileSync(
      resolve(process.cwd(), "lib/trader/research/research-orchestrator.ts"),
      "utf8",
    );
    expect(orchestrator).not.toContain("runWalkForwardValidation");
    expect(orchestrator).toContain("accountWalkForwardFromSingleEvaluation");
    const validationCalls = orchestrator.match(/runIsolatedResearchBacktest\(/g) ?? [];
    expect(validationCalls).toHaveLength(2);
  });
});
