import { formatDecimal, multiplyDecimal, parseDecimal } from "@/lib/trader/risk/numeric";
import {
  formatEpistemicScore,
  validateProbabilityDomain,
} from "@/lib/trader/intelligence/calibration/brier-score";
import { addDecimal, divideDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

function clipProbability(probability: string): string {
  const p = Number(probability);
  const epsilon = 1e-12;
  if (!Number.isFinite(p)) {
    return probability;
  }
  if (p < epsilon) {
    return String(epsilon);
  }
  const ceiling = 1 - epsilon;
  if (p > ceiling) {
    return String(ceiling);
  }
  return probability;
}

function naturalLogApprox(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return "0";
  }
  return formatDecimal(parseDecimal(Number(Math.log(n)).toFixed(8)));
}

export function computeLogLoss(probability: string, outcomeEncoding: "1" | "0"): string {
  if (!validateProbabilityDomain(probability)) {
    throw new Error("INVALID_PROBABILITY");
  }
  const clipped = clipProbability(probability);
  const loss =
    outcomeEncoding === "1"
      ? multiplyDecimal("-1", naturalLogApprox(clipped))
      : multiplyDecimal("-1", naturalLogApprox(subtractDecimal("1", clipped)));
  return formatEpistemicScore(loss);
}

export function meanLogLossScores(scores: readonly string[]): string | null {
  if (scores.length === 0) {
    return null;
  }
  const sum = scores.reduce((acc, score) => addDecimal(acc, score), "0");
  return formatEpistemicScore(divideDecimal(sum, String(scores.length)));
}
