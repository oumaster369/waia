/** Static, read-only contract for documented HTX USDT-M V5 observation routes.
 * Mode and route capability remain separate. This module performs no I/O. */
import { types } from "node:util";

export const HTX_V5_READ_ONLY_ROUTES = Object.freeze({
  assetMode: "/v5/account/asset_mode",
  balance: "/v5/account/balance",
  positions: "/v5/trade/position/opens",
  openOrders: "/v5/trade/order/opens",
  algoOrders: "/v5/algo/order/opens",
  fills: "/v5/trade/order/details",
} as const);

export type HtxV5ReadRoute = (typeof HTX_V5_READ_ONLY_ROUTES)[keyof typeof HTX_V5_READ_ONLY_ROUTES];
export type HtxV5MarginMode = "cross" | "isolated";
export type HtxV5PositionSide = "long" | "short" | "both";
export type HtxV5Side = "buy" | "sell";
export type HtxV5AlgoType = "tp" | "sl" | "tpsl" | "trigger" | "trailing_stop";

export type HtxV5ReadRequest = Readonly<{
  method: "GET";
  path: HtxV5ReadRoute;
  query: Readonly<Record<string, string>>;
}>;

const MAX_PAGE_SIZE = 100;
const MAX_QUERY_ID_DIGITS = 19;
const MAX_SIGNED_LONG = 9_223_372_036_854_775_807n;
const MAX_FILL_WINDOW_MS = 48 * 60 * 60 * 1000;
const USDT_CONTRACT = /^[A-Z0-9]+-USDT(?:-\d{6})?$/;
const SIMPLE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const fail = (): never => {
  throw new Error("HTX_V5_INVALID_RESPONSE");
};
const badRequest = (): never => {
  throw new Error("HTX_V5_INVALID_READ_REQUEST");
};

function request(path: HtxV5ReadRoute, query: Record<string, string> = {}): HtxV5ReadRequest {
  return Object.freeze({ method: "GET", path, query: Object.freeze(query) });
}

function snapshotBuilderInput(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || types.isProxy(value) || Array.isArray(value))
    return badRequest();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return badRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowedKeys.includes(key)) return badRequest();
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return badRequest();
    result[key] = descriptor.value;
  }
  return result;
}

function validateContractCode(value: unknown): string {
  if (typeof value !== "string" || !USDT_CONTRACT.test(value)) return badRequest();
  return value;
}

export function buildHtxV5AssetModeRequest(): HtxV5ReadRequest {
  return request(HTX_V5_READ_ONLY_ROUTES.assetMode);
}

export function buildHtxV5BalanceRequest(): HtxV5ReadRequest {
  return request(HTX_V5_READ_ONLY_ROUTES.balance);
}

export function buildHtxV5PositionsRequest(
  input: Readonly<{ contractCode?: string }> = {},
): HtxV5ReadRequest {
  const safeInput = snapshotBuilderInput(input, ["contractCode"]);
  const contractCode = safeInput.contractCode;
  if (contractCode !== undefined) validateContractCode(contractCode);
  return request(HTX_V5_READ_ONLY_ROUTES.positions, {
    ...(contractCode ? { contract_code: validateContractCode(contractCode) } : {}),
  });
}

function boundedCursor(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d{0,18})$/.test(value) ||
    value.length > MAX_QUERY_ID_DIGITS ||
    BigInt(value) > MAX_SIGNED_LONG
  )
    return badRequest();
  return value;
}

function boundedLimit(value: unknown): string {
  const limit = value ?? MAX_PAGE_SIZE;
  if (
    typeof limit !== "number" ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  )
    badRequest();
  return String(limit);
}

function optionalText(value: unknown, pattern = SIMPLE_ID): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !pattern.test(value)) return badRequest();
  return value;
}

function validatedMarginMode(value: unknown): HtxV5MarginMode | undefined {
  if (value === undefined) return undefined;
  if (value === "cross" || value === "isolated") return value;
  return badRequest();
}

function validatedAlgoType(value: unknown): HtxV5AlgoType {
  if (
    value === "tp" ||
    value === "sl" ||
    value === "tpsl" ||
    value === "trigger" ||
    value === "trailing_stop"
  )
    return value;
  return badRequest();
}

