// @vitest-environment node
import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHtxObservationGetTransport } from "@/lib/trader/account-observation/htx-get-transport";
import { createHtxAccountObservationReader, type HtxObservationGetTransport } from "@/lib/trader/account-observation/htx-reader";
import type { ObservationBinding, ObservationClock } from "@/lib/trader/account-observation/types";

const NOW = Date.parse("2026-09-09T12:00:00Z");
const API_KEY = "synthetic_public_test_key";
const API_SECRET = "synthetic-secret-used-only-in-unit-tests";
const binding: ObservationBinding = Object.freeze({ organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "123",
  credentialRevision: "1", configurationRevision: "config-v1" });
type Input = Parameters<typeof createHtxObservationGetTransport>[0];
type Request = Parameters<HtxObservationGetTransport["signedGet"]>[0];
const clock: ObservationClock = { now: () => NOW, sleep: (ms, signal) => new Promise((resolve, reject) => {
  const cancel = () => { clearTimeout(timer); reject(new Error("aborted")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
  signal.addEventListener("abort", cancel, { once: true }); if (signal.aborted) cancel();
}) };
function request(overrides: Partial<Request> = {}): Request {
  return { method: "GET", path: "/v1/account/accounts/123/balance", query: {},
    maxResponseBytes: 1024, signal: new AbortController().signal, ...overrides };
}
function setup(overrides: Partial<Input> = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{"status":"ok","data":[]}'));
  const verifyReadAdmission = vi.fn<Input["verifyReadAdmission"]>(async () => true);
  const input: Input = { binding, apiKey: API_KEY, apiSecret: API_SECRET, host: "api.huobi.pro",
    symbols: ["BTCUSDT"], timeoutMs: 1000, clock, fetchImpl, verifyReadAdmission, ...overrides };
  return { input, fetchImpl, verifyReadAdmission, transport: createHtxObservationGetTransport(input) };
}
function streamed(chunks: Uint8Array[], options: { status?: number; headers?: Record<string, string>; close?: boolean } = {}) {
  const cancel = vi.fn(); let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else if (options.close !== false) controller.close();
    }, cancel,
  }, { highWaterMark: 0 });
  const response = new Response(stream, { status: options.status ?? 200, headers: options.headers });
  return { response, cancel, getReader: vi.spyOn(stream, "getReader") };
}
afterEach(() => vi.useRealTimers());

