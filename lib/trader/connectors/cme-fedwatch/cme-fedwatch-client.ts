import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type CmeFedWatchProbability = {
  meetingDate: string;
  probability: number;
  targetRateRange?: string;
};

export type CmeFedWatchClientConfig = {
  enabled?: boolean;
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://www.cmegroup.com/CmeWS/mvc/Quotes/FedWatch";

function resolveCmeFedWatchEnabled(configEnabled?: boolean): boolean {
  if (configEnabled !== undefined) {
    return configEnabled;
  }
  return process.env.AI_TRADER_CME_FEDWATCH_ENABLED === "1";
}

export class CmeFedWatchClient {
  private readonly enabled: boolean;
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: CmeFedWatchClientConfig = {}) {
    this.enabled = resolveCmeFedWatchEnabled(config.enabled);
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getProbabilities(): Promise<CmeFedWatchProbability[]> {
    if (!this.enabled) {
      throw new Error("[cme-fedwatch] unavailable: AI_TRADER_CME_FEDWATCH_ENABLED is not set");
    }

    const response = await this.fetchImpl(this.baseUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[cme-fedwatch] probabilities HTTP ${response.status}`);
    }
    const body = (await response.json()) as { probabilities?: CmeFedWatchProbability[] };
    return body.probabilities ?? [];
  }
}