export function buildHtxV5OpenOrdersRequest(
  input: Readonly<{
    contractCode?: string;
    marginMode?: HtxV5MarginMode;
    orderId?: string;
    clientOrderId?: string;
    from?: string;
    limit?: number;
  }> = {},
): HtxV5ReadRequest {
  const safeInput = snapshotBuilderInput(input, [
    "contractCode",
    "marginMode",
    "orderId",
    "clientOrderId",
    "from",
    "limit",
  ]);
  const contractCode = safeInput.contractCode;
  const marginMode = validatedMarginMode(safeInput.marginMode);
  if (contractCode !== undefined) validateContractCode(contractCode);
  const query: Record<string, string> = {
    limit: boundedLimit(safeInput.limit),
    direct: "next",
  };
  if (contractCode !== undefined) query.contract_code = validateContractCode(contractCode);
  if (marginMode) query.margin_mode = marginMode as HtxV5MarginMode;
  const orderId = optionalText(safeInput.orderId);
  const clientOrderId = optionalText(safeInput.clientOrderId);
  if (orderId !== undefined) query.order_id = orderId;
  if (clientOrderId !== undefined) query.client_order_id = clientOrderId;
  const from = boundedCursor(safeInput.from);
  if (from !== undefined) query.from = from;
  return request(HTX_V5_READ_ONLY_ROUTES.openOrders, query);
}

export function buildHtxV5AlgoOrdersRequest(
  input: Readonly<{
    type: HtxV5AlgoType;
    contractCode?: string;
    algoId?: string;
    algoClientOrderId?: string;
    from?: string;
    limit?: number;
  }>,
): HtxV5ReadRequest {
  const safeInput = snapshotBuilderInput(input, [
    "type",
    "contractCode",
    "algoId",
    "algoClientOrderId",
    "from",
    "limit",
  ]);
  const type = validatedAlgoType(safeInput.type);
  const contractCode = safeInput.contractCode;
  if (contractCode !== undefined) validateContractCode(contractCode);
  const query: Record<string, string> = {
    type,
    limit: boundedLimit(safeInput.limit),
    direct: "next",
  };
  if (contractCode !== undefined) query.contract_code = validateContractCode(contractCode);
  const algoId = optionalText(safeInput.algoId);
  const algoClientOrderId = optionalText(safeInput.algoClientOrderId);
  if (algoId !== undefined) query.algo_id = algoId;
  if (algoClientOrderId !== undefined) query.algo_client_order_id = algoClientOrderId;
  const from = boundedCursor(safeInput.from);
  if (from !== undefined) query.from = from;
  return request(HTX_V5_READ_ONLY_ROUTES.algoOrders, query);
}

export function buildHtxV5FillsRequest(
  input: Readonly<{
    contractCode: string;
    orderId?: string;
    startTimeMs: number;
    endTimeMs: number;
    from?: string;
    limit?: number;
  }>,
): HtxV5ReadRequest {
  const safeInput = snapshotBuilderInput(input, [
    "contractCode",
    "orderId",
    "startTimeMs",
    "endTimeMs",
    "from",
    "limit",
  ]);
  const contractCode = validateContractCode(safeInput.contractCode);
  if (
    typeof safeInput.startTimeMs !== "number" ||
    typeof safeInput.endTimeMs !== "number" ||
    !Number.isSafeInteger(safeInput.startTimeMs) ||
    safeInput.startTimeMs < 0 ||
    !Number.isSafeInteger(safeInput.endTimeMs) ||
    safeInput.endTimeMs <= safeInput.startTimeMs ||
    safeInput.endTimeMs - safeInput.startTimeMs > MAX_FILL_WINDOW_MS
  )
    badRequest();
  const query: Record<string, string> = {
    contract_code: contractCode,
    start_time: String(safeInput.startTimeMs),
    end_time: String(safeInput.endTimeMs),
    limit: boundedLimit(safeInput.limit),
    direct: "next",
  };
  const orderId = optionalText(safeInput.orderId);
  if (orderId !== undefined) query.order_id = orderId;
  const from = boundedCursor(safeInput.from);
  if (from !== undefined) query.from = from;
  return request(HTX_V5_READ_ONLY_ROUTES.fills, query);
}

