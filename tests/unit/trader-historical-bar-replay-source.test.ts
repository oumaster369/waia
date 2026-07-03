import { describe, expect, it } from "vitest";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { Bar } from "@/lib/trader/intelligence/types";

function buildBars(count: number, close = "100"): Bar[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: new Date(Date.parse("2026-06-22T09:40:00.000Z") + index * 60_000).toISOString(),
    barCloseTime: new Date(Date.parse("2026-06-22T09:41:00.000Z") + index * 60_000).toISOString(),
  }));
}

describe("HistoricalBarReplaySource (RI-P7 OOS)", () => {
  it("runs exactly one cycle when bar count equals EXPAND_MIN_BARS", () => {
    expect(EXPAND_MIN_BARS).toBe(20);

    const source = new HistoricalBarReplaySource({ bars: buildBars(20) });
    const first = source.next();
    const second = source.next();

    expect(first.done).toBe(false);
    expect(second.done).toBe(true);
    if (first.done) {
      return;
    }

    expect(first.snapshot.bars).toHaveLength(20);
  });
});
