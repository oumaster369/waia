import type {
  Balance,
  MarketDataEvent,
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
  Position,
  Trade,
} from "@/lib/trader/connectors/types";

import type {
  HtxAccountBalance,
  HtxMatchResultRow,
  HtxOrderRow,
} from "@/lib/trader/connectors/htx/types";

const QUOTE_SUFFIXES = [
  "usdt",
  "usdc",
  "husd",
  "btc",
  "eth",
  "ht",
  "usd",
  "eur",
  "try",
  "gbp",
  "aud",
  "brl",
  "rub",
  "jpy",
  "krw",
] as const;

const SORTED_QUOTE_SUFFIXES = [...QUOTE_SUFFIXES].sort((a, b) => b.length - a.length);

export function internalSymbolToHtx(symbol: string): string {
  const parts = symbol.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(`[trader] invalid internal symbol for HTX: ${symbol}`);
  }
  return `${parts[0].toLowerCase()}${parts[1].toLowerCase()}`;
}

export function htxSymbolToInternal(htxSymbol: string): string {
  const lower = htxSymbol.toLowerCase();
  for (const quote of SORTED_QUOTE_SUFFIXES) {
    if (lower.endsWith(quote) && lower.length > quote.length) {
      const base = lower.slice(0, -quote.length);
      return `${base.toUpperCase()}/${quote.toUpperCase()}`;
    }
  }
  return htxSymbol.toUpperCase();
}

export function parseHtxPermissions(permission: string): string[] {
  return permission
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function mapHtxPermissionsToAccountScopes(permission: string): string[] {
  const tokens = parseHtxPermissions(permission);
  const scopes: string[] = [];
  if (tokens.includes("readonly")) {
    scopes.push("read");
  }
  if (tokens.includes("trade")) {
    scopes.push("trade");
  }
  if (tokens.includes("withdraw")) {
    scopes.push("withdraw");
  }
  return scopes;
}

export function permissionIncludesWithdraw(permission: string): boolean {
  return parseHtxPermissions(permission).includes("withdraw");
}

export function permissionIncludesTrade(permission: string): boolean {
  return parseHtxPermissions(permission).includes("trade");
}

export function mapHtxBalances(data: HtxAccountBalance): Balance[] {
  const byCurrency = new Map<string, { free: number; locked: number }>();

  for (const row of data.list) {
    const currency = row.currency.toUpperCase();
    const amount = Number(row.balance);
    if (!Number.isFinite(amount)) {
      continue;
    }
    const current = byCurrency.get(currency) ?? { free: 0, locked: 0 };
    if (row.type === "trade") {
      current.free += amount;
    } else if (row.type === "frozen") {
      current.locked += amount;
    } else {
      current.free += amount;
    }
    byCurrency.set(currency, current);
  }

  return [...byCurrency.entries()]
    .map(([asset, amounts]) => {
      const total = amounts.free + amounts.locked;
      return {
        asset,
        free: formatDecimal(amounts.free),
        locked: formatDecimal(amounts.locked),
        total: formatDecimal(total),
      };
    })
    .filter((balance) => Number(balance.total) > 0)
    .sort((a, b) => a.asset.localeCompare(b.asset));
}

export function mapHtxBalancesToPositions(balances: Balance[]): Position[] {
  return balances
    .filter(
      (balance) => balance.asset !== "USDT" && balance.asset !== "USDC" && balance.asset !== "USD",
    )
    .filter((balance) => Number(balance.total) > 0)
    .map((balance) => ({
      symbol: `${balance.asset}/USDT`,
      marketType: "spot" as const,
      quantity: balance.total,
    }));
}

function formatDecimal(value: number): string {
  return value.toFixed(8).replace(/\.?0+$/, "") || "0";
}

function parseHtxOrderSideAndType(htxType: string): { side: OrderSide; type: OrderType } {
  const normalized = htxType.toLowerCase();
  const side: OrderSide = normalized.startsWith("sell") ? "sell" : "buy";
  const type: OrderType = normalized.includes("market") ? "market" : "limit";
  return { side, type };
}

function mapHtxOrderStatus(state: string): OrderStatus {
  switch (state) {
    case "submitted":
    case "created":
      return "open";
    case "partial-filled":
      return "partially_filled";
    case "filled":
      return "filled";
    case "canceled":
    case "partial-canceled":
      return "canceled";
    default:
      return "rejected";
  }
}

function msToIso(ms?: number): string {
  if (!ms || ms <= 0) {
    return new Date(0).toISOString();
  }
  return new Date(ms).toISOString();
}

export function mapHtxOrder(row: HtxOrderRow): Order {
  const { side, type } = parseHtxOrderSideAndType(row.type);
  const createdAt = msToIso(row["created-at"]);
  const quantity = row.amount ?? row["filled-amount"] ?? "0";
  const filledQuantity = row["filled-amount"] ?? "0";

  return {
    orderId: String(row.id),
    clientOrderId: row["client-order-id"] ?? "",
    symbol: htxSymbolToInternal(row.symbol),
    side,
    type,
    status: mapHtxOrderStatus(row.state),
    price: row.price,
    quantity,
    filledQuantity,
    createdAt,
    updatedAt: createdAt,
  };
}

export function mapHtxMatchResult(row: HtxMatchResultRow): Trade {
  const { side } = parseHtxOrderSideAndType(row.type);
  return {
    tradeId: String(row["trade-id"]),
    orderId: String(row["order-id"]),
    clientOrderId: "",
    symbol: htxSymbolToInternal(row.symbol),
    side,
    price: row.price,
    quantity: row["filled-amount"],
    fee: row["filled-fees"] ?? "0",
    feeAsset: (row["fee-currency"] ?? "USDT").toUpperCase(),
    executedAt: msToIso(row["created-at"]),
  };
}

export function mapHtxMarketTick(input: {
  symbol: string;
  tick: { close?: number; bid?: [number, number]; ask?: [number, number] };
  ts?: number;
}): MarketDataEvent {
  const close = input.tick.close ?? input.tick.bid?.[0] ?? input.tick.ask?.[0] ?? 0;
  const bid = input.tick.bid?.[0] ?? close;
  const ask = input.tick.ask?.[0] ?? close;
  const timestamp = input.ts ? new Date(input.ts).toISOString() : new Date().toISOString();

  return {
    symbol: input.symbol,
    lastPrice: String(close),
    bid: String(bid),
    ask: String(ask),
    timestamp,
  };
}

export const HTX_TRADE_PERMISSION_WARNING =
  "HTX Trade permission includes place, cancel, and transfer capability; transfer cannot be detected separately from Trade.";

export const HTX_PERMISSION_PROBE_WARNING =
  "HTX API key permissions could not be verified; treat credentials as potentially over-privileged.";