/** Raw HTX account setting only. This enum does not prove which API family is enabled. */
export type HtxV5AssetMode = "0" | "1" | "2";
export type HtxV5AssetModeSnapshot = Readonly<{
  assetMode: HtxV5AssetMode;
  responseGeneratedAtMs: number | null;
}>;
export type HtxV5Page<T> = Readonly<{
  rows: readonly T[];
  /** The venue's final `id` is a candidate cursor. Endpoint exhaustion is undocumented. */
  nextFrom: string | null;
  completeness: "unknown";
  responseGeneratedAtMs: number | null;
}>;

export type HtxV5BalanceDetail = Readonly<{
  currency: string;
  equity: string;
  isolatedEquity: string;
  available: string;
  isolatedAvailable: string;
  withdrawAvailable: string;
  profitUnreal: string;
  isolatedProfitUnreal: string;
  initialMargin: string;
  maintenanceMargin: string;
  maintenanceMarginRate: string;
  initialMarginRate: string;
  voucher: string;
  voucherValue: string;
  createdTimeMs: number | null;
  updatedTimeMs: number | null;
}>;

export type HtxV5BalanceSnapshot = Readonly<{
  state: "normal" | "liquidating" | "adl" | "open_limit";
  /** Account-wide USD aggregates; keep separate from per-currency details. */
  account: Readonly<{
    equityUsd: string;
    initialMarginUsd: string;
    maintenanceMarginUsd: string;
    maintenanceMarginRate: string;
    profitUnrealUsd: string;
    availableMarginUsd: string;
    voucherValue: string;
    createdTimeMs: number | null;
    updatedTimeMs: number | null;
  }>;
  details: readonly HtxV5BalanceDetail[];
  responseGeneratedAtMs: number | null;
}>;

export type HtxV5Position = Readonly<{
  contractCode: string;
  positionSide: HtxV5PositionSide;
  direction: HtxV5Side;
  marginMode: HtxV5MarginMode;
  volume: string;
  available: string;
  openAveragePrice: string;
  liquidationPrice: string | null;
  initialMargin: string | null;
  maintenanceMargin: string;
  margin: string;
  profitUnreal: string;
  profitRate: string;
  marginRate: string;
  marginCurrency: string;
  lastPrice: string;
  markPrice: string;
  contractType: string;
  createdTimeMs: number | null;
  updatedTimeMs: number | null;
}>;

export type HtxV5OpenOrder = Readonly<{
  id: string;
  contractCode: string;
  orderId: string;
  clientOrderId: string | null;
  side: HtxV5Side;
  positionSide: HtxV5PositionSide;
  marginMode: HtxV5MarginMode;
  volume: string;
  state: "new" | "partially_filled" | "filled" | "partially_canceled" | "canceled";
  reduceOnly: boolean | null;
  tpTriggerPrice: string | null;
  slTriggerPrice: string | null;
  createdTimeMs: number | null;
  updatedTimeMs: number | null;
}>;

export type HtxV5AlgoOrder = Readonly<{
  id: string;
  algoId: string;
  contractCode: string;
  volume: string;
  type: HtxV5AlgoType;
  state: "active";
  positionSide: HtxV5PositionSide;
  side: HtxV5Side;
  marginMode: HtxV5MarginMode;
  tpTriggerPrice: string | null;
  slTriggerPrice: string | null;
  reduceOnly: boolean | null;
  createdTimeMs: number | null;
  updatedTimeMs: number | null;
}>;

export type HtxV5Fill = Readonly<{
  id: string;
  tradeId: string;
  orderId: string;
  contractCode: string;
  side: HtxV5Side;
  positionSide: HtxV5PositionSide;
  orderType: "1" | "3" | "4" | "22";
  marginMode: HtxV5MarginMode;
  tradePrice: string;
  tradeVolume: string;
  tradeTurnover: string;
  tradeFee: string;
  feeCurrency: string;
  profit: string;
  createdTimeMs: number | null;
  updatedTimeMs: number | null;
}>;

