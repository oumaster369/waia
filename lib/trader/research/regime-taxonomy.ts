import type { Regime } from "@/lib/trader/intelligence/types";
import {
  DOWN_REGIME_LABELS,
  NON_TRENDING_REGIME_LABELS,
  evaluateMultiRegimeCoverage,
} from "@/lib/trader/research/regime-coverage";
import type { ResearchRegimeCoverage } from "@/lib/trader/research/research-evidence-export.types";

/**
 * Canonical regime vocabulary for Research Intelligence.
 *
 * All RI surfaces (backtest metrics, walk-forward, blind holdout, evidence export,
 * promotion gate) use CDE {@link Regime} labels — never parallel taxonomies.
 *
 * Mapping is identity: production `classifyRegime` output is the evidence label.
 */
export const CANONICAL_RESEARCH_REGIME_LABELS = [
  "TREND_BULL",
  "TREND_BEAR",
  "RANGE",
  "CHOP",
  "STRESS",
] as const satisfies readonly Regime[];

export type CanonicalResearchRegimeLabel = (typeof CANONICAL_RESEARCH_REGIME_LABELS)[number];

export function isCanonicalResearchRegimeLabel(value: string): value is Regime {
  return (CANONICAL_RESEARCH_REGIME_LABELS as readonly string[]).includes(value);
}

export function buildResearchRegimeCoverage(
  regimeLabels: readonly string[],
): ResearchRegimeCoverage {
  const unique = [...new Set(regimeLabels.filter(isCanonicalResearchRegimeLabel))].sort((a, b) =>
    a.localeCompare(b),
  );
  const report = evaluateMultiRegimeCoverage(unique);

  let nonTrendingCount = 0;
  let downRegimeCount = 0;
  for (const label of unique) {
    if ((NON_TRENDING_REGIME_LABELS as readonly string[]).includes(label)) {
      nonTrendingCount += 1;
    }
    if ((DOWN_REGIME_LABELS as readonly string[]).includes(label)) {
      downRegimeCount += 1;
    }
  }

  return {
    regimes: unique,
    nonTrendingCount,
    downRegimeCount,
    satisfiesRequirement: report.satisfiesRequirement,
  };
}

export function hasSufficientCanonicalRegimeCoverage(coverage: ResearchRegimeCoverage): boolean {
  return coverage.satisfiesRequirement;
}
