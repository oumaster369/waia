import type { FeatureSnapshot } from "@/lib/trader/intelligence/types";

/** Backtest/live parity contract version (DEE-199). */
export const FEATURE_ENGINE_PARITY_CONTRACT_VERSION = "1.0.0" as const;

export type FeatureParityMismatch = {
  field: string;
  live: unknown;
  backtest: unknown;
};

/**
 * Asserts two feature snapshots from the same inputs are identical (live/backtest parity).
 */
export function findFeatureParityMismatches(
  live: FeatureSnapshot,
  backtest: FeatureSnapshot,
): FeatureParityMismatch[] {
  const mismatches: FeatureParityMismatch[] = [];

  const compare = (field: string, a: unknown, b: unknown) => {
    if (a !== b) {
      mismatches.push({ field, live: a, backtest: b });
    }
  };

  compare("featureSetId", live.featureSetId, backtest.featureSetId);
  compare("instrumentId", live.instrumentId, backtest.instrumentId);
  compare("evaluatedAt", live.evaluatedAt, backtest.evaluatedAt);
  compare("dataQualityScore", live.dataQualityScore, backtest.dataQualityScore);
  compare("features.close", live.features.close, backtest.features.close);
  compare("features.sma20", live.features.sma20, backtest.features.sma20);
  compare("features.zscoreVsSma20", live.features.zscoreVsSma20, backtest.features.zscoreVsSma20);
  compare("features.realizedVol20", live.features.realizedVol20, backtest.features.realizedVol20);
  compare("features.spreadBps", live.features.spreadBps, backtest.features.spreadBps);
  compare("inputs.barCount", live.inputs.barCount, backtest.inputs.barCount);
  compare(
    "inputs.latestQuoteAgeMs",
    live.inputs.latestQuoteAgeMs,
    backtest.inputs.latestQuoteAgeMs,
  );

  return mismatches;
}

export function assertFeatureParity(live: FeatureSnapshot, backtest: FeatureSnapshot): void {
  const mismatches = findFeatureParityMismatches(live, backtest);
  if (mismatches.length > 0) {
    const detail = mismatches.map(
      (m) => `${m.field}: live=${String(m.live)} backtest=${String(m.backtest)}`,
    );
    throw new Error(`[trader/intelligence] feature parity violation: ${detail.join("; ")}`);
  }
}
