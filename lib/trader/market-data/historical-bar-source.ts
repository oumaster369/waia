import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { assertIngestBarsIntegrityOrThrow } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type { BarPollSource, MarketSnapshot } from "@/lib/trader/market-data/types";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";

export const DEFAULT_HISTORICAL_BAR_CYCLE_ID_PREFIX = "historical-bar";

export type HistoricalBarSourceOptions = {
  /** In-memory chronological bar history (mutually exclusive with loadBars). */
  bars?: readonly Bar[];
  /** Async loader for chronological bar history (mutually exclusive with bars). */
  loadBars?: () => Promise<readonly Bar[]>;
  /** Optional static quote; defaults to last bar close in the active window. */
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

/** Preserve static fixture quote levels while binding timestamp to the active closed bar. */
function quoteForReplayCycle(bar: Bar, quoteOverride?: Quote): Quote {
  if (!quoteOverride) {
    return quoteFromBar(bar);
  }

  return {
    ...quoteOverride,
    symbol: bar.symbol,
    timestamp: bar.barCloseTime,
  };
}

/**
 * Replays stored OHLCV chronologically with an expanding window (min {@link EXPAND_MIN_BARS}),
 * matching fixture expand mode for Feature Engine parity.
 */
export class HistoricalBarSource implements BarPollSource {
  private readonly quoteOverride?: Quote;
  private readonly cycleIdPrefix: string;
  private readonly loadBarsFn?: () => Promise<readonly Bar[]>;
  private readonly initialBars?: readonly Bar[];

  private bars: readonly Bar[] | null = null;
  private cycleIndex = 0;
  private expandBarCount = EXPAND_MIN_BARS;
  private expandExhausted = false;

  constructor(options: HistoricalBarSourceOptions) {
    const hasBars = options.bars !== undefined;
    const hasLoader = options.loadBars !== undefined;

    if (hasBars === hasLoader) {
      throw new Error("[market-data] HistoricalBarSource requires exactly one of bars or loadBars");
    }

    this.initialBars = options.bars;
    this.loadBarsFn = options.loadBars;
    this.quoteOverride = options.quote;
    this.cycleIdPrefix = options.cycleIdPrefix ?? DEFAULT_HISTORICAL_BAR_CYCLE_ID_PREFIX;
    this.bars = options.bars ?? null;

    if (this.initialBars && this.initialBars.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] historical bar source requires at least ${EXPAND_MIN_BARS} bars`,
      );
    }

    if (this.initialBars) {
      const firstBar = this.initialBars[0]!;
      assertIngestBarsIntegrityOrThrow({
        bars: this.initialBars,
        expectedSymbol: firstBar.symbol,
        expectedInterval: firstBar.interval,
      });
    }
  }

  reset(): void {
    this.cycleIndex = 0;
    this.expandBarCount = EXPAND_MIN_BARS;
    this.expandExhausted = false;
    if (this.initialBars) {
      this.bars = this.initialBars;
    } else {
      this.bars = null;
    }
  }

  private async ensureBarsLoaded(): Promise<readonly Bar[]> {
    if (this.bars) {
      return this.bars;
    }

    if (!this.loadBarsFn) {
      throw new Error("[market-data] historical bar source has no bar history");
    }

    const loaded = await this.loadBarsFn();
    if (loaded.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] historical bar loader returned ${loaded.length} bars; need at least ${EXPAND_MIN_BARS}`,
      );
    }

    const firstBar = loaded[0]!;
    assertIngestBarsIntegrityOrThrow({
      bars: loaded,
      expectedSymbol: firstBar.symbol,
      expectedInterval: firstBar.interval,
    });

    this.bars = loaded;
    return loaded;
  }

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const bars = await this.ensureBarsLoaded();

    if (this.expandExhausted) {
      throw new Error("[market-data] historical bar replay exhausted");
    }

    const windowBars = bars.slice(0, this.expandBarCount);
    const lastBar = windowBars.at(-1)!;
    const quote = quoteForReplayCycle(lastBar, this.quoteOverride);
    const snapshot = buildMarketSnapshot(windowBars, quote, this.cycleIndex, this.cycleIdPrefix);

    this.cycleIndex += 1;

    if (this.expandBarCount >= bars.length) {
      this.expandExhausted = true;
    } else {
      this.expandBarCount += 1;
    }

    return snapshot;
  }
}
