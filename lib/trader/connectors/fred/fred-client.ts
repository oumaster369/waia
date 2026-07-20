import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type FredObservationRow = {
  realtime_start: string;
  realtime_end: string;
  date: string;
  value: string;
};

export type FredSeriesObservationsResponse = {
  observations: FredObservationRow[];
  count: number;
};

export type FredClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.stlouisfed.org/fred";

function resolveFredApiKey(configApiKey?: string): string | undefined {
  return configApiKey ?? process.env.FRED_API_KEY;
}

export class FredClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: FredClientConfig = {}) {
    this.apiKey = resolveFredApiKey(config.apiKey);
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getSeriesObservations(input: {
    seriesId: string;
    limit?: number;
    sortOrder?: "asc" | "desc";
  }): Promise<FredSeriesObservationsResponse> {
    if (!this.apiKey) {
      throw new Error("[fred] FRED_API_KEY is required");
    }

    const params = new URLSearchParams({
      series_id: input.seriesId,
      api_key: this.apiKey,
      file_type: "json",
      sort_order: input.sortOrder ?? "desc",
      limit: String(input.limit ?? 1),
    });
    const url = `${this.baseUrl}/series/observations?${params.toString()}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[fred] series observations HTTP ${response.status}`);
    }
    return (await response.json()) as FredSeriesObservationsResponse;
  }
}
