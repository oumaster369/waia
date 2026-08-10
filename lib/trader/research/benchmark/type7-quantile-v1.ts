/** Hyndman–Fan type-7 empirical quantile (`type7-quantile/v1`). */
export const TYPE7_QUANTILE_VERSION = "type7-quantile/v1" as const;

export class Type7QuantileDomainError extends Error {
  readonly code = "TYPE7_QUANTILE_DOMAIN_ERROR" as const;

  constructor(message: string) {
    super(message);
    this.name = "Type7QuantileDomainError";
  }
}

/**
 * R-compatible Hyndman–Fan type 7: m = (n-1)*p, j = floor(m)+1, g = m - floor(m).
 */
export function type7QuantileV1(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) {
    throw new Type7QuantileDomainError("empty sample");
  }
  if (!Number.isFinite(p)) {
    throw new Type7QuantileDomainError(`non-finite p: ${p}`);
  }
  if (p <= 0) {
    return sortedAsc[0]!;
  }
  if (p >= 1) {
    return sortedAsc[n - 1]!;
  }
  const m = (n - 1) * p;
  const j = Math.floor(m) + 1;
  const g = m - Math.floor(m);
  const lower = sortedAsc[Math.max(0, j - 1)]!;
  const upper = sortedAsc[Math.min(n - 1, j)]!;
  return (1 - g) * lower + g * upper;
}

export function type7QuantileFromUnsorted(values: readonly number[], p: number): number {
  return type7QuantileV1(
    [...values].sort((a, b) => a - b),
    p,
  );
}

export function type7TertileEdgesV1(values: readonly number[]): { q1: number; q2: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = type7QuantileV1(sorted, 1 / 3);
  const q2 = type7QuantileV1(sorted, 2 / 3);
  if (!(q1 < q2)) {
    throw new Type7QuantileDomainError(`degenerate tertile edges q1=${q1} q2=${q2}`);
  }
  return { q1, q2 };
}
