import { describe, expect, it } from "vitest";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { HistoricalBarReplaySource } from "@/lib/trader/market-data/historical-bar-replay-source";
import type { Bar } from "@/lib/trader/intelligence/types";

function buildBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: "100",
    high: "101",
    low: "99",
    close: "100.5",
    volume: "1",
    barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, index)).toISOString(),
    barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, index + 1) - 1).toISOString(),
  }));
}

function countCursorCycles(barCount: number): number {
  const source = new HistoricalBarReplaySource({ bars: buildBars(barCount), windowMode: "cursor" });
  let cycles = 0;
  while (!source.next().done) {
    cycles += 1;
  }
  return cycles;
}

describe("canvas runtime cycle counts (HTR-WP09)", () => {
  it("N1 contract: 64800 bars → 64781 integrated cycles", () => {
    expect(countCursorCycles(64_800)).toBe(64_781);
  });

  it("N2 contract: 129600 bars → 129581 integrated cycles", () => {
    expect(countCursorCycles(129_600)).toBe(129_581);
  });

  it("warm-up boundary uses EXPAND_MIN_BARS", () => {
    expect(countCursorCycles(EXPAND_MIN_BARS)).toBe(1);
    expect(countCursorCycles(EXPAND_MIN_BARS + 1)).toBe(2);
  });
});