describe("admitted HTX GET observation transport with synthetic keys and in-memory fetch", () => {
  it("signs the canonical GET payload and checks the exact binding/key digest before and after reading", async () => {
    const f = setup(); const result = await f.transport.signedGet(request({ path: "/v1/order/openOrders",
      query: { size: "100", "account-id": "123" } }));
    expect(result).toEqual({ binding, httpStatus: 200, body: '{"status":"ok","data":[]}' });
    expect(Object.isFrozen(result.binding)).toBe(true);
    const [rawUrl, init] = f.fetchImpl.mock.calls[0]; const url = new URL(String(rawUrl));
    expect(url.origin).toBe("https://api.huobi.pro"); expect(url.pathname).toBe("/v1/order/openOrders");
    const expectedCanonical = "AccessKeyId=synthetic_public_test_key&SignatureMethod=HmacSHA256&SignatureVersion=2&" +
      "Timestamp=2026-09-09T12%3A00%3A00&account-id=123&size=100";
    const expectedSignature = createHmac("sha256", API_SECRET)
      .update(`GET\napi.huobi.pro\n/v1/order/openOrders\n${expectedCanonical}`).digest("base64");
    expect(url.searchParams.get("Signature")).toBe(expectedSignature);
    expect(url.searchParams.get("AccessKeyId")).toBe(API_KEY);
    expect(String(rawUrl)).not.toContain(API_SECRET);
    expect(init).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", cache: "no-store",
      headers: { Accept: "application/json" } });
    expect(init).not.toHaveProperty("body");
    const keyDigest = createHash("sha256").update(API_KEY).digest("hex");
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(2);
    for (const [scope, digest] of f.verifyReadAdmission.mock.calls) {
      expect(scope).toEqual(binding); expect(digest).toBe(keyDigest);
    }
  });
  it("supports only the other explicitly allowed host", async () => {
    const f = setup({ host: "api-aws.huobi.pro" }); await f.transport.signedGet(request());
    expect(new URL(String(f.fetchImpl.mock.calls[0][0])).host).toBe("api-aws.huobi.pro");
    expect(() => setup({ host: "attacker.test" as Input["host"] })).toThrow();
  });
  it.each([
    { method: "POST" }, { method: "DELETE" }, { path: "/v1/order/orders/place" },
    { path: "/v1/order/orders/456/submitcancel" }, { path: "/v1/account/accounts/999/balance" },
    { path: "https://attacker.test/v1/order/openOrders" }, { path: "/v1/order/orders/123?submitcancel=1" },
    { path: "/v1/order/orders/../123" }, { path: "/v1/order/orders/0" },
    { query: { AccessKeyId: "substituted" } }, { maxResponseBytes: 0 }, { maxResponseBytes: 1_048_577 },
  ])("refuses unsafe request %j before admission or fetch", async override => {
    const f = setup();
    await expect(f.transport.signedGet(request(override as Partial<Request>))).rejects.toThrow();
    expect(f.verifyReadAdmission).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { "account-id": "999", size: "100" }, { "account-id": "123", size: "501" },
    { "account-id": "123", size: "1", from: "456" }, { "account-id": "123", size: "1", direct: "next" },
    { "account-id": "123", size: "1", from: "456", direct: "prev" },
    { "account-id": "123", size: "1", symbol: "btcusdt" },
    { "account-id": "123", size: "1", Signature: "supplied" },
  ])("rejects unscoped/unbounded/extra open-order parameters %j", async query => {
    const f = setup(); await expect(f.transport.signedGet(request({ path: "/v1/order/openOrders", query }))).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("admits only scoped trade history and paired forward pagination", async () => {
    const f = setup(); const query = { symbol: "btcusdt", "start-time": String(NOW - 60_000),
      "end-time": String(NOW), size: "2", from: "77", direct: "next" };
    await f.transport.signedGet(request({ path: "/v1/order/matchresults", query }));
    const url = new URL(String(f.fetchImpl.mock.calls[0][0])); expect(url.searchParams.get("from")).toBe("77");
    expect(url.searchParams.get("symbol")).toBe("btcusdt");
    const invalidPatches: ReadonlyArray<Record<string, string>> = [{ symbol: "ethusdt" }, { "start-time": String(NOW - 172_800_001) },
      { "end-time": String(NOW + 1) }, { "start-time": String(NOW) }, { "start-time": "9999999999999999" },
      { types: "buy-limit" }];
    for (const patch of invalidPatches) {
      const invalid = setup();
      await expect(invalid.transport.signedGet(request({ path: "/v1/order/matchresults", query: { ...query, ...patch } })))
        .rejects.toThrow();
      expect(invalid.fetchImpl).not.toHaveBeenCalled();
    }
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("allows order identity GETs but no extra query authority", async () => {
    const f = setup(); await f.transport.signedGet(request({ path: "/v1/order/orders/456" }));
    expect(new URL(String(f.fetchImpl.mock.calls[0][0])).pathname).toBe("/v1/order/orders/456");
    await expect(f.transport.signedGet(request({ path: "/v1/order/orders/456", query: { "account-id": "999" } })))
      .rejects.toThrow(); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("pre-read admission refusal never signs or sends", async () => {
    const f = setup(); f.verifyReadAdmission.mockResolvedValue(false);
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("post-read admission refusal prevents data publication", async () => {
    const f = setup(); f.verifyReadAdmission.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(2);
  });
  it("copies bound identity so caller mutation cannot replace the admitted account", async () => {
    const mutable = { ...binding }; const f = setup({ binding: mutable }); mutable.exchangeAccountId = "999";
    await f.transport.signedGet(request());
    expect(f.verifyReadAdmission.mock.calls[0][0].exchangeAccountId).toBe("123");
    expect(new URL(String(f.fetchImpl.mock.calls[0][0])).pathname).toContain("/123/");
  });
  it("preserves valid multibyte UTF-8 split across chunks without parsing JSON", async () => {
    const f = setup(); const bytes = new TextEncoder().encode('{"value":"é"}');
    const byteIndex = bytes.indexOf(0xc3); const stream = streamed([bytes.slice(0, byteIndex + 1), bytes.slice(byteIndex + 1)]);
    f.fetchImpl.mockResolvedValueOnce(stream.response);
    expect(await f.transport.signedGet(request())).toMatchObject({ body: '{"value":"é"}' });
  });
  it("enforces actual bytes before finishing or parsing a streamed response", async () => {
    const f = setup(); const stream = streamed([new Uint8Array([0x61, 0x61]), new Uint8Array([0xc3, 0xa9])], { close: false });
    f.fetchImpl.mockResolvedValueOnce(stream.response);
    await expect(f.transport.signedGet(request({ maxResponseBytes: 3 }))).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(stream.cancel).toHaveBeenCalledTimes(1); expect(f.verifyReadAdmission).toHaveBeenCalledTimes(1);
  });
  it.each(["1025", "NaN", "-1", "1.5"])("rejects bad/excess content-length %s before reading", async length => {
    const f = setup(); const stream = streamed([new TextEncoder().encode("sensitive")], { close: false,
      headers: { "content-length": length } }); f.fetchImpl.mockResolvedValueOnce(stream.response);
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(stream.getReader).not.toHaveBeenCalled(); expect(stream.cancel).toHaveBeenCalledTimes(1);
  });
  it.each([new Uint8Array([0xc3, 0x28]), new Uint8Array([0xc3])])("rejects malformed UTF-8 %j", async chunk => {
    const f = setup(); const stream = streamed([chunk]); f.fetchImpl.mockResolvedValueOnce(stream.response);
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(1);
  });
  it.each([429, 403, 401, 500])("returns HTTP %s with an empty body and post-admission check", async status => {
    const f = setup(); const stream = streamed([new TextEncoder().encode("sensitive echoed signature")], { status, close: false });
    f.fetchImpl.mockResolvedValueOnce(stream.response);
    expect(await f.transport.signedGet(request())).toEqual({ binding, httpStatus: status, body: "" });
    expect(stream.getReader).not.toHaveBeenCalled(); expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(2);
  });
  it.each(["redirected", "foreign-url", "redirect-status"])("refuses %s response and cancels its body", async kind => {
    const f = setup(); const stream = streamed([], { close: false, status: kind === "redirect-status" ? 302 : 200 });
    if (kind === "redirected") Object.defineProperty(stream.response, "redirected", { value: true });
    if (kind === "foreign-url") Object.defineProperty(stream.response, "url", { value: "https://attacker.test/" });
    f.fetchImpl.mockResolvedValueOnce(stream.response);
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(stream.cancel).toHaveBeenCalledTimes(1); expect(stream.getReader).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected admission, fetch and body failures", async () => {
    const f = setup(); f.verifyReadAdmission.mockRejectedValueOnce(new Error("SECRET admission key"));
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ message: "READ_FAILED" });
    const network = setup(); network.fetchImpl.mockRejectedValueOnce(new Error("SECRET signed URL"));
    await expect(network.transport.signedGet(request())).rejects.toMatchObject({ message: "READ_FAILED" });
    expect(network.fetchImpl).toHaveBeenCalledTimes(1);
    const body = setup(); body.fetchImpl.mockResolvedValueOnce(new Response(
      new ReadableStream({ pull(controller) { controller.error(new Error("SECRET body")); } })));
    await expect(body.transport.signedGet(request())).rejects.toMatchObject({ message: "READ_FAILED" });
    expect(body.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("rejects an already cancelled request before admission", async () => {
    const f = setup(); const abort = new AbortController(); abort.abort();
    await expect(f.transport.signedGet(request({ signal: abort.signal }))).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(f.verifyReadAdmission).not.toHaveBeenCalled();
  });
  it("cancels a stalled body on caller abort", async () => {
    const f = setup(); const stream = streamed([], { close: false }); f.fetchImpl.mockResolvedValueOnce(stream.response);
    const abort = new AbortController(); const pending = f.transport.signedGet(request({ signal: abort.signal }));
    await vi.waitFor(() => expect(stream.getReader).toHaveBeenCalled()); abort.abort();
    await expect(pending).rejects.toMatchObject({ code: "READ_FAILED" }); expect(stream.cancel).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("deadline ends an ignored fetch and cancels its eventual late response", async () => {
    vi.useFakeTimers(); const f = setup(); let finish!: (response: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.transport.signedGet(request()); const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000); await assertion;
    expect(f.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const late = streamed([], { close: false }); finish(late.response); await vi.advanceTimersByTimeAsync(0);
    expect(late.cancel).toHaveBeenCalledTimes(1); expect(late.getReader).not.toHaveBeenCalled();
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("deadline bounds stalled admission without sending after it eventually resolves", async () => {
    vi.useFakeTimers(); const f = setup(); let finish!: (accepted: boolean) => void;
    f.verifyReadAdmission.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.transport.signedGet(request()); const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000); await assertion; finish(true); await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("disposal interrupts active requests, rejects reuse, and cancels late bodies", async () => {
    const f = setup(); let finish!: (response: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.transport.signedGet(request()); await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalled());
    f.transport.dispose(); f.transport.dispose(); await expect(pending).rejects.toMatchObject({ code: "READ_FAILED" });
    const late = streamed([], { close: false }); finish(late.response); await vi.waitFor(() => expect(late.cancel).toHaveBeenCalledTimes(1));
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("allows sequential requests and refuses overlapping owners", async () => {
    const f = setup(); let finish!: (response: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = f.transport.signedGet(request());
    await expect(f.transport.signedGet(request())).rejects.toMatchObject({ code: "READ_FAILED" });
    await vi.waitFor(() => expect(f.fetchImpl).toHaveBeenCalledTimes(1));
    finish(new Response("first")); await expect(first).resolves.toMatchObject({ body: "first" });
    await expect(f.transport.signedGet(request())).resolves.toMatchObject({ httpStatus: 200 });
    expect(f.fetchImpl).toHaveBeenCalledTimes(2); expect(f.verifyReadAdmission).toHaveBeenCalledTimes(4);
  });
  it("composes the real local reader and transport for balances, partial orders and account-proven partial trades", async () => {
    const f = setup();
    const order = { id: 456, "account-id": 123, symbol: "btcusdt", type: "buy-limit", state: "submitted",
      amount: "1", "filled-amount": "0.2", price: "42", "created-at": NOW - 5000 };
    f.fetchImpl.mockImplementation(async url => {
      const path = new URL(String(url)).pathname;
      const data = path.endsWith("/balance") ? { id: 123, type: "spot", state: "working", list: [
        { currency: "btc", type: "trade", balance: "0.100000000000000001" },
        { currency: "btc", type: "frozen", balance: "0.200000000000000002" }] } :
        path === "/v1/order/openOrders" ? [order] : path === "/v1/order/orders/456" ? order :
          path === "/v1/order/matchresults" ? [{ id: 77, "trade-id": 88, "order-id": 456, symbol: "btcusdt",
            type: "buy-limit", price: "42", "filled-amount": "0.2", "filled-fees": "0.01",
            "fee-currency": "btc", "created-at": NOW - 1000 }] : null;
      return new Response(JSON.stringify({ status: "ok", data }));
    });
    const reader = createHtxAccountObservationReader({ transport: f.transport, clock }, {
      binding, symbols: ["BTC/USDT"], readTimeoutMs: 1000, pageSize: 2, maxPages: 2,
      maxRecords: 5, maxResponseBytes: 8192, tradeWindowMs: 60_000 });
    const balances = await reader.readBalances(new AbortController().signal);
    const orders = await reader.readOpenOrders(new AbortController().signal);
    const trades = await reader.readTrades("BTCUSDT", new AbortController().signal);
    expect(balances).toMatchObject({ binding, complete: true, sourceAsOfMs: null,
      values: [{ total: "0.300000000000000003" }] });
    expect(orders).toMatchObject({ binding, complete: false, sourceAsOfMs: null,
      values: [{ orderId: "456", updatedAt: null }] });
    expect(trades).toMatchObject({ binding, complete: false, sourceAsOfMs: null,
      values: [{ orderId: "456", tradeId: "88", symbol: "BTCUSDT" }] });
    expect(f.fetchImpl).toHaveBeenCalledTimes(4);
    expect(f.fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(8); reader.dispose();
  });
});
