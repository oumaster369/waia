import type {
  AccountInfo,
  Balance,
  ConnectorCredentialInput,
  ConnectorVenueId,
  CredentialValidationResult,
  GetOpenOrdersFilter,
  GetTradeHistoryFilter,
  MarketDataEvent,
  Order,
  PlaceOrderInput,
  Position,
  Trade,
  UserDataEvent,
} from "@/lib/trader/connectors/types";

/**
 * Exchange-agnostic connector seam (AI-TRADER Master Spec v2 §7).
 * Venue-specific logic lives in connector implementations under `lib/trader/connectors/`.
 */
export interface ExchangeConnector {
  readonly venueId: ConnectorVenueId;
  readonly marketType: "spot";

  validateCredentials(input: ConnectorCredentialInput): Promise<CredentialValidationResult>;
  getAccountInfo(): Promise<AccountInfo>;
  getBalances(): Promise<Balance[]>;
  getPositions(): Promise<Position[]>;
  getOpenOrders(filter?: GetOpenOrdersFilter): Promise<Order[]>;
  getOrder(orderId: string): Promise<Order | null>;
  placeOrder(input: PlaceOrderInput): Promise<Order>;
  cancelOrder(orderId: string): Promise<Order>;
  getTradeHistory(filter?: GetTradeHistoryFilter): Promise<Trade[]>;
  streamMarketData(symbols: readonly string[]): AsyncIterable<MarketDataEvent>;
  streamUserData(): AsyncIterable<UserDataEvent>;

  /** Futures stubs — disabled in spot-only MVP (Master Spec §7). */
  getFuturesBalances(): Promise<Balance[]>;
  getFuturesPositions(): Promise<Position[]>;
  placeFuturesOrder(input: PlaceOrderInput): Promise<Order>;
}
