// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import { AccountObservationReadFailure } from "@/lib/trader/account-observation/service";
import type { HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";
import type { ObservationBinding, ObservationClock } from "@/lib/trader/account-observation/types";
import { createHtxV5ObservationReader } from "@/lib/trader/account-observation/derivatives/htx-v5-reader";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";

const binding: ObservationBinding = Object.freeze({
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "123",
  credentialRevision: "1",
  configurationRevision: "config-v1",
});
const apiKey = "synthetic-reader-key";
const apiSecret = "synthetic-reader-secret";
const uid = "456";
const ts = 1_791_028_800_000;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function body(path: string): unknown {
  if (path === "/v1/account/accounts")
    return { status: "ok", data: [{ id: 123, type: "spot", state: "working" }] };
  if (path === "/v2/user/uid") return { code: 200, data: Number(uid) };
  if (path === "/v2/user/api-key")
    return { code: 200, data: [{ accessKey: apiKey, status: "normal", permission: "readOnly" }] };
  if (path === "/v5/account/asset_mode") return { code: 200, data: { asset_mode: "1" }, ts };
  if (path === "/v5/account/balance") return { code: 200, data: {
    state: "normal", equity: "0", initial_margin: "0", maintenance_margin: "0",
    maintenance_margin_rate: "0", profit_unreal: "0", available_margin: "0", voucher_value: "0",
    details: [],
  }, ts };
  if (["/v5/trade/position/opens", "/v5/trade/order/opens", "/v5/algo/order/opens", "/v5/trade/order/details"].includes(path))
    return { code: 200, data: [], ts };
  return { code: 404, message: "unsupported" };
}

function credential(): HtxObservationCredentialHandle {
  return Object.freeze({ binding, apiKey, apiSecret, dispose: vi.fn() });
}

function setup(overrides: Readonly<{ uid?: string; contracts?: readonly string[]; fetchImpl?: typeof fetch;
  credential?: HtxObservationCredentialHandle; timeoutMs?: number; maxResponseBytes?: number;
  clock?: ObservationClock }> = {}) {
  const calls: URL[] = [];
  const credentialHandle = overrides.credential ?? credential();
  const fetchImpl = overrides.fetchImpl ?? vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === "api.huobi.pro") return json(body(url.pathname));
    return json(body(url.pathname));
  });
  const reader = createHtxV5ObservationReader({ credential: credentialHandle, clock: overrides.clock ?? accountObservationClock,
    fetchImpl, timeoutMs: overrides.timeoutMs ?? 1000, maxResponseBytes: overrides.maxResponseBytes ?? 4096,
    authorizeCurrent: async () => true,
    ...(overrides.uid ? { expectedHtxUid: overrides.uid } : {}),
    ...(overrides.contracts ? { contracts: overrides.contracts } : {}),
  });
  return { reader, calls, credentialHandle, fetchImpl };
}

function accountEnvelope(htxV5: unknown, status = "PARTIAL", collectionStartedAtMs = ts, collectionCompletedAtMs = ts) {
  return {
    schemaVersion: "account-observation/v3", observationId: "10000000-0000-4000-8000-000000000001",
    binding, collectionStartedAtMs, collectionCompletedAtMs, status,
    balances: { status: "COMPLETE", values: [], sourceAsOfMs: null, readStartedAtMs: ts, readCompletedAtMs: ts, error: null },
    openOrders: { status: "COMPLETE", values: [], sourceAsOfMs: null, readStartedAtMs: ts, readCompletedAtMs: ts, error: null },
    trades: [{ symbol: "BTCUSDT", component: { status: "COMPLETE", values: [], sourceAsOfMs: null,
      readStartedAtMs: ts, readCompletedAtMs: ts, error: null } }],
    holdings: [], htxV5,
  };
}