/** Bounded JSON reader: preserve numeric lexemes and reject duplicate keys before projection. */
function parseJson(input: string): unknown {
  if (typeof input !== "string" || input.length > 1_048_576) return fail();
  let i = 0;
  let nodes = 0;
  const ws = () => {
    while (/[ \t\r\n]/.test(input[i] ?? "")) i++;
  };
  const readString = (): string => {
    if (input[i] !== '"') return fail();
    const start = i++;
    while (i < input.length) {
      const c = input[i++]!;
      if (c === '"') {
        try {
          return JSON.parse(input.slice(start, i)) as string;
        } catch {
          return fail();
        }
      }
      if (c === "\\") i++;
      else if (c.charCodeAt(0) < 0x20) return fail();
    }
    return fail();
  };
  const value = (depth = 0): unknown => {
    if (depth > 64 || ++nodes > 20_000) return fail();
    ws();
    if (input[i] === '"') return readString();
    if (input[i] === "{") {
      i++;
      ws();
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      if (input[i] === "}") {
        i++;
        return out;
      }
      while (true) {
        ws();
        const key = readString();
        if (Object.hasOwn(out, key)) return fail();
        ws();
        if (input[i++] !== ":") return fail();
        out[key] = value(depth + 1);
        ws();
        const sep = input[i++];
        if (sep === "}") return out;
        if (sep !== ",") return fail();
      }
    }
    if (input[i] === "[") {
      i++;
      ws();
      const out: unknown[] = [];
      if (input[i] === "]") {
        i++;
        return out;
      }
      while (true) {
        out.push(value(depth + 1));
        ws();
        const sep = input[i++];
        if (sep === "]") return out;
        if (sep !== ",") return fail();
      }
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (input.startsWith(literal, i)) {
        i += literal.length;
        return result;
      }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(i));
    if (!match) return fail();
    i += match[0].length;
    return match[0];
  };
  const parsed = value();
  ws();
  if (i !== input.length) return fail();
  return parsed;
}

type Dict = Record<string, unknown>;
function object(value: unknown): Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Dict)
    : fail();
}
function text(value: unknown): string {
  return typeof value === "string" && value.length <= 256 ? value : fail();
}
function decimal(value: unknown, nonnegative = false): string {
  const raw = text(value);
  if (
    !(nonnegative ? /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/ : /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/).test(
      raw,
    ) ||
    raw.length > 80
  )
    return fail();
  return raw;
}
function nullableDecimal(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return decimal(value);
}
function timestamp(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = typeof value === "string" ? value : fail();
  if (!/^\d{1,15}$/.test(raw)) return fail();
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : fail();
}
function envelope(payload: string): Readonly<{ data: unknown; ts: number | null }> {
  const value = object(parseJson(payload));
  if (value.code !== "200") return fail();
  const ts = timestamp(value.ts);
  return Object.freeze({ data: value.data, ts });
}
function rowsEnvelope(payload: string): Readonly<{ rows: readonly Dict[]; ts: number | null }> {
  const env = envelope(payload);
  if (!Array.isArray(env.data) || env.data.length > MAX_PAGE_SIZE) return fail();
  return Object.freeze({ rows: env.data.map(object), ts: env.ts });
}
function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  const raw = text(value);
  return values.includes(raw as T) ? (raw as T) : fail();
}
function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const raw = text(value);
  return SIMPLE_ID.test(raw) ? raw : fail();
}
function cursorId(value: unknown): string {
  const raw = text(value);
  return /^(?:0|[1-9]\d{0,18})$/.test(raw) && BigInt(raw) <= MAX_SIGNED_LONG ? raw : fail();
}
function page<T>(rows: readonly T[], ts: number | null, getId?: (row: T) => string): HtxV5Page<T> {
  const seen = new Set<string>();
  for (let index = 0; index < rows.length; index++) {
    const key = getId?.(rows[index]!) ?? String(index);
    if (seen.has(key)) return fail();
    seen.add(key);
  }
  return Object.freeze({
    rows: Object.freeze([...rows]),
    nextFrom: getId && rows.length ? getId(rows[rows.length - 1]!) : null,
    completeness: "unknown",
    responseGeneratedAtMs: ts,
  });
}

export function parseHtxV5AssetMode(payload: string): HtxV5AssetModeSnapshot {
  const env = envelope(payload);
  const data = object(env.data);
  if (data.asset_mode === "0" || data.asset_mode === "1" || data.asset_mode === "2") {
    return Object.freeze({ assetMode: data.asset_mode, responseGeneratedAtMs: env.ts });
  }
  return fail();
}

function requiredAmounts(value: Dict, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) out[key] = decimal(value[key]);
  return out;
}

