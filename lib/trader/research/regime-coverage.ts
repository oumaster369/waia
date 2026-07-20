import { classifyRegime } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar, Regime } from "@/lib/trader/intelligence/types";
import type {
  ResearchRegimeMetricSliceV1,
  ResearchRegimeMetricSliceV2,
  ResearchValidationMetrics,
} from "@/lib/trader/research/strategy-candidate.types";
import { countAttributedRoundTrips } from "@/lib/trader/research/research-validation-metrics-taxonomy";
import { MultiRegimeCoverageError } from "@/lib/trader/research/errors";

/** Non-trending regimes per ADR-0010 / RI program (RANGE/CHOP). */
export const NON_TRENDING_REGIME_LABELS = ["RANGE", "CHOP"] as const satisfies readonly Regime[];

/** Down regimes per ADR-0010 / RI program (TREND_BEAR/STRESS). */
export const DOWN_REGIME_LABELS = ["TREND_BEAR", "STRESS"] as const satisfies readonly Regime[];

export type MultiRegimeCoverageReport = {
  regimeLabels: string[];
  hasNonTrending: boolean;
  hasDown: boolean;
  satisfiesRequirement: boolean;
};

export function classifyBarWindowRegime(bars: readonly Bar[]): Regime {
  if (bars.length < 20) {
    throw new Error("[research] classifyBarWindowRegime requires at least 20 bars");
  }
  const features = computeFeatureSnapshot({
    bars,
    evaluatedAt: bars.at(-1)!.barCloseTime,
  });
  return classifyRegime(features);
}

export function isResearchRegimeMetricSliceV2(
  slice: ResearchRegimeMetricSliceV1 | ResearchRegimeMetricSliceV2,
): slice is ResearchRegimeMetricSliceV2 {
  return "closedTrades" in slice;
}

/** Whether a regime slice has attributed round-trip activity for coverage gates. */
export function regimeSliceHasAttributedRoundTrips(
  slice: ResearchRegimeMetricSliceV1 | ResearchRegimeMetricSliceV2,
): boolean {
  if (isResearchRegimeMetricSliceV2(slice)) {
    return countAttributedRoundTrips(slice) > 0;
  }
  return slice.tradeCount > 0;
}

export function collectRegimeLabelsFromMetrics(
  metrics: readonly ResearchValidationMetrics[],
): string[] {
  const labels = new Set<string>();
  for (const entry of metrics) {
    for (const slice of entry.byRegime) {
      if (regimeSliceHasAttributedRoundTrips(slice)) {
        labels.add(slice.regimeLabel);
      }
    }
  }
  return [...labels].sort((a, b) => a.localeCompare(b));
}

export function evaluateMultiRegimeCoverage(
  regimeLabels: readonly string[],
): MultiRegimeCoverageReport {
  const labelSet = new Set(regimeLabels);
  const hasNonTrending = NON_TRENDING_REGIME_LABELS.some((label) => labelSet.has(label));
  const hasDown = DOWN_REGIME_LABELS.some((label) => labelSet.has(label));

  return {
    regimeLabels: [...regimeLabels],
    hasNonTrending,
    hasDown,
    satisfiesRequirement: hasNonTrending && hasDown,
  };
}

export function hasMultiRegimeCoverage(regimeLabels: readonly string[]): boolean {
  return evaluateMultiRegimeCoverage(regimeLabels).satisfiesRequirement;
}

export function assertMultiRegimeCoverage(regimeLabels: readonly string[]): void {
  const report = evaluateMultiRegimeCoverage(regimeLabels);
  if (report.satisfiesRequirement) {
    return;
  }

  const missing: string[] = [];
  if (!report.hasNonTrending) {
    missing.push(`non-trending (${NON_TRENDING_REGIME_LABELS.join("|")})`);
  }
  if (!report.hasDown) {
    missing.push(`down (${DOWN_REGIME_LABELS.join("|")})`);
  }

  throw new MultiRegimeCoverageError(
    `missing ${missing.join(" and ")} regime coverage (observed: ${report.regimeLabels.join(", ") || "none"})`,
  );
}

/** ADR-0010 bundle-level gate: validation + walk-forward + blind trade-attributed regimes. */
export function assertResearchPipelineRegimeCoverage(
  metrics: readonly ResearchValidationMetrics[],
): void {
  assertMultiRegimeCoverage(collectRegimeLabelsFromMetrics(metrics));
}
