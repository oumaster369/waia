import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type { BarReplayNextResult, BarReplaySource } from "@/lib/trader/market-data/types";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

export const DEFAULT_HISTORICAL_BAR_REPLAY_CYCLE_ID_PREFIX = "historical-bar-replay";

export type HistoricalBarReplaySourceOptions = {
  bars: readonly Bar[];
  quote?: Quote;
  cycleIdPrefix?: string;
  /** `cursor` yields one new closed bar per cycle after warm-up (default for incremental cutover). */
  windowMode?: "expanding" | "cursor";
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
  private readonly windowMode: "expanding" | "cursor";
  private cycleIndex = 0;
  private expandBarCount = EXPAND_MIN_BARS;
  private expandExhausted = false;
  private cursorBarIndex = EXPAND_MIN_BARS;

  constructor(options: HistoricalBarReplaySourceOptions) {
    if (options.bars.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] historical bar replay requires at least ${EXPAND_MIN_BARS} bars`,
      );
    }
    this.bars = options.bars;
    this.quoteOverride = options.quote;
    this.cycleIdPrefix = options.cycleIdPrefix ?? DEFAULT_HISTORICAL_BAR_REPLAY_CYCLE_ID_PREFIX;
    this.windowMode = options.windowMode ?? "cursor";
  }

  reset(): void {
    this.cycleIndex = 0;
    this.expandBarCount = EXPAND_MIN_BARS;
    this.expandExhausted = false;
    this.cursorBarIndex = EXPAND_MIN_BARS;
  }

  /** Advance internal cursor without executing cycles — used for resume warm-up discard. */
  advanceToCycleIndex(targetCycleIndex: number): void {
    while (this.cycleIndex < targetCycleIndex && !this.expandExhausted) {
      this.next();
    }
  }

  get currentCycleIndex(): number {
    return this.cycleIndex;
  }

  next(): BarReplayNextResult {
    if (this.expandExhausted) {
      return { done: true };
    }

    if (this.windowMode === "expanding") {
      return this.nextExpanding();
    }

    return this.nextCursor();
  }

  private nextExpanding(): BarReplayNextResult {
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

  private nextCursor(): BarReplayNextResult {
    if (this.cycleIndex === 0) {
      const windowBars = this.bars.slice(0, EXPAND_MIN_BARS);
      const lastBar = windowBars.at(-1)!;
      const quote = this.quoteOverride ?? quoteFromBar(lastBar);
      const snapshot = buildMarketSnapshot(windowBars, quote, this.cycleIndex, this.cycleIdPrefix);
      this.cycleIndex += 1;
      this.cursorBarIndex = EXPAND_MIN_BARS;
      if (this.bars.length <= EXPAND_MIN_BARS) {
        this.expandExhausted = true;
      }
      return { done: false, snapshot };
    }

    if (this.cursorBarIndex >= this.bars.length) {
      this.expandExhausted = true;
      return { done: true };
    }

    const bar = this.bars[this.cursorBarIndex]!;
    this.cursorBarIndex += 1;
    const quote = this.quoteOverride ?? quoteFromBar(bar);
    const snapshot = buildMarketSnapshot([bar], quote, this.cycleIndex, this.cycleIdPrefix);
    this.cycleIndex += 1;

    if (this.cursorBarIndex >= this.bars.length) {
      this.expandExhausted = true;
    }

    return { done: false, snapshot };
  }
}
