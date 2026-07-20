import { advanceMarketCanvasClosedBar } from "@/lib/trader/market-data/canvas/market-canvas";
import type { MarketCanvasState } from "@/lib/trader/market-data/canvas/market-canvas.types";
import type { Bar } from "@/lib/trader/intelligence/types";

export function makeCanvasBar1m(overrides: Partial<Bar> & Pick<Bar, "barOpenTime">): Bar {
  const { barOpenTime, barCloseTime: overrideClose, ...rest } = overrides;
  const barOpenTimeMs = Date.parse(barOpenTime);
  const barCloseTime =
    overrideClose ??
    new Date(barOpenTimeMs + 60_000 - 1).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  return {
    symbol: "BTC/USDT",
    interval: "1m",
    open: "100",
    high: "101",
    low: "99",
    close: "100.5",
    volume: "10",
    barOpenTime,
    barCloseTime,
    ...rest,
  };
}

export function advanceBars(state: MarketCanvasState, bars: readonly Bar[]): MarketCanvasState {
  let current = state;
  for (const bar of bars) {
    const result = advanceMarketCanvasClosedBar(current, bar);
    if (!result.ok) {
      throw new Error(`advance failed: ${result.error}`);
    }
    current = result.state;
  }
  return current;
}
