import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type BybitAnnouncementArticle = {
  title?: string;
  description?: string;
  dateTimestamp?: number;
  url?: string;
  type?: string;
};

export type BybitAnnouncementsResponse = {
  retCode?: number;
  retMsg?: string;
  result?: {
    list?: BybitAnnouncementArticle[];
  };
};

export type BybitAnnouncementsClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://api.bybit.com/v5/announcements/index";

export class BybitAnnouncementsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: BybitAnnouncementsClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async listRecentAnnouncements(input?: { limit?: number }): Promise<BybitAnnouncementArticle[]> {
    try {
      const params = new URLSearchParams({
        locale: "en-US",
        limit: String(input?.limit ?? 10),
      });
      const url = `${this.baseUrl}?${params.toString()}`;
      const response = await this.fetchImpl(url, { method: "GET" });
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as BybitAnnouncementsResponse;
      if (body.retCode !== 0) {
        return [];
      }
      return body.result?.list ?? [];
    } catch {
      return [];
    }
  }
}
