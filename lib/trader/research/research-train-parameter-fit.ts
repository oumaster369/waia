import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import type { Bar } from "@/lib/trader/intelligence/types";
import { compareDecimal } from "@/lib/trader/risk/numeric";

/**
 * Pre-registered lookback grid for the research train fit (DEE-1152).
 * Selection uses only the chronological train partition. Validation is scored
 * once with the frozen choice. Costs stay the canonical 20 bps fee and 15 bps
 * slippage (`costModelV1FromAuthority`).
 */
export const RESEARCH_TRAIN_LOOKBACK_GRID = [5, 8, 10] as const;

export const RESEARCH_TRAIN_FIT_FEE_BPS = "20" as const;
export const RESEARCH_TRAIN_FIT_SLIPPAGE_BPS = "15" as const;

export type ResearchParameterFitV1 = Readonly<{
  selectedLookback: number;
  trainNet: string;
  tradeCount: number;
  feeBps: typeof RESEARCH_TRAIN_FIT_FEE_BPS;
  slippageBps: typeof RESEARCH_TRAIN_FIT_SLIPPAGE_BPS;
  grid: readonly number[];
}>;

export type FittedParameterValidationV1 = Readonly<{
  lookback: number;
  validationNet: string;
  tradeCount: number;
  evaluations: 1;
}>;

export type ResearchEvaluationPlanV1 = Readonly<{
  fit: ResearchParameterFitV1;
  validation: FittedParameterValidationV1;
  validationEvaluations: 1;
  walkForwardRescore: false;
  chronological: true;
}>;

function assertCanonicalResearchCosts(): { feeBps: number; slippageBps: number } {
  const cost = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());
  if (
    compareDecimal(cost.feesBps, RESEARCH_TRAIN_FIT_FEE_BPS) !== 0 ||
    compareDecimal(cost.slippageBps, RESEARCH_TRAIN_FIT_SLIPPAGE_BPS) !== 0
  ) {
    throw new Error(
      "[research] train fit refused: canonical cost model is no longer 20 bps fee and 15 bps slippage",
    );
  }
  return { feeBps: 20, slippageBps: 15 };
}

function parseClose(bar: Bar): number {
  const value = Number(bar.close);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("[research] train fit refused a non-positive close");
  }
  return value;
}

function roundTripNet(entry: number, exit: number, feeBps: number, slippageBps: number): number {
  const slip = slippageBps / 10_000;
  const fee = feeBps / 10_000;
  const entryPx = entry * (1 + slip);
  const exitPx = exit * (1 - slip);
  const pnl = exitPx - entryPx - entryPx * fee - exitPx * fee;
  return pnl / entryPx;
}

/**
 * Cost-adjusted mean-reversion score. The signal at bar i uses only closes
 * strictly before i. The exit is the next bar, which is inside the scored partition.
 */
export function scoreLookbackOnBars(
  bars: readonly Bar[],
  lookback: number,
): { net: number; tradeCount: number } {
  const { feeBps, slippageBps } = assertCanonicalResearchCosts();
  if (!Number.isInteger(lookback) || lookback < 2) {
    throw new Error("[research] lookback must be an integer >= 2");
  }
  if (bars.length < lookback + 2) {
    return { net: Number.NEGATIVE_INFINITY, tradeCount: 0 };
  }
  const closes = bars.map(parseClose);
  const opens = bars.map((row) => {
    const value = Number(row.open);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("[research] train fit refused a non-positive open");
    }
    return value;
  });
  let net = 0;
  let tradeCount = 0;
  for (let index = lookback; index < closes.length - 1; index += 1) {
    const window = closes.slice(index - lookback, index);
    const mean = window.reduce((sum, value) => sum + value, 0) / window.length;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / window.length;
    const deviation = Math.sqrt(variance);
    if (deviation === 0) {
      continue;
    }
    const z = (closes[index]! - mean) / deviation;
    if (z > -1) {
      continue;
    }
    // Signal is known at the close of `index`. Entry is the next bar's open.
    net += roundTripNet(opens[index + 1]!, closes[index + 1]!, feeBps, slippageBps);
    tradeCount += 1;
  }
  return { net, tradeCount };
}

function formatNet(net: number): string {
  if (!Number.isFinite(net)) {
    return "0";
  }
  return net.toFixed(8);
}

export function fitResearchParametersOnTrain(trainBars: readonly Bar[]): ResearchParameterFitV1 {
  const feasible = RESEARCH_TRAIN_LOOKBACK_GRID.filter(
    (lookback) => trainBars.length >= lookback + 2,
  );
  if (feasible.length === 0) {
    throw new Error(
      `[research] train partition cannot fit the pre-registered lookback grid (bars=${trainBars.length})`,
    );
  }
  let selectedLookback = feasible[0]!;
  let selected = scoreLookbackOnBars(trainBars, selectedLookback);
  for (const lookback of feasible.slice(1)) {
    const score = scoreLookbackOnBars(trainBars, lookback);
    const better =
      score.tradeCount > 0 && (selected.tradeCount === 0 || score.net > selected.net + 1e-12);
    if (better) {
      selectedLookback = lookback;
      selected = score;
    }
  }
  return {
    selectedLookback,
    trainNet: formatNet(selected.net === Number.NEGATIVE_INFINITY ? 0 : selected.net),
    tradeCount: selected.tradeCount === 0 ? 0 : selected.tradeCount,
    feeBps: RESEARCH_TRAIN_FIT_FEE_BPS,
    slippageBps: RESEARCH_TRAIN_FIT_SLIPPAGE_BPS,
    grid: RESEARCH_TRAIN_LOOKBACK_GRID,
  };
}

export function evaluateFittedParametersOnce(input: {
  bars: readonly Bar[];
  lookback: number;
}): FittedParameterValidationV1 {
  const score = scoreLookbackOnBars(input.bars, input.lookback);
  return {
    lookback: input.lookback,
    validationNet: formatNet(score.net === Number.NEGATIVE_INFINITY ? 0 : score.net),
    tradeCount: Number.isFinite(score.net) ? score.tradeCount : 0,
    evaluations: 1,
  };
}

/** Fit on train only, then score validation once. Does not rescore walk-forward slices. */
export function buildResearchEvaluationPlan(input: {
  trainBars: readonly Bar[];
  validationBars: readonly Bar[];
}): ResearchEvaluationPlanV1 {
  const lastTrain = input.trainBars.at(-1)?.barOpenTime;
  const firstValidation = input.validationBars[0]?.barOpenTime;
  if (
    input.trainBars.length < 1 ||
    input.validationBars.length < 1 ||
    lastTrain === undefined ||
    firstValidation === undefined ||
    lastTrain > firstValidation
  ) {
    throw new Error("[research] train must precede validation in chronological order");
  }
  const fit = fitResearchParametersOnTrain(input.trainBars);
  const validation = evaluateFittedParametersOnce({
    bars: input.validationBars,
    lookback: fit.selectedLookback,
  });
  return {
    fit,
    validation,
    validationEvaluations: 1,
    walkForwardRescore: false,
    chronological: true,
  };
}