const openOrderRow = {
  id: "9007199254740993", contract_code: "BTC-USDT", side: "sell", position_side: "long",
  order_id: "123456789012345678", client_order_id: "client_1", margin_mode: "cross", volume: "0.1",
  state: "new", reduce_only: true, tp_trigger_price: "70000", sl_trigger_price: "55000",
  created_time: ts, updated_time: ts,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function mutableCredential() {
  let currentBinding: ObservationBinding = { ...binding };
  let currentKey = apiKey;
  const handle = {
    get binding() { return currentBinding; },
    get apiKey() { return currentKey; },
    apiSecret,
    dispose: vi.fn(),
  } as HtxObservationCredentialHandle;
  return {
    handle,
    changeBinding: () => { currentBinding = { ...binding, configurationRevision: "config-v2" }; },
    changeKey: () => { currentKey = "rotated-reader-key"; },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T12:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("HTX V5 observation reader", () => {
  it("reads the bounded empty projection and preserves descriptive UID and unknown list coverage", async () => {
    const f = setup({ uid });
    const result = await f.reader.read(new AbortController().signal);
    expect(result).toMatchObject({
      schemaVersion: "htx-v5-observation/v1",
      htxUid: uid,
      assetMode: { status: "COMPLETE", value: "1" },
      balance: { status: "COMPLETE", value: { account: { equityUsd: "0" }, details: [] } },
      positions: { status: "COMPLETE", values: [], pageScope: null },
      openOrders: { status: "PARTIAL", values: [], pageScope: { completeness: "UNKNOWN", pagesRead: 1 } },
      algoOrders: { status: "PARTIAL", values: [], pageScope: { completeness: "UNKNOWN", queries: [
        { type: "tp" }, { type: "sl" }, { type: "tpsl" }, { type: "trigger" }, { type: "trailing_stop" },
      ] } },
      fills: { status: "NOT_CONFIGURED", coverage: "NOT_CONFIGURED", values: null },
    });
    expect(f.calls.filter(url => url.hostname === "api.hbdm.com")).toHaveLength(9);
    expect(f.credentialHandle.dispose).not.toHaveBeenCalled();
    expect(result.htxUid).not.toBe(createHash("sha256").update(apiKey).digest("hex"));
    const accountObservation = parseAccountObservation(accountEnvelope(result));
    expect(accountObservation.schemaVersion).toBe("account-observation/v3");
    expect(() => parseAccountObservation(accountEnvelope({ ...result, openOrders: {
      ...result.openOrders, status: "COMPLETE", pageScope: null,
    } }))).toThrow();
    expect(() => parseAccountObservation(accountEnvelope({ ...result, algoOrders: {
      ...result.algoOrders, pageScope: { ...result.algoOrders.pageScope!, queries: [
        ...result.algoOrders.pageScope!.queries.slice(0, 4),
        { ...result.algoOrders.pageScope!.queries[4]!, type: "tp" },
      ] },
    } }))).toThrow();
    expect(() => parseAccountObservation(accountEnvelope({ ...result, algoOrders: {
      ...result.algoOrders, pageScope: { ...result.algoOrders.pageScope!, queries: [
        { ...result.algoOrders.pageScope!.queries[0]!, pagesRead: 3 },
        ...result.algoOrders.pageScope!.queries.slice(1),
      ] },
    } }))).toThrow();
    await f.reader.settled();
  });

  it("reads the configured fill route with an explicit bounded time window and unknown coverage", async () => {
    const f = setup({ uid, contracts: ["BTC-USDT"] });
    const result = await f.reader.read(new AbortController().signal);
    const fills = result.fills;
    expect(fills).toMatchObject({ status: "PARTIAL", values: [], coverage: "CONFIGURED_CONTRACTS_AND_WINDOW",
      contracts: ["BTC-USDT"], pageScope: { completeness: "UNKNOWN", queries: [
        { contractCode: "BTC-USDT", pagesRead: 1, nextFrom: null },
      ] } });
    const fillUrl = f.calls.find(url => url.hostname === "api.hbdm.com" && url.pathname === "/v5/trade/order/details");
    expect(fillUrl?.searchParams.get("contract_code")).toBe("BTC-USDT");
    expect(Number(fillUrl?.searchParams.get("end_time")) - Number(fillUrl?.searchParams.get("start_time"))).toBe(86_400_000);
    const outOfScopeFill = { id: "100", tradeId: "trade_1", orderId: "order_1", contractCode: "ETH-USDT",
      side: "sell", positionSide: "short", orderType: "1", marginMode: "cross", tradePrice: "1",
      tradeVolume: "1", tradeTurnover: "1", tradeFee: "0", feeCurrency: "USDT", profit: "0",
      createdTimeMs: ts, updatedTimeMs: ts };
    expect(() => parseAccountObservation(accountEnvelope({ ...result, fills: {
      ...fills, values: [outOfScopeFill],
    } }))).toThrow();
    expect(() => parseAccountObservation(accountEnvelope({ ...result, fills: {
      ...fills, values: [{ ...outOfScopeFill, contractCode: "BTC-USDT", createdTimeMs: fills.windowEndMs! + 1 }],
    } }))).toThrow();
    expect(() => parseAccountObservation(accountEnvelope({ ...result, fills: {
      ...fills, values: [{ ...outOfScopeFill, contractCode: "BTC-USDT", createdTimeMs: null }],
    } }))).not.toThrow();
    const oversizedOpenOrders = Array.from({ length: 101 }, (_, index) => ({
      id: String(index + 1), orderId: `order_${index + 1}`, contractCode: "BTC-USDT", clientOrderId: null,
      side: "sell", positionSide: "long", marginMode: "cross", volume: "1", state: "new",
      reduceOnly: null, tpTriggerPrice: null, slTriggerPrice: null, createdTimeMs: null, updatedTimeMs: null,
    }));
    expect(() => parseAccountObservation(accountEnvelope({ ...result, openOrders: {
      ...result.openOrders, values: oversizedOpenOrders,
      pageScope: { ...result.openOrders.pageScope!, pagesRead: 1 },
    } }))).toThrow();
    await f.reader.settled();
  });

  it("stays inside the 31-request worst-case page budget across all configured contracts", async () => {
    const requestCount = new Map<string, number>();
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.hostname !== "api.hbdm.com") return json(body(url.pathname));
      const key = url.pathname === "/v5/trade/order/opens" ? url.pathname
        : url.pathname === "/v5/algo/order/opens" ? `${url.pathname}:${url.searchParams.get("type")}`
          : url.pathname === "/v5/trade/order/details" ? `${url.pathname}:${url.searchParams.get("contract_code")}`
            : url.pathname;
      const page = (requestCount.get(key) ?? 0) + 1;
      requestCount.set(key, page);
      const generated = (start: number, size: number, make: (id: number) => unknown) =>
        Array.from({ length: size }, (_, index) => make(start + index));
      if (url.pathname === "/v5/trade/order/opens") {
        const offset = page === 1 ? 1 : 101;
        return json({ code: 200, ts, data: generated(offset, 100, id => ({ ...openOrderRow,
          id: String(id), order_id: `order_${id}`, client_order_id: `client_${id}` })) });
      }
      if (url.pathname === "/v5/algo/order/opens") {
        const type = url.searchParams.get("type")!;
        const offset = page === 1 ? 1 : 21;
        return json({ code: 200, ts, data: generated(offset, 20, id => ({ id: String(id), algo_id: `algo_${type}_${id}`,
          contract_code: "BTC-USDT", volume: "1", type, state: "active", position_side: "long", side: "sell",
          margin_mode: "cross", tp_trigger_price: null, sl_trigger_price: "10", reduce_only: true,
          created_time: ts, updated_time: ts })) });
      }
      if (url.pathname === "/v5/trade/order/details") {
        const contractCode = url.searchParams.get("contract_code")!;
        const offset = page === 1 ? 1 : 13;
        return json({ code: 200, ts, data: generated(offset, 12, id => ({ id: String(id), trade_id: `trade_${id}`,
          order_id: `order_${id}`, contract_code: contractCode, side: "sell", position_side: "short",
          order_type: "1", margin_mode: "cross", trade_price: "1", trade_volume: "1", trade_turnover: "1",
          trade_fee: "0", fee_currency: "USDT", profit: "0", created_time: ts, updated_time: ts })) });
      }
      return json(body(url.pathname));
    });
    const contracts = ["BTC-USDT", "ETH-USDT", "SOL-USDT", "XRP-USDT", "ADA-USDT", "DOGE-USDT", "LTC-USDT", "BCH-USDT"];
    const f = setup({ uid, contracts, fetchImpl, maxResponseBytes: 1_048_576 });
    const result = await f.reader.read(new AbortController().signal);
    expect([...requestCount.values()].reduce((sum, count) => sum + count, 0)).toBe(31);
    expect(f.fetchImpl).toHaveBeenCalledTimes(31 * 7);
    expect(result.openOrders.values).toHaveLength(200);
    expect(result.algoOrders.values).toHaveLength(200);
    expect(result.fills.values).toHaveLength(192);
    expect(result.fills.pageScope?.queries).toHaveLength(8);
    await f.reader.settled();
  });

  it("keeps a first open-order page partial when the next page fails and records the failed attempt time", async () => {
    let pages = 0;
    let nowMs = ts;
    let secondPageResponseAt = ts;
    const clock = { now: () => nowMs++, sleep: accountObservationClock.sleep.bind(accountObservationClock) };
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com" && url.pathname === "/v5/trade/order/opens") {
        pages++;
        if (pages === 1) return json({ code: 200, data: [openOrderRow], ts });
        secondPageResponseAt = nowMs;
        return json({ code: 500, message: "route error" });
      }
      return json(body(url.pathname));
    });
    const f = setup({ uid, fetchImpl, clock });
    const result = await f.reader.read(new AbortController().signal);
    expect(result.openOrders).toMatchObject({ status: "PARTIAL", error: "INVALID_RESPONSE", values: [{ id: openOrderRow.id }],
      pageScope: { pagesRead: 1, nextFrom: openOrderRow.id, completeness: "UNKNOWN" } });
    expect(result.openOrders.readCompletedAtMs).toBeGreaterThan(secondPageResponseAt);
    const completedAt = Math.max(result.assetMode.readCompletedAtMs!, result.balance.readCompletedAtMs!,
      result.positions.readCompletedAtMs!, result.openOrders.readCompletedAtMs!, result.algoOrders.readCompletedAtMs!,
      result.fills.readCompletedAtMs ?? 0);
    expect(parseAccountObservation(accountEnvelope(result, "PARTIAL", ts, completedAt)).htxV5).toMatchObject({
      openOrders: { status: "PARTIAL", error: "INVALID_RESPONSE" },
    });
    await f.reader.settled();
  });

  it.each(["openOrders", "algoOrders", "fills"] as const)("rejects a %s response larger than its requested page limit", async component => {
    const makeAlgo = (id: number, type: string) => ({ id: String(id), algo_id: `algo_${type}_${id}`,
      contract_code: "BTC-USDT", volume: "1", type, state: "active", position_side: "long", side: "sell",
      margin_mode: "cross", tp_trigger_price: null, sl_trigger_price: "10", reduce_only: true,
      created_time: String(ts), updated_time: String(ts) });
    const makeFill = (id: number) => ({ id: String(id), trade_id: `trade_${id}`, order_id: `order_${id}`,
      contract_code: "BTC-USDT", side: "sell", position_side: "short", order_type: "1", margin_mode: "cross",
      trade_price: "1", trade_volume: "1", trade_turnover: "1", trade_fee: "0", fee_currency: "USDT",
      profit: "0", created_time: String(ts), updated_time: String(ts) });
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com" && component === "openOrders" && url.pathname === "/v5/trade/order/opens")
        return json({ code: 200, data: Array.from({ length: 101 }, (_, i) => ({ ...openOrderRow,
          id: String(i + 1), order_id: `order_${i + 1}`, client_order_id: `client_${i + 1}` })), ts });
      if (url.hostname === "api.hbdm.com" && component === "algoOrders" && url.pathname === "/v5/algo/order/opens" &&
          url.searchParams.get("type") === "tp")
        return json({ code: 200, data: Array.from({ length: 21 }, (_, i) => makeAlgo(i + 1, "tp")), ts });
      if (url.hostname === "api.hbdm.com" && component === "fills" && url.pathname === "/v5/trade/order/details")
        return json({ code: 200, data: Array.from({ length: 13 }, (_, i) => makeFill(i + 1)), ts });
      return json(body(url.pathname));
    });
    const f = setup({ uid, fetchImpl, ...(component === "fills" ? { contracts: ["BTC-USDT"] } : {}) });
    const result = await f.reader.read(new AbortController().signal);
    expect(result[component]).toMatchObject({ status: "ERROR", values: null, error: "INVALID_RESPONSE" });
    await f.reader.settled();
  });

  it("records the failed fills page completion time", async () => {
    let pages = 0;
    let nowMs = ts;
    let failedPageResponseAt = ts;
    const clock = { now: () => nowMs++, sleep: accountObservationClock.sleep.bind(accountObservationClock) };
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com" && url.pathname === "/v5/trade/order/details") {
        pages++;
        if (pages === 1) return json({ code: 200, data: Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1),
          trade_id: `trade_${i + 1}`, order_id: `order_${i + 1}`, contract_code: "BTC-USDT", side: "sell",
          position_side: "short", order_type: "1", margin_mode: "cross", trade_price: "1", trade_volume: "1",
          trade_turnover: "1", trade_fee: "0", fee_currency: "USDT", profit: "0", created_time: String(ts),
          updated_time: String(ts) })), ts });
        failedPageResponseAt = nowMs;
        return json({ code: 500, message: "route error" });
      }
      return json(body(url.pathname));
    });
    const f = setup({ uid, contracts: ["BTC-USDT"], fetchImpl, clock });
    const result = await f.reader.read(new AbortController().signal);
    expect(result.fills).toMatchObject({ status: "ERROR", error: "INVALID_RESPONSE", values: null });
    expect(result.fills.readCompletedAtMs).toBeGreaterThan(failedPageResponseAt);
    await f.reader.settled();
  });

  it("rejects duplicate IDs across cursor pages", async () => {
    let pages = 0;
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com" && url.pathname === "/v5/trade/order/opens") {
        pages++;
        return json({ code: 200, data: [openOrderRow], ts });
      }
      return json(body(url.pathname));
    });
    const f = setup({ uid, fetchImpl });
    await expect(f.reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(pages).toBe(2);
    await f.reader.settled();
  });

  it("accepts a post-admission identity check later than the response receive time", async () => {
    let now = ts;
    const clock = { now: () => now++, sleep: accountObservationClock.sleep.bind(accountObservationClock) };
    const credentialHandle = credential();
    const fetchImpl = vi.fn<typeof fetch>(async input => json(body(new URL(String(input)).pathname)));
    const reader = createHtxV5ObservationReader({ credential: credentialHandle, clock, fetchImpl,
      timeoutMs: 1000, maxResponseBytes: 4096, authorizeCurrent: async () => true });
    const result = await reader.read(new AbortController().signal);
    expect(result.htxUid).toBe(uid);
    expect(result.assetMode.readCompletedAtMs).toBeGreaterThan(ts);
    await reader.settled();
  });

  it.each(["binding", "key"] as const)("abandons the poll when the protected %s changes between requests", async mutation => {
    const mutable = mutableCredential();
    let changed = false;
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      const response = json(body(url.pathname));
      if (!changed && url.hostname === "api.hbdm.com") {
        changed = true;
        if (mutation === "binding") mutable.changeBinding(); else mutable.changeKey();
      }
      return response;
    });
    const f = setup({ credential: mutable.handle, fetchImpl });
    await expect(f.reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await f.reader.settled();
    expect(mutable.handle.dispose).not.toHaveBeenCalled();
  });

  it("abandons the poll when a later transport owner discovers a different UID", async () => {
    let uidReads = 0;
    let v5Reads = 0;
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const url = new URL(String(input));
      if (url.hostname === "api.huobi.pro") {
        if (url.pathname === "/v2/user/uid") uidReads++;
        const metadata = body(url.pathname);
        if (url.pathname === "/v2/user/uid") return json({ code: 200, data: uidReads <= 2 ? 456 : 789 });
        return json(metadata);
      }
      if (url.hostname === "api.hbdm.com") v5Reads++;
      return json(body(url.pathname));
    });
    const f = setup({ fetchImpl });
    await expect(f.reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await f.reader.settled();
    expect(v5Reads).toBe(1);
  });

  it("rejects invalid contract scope before any network request", () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => setup({ contracts: ["BTC/USDT"], fetchImpl })).toThrow(AccountObservationReadFailure);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects proxy-backed contract arrays without invoking their traps", () => {
    let trapped = false;
    const contracts = new Proxy(["BTC-USDT"], { get() { trapped = true; throw new Error("trap"); } });
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => createHtxV5ObservationReader({ credential: credential(), clock: accountObservationClock,
      fetchImpl, timeoutMs: 1000, maxResponseBytes: 4096, authorizeCurrent: async () => true,
      contracts: contracts as unknown as readonly string[] })).toThrow(AccountObservationReadFailure);
    expect(trapped).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects when less than one request quantum remains before constructing a transport", async () => {
    let calls = 0;
    const clock = { now: () => (++calls === 1 ? ts : ts + 120_000), sleep: accountObservationClock.sleep.bind(accountObservationClock) };
    const fetchImpl = vi.fn<typeof fetch>();
    const reader = createHtxV5ObservationReader({ credential: credential(), clock, fetchImpl,
      timeoutMs: 1000, maxResponseBytes: 4096, authorizeCurrent: async () => true });
    await expect(reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(fetchImpl).not.toHaveBeenCalled();
    await reader.settled();
  });

  it("abandons the whole projection when the verified UID disagrees with the expected UID", async () => {
    const f = setup({ uid: "999" });
    await expect(f.reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    await f.reader.settled();
    expect(f.calls.filter(url => url.hostname === "api.hbdm.com")).toHaveLength(0);
    expect(f.credentialHandle.dispose).not.toHaveBeenCalled();
  });

  it("rejects a timed-out late fetch promptly while settled waits for its late body cancellation", async () => {
    const lateResponse = deferred<Response>();
    const bodyCancel = deferred<void>();
    const v5Started = deferred<void>();
    let v5Fetches = 0;
    const fetchImpl = vi.fn<typeof fetch>(input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com") {
        v5Fetches++;
        v5Started.resolve();
        return lateResponse.promise;
      }
      return Promise.resolve(json(body(url.pathname)));
    });
    const f = setup({ uid, fetchImpl, timeoutMs: 100 });
    const reading = f.reader.read(new AbortController().signal);
    await v5Started.promise;
    await vi.advanceTimersByTimeAsync(100);
    await expect(reading).rejects.toMatchObject({ code: "TIMEOUT" });
    await expect(f.reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(v5Fetches).toBe(1);
    let isSettled = false;
    const settlement = f.reader.settled().then(() => { isSettled = true; });
    await Promise.resolve();
    expect(isSettled).toBe(false);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(JSON.stringify(body("/v5/account/asset_mode")))); },
      cancel() { return bodyCancel.promise; },
    });
    lateResponse.resolve(new Response(stream));
    await Promise.resolve();
    bodyCancel.resolve();
    await settlement;
    expect(isSettled).toBe(true);
    expect(f.credentialHandle.dispose).not.toHaveBeenCalled();
  });

  it("enforces the wall-clock whole-read deadline when the injected clock does not advance", async () => {
    const v5Started = deferred<void>();
    let v5Fetches = 0;
    const frozenClock = { now: () => ts, sleep: accountObservationClock.sleep.bind(accountObservationClock) };
    const fetchImpl = vi.fn<typeof fetch>(input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com") {
        v5Fetches++;
        v5Started.resolve();
        return new Promise<Response>(resolve => setTimeout(() => resolve(json({ code: 500, message: "route error" })),
          50_000));
      }
      return Promise.resolve(json(body(url.pathname)));
    });
    const reader = createHtxV5ObservationReader({ credential: credential(), clock: frozenClock, fetchImpl,
      timeoutMs: 120_000, maxResponseBytes: 4096, authorizeCurrent: async () => true });
    const reading = reader.read(new AbortController().signal);
    await v5Started.promise;
    await vi.advanceTimersByTimeAsync(120_000);
    await expect(reading).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(v5Fetches).toBeGreaterThanOrEqual(2);
    const requestsAtTimeout = v5Fetches;
    await expect(reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(v5Fetches).toBe(requestsAtTimeout);
    const settlement = reader.settled();
    await vi.advanceTimersByTimeAsync(30_000);
    await settlement;
  });

  it("parent cancellation rejects promptly while a late fetch remains owned until settlement", async () => {
    const lateResponse = deferred<Response>();
    const v5Started = deferred<void>();
    const fetchImpl = vi.fn<typeof fetch>(input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com") {
        v5Started.resolve();
        return lateResponse.promise;
      }
      return Promise.resolve(json(body(url.pathname)));
    });
    const f = setup({ uid, fetchImpl });
    const controller = new AbortController();
    const reading = f.reader.read(controller.signal);
    await v5Started.promise;
    controller.abort();
    await expect(reading).rejects.toMatchObject({ code: "READ_FAILED" });
    let isSettled = false;
    const settlement = f.reader.settled().then(() => { isSettled = true; });
    await Promise.resolve();
    expect(isSettled).toBe(false);
    lateResponse.resolve(json(body("/v5/account/asset_mode")));
    await settlement;
    expect(isSettled).toBe(true);
    expect(f.credentialHandle.dispose).not.toHaveBeenCalled();
  });

  it("owner disposal rejects the read immediately and still tracks an unresolved fetch", async () => {
    const lateResponse = deferred<Response>();
    const v5Started = deferred<void>();
    const fetchImpl = vi.fn<typeof fetch>(input => {
      const url = new URL(String(input));
      if (url.hostname === "api.hbdm.com") {
        v5Started.resolve();
        return lateResponse.promise;
      }
      return Promise.resolve(json(body(url.pathname)));
    });
    const f = setup({ uid, fetchImpl });
    const reading = f.reader.read(new AbortController().signal);
    await v5Started.promise;
    f.reader.dispose();
    await expect(reading).rejects.toMatchObject({ code: "READ_FAILED" });
    const settlement = f.reader.settled();
    lateResponse.resolve(json(body("/v5/account/asset_mode")));
    await settlement;
    expect(f.credentialHandle.dispose).not.toHaveBeenCalled();
  });
});
