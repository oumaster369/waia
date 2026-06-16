/** Legacy HTX envelope (`status: ok|error`). */
export type HtxLegacyResponse<T> = {
  status: "ok" | "error";
  "err-code"?: string;
  "err-msg"?: string;
  data?: T;
};

/** V2 HTX envelope (`code: 200`). */
export type HtxV2Response<T> = {
  code: number;
  message?: string;
  data?: T;
  success?: boolean;
  ok?: boolean;
};

export type HtxAccountRow = {
  id: number;
  type: string;
  subtype?: string;
  state: string;
};

export type HtxBalanceRow = {
  currency: string;
  type: string;
  balance: string;
};

export type HtxAccountBalance = {
  id: number;
  type: string;
  state: string;
  list: HtxBalanceRow[];
};

export type HtxOrderRow = {
  id: number;
  "client-order-id"?: string;
  symbol: string;
  "account-id"?: number;
  price?: string;
  amount?: string;
  "created-at"?: number;
  type: string;
  "filled-amount"?: string;
  state: string;
};

export type HtxMatchResultRow = {
  id: number;
  symbol: string;
  "order-id": number;
  "trade-id": number;
  price: string;
  "created-at": number;
  type: string;
  "filled-amount": string;
  "filled-fees": string;
  "fee-currency"?: string;
};

export type HtxApiKeyRow = {
  accessKey: string;
  permission: string;
  status: string;
};

export type HtxMarketMergedTick = {
  close?: number;
  bid?: [number, number];
  ask?: [number, number];
};

export type HtxMarketMergedResponse = {
  status: "ok" | "error";
  ts?: number;
  tick?: HtxMarketMergedTick;
};

export type HtxKlineRow = {
  id: number;
  open: number;
  close: number;
  low: number;
  high: number;
  amount: number;
  vol: number;
  count: number;
};

export type HtxKlineResponse = {
  status: "ok" | "error";
  "err-code"?: string;
  "err-msg"?: string;
  ch?: string;
  ts?: number;
  data?: HtxKlineRow[];
};
