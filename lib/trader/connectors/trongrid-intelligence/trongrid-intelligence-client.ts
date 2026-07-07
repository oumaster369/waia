import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type TronGridChainParameter = {
  key: string;
  value: number | string;
};

export type TronGridChainParametersResponse = {
  data?: TronGridChainParameter[];
};

export type TronGridIntelligenceClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.trongrid.io";

function resolveTronGridApiKey(configApiKey?: string): string | undefined {
  return configApiKey ?? process.env.AI_TRADER_TRONGRID_API_KEY;
}

export class TronGridIntelligenceClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: TronGridIntelligenceClientConfig = {}) {
    this.apiKey = resolveTronGridApiKey(config.apiKey);
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers["TRON-PRO-API-KEY"] = this.apiKey;
    }
    return headers;
  }

  async getChainParameters(): Promise<TronGridChainParameter[]> {
    if (!this.apiKey) {
      throw new Error("[trongrid] AI_TRADER_TRONGRID_API_KEY is required");
    }
    const url = `${this.baseUrl}/wallet/getchainparameters`;
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: "{}",
    });
    if (!response.ok) {
      throw new Error(`[trongrid] chain parameters HTTP ${response.status}`);
    }
    const body = (await response.json()) as TronGridChainParametersResponse;
    return body.data ?? [];
  }
}
