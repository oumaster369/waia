import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type { BarReplayNextResult, BarReplaySource } from "@/lib/trader/market-data/types";
import type { Bar } from "@/lib/trader/intelligence/types";

function quoteFromBar(bar: Bar) {
  return {
    symbol: bar.symbol,
    bid: bar.close,
    ask: bar.close,
    last: bar.close,
    timestamp: bar.barCloseTime,
  };
}

/** Merge multi-symbol bars chronologically; BTC before ETH when barOpenTime ties. */
export function mergeFhvSharedPortfolioBarsChronologically(bars: readonly Bar[]): Bar[] {
  return [...bars].sort((left, right) => {
    const delta = Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime);
    if (delta !== 0) {
      return delta;
    }
    if (left.symbol === right.symbol) {
      return 0;
    }
    return left.symbol.startsWith("BTC") ? -1 : 1;
  });
}

/** Shared-portfolio interleaved bar source (multi-symbol cursor replay). */
export class FhvSharedPortfolioBarReplaySource implements BarReplaySource {
  private readonly bars: readonly Bar[];
  private readonly cycleIdPrefix: string;
  private cycleIndex = 0;
  private cursorBarIndex = EXPAND_MIN_BARS;
  private exhausted = false;

  constructor(bars: readonly Bar[], cycleIdPrefix = "fhv-shared-portfolio") {
    if (bars.length < EXPAND_MIN_BARS) {
      throw new Error(`FHV_SHARED_PORTFOLIO:MIN_BARS:${EXPAND_MIN_BARS}`);
    }
    this.bars = bars;
    this.cycleIdPrefix = cycleIdPrefix;
  }

  reset(): void {
    this.cycleIndex = 0;
    this.cursorBarIndex = EXPAND_MIN_BARS;
    this.exhausted = false;
  }

  advanceToCycleIndex(targetCycleIndex: number): void {
    while (this.cycleIndex < targetCycleIndex && !this.exhausted) {
      this.next();
    }
  }

  get currentCycleIndex(): number {
    return this.cycleIndex;
  }

  next(): BarReplayNextResult {
    if (this.exhausted) {
      return { done: true };
    }
    if (this.cycleIndex === 0) {
      const windowBars = this.bars.slice(0, EXPAND_MIN_BARS);
      const lastBar = windowBars.at(-1)!;
      const snapshot = buildMarketSnapshot(
        windowBars,
        quoteFromBar(lastBar),
        this.cycleIndex,
        this.cycleIdPrefix,
      );
      this.cycleIndex += 1;
      this.cursorBarIndex = EXPAND_MIN_BARS;
      if (this.bars.length <= EXPAND_MIN_BARS) {
        this.exhausted = true;
      }
      return { done: false, snapshot };
    }
    if (this.cursorBarIndex >= this.bars.length) {
      this.exhausted = true;
      return { done: true };
    }
    const bar = this.bars[this.cursorBarIndex]!;
    this.cursorBarIndex += 1;
    const snapshot = buildMarketSnapshot(
      [bar],
      quoteFromBar(bar),
      this.cycleIndex,
      this.cycleIdPrefix,
    );
    this.cycleIndex += 1;
    if (this.cursorBarIndex >= this.bars.length) {
      this.exhausted = true;
    }
    return { done: false, snapshot };
  }
}
