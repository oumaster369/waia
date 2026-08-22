import type {
  Balance,
  MarketDataEvent,
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
  PlaceOrderInput,
  Position,
  Trade,
} from "@/lib/trader/connectors/types";

import { HTX_SPOT_ALLOWED_SYMBOLS } from "@/lib/trader/connectors/htx/config";
import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";
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

export function isHtxSpotSymbolAllowed(symbol: string): boolean {
  return (HTX_SPOT_ALLOWED_SYMBOLS as readonly string[]).includes(symbol);
}

export function assertHtxSpotSymbolAllowed(symbol: string): void {
  if (!isHtxSpotSymbolAllowed(symbol)) {
    throw new HtxConnectorValidationError(
      "SYMBOL_NOT_ALLOWED",
      `HTX spot connector only supports ${HTX_SPOT_ALLOWED_SYMBOLS.join(", ")}; got ${symbol}`,
    );
  }
}

export function placeOrderInputToHtxType(input: Pick<PlaceOrderInput, "side" | "type">): string {
  return `${input.side}-${input.type}`;
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

class HtxUnknownOrderMechanicsError extends Error {
  readonly rawVenueObservation: Readonly<Record<string, unknown>>;

  constructor(row: Readonly<Record<string, unknown>>) {
    super(`[trader] HTX order mechanics are fail-unknown: ${String(row.type)}`);
    this.name = "HtxUnknownOrderMechanicsError";
    this.rawVenueObservation = Object.freeze({ ...row });
  }
}

function parseHtxOrderSideAndType(
  htxType: string,
  row: Readonly<Record<string, unknown>>,
): { side: OrderSide; type: OrderType } {
  const normalized = htxType.toLowerCase();
  switch (normalized) {
    case "buy-limit":
      return { side: "buy", type: "limit" };
    case "sell-limit":
      return { side: "sell", type: "limit" };
    case "buy-market":
      return { side: "buy", type: "market" };
    case "sell-market":
      return { side: "sell", type: "market" };
    default:
      throw new HtxUnknownOrderMechanicsError(row);
  }
}

class HtxUnknownOrderStateError extends Error {
  readonly rawVenueObservation: Readonly<Record<string, unknown>>;

  constructor(row: HtxOrderRow) {
    super(`[trader] HTX order state is fail-unknown: ${row.state}`);
    this.name = "HtxUnknownOrderStateError";
    this.rawVenueObservation = Object.freeze({ ...row });
  }
}

class HtxUnknownVenueIdentityError extends Error {
  readonly rawVenueObservation: Readonly<Record<string, unknown>>;

  constructor(field: string, row: Readonly<Record<string, unknown>>) {
    super(`[trader] HTX ${field} identity is fail-unknown`);
    this.name = "HtxUnknownVenueIdentityError";
    this.rawVenueObservation = Object.freeze({ ...row });
  }
}

class HtxUnknownTradeEvidenceError extends Error {
  readonly rawVenueObservation: Readonly<Record<string, unknown>>;

  constructor(field: string, row: Readonly<Record<string, unknown>>) {
    super(`[trader] HTX trade ${field} is fail-unknown`);
    this.name = "HtxUnknownTradeEvidenceError";
    this.rawVenueObservation = Object.freeze({ ...row });
  }
}

function requireHtxVenueIdentity(
  value: unknown,
  field: string,
  row: Readonly<Record<string, unknown>>,
): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  throw new HtxUnknownVenueIdentityError(field, row);
}

function mapHtxOrderStatus(row: HtxOrderRow): OrderStatus {
  switch (row.state) {
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
      throw new HtxUnknownOrderStateError(row);
  }
}

function msToIso(ms?: number): string {
  if (!ms || ms <= 0) {
    return new Date(0).toISOString();
  }
  return new Date(ms).toISOString();
}

export function mapHtxOrder(row: HtxOrderRow): Order {
  const { side, type } = parseHtxOrderSideAndType(row.type, row);
  const orderId = requireHtxVenueIdentity(row.id, "order", row);
  const createdAt = msToIso(row["created-at"]);
  const quantity = row.amount ?? row["filled-amount"] ?? "0";
  const filledQuantity = row["filled-amount"] ?? "0";

  return {
    orderId,
    clientOrderId: row["client-order-id"] ?? "",
    symbol: htxSymbolToInternal(row.symbol),
    side,
    type,
    status: mapHtxOrderStatus(row),
    price: row.price,
    quantity,
    filledQuantity,
    createdAt,
    updatedAt: createdAt,
    rawVenueObservation: Object.freeze({ ...row }),
  };
}

export function mapHtxMatchResult(row: HtxMatchResultRow): Trade {
  const { side } = parseHtxOrderSideAndType(row.type, row);
  const tradeId = requireHtxVenueIdentity(row["trade-id"], "trade", row);
  const orderId = requireHtxVenueIdentity(row["order-id"], "order", row);
  if (typeof row["filled-fees"] !== "string" || row["filled-fees"].trim() === "") {
    throw new HtxUnknownTradeEvidenceError("fee", row);
  }
  if (typeof row["fee-currency"] !== "string" || row["fee-currency"].trim() === "") {
    throw new HtxUnknownTradeEvidenceError("fee currency", row);
  }
  return {
    tradeId,
    orderId,
    clientOrderId: "",
    symbol: htxSymbolToInternal(row.symbol),
    side,
    price: row.price,
    quantity: row["filled-amount"],
    fee: row["filled-fees"],
    feeAsset: row["fee-currency"].toUpperCase(),
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