export function parseHtxV5Balance(payload: string): HtxV5BalanceSnapshot {
  const env = envelope(payload);
  const data = object(env.data);
  const state = enumValue(data.state, ["normal", "liquidating", "adl", "open_limit"] as const);
  const accountAmounts = requiredAmounts(data, [
    "equity",
    "initial_margin",
    "maintenance_margin",
    "maintenance_margin_rate",
    "profit_unreal",
    "available_margin",
    "voucher_value",
  ]);
  if (!Array.isArray(data.details) || data.details.length > 100) return fail();
  const currencies = new Set<string>();
  const details = data.details.map((entry): HtxV5BalanceDetail => {
    const row = object(entry);
    const currency = text(row.currency);
    if (!/^[A-Z0-9]{2,16}$/.test(currency)) return fail();
    if (currencies.has(currency)) return fail();
    currencies.add(currency);
    const amounts = requiredAmounts(row, [
      "equity",
      "isolated_equity",
      "available",
      "isolated_available",
      "withdraw_available",
      "profit_unreal",
      "isolated_profit_unreal",
      "initial_margin",
      "maintenance_margin",
      "maintenance_margin_rate",
      "initial_margin_rate",
      "voucher",
      "voucher_value",
    ]);
    return Object.freeze({
      currency,
      equity: amounts.equity!,
      isolatedEquity: amounts.isolated_equity!,
      available: amounts.available!,
      isolatedAvailable: amounts.isolated_available!,
      withdrawAvailable: amounts.withdraw_available!,
      profitUnreal: amounts.profit_unreal!,
      isolatedProfitUnreal: amounts.isolated_profit_unreal!,
      initialMargin: amounts.initial_margin!,
      maintenanceMargin: amounts.maintenance_margin!,
      maintenanceMarginRate: amounts.maintenance_margin_rate!,
      initialMarginRate: amounts.initial_margin_rate!,
      voucher: amounts.voucher!,
      voucherValue: amounts.voucher_value!,
      createdTimeMs: timestamp(row.created_time),
      updatedTimeMs: timestamp(row.updated_time),
    });
  });
  return Object.freeze({
    state,
    account: Object.freeze({
      equityUsd: accountAmounts.equity!,
      initialMarginUsd: accountAmounts.initial_margin!,
      maintenanceMarginUsd: accountAmounts.maintenance_margin!,
      maintenanceMarginRate: accountAmounts.maintenance_margin_rate!,
      profitUnrealUsd: accountAmounts.profit_unreal!,
      availableMarginUsd: accountAmounts.available_margin!,
      voucherValue: accountAmounts.voucher_value!,
      createdTimeMs: timestamp(data.created_time),
      updatedTimeMs: timestamp(data.updated_time),
    }),
    details: Object.freeze(details),
    responseGeneratedAtMs: env.ts,
  });
}

function contract(value: unknown): string {
  const raw = text(value);
  return USDT_CONTRACT.test(raw) ? raw : fail();
}

export function parseHtxV5Positions(payload: string): HtxV5Page<HtxV5Position> {
  const env = rowsEnvelope(payload);
  const rows = env.rows.map((row) => {
    const contractCode = contract(row.contract_code);
    const positionSide = enumValue(row.position_side, ["long", "short", "both"] as const);
    const direction = enumValue(row.direction, ["buy", "sell"] as const);
    const marginMode = enumValue(row.margin_mode, ["cross", "isolated"] as const);
    const volume = decimal(row.volume, true);
    const available = decimal(row.available, true);
    return Object.freeze({
      contractCode,
      positionSide,
      direction,
      marginMode,
      volume,
      available,
      openAveragePrice: decimal(row.open_avg_price),
      liquidationPrice: nullableDecimal(row.liquidation_price),
      initialMargin: nullableDecimal(row.initial_margin),
      maintenanceMargin: decimal(row.maintenance_margin),
      margin: decimal(row.margin),
      profitUnreal: decimal(row.profit_unreal),
      profitRate: decimal(row.profit_rate),
      marginRate: decimal(row.margin_rate),
      marginCurrency: text(row.margin_currency),
      lastPrice: decimal(row.last_price),
      markPrice: decimal(row.mark_price),
      contractType: text(row.contract_type),
      createdTimeMs: timestamp(row.created_time),
      updatedTimeMs: timestamp(row.updated_time),
    });
  });
  const positionsSeen = new Set<string>();
  for (const row of rows) {
    const key = `${row.contractCode}\u0000${row.marginMode}\u0000${row.positionSide}`;
    if (positionsSeen.has(key)) return fail();
    positionsSeen.add(key);
  }
  return page(rows, env.ts);
}

