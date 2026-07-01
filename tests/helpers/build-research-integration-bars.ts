import type { Bar } from "@/lib/trader/intelligence/types";

/**
 * Synthetic OHLCV for research integration tests.
 * Produces ≥120 bars with flat (RANGE-friendly) and declining (TREND_BEAR) segments.
 */
export function buildResearchIntegrationBars(totalBars = 120): Bar[] {
  if (totalBars < 60) {
    throw new Error("research integration bars require at least 60 bars");
  }

  const baseTime = Date.parse("2026-01-01T00:00:00.000Z");
  const bars: Bar[] = [];

  for (let index = 0; index < totalBars; index += 1) {
    const segment = Math.floor(index / (totalBars / 3));
    let close: number;
    if (segment === 0) {
      close = 65000 + (index % 5) * 2;
    } else if (segment === 1) {
      close = 64000 - index * 8;
    } else {
      close = 62000 + (index % 7) * 15;
    }

    const closeStr = close.toFixed(2);
    const openTime = new Date(baseTime + index * 60_000).toISOString();
    const closeTime = new Date(baseTime + (index + 1) * 60_000).toISOString();

    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: closeStr,
      high: (close + 20).toFixed(2),
      low: (close - 20).toFixed(2),
      close: closeStr,
      volume: "10",
      barOpenTime: openTime,
      barCloseTime: closeTime,
    });
  }

  return bars;
}
