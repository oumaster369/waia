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

function buildSymbolIsolatedSnapshots(
  bars: readonly Bar[],
  cycleIdPrefix: string,
): MarketSnapshot[] {
  const merged = mergeFhvSharedPortfolioBarsChronologically(bars);
  const symbolHistories = new Map<string, Bar[]>();
  const snapshots: MarketSnapshot[] = [];
  let cycleIndex = 0;

  for (const bar of merged) {
    const history = symbolHistories.get(bar.symbol) ?? [];
    history.push(bar);
    symbolHistories.set(bar.symbol, history);

    if (history.length === EXPAND_MIN_BARS) {
      snapshots.push(
        buildMarketSnapshot(
          history.slice(0, EXPAND_MIN_BARS),
          quoteFromBar(bar),
          cycleIndex,
          cycleIdPrefix,
        ),
      );
      cycleIndex += 1;
    } else if (history.length > EXPAND_MIN_BARS) {
      snapshots.push(buildMarketSnapshot([bar], quoteFromBar(bar), cycleIndex, cycleIdPrefix));
      cycleIndex += 1;
    }
  }

  return snapshots;
}

function maxSymbolBarCount(bars: readonly Bar[]): number {
  const counts = new Map<string, number>();
  for (const bar of bars) {
    counts.set(bar.symbol, (counts.get(bar.symbol) ?? 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

/** Shared-portfolio interleaved bar source with per-symbol rolling 1m histories. */
export class FhvSharedPortfolioBarReplaySource implements BarReplaySource {
  private readonly snapshots: readonly MarketSnapshot[];
  private cycleIndex = 0;

  constructor(bars: readonly Bar[], cycleIdPrefix = "fhv-shared-portfolio") {
    if (maxSymbolBarCount(bars) < EXPAND_MIN_BARS) {
      throw new Error(`FHV_SHARED_PORTFOLIO:MIN_BARS:${EXPAND_MIN_BARS}`);
    }
    this.snapshots = buildSymbolIsolatedSnapshots(bars, cycleIdPrefix);
  }

  reset(): void {
    this.cycleIndex = 0;
  }

  advanceToCycleIndex(targetCycleIndex: number): void {
    this.cycleIndex = Math.max(0, Math.min(targetCycleIndex, this.snapshots.length));
  }

  get currentCycleIndex(): number {
    return this.cycleIndex;
  }

  next(): BarReplayNextResult {
    if (this.cycleIndex >= this.snapshots.length) {
      return { done: true };
    }
    const snapshot = this.snapshots[this.cycleIndex]!;
    this.cycleIndex += 1;
    return { done: false, snapshot };
  }
}

/** @internal Test helper — inspect per-symbol snapshot windows. */
export function buildFhvSharedPortfolioSnapshotsForTest(
  bars: readonly Bar[],
  cycleIdPrefix = "fhv-shared-portfolio-test",
): MarketSnapshot[] {
  return buildSymbolIsolatedSnapshots(bars, cycleIdPrefix);
}
