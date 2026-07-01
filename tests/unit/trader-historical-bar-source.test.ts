import { describe, expect, it } from "vitest";

import {
  DEFAULT_HISTORICAL_BAR_CYCLE_ID_PREFIX,
  HistoricalBarSource,
} from "@/lib/trader/market-data/historical-bar-source";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import type { Bar } from "@/lib/trader/intelligence/types";

function makeBar(index: number): Bar {
  const openMs = Date.parse("2026-01-01T00:00:00.000Z") + index * 60_000;
  const openIso = new Date(openMs).toISOString();
  const closeIso = new Date(openMs + 60_000).toISOString();
  const close = `${65000 + index}`;
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: openIso,
    barCloseTime: closeIso,
  };
}

function makeBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, index) => makeBar(index));
}

describe("HistoricalBarSource", () => {
  it("expands window from EXPAND_MIN_BARS through full history", async () => {
    const bars = makeBars(25);
    const source = new HistoricalBarSource({
      bars,
      cycleIdPrefix: "hist-test",
    });

    const lengths: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      const snapshot = await source.fetchSnapshot();
      lengths.push(snapshot.bars.length);
    }

    expect(lengths).toEqual([20, 21, 22, 23, 24, 25]);
    await expect(source.fetchSnapshot()).rejects.toThrow(/exhausted/);
  });

  it("never returns fewer than EXPAND_MIN_BARS while active", async () => {
    const source = new HistoricalBarSource({ bars: makeBars(25) });

    for (let index = 0; index < 6; index += 1) {
      const snapshot = await source.fetchSnapshot();
      expect(snapshot.bars.length).toBeGreaterThanOrEqual(EXPAND_MIN_BARS);
    }
  });

  it("increments cycleId deterministically", async () => {
    const source = new HistoricalBarSource({
      bars: makeBars(25),
      cycleIdPrefix: "hist-test",
    });

    const first = await source.fetchSnapshot();
    const second = await source.fetchSnapshot();

    expect(first.cycleIndex).toBe(0);
    expect(first.cycleId).toBe("hist-test-0");
    expect(second.cycleIndex).toBe(1);
    expect(second.cycleId).toBe("hist-test-1");
  });

  it("uses default cycleIdPrefix when omitted", async () => {
    const source = new HistoricalBarSource({ bars: makeBars(25) });
    const snapshot = await source.fetchSnapshot();
    expect(snapshot.cycleId).toBe(`${DEFAULT_HISTORICAL_BAR_CYCLE_ID_PREFIX}-0`);
  });

  it("derives quote from last bar in window when quote override absent", async () => {
    const bars = makeBars(25);
    const source = new HistoricalBarSource({ bars, cycleIdPrefix: "hist-test" });
    const snapshot = await source.fetchSnapshot();
    const lastBar = snapshot.bars.at(-1)!;

    expect(snapshot.quote.symbol).toBe("BTC/USDT");
    expect(snapshot.quote.last).toBe(lastBar.close);
    expect(snapshot.quote.timestamp).toBe(lastBar.barCloseTime);
  });

  it("reset restores expand progression", async () => {
    const source = new HistoricalBarSource({ bars: makeBars(25), cycleIdPrefix: "hist-test" });

    await source.fetchSnapshot();
    await source.fetchSnapshot();
    source.reset();

    const afterReset = await source.fetchSnapshot();
    expect(afterReset.bars).toHaveLength(EXPAND_MIN_BARS);
    expect(afterReset.cycleIndex).toBe(0);
  });

  it("loads bars lazily via async loader", async () => {
    let loadCount = 0;
    const source = new HistoricalBarSource({
      loadBars: async () => {
        loadCount += 1;
        return makeBars(25);
      },
      cycleIdPrefix: "hist-test",
    });

    const first = await source.fetchSnapshot();
    const second = await source.fetchSnapshot();

    expect(loadCount).toBe(1);
    expect(first.bars).toHaveLength(EXPAND_MIN_BARS);
    expect(second.bars).toHaveLength(EXPAND_MIN_BARS + 1);
  });

  it("throws when in-memory history is shorter than EXPAND_MIN_BARS", () => {
    expect(() => new HistoricalBarSource({ bars: makeBars(10) })).toThrow(/at least 20 bars/);
  });

  it("throws when async loader returns too few bars", async () => {
    const source = new HistoricalBarSource({
      loadBars: async () => makeBars(5),
    });

    await expect(source.fetchSnapshot()).rejects.toThrow(/need at least 20/);
  });

  it("requires exactly one of bars or loadBars", () => {
    expect(() => new HistoricalBarSource({})).toThrow(/exactly one of bars or loadBars/);
    expect(
      () =>
        new HistoricalBarSource({
          bars: makeBars(25),
          loadBars: async () => makeBars(25),
        }),
    ).toThrow(/exactly one of bars or loadBars/);
  });

  it("sets evaluatedAt to last bar close time", async () => {
    const source = new HistoricalBarSource({ bars: makeBars(25) });
    const snapshot = await source.fetchSnapshot();
    expect(snapshot.evaluatedAt).toBe(snapshot.bars.at(-1)!.barCloseTime);
  });
});
