import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type HtxAnnouncementArticle = {
  id?: number | string;
  title?: string;
  showTime?: number;
  content?: string;
  language?: string;
};

export type HtxAnnouncementsResponse = {
  code?: number;
  success?: boolean;
  data?: HtxAnnouncementArticle[];
};

export type HtxAnnouncementsClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://www.htx.com/-/x/hb/p/api/contents/pro/list";

export class HtxAnnouncementsClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: HtxAnnouncementsClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async listRecentAnnouncements(input?: { limit?: number }): Promise<HtxAnnouncementArticle[]> {
    try {
      const params = new URLSearchParams({
        language: "en-us",
        limit: String(input?.limit ?? 10),
      });
      const url = `${this.baseUrl}?${params.toString()}`;
      const response = await this.fetchImpl(url, { method: "GET" });
      if (!response.ok) {
        return [];
      }
      const body = (await response.json()) as HtxAnnouncementsResponse;
      return body.data ?? [];
    } catch {
      return [];
    }
  }
}
