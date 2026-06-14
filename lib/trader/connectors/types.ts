/** Supported connector venues. Only `"mock"` is implemented in DEE-194. */
export type ConnectorVenueId = "mock" | "htx";

export type ConnectorMarketType = "spot" | "futures";

export type OrderSide = "buy" | "sell";
export type OrderType = "limit" | "market";
export type OrderStatus = "open" | "partially_filled" | "filled" | "canceled" | "rejected";

export type ConnectorCredentialInput = {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
};

export type CredentialValidationResult = {
  valid: boolean;
  accountId?: string;
  warnings?: string[];
  errorCode?: string;
  errorMessage?: string;
};

export type AccountInfo = {
  accountId: string;
  venue: ConnectorVenueId;
  marketType: "spot";
  permissions: string[];
};

export type Balance = {
  asset: string;
  free: string;
  locked: string;
  total: string;
};

export type Position = {
  symbol: string;
  marketType: "spot";
  quantity: string;
  avgEntryPrice?: string;
  unrealizedPnl?: string;
};

export type Order = {
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price?: string;
  quantity: string;
  filledQuantity: string;
  createdAt: string;
  updatedAt: string;
};

export type PlaceOrderInput = {
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: string;
  quantity: string;
};

export type Trade = {
  tradeId: string;
  orderId: string;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  price: string;
  quantity: string;
  fee: string;
  feeAsset: string;
  executedAt: string;
};

export type MarketDataEvent = {
  symbol: string;
  lastPrice: string;
  bid: string;
  ask: string;
  timestamp: string;
};

export type UserDataEvent =
  | { kind: "order_update"; order: Order }
  | { kind: "balance_update"; balance: Balance }
  | { kind: "trade"; trade: Trade };

export type GetOpenOrdersFilter = {
  symbol?: string;
};

export type GetTradeHistoryFilter = {
  symbol?: string;
  limit?: number;
};
