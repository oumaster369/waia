import type { Balance } from "@/lib/trader/connectors/types";
import { AccountObservationReadFailure } from "./service";
import type { AccountObservationReader, ObservationBinding, ObservationClock,
  ObservedOrder, ObservedTrade, ReadEnvelope } from "./types";

type ReadPath = `/v1/account/accounts/${string}/balance` | "/v1/order/openOrders" |
  "/v1/order/matchresults" | `/v1/order/orders/${string}`;
/** Inject only AFTER exact key/account admission. The transport must restrict signing to GET,
 * enforce this endpoint allowlist and stop response streaming at maxResponseBytes BEFORE parsing.
 * No default network, signing, key lookup or credential storage is provided by this adapter. */
export type HtxObservationGetTransport = Readonly<{
  binding: ObservationBinding;
  signedGet(request: Readonly<{ method: "GET"; path: ReadPath;
    query: Readonly<Record<string, string>>; signal: AbortSignal; maxResponseBytes: number }>):
    Promise<Readonly<{ binding: ObservationBinding; httpStatus: number; body: string }>>;
  dispose(): void;
}>;
export type HtxObservationReaderOptions = Readonly<{
  binding: ObservationBinding; symbols: readonly string[];
  readTimeoutMs: number; pageSize: number; maxPages: number; maxRecords: number;
  maxResponseBytes: number; tradeWindowMs: number;
}>;
const bindingKeys = ["organizationId", "credentialId", "exchangeAccountId", "credentialRevision",
  "configurationRevision"] as const;
function fail(code: "INVALID_RESPONSE" | "IDENTITY_MISMATCH" | "READ_FAILED" | "TIMEOUT" |
  "RATE_LIMITED" | "PERMISSION_DENIED" = "INVALID_RESPONSE"): never {
  throw new AccountObservationReadFailure(code);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.length || value.length > 256) fail();
  return value;
}
function id(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d{0,39}$/.test(value)) return value;
  return fail();
}
function sameBinding(left: ObservationBinding, right: ObservationBinding): boolean {
  return !!right && bindingKeys.every(key => left[key] === right[key]);
}
function decimal(value: unknown): string {
  const result = text(value);
  if (!/^\d{1,40}(?:\.\d{1,36})?$/.test(result)) fail();
  return result;
}
function sum(left: string, right: string): string {
  const [la, lb = ""] = left.split("."); const [ra, rb = ""] = right.split(".");
  const scale = Math.max(lb.length, rb.length);
  const total = (BigInt(la + lb.padEnd(scale, "0")) + BigInt(ra + rb.padEnd(scale, "0"))).toString();
  if (!scale) return total;
  const padded = total.padStart(scale + 1, "0");
  return `${padded.slice(0, -scale)}.${padded.slice(-scale)}`.replace(/\.?0+$/, "");
}
function compare(left: string, right: string): number {
  const [la, lb = ""] = left.split("."); const [ra, rb = ""] = right.split(".");
  const scale = Math.max(lb.length, rb.length);
  const a = BigInt(la + lb.padEnd(scale, "0")); const b = BigInt(ra + rb.padEnd(scale, "0"));
  return a === b ? 0 : a < b ? -1 : 1;
}
/** Explicit compact observation symbols; never use the connector's quote-suffix heuristic. */
export function normalizeHtxObservationSymbol(value: string): string {
  if (typeof value !== "string" || !/^(?:[A-Z0-9]{2,32}|[A-Z0-9]{1,16}\/[A-Z0-9]{1,16})$/.test(value)) fail();
  const normalized = value.replace("/", "");
  if (normalized.length > 32) fail();
  return normalized;
}
function venueSymbol(value: unknown): string {
  const symbol = text(value);
  if (!/^[a-z0-9]{2,32}$/.test(symbol)) fail();
  return symbol.toUpperCase();
}
function iso(value: unknown, nowMs: number): string {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > nowMs) fail();
  const result = new Date(value as number); if (!Number.isFinite(result.getTime())) fail();
  return result.toISOString();
}
function side(value: unknown): "buy" | "sell" {
  const type = text(value);
  if (!/^(buy|sell)-(market|limit|ioc|limit-maker|stop-limit|limit-fok|stop-limit-fok)$/.test(type)) fail();
  return type.startsWith("buy-") ? "buy" : "sell";
}
function array(value: unknown, cap: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > cap) fail();
  return value.map(record);
}

/** Local adapter only. Recent trades and ordinary open orders are PARTIAL, even when empty:
 * history is bounded and the separate pre-trigger conditional-order endpoint is not collected.
 * Component sourceAsOfMs stays unknown: these REST endpoints supply no snapshot timestamp. */
