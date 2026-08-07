/**
 * DEE-436 — FHV incremental multi-symbol history parity (100+ post-warm-up cycles per symbol).
 */

import { describe, expect, it } from "vitest";

import {
  computeFeatureSnapshot,
  isInsufficientBars,
} from "@/lib/trader/intelligence/feature-engine-v0";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import {
  FhvSharedPortfolioBarReplaySource,
  mergeFhvSharedPortfolioBarsChronologically,
} from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import type { Bar } from "@/lib/trader/intelligence/types";

const POST_WARMUP_CYCLES = 100;

function generateSymbolBars(
  symbol: "BTC/USDT" | "ETH/USDT",
  count: number,
  phaseMs: number,
): Bar[] {
  const bars: Bar[] = [];
  const basePrice = symbol.startsWith("BTC") ? "65000.00" : "3500.00";
  for (let index = 0; index < count; index += 1) {
    const openMs = Date.parse("2020-01-01T00:00:00.000Z") + phaseMs + index * 120_000;
    bars.push({
      symbol,
      interval: "1m",
      open: basePrice,
      high: basePrice,
      low: basePrice,
      close: basePrice,
      volume: "1.00",
      barOpenTime: new Date(openMs).toISOString(),
      barCloseTime: new Date(openMs + 60_000).toISOString(),
    });
  }
  return bars;
}

function quoteFromBar(bar: Bar) {
  return {
    symbol: bar.symbol,
    bid: bar.close,
    ask: bar.close,
    last: bar.close,
    timestamp: bar.barCloseTime,
  };
}

describe("DEE-436 FHV incremental history parity", () => {
  it("FHV_BTC_ETH_INCREMENTAL_HISTORY_PARITY_PASS", () => {
    const barsPerSymbol = EXPAND_MIN_BARS + POST_WARMUP_CYCLES + 5;
    const merged = mergeFhvSharedPortfolioBarsChronologically([
      ...generateSymbolBars("BTC/USDT", barsPerSymbol, 0),
      ...generateSymbolBars("ETH/USDT", barsPerSymbol, 60_000),
    ]);

    const allBarsBySymbol = new Map<string, Bar[]>();
    for (const bar of merged) {
      const history = allBarsBySymbol.get(bar.symbol) ?? [];
      history.push(bar);
      allBarsBySymbol.set(bar.symbol, history);
    }

    const source = new FhvSharedPortfolioBarReplaySource(merged, "fhv-parity");
    const btcPostWarmup: number[] = [];
    const ethPostWarmup: number[] = [];

    for (;;) {
      const result = source.next();
      if (result.done || !result.snapshot) {
        break;
      }
      const symbol = result.snapshot.bars.at(-1)!.symbol;
      const historyLength = source.getSymbolHistoryLength(symbol);
      const oracleWindow = allBarsBySymbol
        .get(symbol)!
        .slice(0, historyLength)
        .slice(-EXPAND_MIN_BARS);
      const incrementalWindow = source.getSymbolHistoryWindow(symbol);

      expect(incrementalWindow.length).toBe(EXPAND_MIN_BARS);
      expect(incrementalWindow.every((bar) => bar.symbol === symbol)).toBe(true);
      expect(incrementalWindow.map((bar) => bar.barOpenTime)).toEqual(
        oracleWindow.map((bar) => bar.barOpenTime),
      );

      const activeBar = result.snapshot.bars.at(-1)!;
      const incrementalSnapshot = buildMarketSnapshot(
        [...incrementalWindow],
        quoteFromBar(activeBar),
        result.snapshot.cycleIndex,
        "fhv-parity-oracle",
      );
      const oracleSnapshot = buildMarketSnapshot(
        [...oracleWindow],
        quoteFromBar(activeBar),
        result.snapshot.cycleIndex,
        "fhv-parity-oracle",
      );
      const incrementalFeatures = computeFeatureSnapshot({
        bars: incrementalSnapshot.bars,
        quote: incrementalSnapshot.quote,
      });
      const oracleFeatures = computeFeatureSnapshot({
        bars: oracleSnapshot.bars,
        quote: oracleSnapshot.quote,
      });
      expect(isInsufficientBars(incrementalWindow)).toBe(false);
      expect(isInsufficientBars(oracleWindow)).toBe(false);
      expect(incrementalFeatures.inputs.barCount).toBe(EXPAND_MIN_BARS);
      expect(incrementalFeatures.inputs.barCount).toBe(oracleFeatures.inputs.barCount);

      if (symbol === "BTC/USDT" && historyLength > EXPAND_MIN_BARS) {
        btcPostWarmup.push(incrementalFeatures.inputs.barCount);
      }
      if (symbol === "ETH/USDT" && historyLength > EXPAND_MIN_BARS) {
        ethPostWarmup.push(incrementalFeatures.inputs.barCount);
      }
    }

    expect(btcPostWarmup.length).toBeGreaterThanOrEqual(POST_WARMUP_CYCLES);
    expect(ethPostWarmup.length).toBeGreaterThanOrEqual(POST_WARMUP_CYCLES);
    expect(btcPostWarmup.every((count) => count === EXPAND_MIN_BARS)).toBe(true);
    expect(ethPostWarmup.every((count) => count === EXPAND_MIN_BARS)).toBe(true);
  });
});
