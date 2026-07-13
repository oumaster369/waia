import type { Bar, BarInterval } from "@/lib/trader/intelligence/types";
import { floorToInterval, INTERVAL_MS } from "@/lib/trader/market-data/mtf/replay-mtf-resampler";

export type BucketAccumulator = Readonly<{
  bucketKey: number;
  symbol: string;
  open: string;
  high: number;
  low: number;
  close: string;
  volume: number;
  barOpenTime: string;
  barCloseTime: string;
}>;

export function createBucketAccumulator(firstBar: Bar, interval: BarInterval): BucketAccumulator {
  const bucketKey = floorToInterval(Date.parse(firstBar.barOpenTime), INTERVAL_MS[interval]);
  return {
    bucketKey,
    symbol: firstBar.symbol,
    open: firstBar.open,
    high: Number(firstBar.high),
    low: Number(firstBar.low),
    close: firstBar.close,
    volume: Number(firstBar.volume),
    barOpenTime: firstBar.barOpenTime,
    barCloseTime: firstBar.barCloseTime,
  };
}

export function appendBarToBucket(acc: BucketAccumulator, bar: Bar): BucketAccumulator {
  return {
    ...acc,
    high: Math.max(acc.high, Number(bar.high)),
    low: Math.min(acc.low, Number(bar.low)),
    close: bar.close,
    volume: acc.volume + Number(bar.volume),
    barCloseTime: bar.barCloseTime,
  };
}

export function finalizeBucket(acc: BucketAccumulator, interval: BarInterval): Bar {
  return {
    symbol: acc.symbol,
    interval,
    open: acc.open,
    high: String(acc.high),
    low: String(acc.low),
    close: acc.close,
    volume: String(acc.volume),
    barOpenTime: acc.barOpenTime,
    barCloseTime: acc.barCloseTime,
  };
}
