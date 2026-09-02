import { describe, expect, it } from "vitest";

import { buildHistoricalDevelopmentSourceCorpusV2 } from
  "@/lib/trader/historical-simulation-v2/development-source-corpus-v2";
import type { Bar } from "@/lib/trader/intelligence/types";

function fixtureBars(count: number, symbol = "BTC/USDT"): Bar[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 10_000 + index * 2 + Math.sin(index / 4) * 20;
    const openTime = new Date(Date.UTC(2020, 0, 1) + index * 60_000).toISOString();
    return { symbol, interval: "1m", barOpenTime: openTime,
      barCloseTime: new Date(Date.parse(openTime) + 60_000).toISOString(),
      open: (close - 1).toFixed(8), high: (close + 3).toFixed(8), low: (close - 3).toFixed(8),
      close: close.toFixed(8), volume: String(100 + (index % 17)) };
  });
}

async function* iterable(values: readonly Bar[]): AsyncGenerator<Bar> {
  for (const value of values) yield value;
}

describe("historical DEVELOPMENT source corpus v2", () => {
  it("seals PIT features and attaches only fully visible 13-D outcomes", async () => {
    const bars = fixtureBars(180);
    const corpus = await buildHistoricalDevelopmentSourceCorpusV2({
      bars: iterable(bars), symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    });
    expect(corpus).toHaveLength(127);
    expect(corpus[0]?.closedBarEpochMs).toBe(Date.parse(bars[20]!.barCloseTime));
    expect(corpus.at(-1)?.closedBarEpochMs).toBe(Date.parse(bars[146]!.barCloseTime));
    expect(corpus.every((anchor) => anchor.outcome13d.length === 13)).toBe(true);
    expect(corpus.every((anchor) => anchor.symbol === "BTCUSDT")).toBe(true);
  });

  it("fails closed on a gap instead of silently fabricating a future bar", async () => {
    const bars = fixtureBars(180);
    bars.splice(70, 1);
    await expect(buildHistoricalDevelopmentSourceCorpusV2({
      bars: iterable(bars), symbol: "BTCUSDT",
    })).rejects.toThrow("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:NON_CONTIGUOUS_BAR");
  });

  it("refuses a corpus too small for all three state pools", async () => {
    await expect(buildHistoricalDevelopmentSourceCorpusV2({
      bars: iterable(fixtureBars(100)), symbol: "BTCUSDT",
    })).rejects.toThrow("HISTORICAL_DEVELOPMENT_CORPUS_REFUSED:INSUFFICIENT_SOURCE_ANCHORS");
  });
});
