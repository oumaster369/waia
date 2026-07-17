import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";
import { EPISTEMIC_NUMERIC_PRECISION_DP } from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";

function roundHalfEven(value: string, dp: number): string {
  const factor = 10 ** dp;
  const num = Number(value);
  const scaled = num * factor;
  const floor = Math.floor(scaled);
  const fraction = scaled - floor;
  if (fraction > 0.5) {
    return ((floor + 1) / factor).toFixed(dp);
  }
  if (fraction < 0.5) {
    return (floor / factor).toFixed(dp);
  }
  const rounded = floor % 2 === 0 ? floor : floor + 1;
  return (rounded / factor).toFixed(dp);
}

export function formatEpistemicScore(value: string): string {
  return roundHalfEven(value, EPISTEMIC_NUMERIC_PRECISION_DP);
}

export function computeBrierScore(probability: string, outcomeEncoding: "1" | "0"): string {
  const y = outcomeEncoding === "1" ? "1" : "0";
  const error = subtractDecimal(probability, y);
  const squared = multiplyDecimal(error, error);
  return formatEpistemicScore(squared);
}

export function validateProbabilityDomain(probability: string): boolean {
  return compareDecimal(probability, "0") >= 0 && compareDecimal(probability, "1") <= 0;
}

export function meanBrierScores(scores: readonly string[]): string | null {
  if (scores.length === 0) {
    return null;
  }
  const sum = scores.reduce((acc, score) => addDecimal(acc, score), "0");
  return formatEpistemicScore(divideDecimal(sum, String(scores.length)));
}

export { formatDecimal, parseDecimal };
