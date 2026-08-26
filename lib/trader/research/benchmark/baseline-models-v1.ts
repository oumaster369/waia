import { ENERGY_MC_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { normalCdfCody715V1 } from "./cdf-erf-cody715-v1";
import { studentT5BaselineScaleV1, studentT5CdfBetaincV1 } from "./student-t5-cdf-betainc-v1";
import {
  computeTerminalTargetGridFromDevelopmentReturns,
  empiricalBucketProbabilities,
  multiclassLogScore,
  populationStdDevN,
  type TerminalTargetGrid,
} from "./target-grid-ceremony-v1";

export { ENERGY_MC_VERSION };

export type BaselineForecastResult =
  | {
      status: "AVAILABLE";
      probabilities: readonly number[];
      logScore: (observed: number) => number;
    }
  | { status: "UNAVAILABLE"; reason: string };

export type BaselineContext = {
  developmentReturns: readonly number[];
  grid: TerminalTargetGrid;
  history: readonly (number | null)[];
  historyMinuteOpenTimesMs?: readonly number[];
  primaryHorizonMinutes?: 30 | 60;
};

const ROLLING_WINDOW = 2000 as const;
const EWMA_LAMBDA = 0.94 as const;
const EWMA_WARMUP = 2000 as const;

function gaussianBucketProbabilities(grid: TerminalTargetGrid, sigma: number): number[] {
  const s = Math.max(sigma, 1e-12);
  const probs: number[] = [];
  let prevCdf = 0;
  for (let i = 0; i < grid.edges.length; i += 1) {
    const cdf = normalCdfCody715V1(grid.edges[i]! / s);
    probs.push(Math.max(0, cdf - prevCdf));
    prevCdf = cdf;
  }
  const tailCdf = normalCdfCody715V1(grid.edges[grid.edges.length - 1]! / s);
  probs.push(Math.max(0, 1 - tailCdf));
  return probs;
}

function studentT5BucketProbabilities(grid: TerminalTargetGrid, sigmaDev: number): number[] {
  const scale = studentT5BaselineScaleV1(Math.max(sigmaDev, 1e-12));
  const probs: number[] = [];
  let prevCdf = 0;
  for (const edge of grid.edges) {
    const cdf = studentT5CdfBetaincV1(edge, scale);
    probs.push(Math.max(0, cdf - prevCdf));
    prevCdf = cdf;
  }
  const tailCdf = studentT5CdfBetaincV1(grid.edges[grid.edges.length - 1]!, scale);
  probs.push(Math.max(0, 1 - tailCdf));
  return probs;
}

function developmentSampleVariance(returns: readonly number[]): number | null {
  if (returns.length < 2 || returns.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  return Number.isFinite(variance) && variance >= 0 ? variance : null;
}

export function computeEwmaVarianceReturnsV2(context: BaselineContext): number | null {
  const { history, historyMinuteOpenTimesMs, developmentReturns } = context;
  if (
    history.length < EWMA_WARMUP ||
    historyMinuteOpenTimesMs === undefined ||
    historyMinuteOpenTimesMs.length !== history.length
  ) {
    return null;
  }

  const series = history.slice(-EWMA_WARMUP);
  const minuteOpenTimesMs = historyMinuteOpenTimesMs.slice(-EWMA_WARMUP);
  const initialVariance = developmentSampleVariance(developmentReturns);
  if (initialVariance === null) {
    return null;
  }
  let varEwma: number = initialVariance;
  for (let i = 0; i < series.length; i += 1) {
    const value = series[i];
    const minuteOpenTimeMs = minuteOpenTimesMs[i];
    if (
      value === null ||
      !Number.isFinite(value) ||
      minuteOpenTimeMs === undefined ||
      !Number.isSafeInteger(minuteOpenTimeMs) ||
      (i > 0 && minuteOpenTimeMs - minuteOpenTimesMs[i - 1]! !== 60_000)
    ) {
      return null;
    }
    const nextVariance = EWMA_LAMBDA * varEwma + (1 - EWMA_LAMBDA) * value * value;
    if (!Number.isFinite(nextVariance) || nextVariance < 0) {
      return null;
    }
    varEwma = nextVariance;
  }
  return varEwma;
}

function makeAvailable(
  probabilities: readonly number[],
  grid: TerminalTargetGrid,
): BaselineForecastResult {
  return {
    status: "AVAILABLE",
    probabilities,
    logScore: (observed) => multiclassLogScore(observed, probabilities, grid),
  };
}

/** Frozen terminal baselines — multiclass log score over 7-bucket grid (§WP-RESEARCH-HARNESS). */
export const MANDATORY_BASELINE_IDS = [
  "climatology/v1",
  "gaussian-pop-std/v1",
  "student-t5-nu5/v1",
  "rolling-w2000/v1",
  "ewma-lambda094/v2",
] as const;

export function evaluateMandatoryBaselineV1(
  baselineId: (typeof MANDATORY_BASELINE_IDS)[number],
  context: BaselineContext,
): BaselineForecastResult {
  const { grid, developmentReturns, history } = context;
  const sigmaDev = populationStdDevN(developmentReturns);

  switch (baselineId) {
    case "climatology/v1":
      return makeAvailable(empiricalBucketProbabilities(developmentReturns, grid), grid);
    case "gaussian-pop-std/v1":
      return makeAvailable(gaussianBucketProbabilities(grid, sigmaDev), grid);
    case "student-t5-nu5/v1":
      return makeAvailable(studentT5BucketProbabilities(grid, sigmaDev), grid);
    case "rolling-w2000/v1": {
      const window = history.slice(-ROLLING_WINDOW);
      if (
        window.length < ROLLING_WINDOW ||
        window.some((value) => value === null || !Number.isFinite(value))
      ) {
        return { status: "UNAVAILABLE", reason: "ROLLING_WARMUP_INSUFFICIENT" };
      }
      return makeAvailable(empiricalBucketProbabilities(window as number[], grid), grid);
    }
    case "ewma-lambda094/v2": {
      const varEwma = computeEwmaVarianceReturnsV2(context);
      if (varEwma === null) {
        return { status: "UNAVAILABLE", reason: "EWMA_WARMUP_INSUFFICIENT" };
      }
      const h = context.primaryHorizonMinutes ?? 30;
      const sigma = Math.sqrt(varEwma) * Math.sqrt(h);
      return makeAvailable(gaussianBucketProbabilities(grid, sigma), grid);
    }
    default:
      return { status: "UNAVAILABLE", reason: "UNKNOWN_BASELINE" };
  }
}

export function beatAllMandatoryBaselinesV1(
  challengerLogScore: number,
  observed: number,
  context: BaselineContext,
): boolean {
  return MANDATORY_BASELINE_IDS.every((baselineId) => {
    const baseline = evaluateMandatoryBaselineV1(baselineId, context);
    if (baseline.status === "UNAVAILABLE") {
      return false;
    }
    return challengerLogScore > baseline.logScore(observed);
  });
}

export function buildBaselineContextFromDevelopment(input: {
  developmentReturns: readonly number[];
  history: readonly (number | null)[];
  historyMinuteOpenTimesMs?: readonly number[];
  primaryHorizonMinutes?: 30 | 60;
}): BaselineContext {
  return {
    developmentReturns: input.developmentReturns,
    history: input.history,
    historyMinuteOpenTimesMs: input.historyMinuteOpenTimesMs,
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    grid: computeTerminalTargetGridFromDevelopmentReturns(input.developmentReturns),
  };
}

/** @deprecated use evaluateMandatoryBaselineV1 */
export const MANDATORY_BASELINES_V1 = MANDATORY_BASELINE_IDS.map((baselineId) => ({
  baselineId,
  logScore: (observed: number, context: BaselineContext) => {
    const result = evaluateMandatoryBaselineV1(baselineId, context);
    if (result.status === "UNAVAILABLE") {
      return Number.NEGATIVE_INFINITY;
    }
    return result.logScore(observed);
  },
}));

export function gaussianCdfBaselineV1(z: number, sigma: number): number {
  return normalCdfCody715V1(z / Math.max(sigma, 1e-8));
}
