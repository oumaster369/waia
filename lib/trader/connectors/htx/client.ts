import {
  HTX_ENDPOINTS,
  htxHostFromUrl,
  resolveHtxRestHost,
} from "@/lib/trader/connectors/htx/config";
import { buildSignedQueryString } from "@/lib/trader/connectors/htx/signing";
import type {
  HtxAccountBalance,
  HtxAccountRow,
  HtxApiKeyRow,
  HtxKlineResponse,
  HtxKlineRow,
  HtxLegacyResponse,
  HtxMarketMergedResponse,
  HtxMatchResultRow,
  HtxOrderRow,
  HtxV2Response,
} from "@/lib/trader/connectors/htx/types";

export type HtxFetchFn = typeof fetch;

export class HtxApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[trader] HTX API error (${code}): ${message}`);
    this.name = "HtxApiError";
    this.code = code;
  }
}

export type HtxClientConfig = {
  apiKey: string;
  apiSecret: string;
  restHost?: string;
  fetchImpl?: HtxFetchFn;
};

export class HtxRestClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly restHost: string;
  private readonly host: string;
  private readonly fetchImpl: HtxFetchFn;

  constructor(config: HtxClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.restHost = resolveHtxRestHost(config.restHost);
    this.host = htxHostFromUrl(this.restHost);
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  getRestHost(): string {
    return this.restHost;
  }

  async getAccounts(): Promise<HtxAccountRow[]> {
    const response = await this.signedGet<HtxLegacyResponse<HtxAccountRow[]>>(
      HTX_ENDPOINTS.accounts,
    );
    return response.data ?? [];
  }

  async getAccountBalance(accountId: string): Promise<HtxAccountBalance> {
    const response = await this.signedGet<HtxLegacyResponse<HtxAccountBalance>>(
      HTX_ENDPOINTS.accountBalance(accountId),
    );
    if (!response.data) {
      throw new HtxApiError("empty-response", "HTX balance response missing data");
    }
    return response.data;
  }

  async getOpenOrders(input: { accountId: string; symbol: string }) {
    const response = await this.signedGet<HtxLegacyResponse<HtxOrderRow[]>>(
      HTX_ENDPOINTS.openOrders,
      {
        "account-id": input.accountId,
        symbol: input.symbol,
      },
    );
    return response.data ?? [];
  }

  async getOrder(orderId: string): Promise<HtxOrderRow | null> {
    const response = await this.signedGet<HtxLegacyResponse<HtxOrderRow>>(
      HTX_ENDPOINTS.order(orderId),
    );
    return response.data ?? null;
  }

  async getMatchResults(input: {
    symbol: string;
    startTime: number;
    endTime: number;
    size?: number;
  }): Promise<HtxMatchResultRow[]> {
    const response = await this.signedGet<HtxLegacyResponse<HtxMatchResultRow[]>>(
      HTX_ENDPOINTS.matchResults,
      {
        symbol: input.symbol,
        "start-time": String(input.startTime),
        "end-time": String(input.endTime),
        size: String(input.size ?? 100),
      },
    );
    return response.data ?? [];
  }

  async getUserUid(): Promise<number> {
    const response = await this.signedGet<HtxV2Response<number>>(HTX_ENDPOINTS.userUid);
    if (typeof response.data !== "number") {
      throw new HtxApiError("empty-response", "HTX uid response missing data");
    }
    return response.data;
  }

  async getUserApiKey(uid: number): Promise<HtxApiKeyRow | null> {
    const response = await this.signedGet<HtxV2Response<HtxApiKeyRow[]>>(HTX_ENDPOINTS.userApiKey, {
      uid: String(uid),
      accessKey: this.apiKey,
    });
    const rows = response.data ?? [];
    return rows.find((row) => row.accessKey === this.apiKey) ?? rows[0] ?? null;
  }

  async getMarketDetailMerged(symbol: string): Promise<HtxMarketMergedResponse> {
    const url = `${this.restHost}${HTX_ENDPOINTS.marketDetailMerged}?symbol=${encodeURIComponent(symbol)}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new HtxApiError("http-error", `HTTP ${response.status} for market detail`);
    }
    return (await response.json()) as HtxMarketMergedResponse;
  }

  async getMarketHistoryKline(input: {
    symbol: string;
    period: string;
    size?: number;
  }): Promise<HtxKlineRow[]> {
    const params = new URLSearchParams({
      symbol: input.symbol,
      period: input.period,
      size: String(input.size ?? 25),
    });
    const url = `${this.restHost}${HTX_ENDPOINTS.marketHistoryKline}?${params.toString()}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new HtxApiError("http-error", `HTTP ${response.status} for market history kline`);
    }
    const body = (await response.json()) as HtxKlineResponse;
    if (body.status === "error") {
      throw new HtxApiError(
        body["err-code"] ?? "unknown",
        body["err-msg"] ?? "HTX market history kline error",
      );
    }
    if (body.status !== "ok") {
      throw new HtxApiError("invalid-response", "Unexpected HTX market history kline response");
    }
    return body.data ?? [];
  }

  private async signedGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const query = buildSignedQueryString({
      accessKeyId: this.apiKey,
      secret: this.apiSecret,
      host: this.host,
      path,
      params,
    });
    const url = `${this.restHost}${path}?${query}`;
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) {
      throw new HtxApiError("http-error", `HTTP ${response.status} for ${path}`);
    }
    const body = (await response.json()) as T & HtxLegacyResponse<unknown> & HtxV2Response<unknown>;
    this.assertOk(body, path);
    return body;
  }

  private assertOk(body: HtxLegacyResponse<unknown> & HtxV2Response<unknown>, path: string): void {
    if (typeof body.code === "number") {
      if (body.code !== 200) {
        throw new HtxApiError(String(body.code), body.message ?? `HTX v2 error on ${path}`);
      }
      return;
    }

    if (body.status === "error") {
      throw new HtxApiError(
        body["err-code"] ?? "unknown",
        body["err-msg"] ?? `HTX error on ${path}`,
      );
    }

    if (body.status !== "ok") {
      throw new HtxApiError("invalid-response", `Unexpected HTX response on ${path}`);
    }
  }
}
