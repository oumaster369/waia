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
  matchResults: "/v1/order/matchresults",
  userUid: "/v2/user/uid",
  userApiKey: "/v2/user/api-key",
  marketDetailMerged: "/market/detail/merged",
  marketHistoryKline: "/market/history/kline",
} as const;

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
