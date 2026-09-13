import { afterEach, describe, expect, it, vi } from "vitest";
import { createHtxAccountObservationReader, normalizeHtxObservationSymbol,
  type HtxObservationGetTransport, type HtxObservationReaderOptions } from "@/lib/trader/account-observation/htx-reader";
import type { ObservationBinding, ObservationClock } from "@/lib/trader/account-observation/types";

const NOW = 1_750_000_000_000;
const binding: ObservationBinding = Object.freeze({ organizationId: "org", credentialId: "credential",
  exchangeAccountId: "123", credentialRevision: "r1", configurationRevision: "c1" });
const options: HtxObservationReaderOptions = { binding, symbols: ["BTC/USDT"], readTimeoutMs: 1000,
  pageSize: 2, maxPages: 2, maxRecords: 5, maxResponseBytes: 8192, tradeWindowMs: 60_000 };
const signal = () => new AbortController().signal;
const balance = () => ({ id: 123, type: "spot", state: "working", list: [
  { currency: "btc", type: "trade", balance: "0.100000000000000001" },
  { currency: "btc", type: "frozen", balance: "0.200000000000000002" },
] });
const order = (overrides: Record<string, unknown> = {}) => ({ id: 456, "account-id": 123,
  symbol: "btcusdt", type: "buy-limit", state: "submitted", amount: "1", "filled-amount": "0",
  price: "42", "created-at": NOW - 1000, ...overrides });
const trade = (overrides: Record<string, unknown> = {}) => ({ id: 77, "trade-id": 88, "order-id": 456,
  symbol: "btcusdt", type: "buy-limit", price: "42", "filled-amount": "0.2", "filled-fees": "0.01",
  "fee-currency": "btc", "created-at": NOW - 500, ...overrides });
const clock: ObservationClock = { now: () => NOW, sleep: (ms, abort) => new Promise((resolve, reject) => {
  const cancel = () => { clearTimeout(timer); reject(new Error("aborted")); };
  const timer = setTimeout(() => { abort.removeEventListener("abort", cancel); resolve(); }, ms);
  abort.addEventListener("abort", cancel, { once: true }); if (abort.aborted) cancel();
}) };
function setup(overrides: Partial<HtxObservationReaderOptions> = {}) {
  const signedGet = vi.fn<HtxObservationGetTransport["signedGet"]>(async request => ({ binding,
    httpStatus: 200, body: JSON.stringify({ status: "ok", data: request.path.endsWith("/balance") ? balance() :
      request.path === "/v1/order/openOrders" ? [order()] : request.path === "/v1/order/matchresults" ? [trade()] : order() }) }));
  const dispose = vi.fn();
  const transport: HtxObservationGetTransport = { binding, signedGet, dispose };
  return { signedGet, dispose, transport,
    reader: createHtxAccountObservationReader({ transport, clock }, { ...options, ...overrides }) };
}
function response(data: unknown, changes = {}) { return { binding, httpStatus: 200,
  body: JSON.stringify({ status: "ok", data }), ...changes }; }
afterEach(() => vi.useRealTimers());

