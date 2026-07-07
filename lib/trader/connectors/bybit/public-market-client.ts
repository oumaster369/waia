import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type BybitTickerResult = {
  symbol: string;
  lastPrice: string;
};

export type BybitTickerResponse = {
  retCode: number;
  retMsg: string;
  result: {
    list: BybitTickerResult[];
  };
};

export type BybitPublicClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.bybit.com";

export class BybitPublicMarketClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: BybitPublicClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getSpotTicker(symbol: string): Promise<BybitTickerResult> {
    const wire = symbol.replace("/", "");
    const url = `${this.baseUrl}/v5/market/tickers?category=spot&symbol=${encodeURIComponent(wire)}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[bybit] ticker HTTP ${response.status}`);
    }
    const body = (await response.json()) as BybitTickerResponse;
    if (body.retCode !== 0) {
      throw new Error(`[bybit] ticker error ${body.retCode}: ${body.retMsg}`);
    }
    const row = body.result.list[0];
    if (!row) {
      throw new Error("[bybit] ticker empty result");
    }
    return row;
  }
}
