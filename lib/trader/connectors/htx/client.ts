import {
  HTX_ENDPOINTS,
  HTX_MARKET_HISTORY_CANDLES_MAX_SIZE,
  htxHostFromUrl,
  resolveHtxRestHost,
} from "@/lib/trader/connectors/htx/config";
import {
  buildSignedPostQueryString,
  buildSignedQueryString,
} from "@/lib/trader/connectors/htx/signing";
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
import type { OrderSide, OrderType } from "@/lib/trader/connectors/types";
import { placeOrderInputToHtxType } from "@/lib/trader/connectors/htx/mappers";
import { HtxTransport } from "@/lib/trader/connectors/htx/transport";
import {
  DEFAULT_HTX_TRANSPORT_POLICY,
  type HtxTransportPolicy,
  computeRetryDelayMs,
  isHtxRateLimitEnvelope,
} from "@/lib/trader/connectors/htx/transport-policy";

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
  transportPolicy?: HtxTransportPolicy;
};

export class HtxRestClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly restHost: string;
  private readonly host: string;
  private readonly transport: HtxTransport;
  private readonly transportPolicy: HtxTransportPolicy;

  constructor(config: HtxClientConfig) {
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.restHost = resolveHtxRestHost(config.restHost);
    this.host = htxHostFromUrl(this.restHost);
    this.transportPolicy = config.transportPolicy ?? DEFAULT_HTX_TRANSPORT_POLICY;
    const fetchImpl = config.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.transport = new HtxTransport(fetchImpl, this.transportPolicy);
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

  async placeOrder(input: {
    accountId: string;
    symbol: string;
    side: OrderSide;
    type: OrderType;
    quantity: string;
    price?: string;
    clientOrderId: string;
  }): Promise<HtxOrderRow> {
    const body: Record<string, string | number> = {
      "account-id": input.accountId,
      symbol: input.symbol,
      type: placeOrderInputToHtxType(input),
      amount: input.quantity,
      source: "spot-api",
      "client-order-id": input.clientOrderId,
    };

    if (input.type === "limit") {
      if (!input.price) {
        throw new HtxApiError("invalid-request", "HTX limit order requires price");
      }
      body.price = input.price;
    }

    const response = await this.signedPost<HtxLegacyResponse<number>>(
      HTX_ENDPOINTS.placeOrder,
      body,
    );
    const orderId = response.data;
    if (orderId === undefined || orderId === null) {
      throw new HtxApiError("empty-response", "HTX place order response missing order id");
    }

    const order = await this.getOrder(String(orderId));
    if (!order) {
      throw new HtxApiError("empty-response", `HTX order ${orderId} not found after placement`);
    }
    return order;
  }

  async cancelOrder(orderId: string): Promise<HtxOrderRow> {
    await this.signedPost<HtxLegacyResponse<number>>(HTX_ENDPOINTS.cancelOrder(orderId), {});
    const order = await this.getOrder(orderId);
    if (!order) {
      throw new HtxApiError("empty-response", `HTX order ${orderId} not found after cancel`);
    }
    return order;
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
    const response = await this.transport.fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new HtxApiError("http-error", `HTTP ${response.status} for market detail`);
    }
    return (await response.json()) as HtxMarketMergedResponse;
  }

  async getMarketHistoryKline(input: {
    symbol: string;
    period: string;
    size?: number;
    /**
     * Passed through to query string only; `/market/history/kline` ignores `from`
     * and always returns the latest N candles. Use {@link getMarketHistoryCandles}
     * for paginated deep history.
     */
    from?: number;
  }): Promise<HtxKlineRow[]> {
    return this.fetchMarketKlineEnvelope({
      endpoint: HTX_ENDPOINTS.marketHistoryKline,
      symbol: input.symbol,
      period: input.period,
      size: input.size ?? 25,
      from: input.from,
      errorLabel: "market history kline",
    });
  }

  /**
   * Spot historical candles with forward time paging (`from`/`to` in seconds).
   * Max {@link HTX_MARKET_HISTORY_CANDLES_MAX_SIZE} rows per request.
   */
  async getMarketHistoryCandles(input: {
    symbol: string;
    period: string;
    size?: number;
    from?: number;
    to?: number;
  }): Promise<HtxKlineRow[]> {
    const requestedSize = input.size ?? HTX_MARKET_HISTORY_CANDLES_MAX_SIZE;
    const size = Math.min(requestedSize, HTX_MARKET_HISTORY_CANDLES_MAX_SIZE);
    return this.fetchMarketKlineEnvelope({
      endpoint: HTX_ENDPOINTS.marketHistoryCandles,
      symbol: input.symbol,
      period: input.period,
      size,
      from: input.from,
      to: input.to,
      errorLabel: "market history candles",
    });
  }

  private async fetchMarketKlineEnvelope(input: {
    endpoint: string;
    symbol: string;
    period: string;
    size: number;
    from?: number;
    to?: number;
    errorLabel: string;
  }): Promise<HtxKlineRow[]> {
    const params = new URLSearchParams({
      symbol: input.symbol,
      period: input.period,
      size: String(input.size),
    });
    if (input.from !== undefined) {
      params.set("from", String(input.from));
    }
    if (input.to !== undefined) {
      params.set("to", String(input.to));
    }
    const url = `${this.restHost}${input.endpoint}?${params.toString()}`;
    const response = await this.transport.fetch(url, { method: "GET" });
    if (!response.ok) {
      throw new HtxApiError("http-error", `HTTP ${response.status} for ${input.errorLabel}`);
    }
    const body = (await response.json()) as HtxKlineResponse;
    if (body.status === "error") {
      throw new HtxApiError(
        body["err-code"] ?? "unknown",
        body["err-msg"] ?? `HTX ${input.errorLabel} error`,
      );
    }
    if (body.status !== "ok") {
      throw new HtxApiError("invalid-response", `Unexpected HTX ${input.errorLabel} response`);
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
    return this.signedRequest<T>(url, { method: "GET" }, path);
  }

  private async signedPost<T>(path: string, body: Record<string, string | number>): Promise<T> {
    const query = buildSignedPostQueryString({
      accessKeyId: this.apiKey,
      secret: this.apiSecret,
      host: this.host,
      path,
    });
    const url = `${this.restHost}${path}?${query}`;
    return this.signedRequest<T>(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      path,
    );
  }

  private async signedRequest<T>(url: string, init: RequestInit, path: string): Promise<T> {
    for (let attempt = 0; attempt <= this.transportPolicy.maxRetries; attempt++) {
      const response = await this.transport.fetch(url, init);
      if (!response.ok) {
        throw new HtxApiError("http-error", `HTTP ${response.status} for ${path}`);
      }

      const body = (await response.json()) as T &
        HtxLegacyResponse<unknown> &
        HtxV2Response<unknown>;

      if (isHtxRateLimitEnvelope(body)) {
        if (attempt === this.transportPolicy.maxRetries) {
          this.assertOk(body, path);
        }
        const delayMs = computeRetryDelayMs(attempt, this.transportPolicy, response.headers);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      this.assertOk(body, path);
      return body;
    }

    throw new HtxApiError("rate-limit", `HTX rate limit retries exhausted for ${path}`);
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