export function createHtxAccountObservationReader(deps: Readonly<{
  transport: HtxObservationGetTransport; clock: ObservationClock;
}>, input: HtxObservationReaderOptions): AccountObservationReader {
  const binding = Object.freeze(Object.fromEntries(bindingKeys.map(key => [key, text(input.binding[key])]))) as ObservationBinding;
  id(binding.exchangeAccountId);
  if (!sameBinding(binding, deps.transport.binding)) fail("IDENTITY_MISMATCH");
  const options = Object.freeze({ ...input, binding });
  const symbols = input.symbols.map(normalizeHtxObservationSymbol);
  if (!symbols.length || symbols.length > 32 || new Set(symbols).size !== symbols.length ||
    [options.readTimeoutMs, options.pageSize, options.maxPages, options.maxRecords,
      options.maxResponseBytes, options.tradeWindowMs].some(value => !Number.isSafeInteger(value) || value <= 0) ||
    options.readTimeoutMs > 120_000 || options.pageSize > 500 || options.maxPages > 10 ||
    options.maxRecords > 1000 || options.maxResponseBytes > 1_048_576 || options.tradeWindowMs > 48 * 60 * 60 * 1000) fail();
  const active = new Set<AbortController>(); let disposed = false;
  function now() {
    const value = deps.clock.now(); if (!Number.isSafeInteger(value) || value < 0) fail(); return value;
  }
  function envelope<T>(values: readonly T[], complete: boolean): ReadEnvelope<T> {
    return Object.freeze({ binding, values: Object.freeze([...values]), sourceAsOfMs: null, complete });
  }
  async function bounded<T>(signal: AbortSignal, action: (abort: AbortSignal) => Promise<T>): Promise<T> {
    if (disposed || signal.aborted) fail("READ_FAILED");
    const controller = new AbortController(); active.add(controller);
    let rejectAbort!: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new AccountObservationReadFailure("READ_FAILED"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
    try {
      return await Promise.race([action(controller.signal), cancelled,
        deps.clock.sleep(options.readTimeoutMs, controller.signal).then(() => fail("TIMEOUT"))]);
    } catch (error) {
      if (error instanceof AccountObservationReadFailure && ["INVALID_RESPONSE", "IDENTITY_MISMATCH",
        "READ_FAILED", "TIMEOUT", "RATE_LIMITED", "PERMISSION_DENIED"].includes(error.code)) throw error;
      return fail("READ_FAILED");
    } finally {
      signal.removeEventListener("abort", cancel);
      controller.signal.removeEventListener("abort", rejectAbort); controller.abort(); active.delete(controller);
    }
  }
  async function get(path: ReadPath, query: Record<string, string>, signal: AbortSignal): Promise<unknown> {
    if (disposed || signal.aborted) fail("READ_FAILED");
    if (!sameBinding(binding, deps.transport.binding)) fail("IDENTITY_MISMATCH");
    const response = await deps.transport.signedGet({ method: "GET", path,
      query: Object.freeze({ ...query }), signal, maxResponseBytes: options.maxResponseBytes });
    if (disposed || signal.aborted) fail("READ_FAILED");
    if (!response || !sameBinding(binding, response.binding)) fail("IDENTITY_MISMATCH");
    if (response.httpStatus === 429) fail("RATE_LIMITED");
    if (response.httpStatus === 401 || response.httpStatus === 403) fail("PERMISSION_DENIED");
    if (response.httpStatus !== 200) fail("READ_FAILED");
    if (typeof response.body !== "string" || response.body.length > options.maxResponseBytes ||
      new TextEncoder().encode(response.body).byteLength > options.maxResponseBytes) fail();
    let raw: Record<string, unknown>;
    try { raw = record(JSON.parse(response.body)); } catch { return fail(); }
    if (raw.status !== "ok") {
      if (raw["err-code"] === "base-request-exceed-rate-limit") fail("RATE_LIMITED");
      if (raw.status === "error") fail("READ_FAILED");
      fail();
    }
    if (!("data" in raw) || raw.data === null) fail();
    return raw.data;
  }
  function exactAccount(value: unknown) { if (id(value) !== binding.exchangeAccountId) fail("IDENTITY_MISMATCH"); }
  function order(row: Record<string, unknown>): ObservedOrder {
    exactAccount(row["account-id"]);
    // Market-buy amount is quote currency. Do not relabel it as base quantity.
    if (!["buy-limit", "sell-limit", "sell-market"].includes(text(row.type))) fail();
    const state = row.state;
    if (!["created", "submitted", "partial-filled"].includes(text(state))) fail();
    const quantity = decimal(row.amount); const filledQuantity = decimal(row["filled-amount"]);
    if (compare(filledQuantity, quantity) > 0 || compare(quantity, "0") <= 0) fail();
    return Object.freeze({ orderId: id(row.id), clientOrderId: row["client-order-id"] === undefined ||
      row["client-order-id"] === "" ? "" : text(row["client-order-id"]), symbol: venueSymbol(row.symbol),
    side: side(row.type), type: row.type === "sell-market" ? "market" : "limit",
    status: state === "partial-filled" ? "partially_filled" : "open",
    ...(row.type === "sell-market" ? {} : { price: decimal(row.price) }), quantity, filledQuantity,
    createdAt: iso(row["created-at"], now()), updatedAt: null });
  }
  return Object.freeze({
    readBalances(signal) { return bounded(signal, async abort => {
      const data = record(await get(`/v1/account/accounts/${binding.exchangeAccountId}/balance`, {}, abort));
      exactAccount(data.id);
      if (data.type !== "spot") fail("IDENTITY_MISMATCH");
      if (data.state !== "working") fail("PERMISSION_DENIED");
      const balances = new Map<string, { free: string; locked: string }>(); const seen = new Set<string>();
      for (const row of array(data.list, options.maxRecords)) {
        const currency = text(row.currency); if (!/^[a-z0-9]{1,32}$/.test(currency)) fail();
        if (row.type !== "trade" && row.type !== "frozen") fail();
        const key = `${currency}:${row.type}`; if (seen.has(key)) fail(); seen.add(key);
        const value = decimal(row.balance); const amount = balances.get(currency) ?? { free: "0", locked: "0" };
        if (row.type === "trade") amount.free = value; else amount.locked = value;
        balances.set(currency, amount);
      }
      return envelope<Balance>([...balances].sort(([a], [b]) => a.localeCompare(b)).map(([asset, value]) =>
        Object.freeze({ asset: asset.toUpperCase(), ...value, total: sum(value.free, value.locked) })), true);
    }); },
    readOpenOrders(signal) { return bounded(signal, async abort => {
      const values: ObservedOrder[] = []; const seen = new Set<string>(); let from: string | undefined;
      for (let page = 0; page < options.maxPages; page++) {
        const rows = array(await get("/v1/order/openOrders", { "account-id": binding.exchangeAccountId,
          size: String(options.pageSize), ...(from ? { from, direct: "next" } : {}) }, abort), options.pageSize);
        for (const row of rows) {
          const value = order(row);
          if (seen.has(value.orderId)) return envelope(values, false);
          if (values.length === options.maxRecords) return envelope(values, false);
          seen.add(value.orderId); values.push(value);
        }
        if (rows.length < options.pageSize) return envelope(values, false);
        from = id(rows.at(-1)!.id);
      }
      return envelope(values, false);
    }); },
    readTrades(symbol, signal) { return bounded(signal, async abort => {
      const normalized = normalizeHtxObservationSymbol(symbol); if (!symbols.includes(normalized)) fail("IDENTITY_MISMATCH");
      const end = now();
      if (!Number.isSafeInteger(end) || end < options.tradeWindowMs) fail();
      const start = end - options.tradeWindowMs; const values: ObservedTrade[] = [];
      const seen = new Set<string>(); const tradeIds = new Set<string>();
      const orders = new Map<string, Record<string, unknown>>();
      let from: string | undefined;
      for (let page = 0; page < options.maxPages; page++) {
        const rows = array(await get("/v1/order/matchresults", { symbol: normalized.toLowerCase(),
          "start-time": String(start), "end-time": String(end), size: String(options.pageSize),
          ...(from ? { from, direct: "next" } : {}) }, abort), options.pageSize);
        for (const row of rows) {
          const internalId = id(row.id); const orderId = id(row["order-id"]);
          if (seen.has(internalId) || values.length === options.maxRecords) return envelope(values, false);
          seen.add(internalId);
          const tradeId = id(row["trade-id"]); if (tradeIds.has(tradeId)) fail(); tradeIds.add(tradeId);
          if (venueSymbol(row.symbol) !== normalized) fail("IDENTITY_MISMATCH");
          let proof = orders.get(orderId);
          if (!proof) {
            proof = record(await get(`/v1/order/orders/${orderId}`, {}, abort));
            if (id(proof.id) !== orderId || venueSymbol(proof.symbol) !== normalized) fail("IDENTITY_MISMATCH");
            exactAccount(proof["account-id"]); orders.set(orderId, proof);
          }
          if (side(proof.type) !== side(row.type)) fail("IDENTITY_MISMATCH");
          if (typeof row["created-at"] !== "number" || row["created-at"] < start) fail();
          const executedAt = iso(row["created-at"], end);
          const fee = decimal(row["filled-fees"]); const feeAsset = text(row["fee-currency"]);
          if (!/^[a-z0-9]{1,32}$/.test(feeAsset)) fail();
          // A second fee asset/points or rebate cannot fit the current single positive-fee DTO.
          if (row["filled-points"] !== undefined && compare(decimal(row["filled-points"]), "0") !== 0) fail();
          const price = decimal(row.price); const quantity = decimal(row["filled-amount"]);
          if (compare(price, "0") <= 0 || compare(quantity, "0") <= 0) fail();
          values.push(Object.freeze({ tradeId, orderId, clientOrderId: "",
            symbol: normalized, side: side(row.type), price, quantity, fee, feeAsset: feeAsset.toUpperCase(), executedAt }));
        }
        if (rows.length < options.pageSize) return envelope(values, false);
        from = id(rows.at(-1)!.id);
      }
      return envelope(values, false);
    }); },
    dispose() {
      if (disposed) return; disposed = true;
      for (const controller of active) controller.abort();
      try { deps.transport.dispose(); } catch { fail("READ_FAILED"); }
    },
  });
}
