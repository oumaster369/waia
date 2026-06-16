import { internalSymbolToHtx } from "@/lib/trader/connectors/htx/mappers";
import { HtxRestClient, type HtxFetchFn } from "@/lib/trader/connectors/htx/client";
import { BTC_USDT, type InstrumentId } from "@/lib/trader/intelligence/types";
import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import { mapHtxKlinesToBars, mapHtxMergedToQuote } from "@/lib/trader/market-data/htx-kline-mapper";
import { buildMarketSnapshot } from "@/lib/trader/market-data/market-snapshot";
import type {
  BarPollSource,
  HtxBarPollOptions,
  MarketSnapshot,
} from "@/lib/trader/market-data/types";

export const DEFAULT_HTX_POLL_CYCLE_ID_PREFIX = "htx-poll";
export const DEFAULT_HTX_KLINE_SIZE = 25;
export const DEFAULT_HTX_KLINE_PERIOD = "1min";

export class HtxBarPollSource implements BarPollSource {
  private readonly client: HtxRestClient;
  private readonly internalSymbol: InstrumentId;
  private readonly htxSymbol: string;
  private readonly size: number;
  private readonly period: string;
  private readonly cycleIdPrefix: string;
  private cycleIndex = 0;

  constructor(options: HtxBarPollOptions = {}) {
    const fetchImpl: HtxFetchFn | undefined = options.fetchImpl;
    this.client = new HtxRestClient({
      apiKey: "public",
      apiSecret: "public",
      restHost: options.restHost,
      fetchImpl,
    });
    this.internalSymbol = options.internalSymbol ?? BTC_USDT;
    this.htxSymbol = internalSymbolToHtx(this.internalSymbol);
    this.size = options.size ?? DEFAULT_HTX_KLINE_SIZE;
    this.period = options.period ?? DEFAULT_HTX_KLINE_PERIOD;
    this.cycleIdPrefix = options.cycleIdPrefix ?? DEFAULT_HTX_POLL_CYCLE_ID_PREFIX;
  }

  reset(): void {
    this.cycleIndex = 0;
  }

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const klines = await this.client.getMarketHistoryKline({
      symbol: this.htxSymbol,
      period: this.period,
      size: this.size,
    });

    if (klines.length < EXPAND_MIN_BARS) {
      throw new Error(
        `[market-data] HTX poll returned ${klines.length} bars; need at least ${EXPAND_MIN_BARS}`,
      );
    }

    const merged = await this.client.getMarketDetailMerged(this.htxSymbol);
    const bars = mapHtxKlinesToBars(this.internalSymbol, klines);
    const quote = mapHtxMergedToQuote(this.internalSymbol, merged);
    const snapshot = buildMarketSnapshot(bars, quote, this.cycleIndex, this.cycleIdPrefix);
    this.cycleIndex += 1;
    return snapshot;
  }
}
