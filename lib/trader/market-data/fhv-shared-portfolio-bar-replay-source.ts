import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type {
  BarReplayNextResult,
  BarReplaySource,
  MarketSnapshot,
} from "@/lib/trader/market-data/types";
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

function maxSymbolBarCount(bars: readonly Bar[]): number {
  const counts = new Map<string, number>();
  for (const bar of bars) {
    counts.set(bar.symbol, (counts.get(bar.symbol) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

let snapshotMaterializationCount = 0;

export function resetFhvSharedPortfolioSnapshotMaterializationCount(): void {
  snapshotMaterializationCount = 0;
}

export function getFhvSharedPortfolioSnapshotMaterializationCount(): number {
  return snapshotMaterializationCount;
}

/** Incremental shared-portfolio source — one snapshot at a time, rolling per-symbol windows. */
export class FhvSharedPortfolioBarReplaySource implements BarReplaySource {
  private readonly events: readonly Bar[];
  private eventIndex = 0;
  private cycleIndex = 0;
  private readonly symbolHistories = new Map<string, Bar[]>();
  private readonly symbolIngestedCounts = new Map<string, number>();
  private readonly cycleIdPrefix: string;

  constructor(bars: readonly Bar[], cycleIdPrefix = "fhv-shared-portfolio") {
    if (maxSymbolBarCount(bars) < EXPAND_MIN_BARS) {
      throw new Error(`FHV_SHARED_PORTFOLIO:MIN_BARS:${EXPAND_MIN_BARS}`);
    }
    this.events = mergeFhvSharedPortfolioBarsChronologically(bars);
    this.cycleIdPrefix = cycleIdPrefix;
  }

  reset(): void {
    this.eventIndex = 0;
    this.cycleIndex = 0;
    this.symbolHistories.clear();
    this.symbolIngestedCounts.clear();
  }

  advanceToCycleIndex(targetCycleIndex: number): void {
    this.reset();
    while (this.cycleIndex < targetCycleIndex && !this.next().done) {
      /* advance incrementally */
    }
  }

  get currentCycleIndex(): number {
    return this.cycleIndex;
  }

  next(): BarReplayNextResult {
    while (this.eventIndex < this.events.length) {
      const bar = this.events[this.eventIndex]!;
      this.eventIndex += 1;
      const history = this.symbolHistories.get(bar.symbol) ?? [];
      history.push(bar);
      if (history.length > EXPAND_MIN_BARS) {
        history.splice(0, history.length - EXPAND_MIN_BARS);
      }
      this.symbolHistories.set(bar.symbol, history);
      this.symbolIngestedCounts.set(
        bar.symbol,
        (this.symbolIngestedCounts.get(bar.symbol) ?? 0) + 1,
      );

      if (history.length >= EXPAND_MIN_BARS) {
        const window = history.slice(-EXPAND_MIN_BARS);
        const snapshot = buildMarketSnapshot(
          window,
          quoteFromBar(bar),
          this.cycleIndex,
          this.cycleIdPrefix,
        );
        this.cycleIndex += 1;
        snapshotMaterializationCount += 1;
        return { done: false, snapshot };
      }
    }
    return { done: true };
  }

  getSymbolHistoryLength(symbol: string): number {
    return this.symbolIngestedCounts.get(symbol) ?? 0;
  }

  getSymbolHistoryWindow(symbol: string): readonly Bar[] {
    const history = this.symbolHistories.get(symbol) ?? [];
    if (history.length >= EXPAND_MIN_BARS) {
      return history.slice(-EXPAND_MIN_BARS);
    }
    return history;
  }
}

/** Official multi-year bar count per symbol (1m bars, 2020-01-01 .. 2026-01-01 half-open). */
export const FHV_OFFICIAL_BARS_PER_SYMBOL = 3_156_480 as const;
export const FHV_OFFICIAL_TOTAL_BARS = FHV_OFFICIAL_BARS_PER_SYMBOL * 2;

function buildLazyOfficialBar(symbol: "BTC/USDT" | "ETH/USDT", index: number): Bar {
  const openMs = Date.parse("2020-01-01T00:00:00.000Z") + index * 60_000;
  const price = symbol.startsWith("BTC") ? "65000.00" : "3500.00";
  return {
    symbol,
    interval: "1m",
    open: price,
    high: price,
    low: price,
    close: price,
    volume: "1.00",
    barOpenTime: new Date(openMs).toISOString(),
    barCloseTime: new Date(openMs + 60_000).toISOString(),
  };
}

/** Lazily interleave BTC+ETH bars without retaining the full 6,312,960-bar corpus. */
export function createLazyOfficialInterleavedBarIterator(): {
  next(): Bar | undefined;
  totalEvents: number;
} {
  let btcIndex = 0;
  let ethIndex = 0;
  const totalEvents = FHV_OFFICIAL_TOTAL_BARS;
  return {
    totalEvents,
    next(): Bar | undefined {
      if (btcIndex >= FHV_OFFICIAL_BARS_PER_SYMBOL && ethIndex >= FHV_OFFICIAL_BARS_PER_SYMBOL) {
        return undefined;
      }
      if (btcIndex >= FHV_OFFICIAL_BARS_PER_SYMBOL) {
        const bar = buildLazyOfficialBar("ETH/USDT", ethIndex);
        ethIndex += 1;
        return bar;
      }
      if (ethIndex >= FHV_OFFICIAL_BARS_PER_SYMBOL) {
        const bar = buildLazyOfficialBar("BTC/USDT", btcIndex);
        btcIndex += 1;
        return bar;
      }
      const btcBar = buildLazyOfficialBar("BTC/USDT", btcIndex);
      const ethBar = buildLazyOfficialBar("ETH/USDT", ethIndex);
      if (btcBar.barOpenTime <= ethBar.barOpenTime) {
        btcIndex += 1;
        return btcBar;
      }
      ethIndex += 1;
      return ethBar;
    },
  };
}

/** Incremental replay source over a lazy interleaved bar iterator (bounded per-symbol memory). */
export class FhvLazySharedPortfolioBarReplaySource implements BarReplaySource {
  private readonly nextBar: () => Bar | undefined;
  private cycleIndex = 0;
  private readonly symbolHistories = new Map<string, Bar[]>();
  private readonly cycleIdPrefix: string;
  private exhausted = false;

  constructor(input: { nextBar: () => Bar | undefined; cycleIdPrefix?: string }) {
    this.nextBar = input.nextBar;
    this.cycleIdPrefix = input.cycleIdPrefix ?? "fhv-lazy-shared-portfolio";
  }

  reset(): void {
    this.cycleIndex = 0;
    this.symbolHistories.clear();
    this.exhausted = false;
  }

  advanceToCycleIndex(targetCycleIndex: number): void {
    this.reset();
    while (this.cycleIndex < targetCycleIndex && !this.next().done) {
      /* advance incrementally */
    }
  }

  get currentCycleIndex(): number {
    return this.cycleIndex;
  }

  next(): BarReplayNextResult {
    while (!this.exhausted) {
      const bar = this.nextBar();
      if (!bar) {
        this.exhausted = true;
        break;
      }
      const history = this.symbolHistories.get(bar.symbol) ?? [];
      history.push(bar);
      if (history.length > EXPAND_MIN_BARS) {
        history.splice(0, history.length - EXPAND_MIN_BARS);
      }
      this.symbolHistories.set(bar.symbol, history);

      if (history.length >= EXPAND_MIN_BARS) {
        const window = history.slice(-EXPAND_MIN_BARS);
        const snapshot = buildMarketSnapshot(
          window,
          quoteFromBar(bar),
          this.cycleIndex,
          this.cycleIdPrefix,
        );
        this.cycleIndex += 1;
        snapshotMaterializationCount += 1;
        return { done: false, snapshot };
      }
    }
    return { done: true };
  }

  getSymbolHistoryWindow(symbol: string): readonly Bar[] {
    const history = this.symbolHistories.get(symbol) ?? [];
    if (history.length >= EXPAND_MIN_BARS) {
      return history.slice(-EXPAND_MIN_BARS);
    }
    return history;
  }
}

/** @internal Test helper — inspect per-symbol snapshot windows incrementally. */
export function buildFhvSharedPortfolioSnapshotsForTest(
  bars: readonly Bar[],
  cycleIdPrefix = "fhv-shared-portfolio-test",
): MarketSnapshot[] {
  const source = new FhvSharedPortfolioBarReplaySource(bars, cycleIdPrefix);
  const snapshots: MarketSnapshot[] = [];
  for (;;) {
    const result = source.next();
    if (result.done || !result.snapshot) {
      break;
    }
    snapshots.push(result.snapshot);
  }
  return snapshots;
}

/** @internal Advance source and return per-symbol window sizes after N evaluation cycles. */
export function inspectFhvSharedPortfolioWindowSizesForTest(
  bars: readonly Bar[],
  evaluationCycles: number,
): Map<string, number> {
  const source = new FhvSharedPortfolioBarReplaySource(bars, "fhv-window-inspect");
  const sizes = new Map<string, number>();
  for (let index = 0; index < evaluationCycles; index += 1) {
    const result = source.next();
    if (result.done || !result.snapshot) {
      break;
    }
    sizes.set(result.snapshot.bars[0]!.symbol, result.snapshot.bars.length);
  }
  return sizes;
}
