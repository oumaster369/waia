import { bucketIndexForReturn, type TerminalTargetGrid } from "./target-grid-ceremony-v1";

/** DEE-992 Human-ratified 2026-09-12; never selected by a caller or HTTP input. */
export const TERMINAL_SCORING_CONTRACT = "multiclass-brier-reward/v1" as const;
export const TERMINAL_SCORING_METRIC = "terminal-multiclass-brier-reward/v1" as const;
export const TERMINAL_SCORING_AMENDMENT_DIGEST =
  "694d625c2120d3e5410a7395646bd0bae728ea08e08fc8ea93043061cdb8d8de" as const;

export function assertTerminalDevelopmentReturnsV2(values: readonly number[]): void {
  if (!Array.isArray(values) || values.length === 0) throw new Error("TERMINAL_SCORE_INVALID_DEVELOPMENT");
  for (let i = 0; i < values.length; i++) {
    const entry = Object.getOwnPropertyDescriptor(values, String(i));
    if (!entry || !("value" in entry) || typeof entry.value !== "number" || !Number.isFinite(entry.value))
      throw new Error("TERMINAL_SCORE_INVALID_DEVELOPMENT");
  }
}

export function assertTerminalProbabilityVectorV2(p: readonly number[]): void {
  if (!Array.isArray(p) || p.length !== 7) throw new Error("TERMINAL_SCORE_INVALID_PROBABILITIES");
  let sum = 0;
  for (let j = 0; j < 7; j++) {
    const entry = Object.getOwnPropertyDescriptor(p, String(j));
    if (!entry || !("value" in entry) || typeof entry.value !== "number" ||
        !Number.isFinite(entry.value) || entry.value < 0 || entry.value > 1)
      throw new Error("TERMINAL_SCORE_INVALID_PROBABILITIES");
    sum += entry.value;
  }
  if (Math.abs(sum - 1) > 1e-12) throw new Error("TERMINAL_SCORE_INVALID_PROBABILITIES");
}

/** Reward, not loss: larger is better. No renormalization or probability floor. */
export function multiclassBrierRewardV1(observed: number, p: readonly number[], grid: TerminalTargetGrid): number {
  assertTerminalProbabilityVectorV2(p);
  if (!Number.isFinite(observed) || grid.bucketCount !== 7 || !Array.isArray(grid.edges) || grid.edges.length !== 6)
    throw new Error("TERMINAL_SCORE_INVALID_TARGET");
  for (let j = 0; j < 6; j++) {
    if (!Object.hasOwn(grid.edges, j) || !Number.isFinite(grid.edges[j]) ||
        (j > 0 && grid.edges[j]! < grid.edges[j - 1]!)) throw new Error("TERMINAL_SCORE_INVALID_TARGET");
  }
  const outcome = bucketIndexForReturn(observed, grid);
  let loss = 0;
  for (let j = 0; j < 7; j++) loss += (p[j]! - (j === outcome ? 1 : 0)) ** 2;
  return loss === 0 ? 0 : -loss;
}
