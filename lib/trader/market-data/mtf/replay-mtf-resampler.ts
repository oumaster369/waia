import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { MTF_BAR_INTERVALS } from "@/lib/trader/market-data/observation-types";

const INTERVAL_MS: Record<BarInterval, number> = {
  "1m": 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

function floorToInterval(timestampMs: number, intervalMs: number): number {
  return Math.floor(timestampMs / intervalMs) * intervalMs;
}

function aggregateBucket(bucket: Bar[], interval: BarInterval): Bar {
  const first = bucket[0]!;
  const last = bucket.at(-1)!;
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  let volume = 0;

  for (const bar of bucket) {
    high = Math.max(high, Number(bar.high));
    low = Math.min(low, Number(bar.low));
    volume += Number(bar.volume);
  }

  return {
    symbol: first.symbol,
    interval,
    open: first.open,
    high: String(high),
    low: String(low),
    close: last.close,
    volume: String(volume),
    barOpenTime: first.barOpenTime,
    barCloseTime: last.barCloseTime,
  };
}

/**
 * Deterministically resample expanding 1m replay window into higher TF bars.
 */
export function resampleReplayMtfBars(input: {
  bars1m: readonly Bar[];
}): Partial<Record<BarInterval, Bar[]>> {
  const result: Partial<Record<BarInterval, Bar[]>> = {
    "1m": [...input.bars1m],
  };

  if (input.bars1m.length === 0) {
    return result;
  }

  for (const interval of MTF_BAR_INTERVALS) {
    if (interval === "1m") {
      continue;
    }
    const intervalMs = INTERVAL_MS[interval];
    const buckets = new Map<number, Bar[]>();

    for (const bar of input.bars1m) {
      const bucketKey = floorToInterval(Date.parse(bar.barOpenTime), intervalMs);
      const existing = buckets.get(bucketKey) ?? [];
      existing.push(bar);
      buckets.set(bucketKey, existing);
    }

    const aggregated = [...buckets.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, bucket]) => aggregateBucket(bucket, interval));

    if (aggregated.length > 0) {
      result[interval] = aggregated;
    }
  }

  return result;
}
