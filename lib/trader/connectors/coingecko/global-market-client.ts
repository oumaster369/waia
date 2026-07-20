import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type CoinGeckoGlobalData = {
  market_cap_percentage: Record<string, number>;
  total_market_cap: Record<string, number>;
  updated_at: number;
};

export type CoinGeckoGlobalResponse = {
  data: CoinGeckoGlobalData;
};

export type CoinGeckoGlobalClientConfig = {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.coingecko.com";

export class CoinGeckoGlobalMarketClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: CoinGeckoGlobalClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getGlobalMarket(): Promise<CoinGeckoGlobalData> {
    const url = `${this.baseUrl}/api/v3/global`;
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["x-cg-demo-api-key"] = this.apiKey;
    }
    const response = await this.fetchImpl(url, { method: "GET", headers });
    if (!response.ok) {
      throw new Error(`[coingecko] global HTTP ${response.status}`);
    }
    const body = (await response.json()) as CoinGeckoGlobalResponse;
    return body.data;
  }
}
