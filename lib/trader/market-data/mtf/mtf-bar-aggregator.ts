import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import type { HtxRestClient } from "@/lib/trader/connectors/htx/client";
import { htxPeriodToSeconds } from "@/lib/trader/connectors/htx/kline-pagination";
import type { Bar, BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import {
  HTX_PERIOD_BY_INTERVAL,
  INTERVAL_BY_HTX_PERIOD,
  MTF_BAR_INTERVALS,
} from "@/lib/trader/market-data/observation-types";
import { mapHtxKlinesToBars } from "@/lib/trader/market-data/htx-kline-mapper";

export type FetchMtfBarsInput = {
  client: HtxRestClient;
  internalSymbol: InstrumentId;
  size?: number;
  intervals?: readonly BarInterval[];
};

export type FetchMtfBarsResult = Partial<Record<BarInterval, Bar[]>>;

export async function fetchMtfBarsFromHtx(input: FetchMtfBarsInput): Promise<FetchMtfBarsResult> {
  const intervals = input.intervals ?? MTF_BAR_INTERVALS;
  const htxSymbol = internalSymbolToHtx(input.internalSymbol);
  const size = input.size ?? 25;
  const result: FetchMtfBarsResult = {};

  for (const interval of intervals) {
    const period = HTX_PERIOD_BY_INTERVAL[interval];
    const klines = await input.client.getMarketHistoryKline({
      symbol: htxSymbol,
      period,
      size,
    });
    result[interval] = mapHtxKlinesToBars(input.internalSymbol, klines, interval);
  }

  return result;
}

export function intervalDurationMs(interval: BarInterval): number {
  const period = HTX_PERIOD_BY_INTERVAL[interval];
  return htxPeriodToSeconds(period) * 1000;
}

export function barIntervalFromHtxPeriod(period: string): BarInterval {
  const mapped = INTERVAL_BY_HTX_PERIOD[period];
  if (!mapped) {
    throw new Error(`[market-data] unsupported HTX period: ${period}`);
  }
  return mapped;
}
