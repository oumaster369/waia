export const HOLM_FWER_VERSION = "holm-fwer/v1" as const;

export type HolmComparison = {
  comparisonId: string;
  pValue: number;
};

export type HolmResult = {
  comparisonId: string;
  pValue: number;
  rank: number;
  criticalValue: number;
  rejected: boolean;
};

/**
 * Holm step-down FWER control at alpha (default 0.05).
 * Rank is 1-based ascending p-value order; rank MUST NOT seed RNG upstream.
 */
export function holmFwerV1(comparisons: readonly HolmComparison[], alpha = 0.05): HolmResult[] {
  if (alpha <= 0 || alpha >= 1) {
    throw new Error(`[holm] alpha must be in (0,1): ${alpha}`);
  }
  const m = comparisons.length;
  if (m === 0) {
    return [];
  }

  const sorted = [...comparisons]
    .map((c, originalIndex) => ({ ...c, originalIndex }))
    .sort((a, b) => {
      if (a.pValue !== b.pValue) {
        return a.pValue - b.pValue;
      }
      return a.comparisonId.localeCompare(b.comparisonId);
    });

  const results: HolmResult[] = new Array(m);
  let stop = false;

  for (let i = 0; i < m; i += 1) {
    const rank = i + 1;
    const critical = alpha / (m - i);
    const rejected = !stop && sorted[i]!.pValue <= critical;
    if (!rejected) {
      stop = true;
    }
    results[sorted[i]!.originalIndex] = {
      comparisonId: sorted[i]!.comparisonId,
      pValue: sorted[i]!.pValue,
      rank,
      criticalValue: critical,
      rejected,
    };
  }

  return results;
}

export function holmFamilyPassV1(comparisons: readonly HolmComparison[], alpha = 0.05): boolean {
  return holmFwerV1(comparisons, alpha).every((r) => r.rejected);
}
