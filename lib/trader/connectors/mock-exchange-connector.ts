import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { ConnectorNotSupportedError } from "@/lib/trader/connectors/errors";
import type { ExchangeConnector } from "@/lib/trader/connectors/exchange-connector";
import type {
  AccountInfo,
  Balance,
  ConnectorCredentialInput,
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

const MOCK_ACCOUNT_ID = "mock-account-1";
const DEFAULT_SYMBOL = "BTC/USDT";

const SEED_BALANCES: Balance[] = [
  { asset: "USDT", free: "10000.00", locked: "0.00", total: "10000.00" },
  { asset: "BTC", free: "0.50", locked: "0.00", total: "0.50" },
];

const SEED_POSITIONS: Position[] = [
  {
    symbol: DEFAULT_SYMBOL,
    marketType: "spot",
    quantity: "0.10",
    avgEntryPrice: "65000.00",
    unrealizedPnl: "25.00",
  },
];

const SEED_MARKET_TICKS: Record<string, MarketDataEvent> = {
  "BTC/USDT": {
    symbol: "BTC/USDT",
    lastPrice: "65250.00",
    bid: "65249.50",
    ask: "65250.50",
    timestamp: "2026-01-01T00:00:00.000Z",
  },
  "ETH/USDT": {
    symbol: "ETH/USDT",
    lastPrice: "3200.00",
    bid: "3199.50",
    ask: "3200.50",
    timestamp: "2026-01-01T00:00:00.000Z",
  },
};

function cloneBalance(balance: Balance): Balance {
  return { ...balance };
}

function cloneOrder(order: Order): Order {
  return { ...order };
}

function cloneTrade(trade: Trade): Trade {
  return { ...trade };
}

export type MockExchangeConnectorOptions = {
  /** When set, trade/order timestamps use this clock (deterministic replay). */
  nowMs?: () => number;
  /** When true, starts with no seed positions (paper replay without venue inventory). */
  emptyPositions?: boolean;
};

function assertPositiveQuantity(quantity: string): void {
  const parsed = Number(quantity);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("[trader] mock connector requires positive order quantity");
  }
}

function resolveMarketPrice(symbol: string): string {
  return SEED_MARKET_TICKS[symbol]?.lastPrice ?? "1.00";
}

/**
 * Deterministic in-memory connector for tests, paper flows, and safety-spine drills.
 * No network I/O.
 */
export class MockExchangeConnector implements ExchangeConnector {
  readonly venueId = "mock" as const;
  readonly marketType = "spot" as const;

  private readonly clock: () => number;
  private validated = false;
  private balances: Balance[] = SEED_BALANCES.map(cloneBalance);
  private positions: Position[];
  private orders = new Map<string, Order>();
  private trades: Trade[] = [];
  private nextOrderSeq = 1;
  private nextTradeSeq = 1;

  constructor(options: MockExchangeConnectorOptions = {}) {
    this.clock = options.nowMs ?? Date.now;
    this.positions = options.emptyPositions ? [] : SEED_POSITIONS.map((p) => ({ ...p }));
  }

  private timestampIso(): string {
    return new Date(this.clock()).toISOString();
  }

  async validateCredentials(input: ConnectorCredentialInput): Promise<CredentialValidationResult> {
    const apiKey = input.apiKey.trim();
    if (apiKey === "" || apiKey.startsWith("invalid")) {
      this.validated = false;
      return {
        valid: false,
        errorCode: "INVALID_CREDENTIALS",
        errorMessage: "Mock connector rejected synthetic credentials",
      };
    }

    this.validated = true;
    return {
      valid: true,
      accountId: MOCK_ACCOUNT_ID,
      warnings: input.passphrase ? ["passphrase ignored by mock connector"] : undefined,
    };
  }

  async getAccountInfo(): Promise<AccountInfo> {
    this.assertValidated();
    return {
      accountId: MOCK_ACCOUNT_ID,
      venue: "mock",
      marketType: "spot",
      permissions: ["read", "trade"],
    };
  }

  async getBalances(): Promise<Balance[]> {
    this.assertValidated();
    return this.balances.map(cloneBalance);
  }

  async getPositions(): Promise<Position[]> {
    this.assertValidated();
    return this.positions.map((p) => ({ ...p }));
  }

