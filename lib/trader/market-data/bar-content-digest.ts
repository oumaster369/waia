import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { Bar } from "@/lib/trader/intelligence/types";

export type BarContentDigestInput = {
  symbol: string;
  interval: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  barOpenTime: string;
  barCloseTime: string;
};

export function barToContentDigestInput(bar: Bar): BarContentDigestInput {
  return {
    symbol: bar.symbol,
    interval: bar.interval,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    barOpenTime: bar.barOpenTime,
    barCloseTime: bar.barCloseTime,
  };
}

/** Deterministic content digest for OHLCV bar deduplication. */
export function computeBarContentDigest(bar: Bar): string {
  return computeStableJsonDigest(barToContentDigestInput(bar));
}
