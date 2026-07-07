import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type BinanceTickerResponse = {
  symbol: string;
  price: string;
};

export type BinancePublicClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.binance.com";

export class BinancePublicMarketClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: BinancePublicClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getTickerPrice(symbol: string): Promise<BinanceTickerResponse> {
    const wire = symbol.replace("/", "");
    const url = `${this.baseUrl}/api/v3/ticker/price?symbol=${encodeURIComponent(wire)}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[binance] ticker HTTP ${response.status}`);
    }
    return (await response.json()) as BinanceTickerResponse;
  }
}
