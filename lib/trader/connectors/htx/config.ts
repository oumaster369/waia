/**
 * HTX (Huobi) spot REST constants.
 * @see https://huobiapi.github.io/docs/spot/v1/en/
 */
export const HTX_API_DOC_URL = "https://huobiapi.github.io/docs/spot/v1/en/";

export const HTX_DEFAULT_REST_HOST = "https://api.huobi.pro";
export const HTX_AWS_REST_HOST = "https://api-aws.huobi.pro";
export const HTX_OPTIONAL_REST_HOST = "https://api.htx.com";

export const HTX_ENDPOINTS = {
  accounts: "/v1/account/accounts",
  accountBalance: (accountId: string) => `/v1/account/accounts/${accountId}/balance`,
  openOrders: "/v1/order/openOrders",
  order: (orderId: string) => `/v1/order/orders/${orderId}`,
  placeOrder: "/v1/order/orders/place",
  cancelOrder: (orderId: string) => `/v1/order/orders/${orderId}/submitcancel`,
  matchResults: "/v1/order/matchresults",
  userUid: "/v2/user/uid",
  userApiKey: "/v2/user/api-key",
  marketDetailMerged: "/market/detail/merged",
  marketHistoryKline: "/market/history/kline",
  /** CCXT spot historical OHLCV path; supports `from`/`to` (seconds) for forward paging. */
  marketHistoryCandles: "/market/history/candles",
  marketDepth: "/market/depth",
  marketHistoryTrade: "/market/history/trade",
} as const;

/** HTX `/market/history/candles` max `size` per request (values above 1000 return empty). */
export const HTX_MARKET_HISTORY_CANDLES_MAX_SIZE = 1000;

/** MVP spot symbol allowlist (internal `BASE/QUOTE` format). */
export const HTX_SPOT_ALLOWED_SYMBOLS = ["BTC/USDT", "ETH/USDT"] as const;

export type HtxSpotAllowedSymbol = (typeof HTX_SPOT_ALLOWED_SYMBOLS)[number];

/** HTX matchresults query window (ms). */
export const HTX_TRADE_HISTORY_MAX_WINDOW_MS = 48 * 60 * 60 * 1000;

/** HTX matchresults lookback (ms). */
export const HTX_TRADE_HISTORY_MAX_LOOKBACK_MS = 120 * 24 * 60 * 60 * 1000;

export function resolveHtxRestHost(restHost?: string): string {
  if (!restHost) {
    return HTX_DEFAULT_REST_HOST;
  }
  return restHost.replace(/\/$/, "");
}

export function htxHostFromUrl(restHost: string): string {
  return new URL(restHost).host;
}
