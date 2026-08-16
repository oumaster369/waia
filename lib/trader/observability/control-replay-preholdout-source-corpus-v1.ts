import { computeBarContentDigest } from "@/lib/trader/market-data/bar-content-digest";
import { buildCanonicalDevelopmentCorpusFromQualifiedBarsV1 } from "@/lib/trader/intelligence/forecast-v2/canonical-development-corpus-v1";
import type { QualifiedDevelopmentBarV1 } from "@/lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import type { Bar } from "@/lib/trader/intelligence/types";

export const CONTROL_REPLAY_OFFICIAL_MARKET_AUTHORITY = "OFFICIAL_PRE_HOLDOUT_REAL_DATA" as const;
export const CONTROL_REPLAY_TEST_ONLY_DETERMINISTIC_CORPUS =
  "TEST_ONLY_DETERMINISTIC_CORPUS" as const;

/**
 * Build PIT-valid Forecast V2 source anchors from qualified pre-holdout real bars.
 * TEST_ONLY Control Replay may use mapped HTX `vol` in the outcome volume slots without
 * claiming capital-authoritative volume qualification. Never synthesizes missing bars.
 */
export function buildControlReplaySourceAnchorsFromRealBars(input: {
  bars: readonly Bar[];
  venue?: string;
  market?: string;
  symbol: string;
  primaryHorizonMinutes?: 30 | 60;
}): readonly SourceAnchor[] {
  const barsByCloseEpochMs = new Map<number, QualifiedDevelopmentBarV1>();
  const rvByEpoch = new Map<number, number>();
  const candidateEpochs: number[] = [];
  for (let index = 0; index < input.bars.length; index += 1) {
    const bar = input.bars[index]!;
    const closedBarEpochMs = Date.parse(bar.barCloseTime);
    if (!Number.isFinite(closedBarEpochMs)) {
      continue;
    }
    const volume = Number(bar.volume);
    const close = Number(bar.close);
    if (!Number.isFinite(volume) || !Number.isFinite(close)) {
      continue;
    }
    barsByCloseEpochMs.set(closedBarEpochMs, {
      closedBarEpochMs,
      close,
      qualifiedBaseVolume: volume,
    });
    candidateEpochs.push(closedBarEpochMs);
    const window = input.bars.slice(Math.max(0, index - 20), index + 1);
    const snapshot = computeFeatureSnapshot({
      bars: window,
      quote: {
        symbol: bar.symbol,
        bid: bar.close,
        ask: bar.close,
        last: bar.close,
        timestamp: bar.barCloseTime,
      },
    });
    const rv = Number(snapshot.features.realizedVol20m_1m);
    if (Number.isFinite(rv)) {
      rvByEpoch.set(closedBarEpochMs, rv);
    }
  }
  const corpus = buildCanonicalDevelopmentCorpusFromQualifiedBarsV1({
    venue: input.venue ?? "htx",
    market: input.market ?? "spot",
    symbol: input.symbol,
    primaryHorizonMinutes: input.primaryHorizonMinutes ?? 30,
    barsByCloseEpochMs,
    candidateAnchorClosedBarEpochMs: candidateEpochs,
    realizedVol20m_1mByAnchorEpochMs: rvByEpoch,
  });
  return corpus.anchors.map((anchor) => {
    const bar = input.bars.find(
      (candidate) => Date.parse(candidate.barCloseTime) === anchor.closedBarEpochMs,
    );
    return {
      ...anchor,
      barContentDigest: bar ? computeBarContentDigest(bar) : anchor.barContentDigest,
    };
  });
}