  async getOpenOrders(filter?: GetOpenOrdersFilter): Promise<Order[]> {
    this.assertValidated();
    const open = [...this.orders.values()].filter(
      (o) => o.status === "open" || o.status === "partially_filled",
    );
    if (filter?.symbol) {
      return open.filter((o) => o.symbol === filter.symbol).map(cloneOrder);
    }
    return open.map(cloneOrder);
  }

  async getOrder(orderId: string): Promise<Order | null> {
    this.assertValidated();
    const order = this.orders.get(orderId);
    return order ? cloneOrder(order) : null;
  }

  async placeOrder(input: PlaceOrderInput): Promise<Order> {
    this.assertValidated();
    assertPositiveQuantity(input.quantity);

    const existing = [...this.orders.values()].find((o) => o.clientOrderId === input.clientOrderId);
    if (existing) {
      return cloneOrder(existing);
    }

    if (input.type === "limit" && (!input.price || Number(input.price) <= 0)) {
      throw new Error("[trader] mock connector limit orders require a positive price");
    }

    const orderId = `mock-order-${this.nextOrderSeq++}`;
    const timestamp = this.timestampIso();
    const isMarket = input.type === "market";
    const fillPrice = isMarket ? resolveMarketPrice(input.symbol) : input.price!;

    const order: Order = {
      orderId,
      clientOrderId: input.clientOrderId,
      symbol: input.symbol,
      side: input.side,
      type: input.type,
      status: isMarket ? "filled" : "open",
      price: input.price,
      quantity: input.quantity,
      filledQuantity: isMarket ? input.quantity : "0",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.orders.set(orderId, order);

    if (isMarket) {
      this.recordTrade(order, fillPrice, input.quantity);
    }

    return cloneOrder(order);
  }

  async cancelOrder(orderId: string): Promise<Order> {
    this.assertValidated();
    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error(`[trader] mock connector order not found: ${orderId}`);
    }
    if (order.status === "filled" || order.status === "canceled") {
      return cloneOrder(order);
    }

    order.status = "canceled";
    order.updatedAt = this.timestampIso();
    this.orders.set(orderId, order);
    return cloneOrder(order);
  }

  async getTradeHistory(filter?: GetTradeHistoryFilter): Promise<Trade[]> {
    this.assertValidated();
    let rows = this.trades.map(cloneTrade);
    if (filter?.symbol) {
      rows = rows.filter((t) => t.symbol === filter.symbol);
    }
    if (filter?.limit !== undefined && filter.limit >= 0) {
      rows = rows.slice(-filter.limit);
    }
    return rows;
  }

  async *streamMarketData(symbols: readonly string[]): AsyncIterable<MarketDataEvent> {
    this.assertValidated();
    for (const symbol of symbols) {
      const tick = SEED_MARKET_TICKS[symbol] ?? {
        symbol,
        lastPrice: resolveMarketPrice(symbol),
        bid: resolveMarketPrice(symbol),
        ask: resolveMarketPrice(symbol),
        timestamp: this.timestampIso(),
      };
      yield { ...tick, timestamp: this.timestampIso() };
    }
  }

  async *streamUserData(): AsyncIterable<UserDataEvent> {
    this.assertValidated();
    for (const balance of this.balances) {
      yield { kind: "balance_update", balance: cloneBalance(balance) };
    }
    for (const order of this.orders.values()) {
      yield { kind: "order_update", order: cloneOrder(order) };
    }
    for (const trade of this.trades) {
      yield { kind: "trade", trade: cloneTrade(trade) };
    }
  }

  async getFuturesBalances(): Promise<Balance[]> {
    throw new ConnectorNotSupportedError("futures balances");
  }

  async getFuturesPositions(): Promise<Position[]> {
    throw new ConnectorNotSupportedError("futures positions");
  }

  async placeFuturesOrder(input: PlaceOrderInput): Promise<Order> {
    void input;
    throw new ConnectorNotSupportedError("futures order placement");
  }

  private assertValidated(): void {
    if (!this.validated) {
      throw new Error("[trader] mock connector requires validateCredentials before use");
    }
  }

  private recordTrade(order: Order, price: string, quantity: string): void {
    const trade: Trade = {
      tradeId: `mock-trade-${this.nextTradeSeq++}`,
      orderId: order.orderId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      price,
      quantity,
      fee: "0.00",
      feeAsset: "USDT",
      executedAt: this.timestampIso(),
    };
    this.trades.push(trade);
  }
}
