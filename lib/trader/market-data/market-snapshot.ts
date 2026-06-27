import type { Bar, Quote } from "@/lib/trader/intelligence/types";

import type { MarketSnapshot } from "@/lib/trader/market-data/types";

export function buildMarketSnapshot(
  bars: readonly Bar[],
  quote: Quote,
  cycleIndex: number,
  cycleIdPrefix: string,
): MarketSnapshot {
  const lastBar = bars.at(-1)!;
  return {
    bars,
    quote,
    evaluatedAt: lastBar.barCloseTime,
    cycleIndex,
    cycleId: `${cycleIdPrefix}-${cycleIndex}`,
  };
}
