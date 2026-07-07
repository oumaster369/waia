import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type FearGreedDataPoint = {
  value: string;
  value_classification: string;
  timestamp: string;
};

export type FearGreedResponse = {
  name: string;
  data: FearGreedDataPoint[];
};

export type AlternativeMeClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.alternative.me";

export class AlternativeMeFearGreedClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: AlternativeMeClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getLatest(): Promise<FearGreedDataPoint> {
    const url = `${this.baseUrl}/fng/?limit=1`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[alternative.me] fear-greed HTTP ${response.status}`);
    }
    const body = (await response.json()) as FearGreedResponse;
    const point = body.data[0];
    if (!point) {
      throw new Error("[alternative.me] fear-greed empty data");
    }
    return point;
  }
}