describe("HTX observation reader (injected transport; no real venue)", () => {
  it("adds balances exactly, preserves observed zero and refuses to invent source time", async () => {
    const f = setup(); const read = await f.reader.readBalances(signal());
    expect(read).toEqual({ binding, complete: true, sourceAsOfMs: null, values: [
      { asset: "BTC", free: "0.100000000000000001", locked: "0.200000000000000002", total: "0.300000000000000003" }] });
    expect(f.signedGet.mock.calls[0][0]).toMatchObject({ method: "GET", path: "/v1/account/accounts/123/balance",
      query: {}, maxResponseBytes: 8192 });
    f.signedGet.mockResolvedValueOnce(response({ ...balance(), list: [] }));
    expect((await f.reader.readBalances(signal())).values).toEqual([]);
  });
  it.each([null, undefined, {}, "", [{ currency: "btc", type: "loan", balance: "1" }],
    [{ currency: "btc", type: "trade", balance: "NaN" }],
    [{ currency: "btc", type: "trade", balance: "-1" }]])("never turns malformed balances %j into zero", async list => {
    const f = setup(); f.signedGet.mockResolvedValueOnce(response({ ...balance(), list }));
    await expect(f.reader.readBalances(signal())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects repeated balance buckets", async () => {
    const f = setup(); f.signedGet.mockResolvedValueOnce(response({ ...balance(), list: [balance().list[0], balance().list[0]] }));
    await expect(f.reader.readBalances(signal())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each(["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision"])(
    "rejects transport and response %s substitution", async key => {
      const f = setup(); const changed = { ...binding, [key]: "999" };
      expect(() => createHtxAccountObservationReader({ clock, transport: { ...f.transport, binding: changed } }, options))
        .toThrow("IDENTITY_MISMATCH");
      f.signedGet.mockResolvedValueOnce(response(balance(), { binding: changed }));
      await expect(f.reader.readBalances(signal())).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    });
  it("rejects foreign account data and inactive or nonspot balances", async () => {
    const f = setup();
    for (const [patch, code] of [[{ id: 999 }, "IDENTITY_MISMATCH"], [{ type: "margin" }, "IDENTITY_MISMATCH"],
      [{ state: "lock" }, "PERMISSION_DENIED"]] as const) {
      f.signedGet.mockResolvedValueOnce(response({ ...balance(), ...patch }));
      await expect(f.reader.readBalances(signal())).rejects.toMatchObject({ code });
    }
  });
  it("preserves order creation time, represents unknown update time, and strips raw fields", async () => {
    const f = setup(); f.signedGet.mockResolvedValueOnce(response([order({ privateVenueField: "private" })]));
    const read = await f.reader.readOpenOrders(signal());
    expect(read).toMatchObject({ complete: false, sourceAsOfMs: null, values: [{ symbol: "BTCUSDT",
      createdAt: new Date(NOW - 1000).toISOString(), updatedAt: null, quantity: "1", filledQuantity: "0" }] });
    expect(JSON.stringify(read)).not.toContain("private");
    expect(f.signedGet.mock.calls[0][0].query).toEqual({ "account-id": "123", size: "2" });
  });
  it.each([{ "account-id": 999 }, { "account-id": undefined }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { type: "buy-market" }, { type: "buy-stop-limit" }, { state: "filled" }, { "created-at": undefined },
    { "created-at": NOW + 1 }, { amount: "0" }, { "filled-amount": "2" }, { price: "bad" }])(
    "rejects unprovable order %j", async patch => {
      const f = setup(); f.signedGet.mockResolvedValueOnce(response([order(patch)]));
      await expect(f.reader.readOpenOrders(signal())).rejects.toThrow();
    });
  it("bounds pages and marks capped or repeated open-order pages partial", async () => {
    const f = setup({ maxPages: 1 }); f.signedGet.mockResolvedValueOnce(response([order(), order({ id: 455 })]));
    expect(await f.reader.readOpenOrders(signal())).toMatchObject({ complete: false, values: [{ orderId: "456" }, { orderId: "455" }] });
    expect(f.signedGet).toHaveBeenCalledTimes(1);
    const g = setup(); g.signedGet.mockResolvedValue(response([order(), order({ id: 455 })]));
    expect((await g.reader.readOpenOrders(signal())).complete).toBe(false);
    expect(g.signedGet.mock.calls[1][0].query).toMatchObject({ from: "455", direct: "next" });
  });
  it("trades verify their order account, keep compact symbols and bounded history partial", async () => {
    const f = setup(); const read = await f.reader.readTrades("BTCUSDT", signal());
    expect(read).toMatchObject({ complete: false, sourceAsOfMs: null,
      values: [{ tradeId: "88", orderId: "456", symbol: "BTCUSDT", fee: "0.01" }] });
    expect(f.signedGet.mock.calls.map(([request]) => request.path)).toEqual(["/v1/order/matchresults", "/v1/order/orders/456"]);
    expect(f.signedGet.mock.calls[0][0].query).toEqual({ symbol: "btcusdt", "start-time": String(NOW - 60_000),
      "end-time": String(NOW), size: "2" });
    f.signedGet.mockResolvedValueOnce(response([]));
    expect(await f.reader.readTrades("BTCUSDT", signal())).toMatchObject({ complete: false, values: [] });
  });
  it("uses internal match id for paging and caches account proof only within one component", async () => {
    const f = setup(); f.signedGet.mockResolvedValueOnce(response([trade(), trade({ id: 76, "trade-id": 89 })]))
      .mockResolvedValueOnce(response(order())).mockResolvedValueOnce(response([]));
    const read = await f.reader.readTrades("BTCUSDT", signal()); expect(read.values).toHaveLength(2);
    expect(f.signedGet.mock.calls[2][0].query).toMatchObject({ from: "76", direct: "next" });
    expect(f.signedGet.mock.calls.filter(([request]) => request.path === "/v1/order/orders/456")).toHaveLength(1);
  });
  it("rejects duplicate trade identities and caps record and order-proof work", async () => {
    const f = setup(); f.signedGet.mockResolvedValueOnce(response([trade(), trade({ id: 76 })]));
    await expect(f.reader.readTrades("BTCUSDT", signal())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const g = setup({ maxRecords: 1 }); g.signedGet.mockResolvedValueOnce(response([trade(), trade({ id: 76, "trade-id": 89 })]));
    expect((await g.reader.readTrades("BTCUSDT", signal())).values).toHaveLength(1);
    expect(g.signedGet).toHaveBeenCalledTimes(2);
  });
  it("rejects excessive response rows instead of truncating them as complete", async () => {
    const f = setup(); f.signedGet.mockResolvedValueOnce(response([order(), order({ id: 455 }), order({ id: 454 })]));
    await expect(f.reader.readOpenOrders(signal())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it.each([{ "account-id": 999 }, { "account-id": undefined }, { id: 999 }, { symbol: "ethusdt" }, { type: "sell-limit" }])(
    "refuses trade account relabeling using order proof %j", async patch => {
      const f = setup(); f.signedGet.mockResolvedValueOnce(response([trade()])).mockResolvedValueOnce(response(order(patch)));
      await expect(f.reader.readTrades("BTCUSDT", signal())).rejects.toThrow();
    });
  it.each([{ "filled-fees": "-0.1" }, { "filled-points": "0.1" }, { "fee-currency": undefined },
    { "created-at": NOW - 60_001 }, { symbol: "ethusdt" }, { price: "0" }, { "filled-amount": "0" }])(
    "rejects unsupported or malformed trade %j", async patch => {
      const f = setup(); f.signedGet.mockResolvedValueOnce(response([trade(patch)]));
      await expect(f.reader.readTrades("BTCUSDT", signal())).rejects.toThrow();
    });
  it("normalizes slash notation explicitly and never requests unconfigured symbols", async () => {
    expect(normalizeHtxObservationSymbol("BTC/USDT")).toBe("BTCUSDT");
    const f = setup(); await expect(f.reader.readTrades("ETHUSDT", signal())).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect(f.signedGet).not.toHaveBeenCalled();
    expect(() => normalizeHtxObservationSymbol("../../submitcancel")).toThrow();
  });
  it.each([429, 401, 403, 500])("sanitizes HTTP %s", async httpStatus => {
    const f = setup(); f.signedGet.mockResolvedValueOnce(response(null, { httpStatus, body: "SECRET" }));
    await expect(f.reader.readBalances(signal())).rejects.toMatchObject({ message: httpStatus === 429 ? "RATE_LIMITED" :
      httpStatus === 500 ? "READ_FAILED" : "PERMISSION_DENIED" });
  });
  it.each(["not JSON SECRET", '{"status":"ok"}', '{"status":"ok","data":null}',
    '{"status":"error","err-msg":"SECRET"}', " ".repeat(8193)])("refuses malformed/oversize raw envelopes", async body => {
      const f = setup(); f.signedGet.mockResolvedValueOnce(response(null, { body }));
      await expect(f.reader.readBalances(signal())).rejects.toThrow(/^(INVALID_RESPONSE|READ_FAILED)$/);
    });
  it("sanitizes driver exceptions", async () => {
    const f = setup(); f.signedGet.mockRejectedValueOnce(new Error("signed URL SECRET"));
    await expect(f.reader.readBalances(signal())).rejects.toMatchObject({ message: "READ_FAILED" });
  });
  it("deadline aborts ignored transport and discards late data", async () => {
    vi.useFakeTimers(); const f = setup(); let finish!: (value: Awaited<ReturnType<HtxObservationGetTransport["signedGet"]>>) => void;
    f.signedGet.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.reader.readBalances(signal()); const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000); await assertion;
    expect(f.signedGet.mock.calls[0][0].signal.aborted).toBe(true);
    finish(response(balance())); await Promise.resolve(); expect(f.signedGet).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("caller cancellation and disposal abort pending reads, cleanup is idempotent", async () => {
    const f = setup(); f.signedGet.mockImplementation(() => new Promise(() => {}));
    const abort = new AbortController(); const pending = f.reader.readBalances(abort.signal);
    abort.abort(); await expect(pending).rejects.toMatchObject({ code: "READ_FAILED" });
    const second = f.reader.readBalances(signal()); f.reader.dispose(); f.reader.dispose();
    await expect(second).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.dispose).toHaveBeenCalledTimes(1);
    await expect(f.reader.readOpenOrders(signal())).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.signedGet).toHaveBeenCalledTimes(2);
  });
  it("exposes no submit, cancel, amend or positions capability", () => {
    const f = setup(); expect(Object.keys(f.reader).sort()).toEqual(["dispose", "readBalances", "readOpenOrders", "readTrades"]);
  });
});
