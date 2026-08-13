import { type7QuantileFromUnsorted } from "./type7-quantile-v1";

export const TARGET_GRID_CEREMONY_VERSION = "target-grid-ceremony/v1" as const;
export const TERMINAL_BUCKET_COUNT = 7 as const;

/** Frozen DEVELOPMENT quantile grid → 7 Terminal buckets (Gate-D ceremony). */
export const TERMINAL_GRID_QUANTILES = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95] as const;

export type TerminalBucketTailSemantics = "LOWER_TAIL" | "INTERIOR" | "UPPER_TAIL";

export type TerminalTargetGrid = {
  edges: readonly number[];
  bucketCount: typeof TERMINAL_BUCKET_COUNT;
};

/**
 * Canonical target-bucket row semantics for the Human-ratified 7-bucket grid.
 * lower_bound NULL => −∞ (LOWER_TAIL); upper_bound NULL => +∞ (UPPER_TAIL).
 */
export type TerminalTargetBucketDefinitionV1 = {
  bucketOrdinal: number;
  tailSemantics: TerminalBucketTailSemantics;
  /** null only for LOWER_TAIL (−∞). */
  lowerBound: number | null;
  /** null only for UPPER_TAIL (+∞). */
  upperBound: number | null;
};

export function computeTerminalTargetGridFromDevelopmentReturns(
  developmentReturns: readonly number[],
): TerminalTargetGrid {
  if (developmentReturns.length < 2) {
    throw new Error("[target-grid] insufficient DEVELOPMENT returns for grid ceremony");
  }
  const edges = TERMINAL_GRID_QUANTILES.map((p) =>
    type7QuantileFromUnsorted([...developmentReturns], p),
  );
  return { edges, bucketCount: TERMINAL_BUCKET_COUNT };
}

/**
 * Expand ceremony edges into exactly 7 canonical bucket definitions with open tails.
 */
export function terminalTargetBucketDefinitionsFromGrid(
  grid: TerminalTargetGrid,
): TerminalTargetBucketDefinitionV1[] {
  if (grid.bucketCount !== TERMINAL_BUCKET_COUNT || grid.edges.length !== 6) {
    throw new Error("[target-grid] Terminal grid must be exactly 7 buckets (6 edges)");
  }
  const rows: TerminalTargetBucketDefinitionV1[] = [];
  for (let ordinal = 0; ordinal < TERMINAL_BUCKET_COUNT; ordinal += 1) {
    if (ordinal === 0) {
      rows.push({
        bucketOrdinal: 0,
        tailSemantics: "LOWER_TAIL",
        lowerBound: null,
        upperBound: grid.edges[0]!,
      });
    } else if (ordinal === TERMINAL_BUCKET_COUNT - 1) {
      rows.push({
        bucketOrdinal: TERMINAL_BUCKET_COUNT - 1,
        tailSemantics: "UPPER_TAIL",
        lowerBound: grid.edges[grid.edges.length - 1]!,
        upperBound: null,
      });
    } else {
      rows.push({
        bucketOrdinal: ordinal,
        tailSemantics: "INTERIOR",
        lowerBound: grid.edges[ordinal - 1]!,
        upperBound: grid.edges[ordinal]!,
      });
    }
  }
  return rows;
}

/**
 * Deterministic boundary inclusion (pinned by ceremony source truth):
 * LOWER_TAIL / interior left-closed via `y <= edge` scan; UPPER_TAIL is remainder.
 * Every finite sample maps to exactly one of seven buckets.
 */
export function bucketIndexForReturn(returnValue: number, grid: TerminalTargetGrid): number {
  let bucket = 0;
  for (const edge of grid.edges) {
    if (returnValue <= edge) {
      return bucket;
    }
    bucket += 1;
  }
  return TERMINAL_BUCKET_COUNT - 1;
}

export function empiricalBucketProbabilities(
  returns: readonly number[],
  grid: TerminalTargetGrid,
): number[] {
  const counts = new Array<number>(TERMINAL_BUCKET_COUNT).fill(0);
  for (const value of returns) {
    counts[bucketIndexForReturn(value, grid)]! += 1;
  }
  const total = returns.length;
  if (total === 0) {
    throw new Error("[target-grid] empty return sample");
  }
  return counts.map((c) => c / total);
}

export function multiclassLogScore(
  observed: number,
  probabilities: readonly number[],
  grid: TerminalTargetGrid,
): number {
  const idx = bucketIndexForReturn(observed, grid);
  const p = probabilities[idx];
  if (p === undefined || p <= 0 || !Number.isFinite(p)) {
    return Number.NEGATIVE_INFINITY;
  }
  return Math.log(p);
}

export function populationStdDevN(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
