import { ENERGY_MC_VERSION } from "@/lib/trader/intelligence/forecast-v2/constants";
import { normalCdfCody715V1 } from "./cdf-erf-cody715-v1";
import { studentT5CdfBetaincV1, studentT5BaselineScaleV1 } from "./student-t5-cdf-betainc-v1";

export { ENERGY_MC_VERSION };

export type BaselineForecast = {
  baselineId: string;
  logScore: (observed: number, context: BaselineContext) => number;
};

export type BaselineContext = {
  history: readonly number[];
  sigmaDev?: number;
};

function gaussianLogScore(observed: number, mu: number, sigma: number): number {
  const z = (observed - mu) / sigma;
  return -0.5 * Math.log(2 * Math.PI) - Math.log(sigma) - 0.5 * z * z;
}

function populationStdDev(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Frozen terminal baselines (§WP-RESEARCH-HARNESS). */
export const MANDATORY_BASELINES_V1: readonly BaselineForecast[] = [
  {
    baselineId: "climatology/v1",
    logScore: (observed, ctx) => {
      const mu = ctx.history.length
        ? ctx.history.reduce((a, b) => a + b, 0) / ctx.history.length
        : 0;
      const sigma = Math.max(populationStdDev(ctx.history), 1e-8);
      return gaussianLogScore(observed, mu, sigma);
    },
  },
  {
    baselineId: "gaussian-pop-std/v1",
    logScore: (observed, ctx) => {
      const sigma = Math.max(populationStdDev(ctx.history), 1e-8);
      return gaussianLogScore(observed, 0, sigma);
    },
  },
  {
    baselineId: "student-t5-nu5/v1",
    logScore: (observed, ctx) => {
      const sigma = Math.max(populationStdDev(ctx.history), 1e-8);
      const s = studentT5BaselineScaleV1(sigma);
      const density = approximateStudentT5Pdf(observed / s, s);
      return Math.log(Math.max(density, 1e-300));
    },
  },
  {
    baselineId: "rolling-w2000/v1",
    logScore: (observed, ctx) => {
      const window = ctx.history.slice(-2000);
      const mu = window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0;
      const sigma = Math.max(populationStdDev(window), 1e-8);
      return gaussianLogScore(observed, mu, sigma);
    },
  },
  {
    baselineId: "ewma-lambda094/v1",
    logScore: (observed, ctx) => {
      const lambda = 0.94;
      const warmup = 2000;
      const hist = ctx.history.slice(-Math.max(warmup, 1));
      if (hist.length === 0) {
        return gaussianLogScore(observed, 0, 1e-8);
      }
      let mean = hist[0]!;
      let varEwma = 1e-8;
      for (let i = 1; i < hist.length; i += 1) {
        const diff = hist[i]! - mean;
        mean = lambda * mean + (1 - lambda) * hist[i]!;
        varEwma = lambda * varEwma + (1 - lambda) * diff * diff;
      }
      const sigma = Math.max(Math.sqrt(varEwma), 1e-8);
      return gaussianLogScore(observed, mean, sigma);
    },
  },
];

function approximateStudentT5Pdf(x: number, s: number): number {
  const z = x / s;
  const nu = 5;
  const coef =
    Math.exp(
      logGamma((nu + 1) / 2) - logGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI) - Math.log(s),
    ) *
    (1 + (z * z) / nu) ** (-(nu + 1) / 2);
  return coef;
}

function logGamma(z: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  z -= 1;
  let x = coef[0]!;
  for (let i = 1; i < g + 2; i += 1) {
    x += coef[i]! / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function beatAllMandatoryBaselinesV1(
  challengerLogScore: number,
  observed: number,
  context: BaselineContext,
): boolean {
  return MANDATORY_BASELINES_V1.every(
    (baseline) => challengerLogScore > baseline.logScore(observed, context),
  );
}

export function gaussianCdfBaselineV1(z: number, sigma: number): number {
  return normalCdfCody715V1(z / Math.max(sigma, 1e-8));
}