export function parseHtxV5OpenOrders(payload: string): HtxV5Page<HtxV5OpenOrder> {
  const env = rowsEnvelope(payload);
  const rows = env.rows.map(
    (row): HtxV5OpenOrder =>
      Object.freeze({
        id: cursorId(row.id),
        contractCode: contract(row.contract_code),
        orderId: optionalId(row.order_id) ?? fail(),
        clientOrderId: optionalId(row.client_order_id),
        side: enumValue(row.side, ["buy", "sell"] as const),
        positionSide: enumValue(row.position_side, ["long", "short", "both"] as const),
        marginMode: enumValue(row.margin_mode, ["cross", "isolated"] as const),
        volume: decimal(row.volume, true),
        state: enumValue(row.state, [
          "new",
          "partially_filled",
          "filled",
          "partially_canceled",
          "canceled",
        ] as const),
        reduceOnly:
          row.reduce_only === undefined || row.reduce_only === null
            ? null
            : typeof row.reduce_only === "boolean"
              ? row.reduce_only
              : fail(),
        tpTriggerPrice: nullableDecimal(row.tp_trigger_price),
        slTriggerPrice: nullableDecimal(row.sl_trigger_price),
        createdTimeMs: timestamp(row.created_time),
        updatedTimeMs: timestamp(row.updated_time),
      }),
  );
  return page(rows, env.ts, (row) => row.id);
}

export function parseHtxV5AlgoOrders(
  payload: string,
  expectedType: HtxV5AlgoType,
): HtxV5Page<HtxV5AlgoOrder> {
  if (!["tp", "sl", "tpsl", "trigger", "trailing_stop"].includes(expectedType)) return fail();
  const env = rowsEnvelope(payload);
  const rows = env.rows.map((row): HtxV5AlgoOrder => {
    const reduceOnly =
      row.reduce_only === undefined || row.reduce_only === null
        ? null
        : typeof row.reduce_only === "boolean"
          ? row.reduce_only
          : fail();
    return Object.freeze({
      id: cursorId(row.id),
      algoId: optionalId(row.algo_id) ?? fail(),
      contractCode: contract(row.contract_code),
      volume: decimal(row.volume, true),
      type: enumValue(row.type, ["tp", "sl", "tpsl", "trigger", "trailing_stop"] as const),
      state: enumValue(row.state, ["active"] as const),
      positionSide: enumValue(row.position_side, ["long", "short", "both"] as const),
      side: enumValue(row.side, ["buy", "sell"] as const),
      marginMode: enumValue(row.margin_mode, ["cross", "isolated"] as const),
      tpTriggerPrice: nullableDecimal(row.tp_trigger_price),
      slTriggerPrice: nullableDecimal(row.sl_trigger_price),
      reduceOnly,
      createdTimeMs: timestamp(row.created_time),
      updatedTimeMs: timestamp(row.updated_time),
    });
  });
  if (rows.some((row) => row.type !== expectedType)) return fail();
  return page(rows, env.ts, (row) => row.id);
}

export function parseHtxV5Fills(payload: string, expectedContract: string): HtxV5Page<HtxV5Fill> {
  if (typeof expectedContract !== "string" || !USDT_CONTRACT.test(expectedContract)) return fail();
  const env = rowsEnvelope(payload);
  const rows = env.rows.map((row): HtxV5Fill => {
    const contractCode = contract(row.contract_code);
    if (contractCode !== expectedContract) return fail();
    return Object.freeze({
      id: cursorId(row.id),
      tradeId: optionalId(row.trade_id) ?? fail(),
      orderId: optionalId(row.order_id) ?? fail(),
      contractCode,
      side: enumValue(row.side, ["buy", "sell"] as const),
      positionSide: enumValue(row.position_side, ["long", "short", "both"] as const),
      orderType: enumValue(row.order_type, ["1", "3", "4", "22"] as const),
      marginMode: enumValue(row.margin_mode, ["cross", "isolated"] as const),
      tradePrice: decimal(row.trade_price, true),
      tradeVolume: decimal(row.trade_volume, true),
      tradeTurnover: decimal(row.trade_turnover, true),
      tradeFee: decimal(row.trade_fee),
      feeCurrency: text(row.fee_currency),
      profit: decimal(row.profit),
      createdTimeMs: timestamp(row.created_time),
      updatedTimeMs: timestamp(row.updated_time),
    });
  });
  return page(rows, env.ts, (row) => row.id);
}
