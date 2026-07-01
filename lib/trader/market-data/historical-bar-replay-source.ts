import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type { BarReplayNextResult, BarReplaySource } from "@/lib/trader/market-data/types";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

export const DEFAULT_HISTORICAL_BAR_REPLAY_CYCLE_ID_PREFIX = "historical-bar-replay";

export type HistoricalBarReplaySourceOptions = {
  bars: readonly Bar[];
  quote?: Quote;
  cycleIdPrefix?: string;
};

function quoteFromBar(bar: Bar): Quote {
  return {
    symbol: bar.symbol,
    bid: bar.close,
    ask: bar.close,
    last: bar.close,
    timestamp: bar.barCloseTime,
  };
}

/**
 * {@link BarReplaySource} over stored OHLCV with expanding windows (min {@link EXPAND_MIN_BARS}).
 * Used by the backtest engine via {@link runBacktest}.
 */
export class HistoricalBarReplaySource implements BarReplaySource {
  private readonly bars: readonly Bar[];
  private readonly quoteOverride?: Quote;
  private readonly cycleIdPrefix: string;
  private cycleIndex = 0;
  private expandBarCount = EXPAND_MIN_BARS;
  private expandExhausted = false;

  constructor(options: HistoricalBarReplaySourceOptions) {
    if (options.bars.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] historical bar replay requires at least ${EXPAND_MIN_BARS} bars`,
      );
    }
    this.bars = options.bars;
    this.quoteOverride = options.quote;
    this.cycleIdPrefix = options.cycleIdPrefix ?? DEFAULT_HISTORICAL_BAR_REPLAY_CYCLE_ID_PREFIX;
  }

  reset(): void {
    this.cycleIndex = 0;
    this.expandBarCount = EXPAND_MIN_BARS;
    this.expandExhausted = false;
  }

  next(): BarReplayNextResult {
    if (this.expandExhausted) {
      return { done: true };
    }

    const windowBars = this.bars.slice(0, this.expandBarCount);
    const lastBar = windowBars.at(-1)!;
    const quote = this.quoteOverride ?? quoteFromBar(lastBar);
    const snapshot = buildMarketSnapshot(windowBars, quote, this.cycleIndex, this.cycleIdPrefix);

    this.cycleIndex += 1;

    if (this.expandBarCount >= this.bars.length) {
      this.expandExhausted = true;
    } else {
      this.expandBarCount += 1;
    }

    return { done: false, snapshot };
  }
}
