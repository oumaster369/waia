import type { HtxFetchFn } from "@/lib/trader/connectors/htx/client";

export type SecEdgarRecentFiling = {
  accessionNumber: string;
  filingDate: string;
  reportDate?: string;
  form: string;
  primaryDocument?: string;
  primaryDocDescription?: string;
};

export type SecEdgarSubmissionsResponse = {
  cik: string;
  name: string;
  filings?: {
    recent?: {
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      form?: string[];
      primaryDocument?: string[];
      primaryDocDescription?: string[];
    };
  };
};

export type SecEdgarClientConfig = {
  userAgent?: string;
  baseUrl?: string;
  fetchImpl?: HtxFetchFn;
};

const DEFAULT_BASE_URL = "https://data.sec.gov";

function resolveSecEdgarUserAgent(configUserAgent?: string): string | undefined {
  return configUserAgent ?? process.env.AI_TRADER_SEC_EDGAR_USER_AGENT;
}

export class SecEdgarClient {
  private readonly userAgent?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: SecEdgarClientConfig = {}) {
    this.userAgent = resolveSecEdgarUserAgent(config.userAgent);
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private buildHeaders(): Record<string, string> {
    if (!this.userAgent) {
      throw new Error("[sec-edgar] AI_TRADER_SEC_EDGAR_USER_AGENT is required");
    }
    return {
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
  }

  async getCompanySubmissions(cik: string): Promise<SecEdgarSubmissionsResponse> {
    const paddedCik = cik.replace(/\D/g, "").padStart(10, "0");
    const url = `${this.baseUrl}/submissions/CIK${paddedCik}.json`;
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: this.buildHeaders(),
    });
    if (!response.ok) {
      throw new Error(`[sec-edgar] submissions HTTP ${response.status}`);
    }
    return (await response.json()) as SecEdgarSubmissionsResponse;
  }

  async listRecentFilings(cik: string, limit = 10): Promise<SecEdgarRecentFiling[]> {
    const submissions = await this.getCompanySubmissions(cik);
    const recent = submissions.filings?.recent;
    if (!recent?.accessionNumber) {
      return [];
    }

    const filings: SecEdgarRecentFiling[] = [];
    for (let index = 0; index < recent.accessionNumber.length && filings.length < limit; index++) {
      filings.push({
        accessionNumber: recent.accessionNumber[index] ?? "",
        filingDate: recent.filingDate?.[index] ?? "",
        reportDate: recent.reportDate?.[index],
        form: recent.form?.[index] ?? "",
        primaryDocument: recent.primaryDocument?.[index],
        primaryDocDescription: recent.primaryDocDescription?.[index],
      });
    }
    return filings;
  }
}
