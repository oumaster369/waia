import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type MempoolRecommendedFees = {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
};

export type MempoolMempoolStats = {
  count: number;
  vsize: number;
  total_fee: number;
  fee_histogram: [number, number][];
};

export type MempoolSpaceClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://mempool.space/api";

export class MempoolSpaceClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: MempoolSpaceClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getRecommendedFees(): Promise<MempoolRecommendedFees> {
    const url = `${this.baseUrl}/v1/fees/recommended`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[mempool.space] fees HTTP ${response.status}`);
    }
    return (await response.json()) as MempoolRecommendedFees;
  }

  async getMempoolStats(): Promise<MempoolMempoolStats> {
    const url = `${this.baseUrl}/mempool`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[mempool.space] mempool HTTP ${response.status}`);
    }
    return (await response.json()) as MempoolMempoolStats;
  }
}
