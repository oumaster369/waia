import {
  compareDecimal,
  formatDecimal,
  multiplyDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";
import { EPISTEMIC_LOG_LOSS_EPSILON } from "@/lib/trader/intelligence/epistemic/epistemic-scoring-contract";
import {
  formatEpistemicScore,
  validateProbabilityDomain,
} from "@/lib/trader/intelligence/calibration/brier-score";
import { addDecimal, divideDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";

function clipProbability(probability: string): string {
  const epsilon = Number(EPISTEMIC_LOG_LOSS_EPSILON);
  const p = Number(probability);
  if (!Number.isFinite(p)) {
    throw new Error("INVALID_PROBABILITY");
  }
  const clipped = Math.min(1 - epsilon, Math.max(epsilon, p));
  return clipped.toFixed(8).replace(/\.?0+$/, "") || "0";
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
