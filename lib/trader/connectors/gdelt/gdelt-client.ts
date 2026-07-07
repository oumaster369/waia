import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type GdeltArticleRow = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

export type GdeltDocResponse = {
  articles?: GdeltArticleRow[];
};

export type GdeltClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.gdeltproject.org/api/v2/doc/doc";

export class GdeltClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: GdeltClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async searchArticles(input: {
    query: string;
    maxRecords?: number;
    timespan?: string;
  }): Promise<GdeltArticleRow[]> {
    const params = new URLSearchParams({
      query: input.query,
      mode: "ArtList",
      format: "json",
      maxrecords: String(input.maxRecords ?? 10),
    });
    if (input.timespan) {
      params.set("timespan", input.timespan);
    }
    const url = `${this.baseUrl}?${params.toString()}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[gdelt] doc HTTP ${response.status}`);
    }
    const body = (await response.json()) as GdeltDocResponse;
    return body.articles ?? [];
  }
}
