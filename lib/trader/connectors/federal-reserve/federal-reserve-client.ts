import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type FederalReserveCalendarEvent = {
  id: string;
  title: string;
  start: string;
  end?: string;
  category?: string;
  description?: string;
};

export type FederalReserveCalendarResponse = {
  events?: FederalReserveCalendarEvent[];
};

export type FederalReserveClientConfig = {
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://www.federalreserve.gov/json/calendar.json";

export class FederalReserveClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: FederalReserveClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getCalendarEvents(): Promise<FederalReserveCalendarEvent[]> {
    const response = await this.fetchImpl(this.baseUrl, { method: "GET" });
    if (!response.ok) {
      throw new Error(`[federal-reserve] calendar HTTP ${response.status}`);
    }
    const body = (await response.json()) as FederalReserveCalendarResponse;
    return body.events ?? [];
  }
}
