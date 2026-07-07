import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type BinanceAnnouncementCatalog = {
  catalogId: number;
  catalogName: string;
};

export type BinanceAnnouncementArticle = {
  id: number;
  code: string;
  title: string;
  type: number;
  releaseDate: number;
};

export type BinanceAnnouncementsListResponse = {
  code?: string;
  message?: string;
  data?: {
    catalogs?: BinanceAnnouncementCatalog[];
    articles?: BinanceAnnouncementArticle[];
  };
};

export type BinanceAnnouncementsClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://www.binance.com/bapi/composite/v1/public/cms/article/list/query";

export class BinanceAnnouncementsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: BinanceAnnouncementsClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async listRecentAnnouncements(input?: {
    catalogId?: number;
    pageSize?: number;
  }): Promise<BinanceAnnouncementArticle[]> {
    try {
      const response = await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 1,
          catalogId: input?.catalogId ?? 48,
          pageNo: 1,
          pageSize: input?.pageSize ?? 10,
        }),
      });
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as BinanceAnnouncementsListResponse;
      return body.data?.articles ?? [];
    } catch {
      return [];
    }
  }
}
