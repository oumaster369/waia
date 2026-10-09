// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHtxV5ObservationReader, createHtxV5BillsDiagnostics as createReaderBillsDiagnostics } from "@/lib/trader/account-observation/derivatives/htx-v5-reader";
import * as admissionModule from "@/lib/trader/account-observation/htx-read-admission";
import * as transportModule from "@/lib/trader/account-observation/derivatives/htx-v5-read-transport";
import { createHtxV5BillsDiagnostics, parseHtxV5Bills, HTX_V5_BILLS_DIAGNOSTIC_REASONS,
  recordHtxV5BillsDiagnostic, type HtxV5BillsDiagnosticSink } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import type { HtxV5FinancialHistoryScope } from "@/lib/trader/account-observation/types";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";

const ts = 1_791_028_800_000;
const binding = { organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "123", credentialRevision: "1", configurationRevision: "fixture-v1" };
const scope: HtxV5FinancialHistoryScope = { enabled: true, scopeId: "00000000-0000-4000-8000-000000000003",
  windowStartMs: ts - 10000, windowEndMs: ts - 1, validFromMs: ts - 1, validUntilMs: ts + 1000 };
const bill = { id: "1", type: "30", currency: "USDT", amount: "0.10000000000000000001",
  contract_code: "", margin_mode: "cross", created_time: String(ts - 100) };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function response(path: string, rows: unknown[] = [bill]) {
  if (path === "/v1/account/accounts") return { status: "ok", data: [{ id: 123, type: "spot", state: "working" }] };
  if (path === "/v2/user/uid") return { code: 200, data: 456 };
  if (path === "/v2/user/api-key") return { code: 200, data: [{ accessKey: "fixture-key", status: "normal", permission: "readOnly" }] };
  if (path === "/v5/account/asset_mode") return { code: 200, data: { asset_mode: "1" }, ts };
  if (path === "/v5/account/balance") return { code: 200, data: { state: "normal", equity: "1", initial_margin: "0",
    maintenance_margin: "0", maintenance_margin_rate: "0", profit_unreal: "0", available_margin: "1", voucher_value: "0", details: [] }, ts };
  return { code: 200, data: path === "/v5/account/bills" ? rows : [], ts };
}
function setup(options: { scope?: HtxV5FinancialHistoryScope | null; rows?: unknown[];
  billsDiagnosticSink?: HtxV5BillsDiagnosticSink;
  intercept?: (url: URL, init?: RequestInit) => Response | undefined | Promise<Response | undefined>; authorize?: () => Promise<boolean> } = {}) {
  const calls: URL[] = [];
  const input = { credential: { binding, apiKey: "fixture-key", apiSecret: "fixture-secret", dispose() {} },
    clock: accountObservationClock, timeoutMs: 1000, maxResponseBytes: 65536, expectedHtxUid: "456",
    authorizeCurrent: options.authorize ?? (async () => true),
    fetchImpl: vi.fn<typeof fetch>(async (url, init) => { const parsed = new URL(String(url)); calls.push(parsed);
      return await options.intercept?.(parsed, init) ?? json(response(parsed.pathname, options.rows)); }) };
  const reader = createHtxV5ObservationReader({ ...input, ...(options.billsDiagnosticSink === undefined ? {} : { billsDiagnosticSink: options.billsDiagnosticSink }), ...(options.scope === null ? {} : { financialHistory: options.scope ?? scope }) });
  return { reader, input, calls };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(ts); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
const payload = (rows: unknown[] = [bill]) => JSON.stringify({ code: 200, data: rows, ts });
const failure = (read: () => unknown) => {
  try { read(); return null; } catch (error) {
    return error instanceof Error ? { constructor: error.constructor, message: error.message } : error;
  }
};
async function observed(options: Parameters<typeof setup>[0] = {}) {
  const f = setup(options);
  try {
    const result = await f.reader.read(new AbortController().signal);
    return { result, routes: f.calls.map(url => url.pathname) };
  } finally { f.reader.dispose(); await f.reader.settled(); }
}

describe("optional owned bills diagnostics", () => {
  it.each([
    ["BILLS_JSON_INVALID", '{"code":200,"data":[],'],
    ["BILLS_ENVELOPE_INVALID", "[]"],
    ["BILLS_CODE_INVALID", JSON.stringify({ code: 500, data: [], ts })],
    ["BILLS_ENVELOPE_TIMESTAMP_INVALID", JSON.stringify({ code: 200, data: [], ts: "bad" })],
    ["BILLS_DATA_INVALID", JSON.stringify({ code: 200, data: {}, ts })],
    ["BILLS_ROW_SHAPE_INVALID", payload([null])],
    ["BILLS_MARGIN_MODE_INVALID", payload([{ ...bill, margin_mode: "synthetic-secret-canary" }])],
    ["BILLS_DUPLICATE_ID", payload([bill, bill])],
  ] as const)("classifies %s without changing the original exception", (reason, raw) => {
    const diagnostic = createHtxV5BillsDiagnostics();
    const original = failure(() => parseHtxV5Bills(raw));
    expect(original).toMatchObject({ message: "HTX_V5_INVALID_RESPONSE" });
    expect(failure(() => parseHtxV5Bills(raw, diagnostic.sink))).toEqual(original);
    expect(diagnostic.read()).toBe(reason);
    expect(HTX_V5_BILLS_DIAGNOSTIC_REASONS).toContain(diagnostic.read());
    expect(JSON.stringify(diagnostic.read())).not.toContain("synthetic-secret-canary");
    expect(failure(() => parseHtxV5Bills(payload([bill, bill]), diagnostic.sink))).toEqual(original);
    expect(diagnostic.read()).toBe(reason); // bounded first failure, no event list
  });
  it.each([
    ["numeric", '{"code":200,"data":[],"ts":1791028800000}'],
    ["string", '{"code":"200","data":[],"ts":1791028800000}'],
  ] as const)("keeps %s success free of diagnostic details", (_kind, raw) => {
    const diagnostic = createHtxV5BillsDiagnostics();
    expect(parseHtxV5Bills(raw, diagnostic.sink).rows).toEqual([]);
    expect(diagnostic.read()).toBeNull();
    expect(diagnostic.readCodeDiagnostic()).toBeNull();
  });
  it.each([
    ["missing", '{"data":[],"ts":1791028800000}', { httpStatus: null, codeType: "MISSING" }],
    ["wrong-type", '{"code":true,"data":[],"ts":1791028800000}', { httpStatus: null, codeType: "BOOLEAN" }],
    ["null-type", '{"code":null,"data":[],"ts":1791028800000}', { httpStatus: null, codeType: "NULL" }],
    ["object-type", '{"code":{"value":403},"data":[],"ts":1791028800000}', { httpStatus: null, codeType: "OBJECT" }],
    ["array-type", '{"code":[403],"data":[],"ts":1791028800000}', { httpStatus: null, codeType: "ARRAY" }],
    ["nondecimal", '{"code":"bad-code-secret","data":[],"ts":1791028800000}', { httpStatus: null, codeType: "STRING" }],
    ["oversized", '{"code":1234567,"data":[],"ts":1791028800000}', { httpStatus: null, codeType: "NUMBER" }],
    ["bounded-decimal", '{"code":"403","data":[],"ts":1791028800000}', { httpStatus: null, codeType: "STRING", decimalToken: "403" }],
    ["bounded-numeric-decimal", '{"code":403,"data":[],"ts":1791028800000}', { httpStatus: null, codeType: "NUMBER", decimalToken: "403" }],
  ] as const)("retains only bounded code metadata for %s", (_kind, raw, expected) => {
    const diagnostic = createHtxV5BillsDiagnostics();
    const ordinary = failure(() => parseHtxV5Bills(raw));
    expect(failure(() => parseHtxV5Bills(raw, diagnostic.sink))).toEqual(ordinary);
    expect(diagnostic.read()).toBe("BILLS_CODE_INVALID");
    expect(diagnostic.readCodeDiagnostic()).toEqual(expected);
    expect(JSON.stringify(diagnostic.readCodeDiagnostic())).not.toContain("bad-code-secret");
  });
  it("refuses to retain caller-supplied unbounded or accessor-backed code details", () => {
    const diagnostic = createHtxV5BillsDiagnostics();
    const trap = vi.fn(() => { throw new Error("diagnostic-secret-canary"); });
    const accessor = Object.defineProperty({ codeType: "STRING" }, "decimalToken", { enumerable: true, get: trap });
    recordHtxV5BillsDiagnostic(diagnostic.sink, "BILLS_CODE_INVALID", { codeType: "STRING", decimalToken: "diagnostic-secret-canary" });
    expect(diagnostic.read()).toBe("BILLS_CODE_INVALID");
    expect(diagnostic.readCodeDiagnostic()).toBeNull();
    const second = createHtxV5BillsDiagnostics();
    recordHtxV5BillsDiagnostic(second.sink, "BILLS_CODE_INVALID", accessor as never);
    expect(second.readCodeDiagnostic()).toBeNull();
    expect(trap).not.toHaveBeenCalled();
  });
  it("adds HTTP 200 only for a selected bills-code rejection and preserves non-200 behavior", async () => {
    const invalid200 = (url: URL) => url.pathname === "/v5/account/bills"
      ? json({ code: "403", data: [], ts }) : undefined;
    const plain = await observed({ intercept: invalid200 });
    const diagnostic = createHtxV5BillsDiagnostics();
    expect(await observed({ intercept: invalid200, billsDiagnosticSink: diagnostic.sink })).toEqual(plain);
    expect(plain.result).toMatchObject({ bills: { status: "ERROR", error: "INVALID_RESPONSE" } });
    expect(diagnostic.read()).toBe("BILLS_CODE_INVALID");
    expect(diagnostic.readCodeDiagnostic()).toEqual({ httpStatus: 200, codeType: "STRING", decimalToken: "403" });

    const non200 = (url: URL) => url.pathname === "/v5/account/bills"
      ? json({ code: "403", data: [], ts }, 503) : undefined;
    const non200Plain = await observed({ intercept: non200 });
    const non200Diagnostic = createHtxV5BillsDiagnostics();
    expect(await observed({ intercept: non200, billsDiagnosticSink: non200Diagnostic.sink })).toEqual(non200Plain);
    expect(non200Diagnostic.read()).toBeNull();
    expect(non200Diagnostic.readCodeDiagnostic()).toBeNull();
  });
  it("suppresses code details for malformed or duplicate-key JSON", () => {
    for (const raw of ['{"code":403,', '{"code":403,"code":500,"data":[],"ts":1791028800000}']) {
      const diagnostic = createHtxV5BillsDiagnostics();
      expect(failure(() => parseHtxV5Bills(raw, diagnostic.sink))).toEqual(failure(() => parseHtxV5Bills(raw)));
      expect(diagnostic.read()).toBe("BILLS_JSON_INVALID");
      expect(diagnostic.readCodeDiagnostic()).toBeNull();
    }
  });
  it("does not retain code metadata when the existing financial scope expires before parsing", async () => {
    const diagnostic = createHtxV5BillsDiagnostics();
    const intercept = (url: URL) => {
      if (url.pathname !== "/v5/account/bills") return undefined;
      vi.setSystemTime(ts + 2_000);
      return json({ code: 403, data: [], ts });
    };
    const result = await observed({ intercept, billsDiagnosticSink: diagnostic.sink });
    expect(result.result).toMatchObject({ bills: { status: "UNAVAILABLE", unavailableReason: "SCOPE_EXPIRED" } });
    expect(diagnostic.read()).toBeNull();
    expect(diagnostic.readCodeDiagnostic()).toBeNull();
  });
  it("keeps successful parsing, results and requests identical with no event", async () => {
    const diagnostic = createHtxV5BillsDiagnostics();
    expect(parseHtxV5Bills(payload(), diagnostic.sink)).toEqual(parseHtxV5Bills(payload()));
    const original = await observed();
    const enabled = await observed({ billsDiagnosticSink: diagnostic.sink });
    expect(enabled).toEqual(original);
    expect(enabled.routes.filter(path => path === "/v5/account/bills")).toHaveLength(1);
    expect(diagnostic.read()).toBeNull();
    expect(diagnostic.readCodeDiagnostic()).toBeNull();
    expect(Object.isFrozen(diagnostic)).toBe(true);
    expect(Object.isFrozen(diagnostic.sink)).toBe(true);
    expect(Object.keys(diagnostic.sink)).toEqual([]);
  });
  it.each([
    ["BILLS_WINDOW_INVALID", { ...bill, created_time: String(scope.windowEndMs) }],
    ["BILLS_GROUP_INVALID", { ...bill, amount: "1e129" }],
  ] as const)("distinguishes %s with the same failed component and request count", async (reason, row) => {
    const diagnostic = createHtxV5BillsDiagnostics();
    const original = await observed({ rows: [row] });
    const enabled = await observed({ rows: [row], billsDiagnosticSink: diagnostic.sink });
    expect(enabled).toEqual(original);
    expect(enabled.result).toMatchObject({ bills: { status: "ERROR", error: "INVALID_RESPONSE" } });
    expect(enabled.routes.filter(path => path === "/v5/account/bills")).toHaveLength(1);
    expect(diagnostic.read()).toBe(reason);
  });
  it("distinguishes the existing response-timing rejection without changing its result", async () => {
    const factory = transportModule.createHtxV5ReadTransport;
    vi.spyOn(transportModule, "createHtxV5ReadTransport").mockImplementation(input => {
      const transport = factory(input);
      return Object.freeze({ ...transport, readBills: async (...args: Parameters<typeof transport.readBills>) => {
        const result = await transport.readBills(...args);
        return { ...result, receivedAt: ts + 1 };
      } });
    });
    const original = await observed();
    const diagnostic = createHtxV5BillsDiagnostics();
    expect(await observed({ billsDiagnosticSink: diagnostic.sink })).toEqual(original);
    expect(original.result).toMatchObject({ bills: { status: "ERROR", error: "INVALID_RESPONSE" } });
    expect(diagnostic.read()).toBe("BILLS_RESPONSE_TIMING_INVALID");
  });
  it("classifies transport rejection without consuming another body or retrying", async () => {
    const intercept = (url: URL) => url.pathname === "/v5/account/bills"
      ? new Response(payload(), { headers: { "content-length": "invalid" } }) : undefined;
    const original = await observed({ intercept });
    const diagnostic = createHtxV5BillsDiagnostics();
    expect(await observed({ intercept, billsDiagnosticSink: diagnostic.sink })).toEqual(original);
    expect(diagnostic.read()).toBe("BILLS_CONTENT_LENGTH_INVALID");
  });
  it.each([
    ["contract_code", "BILLS_CONTRACT_INVALID", null, "BTC_USDT"],
    ["currency", "BILLS_CURRENCY_INVALID", true, "usdt"],
    ["type", "BILLS_TYPE_INVALID", null, "fee"],
    ["created_time", "BILLS_CREATED_TIME_INVALID", true, "bad"],
    ["id", "BILLS_ID_INVALID", null, "-1"],
    ["margin_mode", "BILLS_MARGIN_MODE_INVALID", true, "unknown"],
    ["amount", "BILLS_AMOUNT_INVALID", null, "NaN"],
  ] as const)("identifies %s for invalid type and format without exposing its value", (field, code, type, format) => {
    for (const value of [type, format]) {
      const diagnostic = createHtxV5BillsDiagnostics();
      const raw = payload([{ ...bill, [field]: value }]);
      expect(failure(() => parseHtxV5Bills(raw, diagnostic.sink))).toEqual(failure(() => parseHtxV5Bills(raw)));
      expect(diagnostic.read()).toBe(code);
      expect(typeof diagnostic.read()).toBe("string");
    }
  });
  it("preserves the original row evaluation order when several fields are invalid", () => {
    const fields = [
      ["contract_code", "BILLS_CONTRACT_INVALID"], ["currency", "BILLS_CURRENCY_INVALID"],
      ["type", "BILLS_TYPE_INVALID"], ["created_time", "BILLS_CREATED_TIME_INVALID"],
      ["id", "BILLS_ID_INVALID"], ["margin_mode", "BILLS_MARGIN_MODE_INVALID"], ["amount", "BILLS_AMOUNT_INVALID"],
    ] as const;
    for (let first = 0; first < fields.length; first++) {
      const row: Record<string, unknown> = { ...bill };
      for (const [field] of fields.slice(first)) row[field] = null;
      const diagnostic = createHtxV5BillsDiagnostics();
      expect(() => parseHtxV5Bills(payload([row]), diagnostic.sink)).toThrow("HTX_V5_INVALID_RESPONSE");
      expect(diagnostic.read()).toBe(fields[first]![1]);
    }
  });
  it.each([
    ["BILLS_CONTENT_LENGTH_EXCEEDS_LIMIT", () => new Response(payload(), { headers: { "content-length": "65537" } })],
    ["BILLS_BODY_MISSING", () => new Response(null)],
    ["BILLS_CHUNK_TYPE_INVALID", () => new Response(new ReadableStream({ start(controller) { controller.enqueue("wrong-type"); controller.close(); } }))],
    ["BILLS_BODY_EXCEEDS_LIMIT", () => new Response(new Uint8Array(65537))],
    ["BILLS_UTF8_CHUNK_INVALID", () => new Response(new Uint8Array([255]))],
    ["BILLS_UTF8_FINAL_INVALID", () => new Response(new Uint8Array([195]))],
    ["BILLS_CREDENTIAL_ECHO", () => new Response(JSON.stringify({ code: 200, data: "fixture-secret" }))],
  ] as const)("retains the exact transport rejection %s and original outcome", async (code, makeResponse) => {
    const intercept = (url: URL) => url.pathname === "/v5/account/bills" ? makeResponse() : undefined;
    const original = await observed({ intercept });
    const diagnostic = createHtxV5BillsDiagnostics();
    expect(await observed({ intercept, billsDiagnosticSink: diagnostic.sink })).toEqual(original);
    expect(diagnostic.read()).toBe(code);
    expect(original.routes.filter(path => path === "/v5/account/bills")).toHaveLength(1);
    expect(JSON.stringify(diagnostic.read())).not.toContain("fixture-secret");
  });
  it("distinguishes transport identity-clock rejection without dispatching a bills request", async () => {
    const factory = admissionModule.createHtxReadAdmission;
    let corrupt = false;
    vi.spyOn(admissionModule, "createHtxReadAdmission").mockImplementation(input => {
      const admission = factory(input);
      return Object.freeze({ ...admission, settled: () => admission.settled(), verifyReadIdentity: async (...args: Parameters<typeof admission.verifyReadIdentity>) => {
        const value = await admission.verifyReadIdentity(...args);
        return corrupt ? { ...value, checkedAt: ts + 1 } : value;
      } });
    });
    const diagnostic = createHtxV5BillsDiagnostics();
    const f = setup();
    const transport = transportModule.createHtxV5ReadTransport({ ...f.input, billsDiagnosticSink: diagnostic.sink });
    corrupt = true;
    try {
      await expect(transport.readBills(scope, new AbortController().signal)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(diagnostic.read()).toBe("BILLS_IDENTITY_CLOCK_INVALID");
      expect(f.calls.some(url => url.pathname === "/v5/account/bills")).toBe(false);
    } finally { transport.dispose(); await transport.settled(); f.reader.dispose(); await f.reader.settled(); }
  });
  it("rejects fake tokens before I/O without invoking throwing functions, accessors or proxy traps", () => {
    const trap = vi.fn(() => { throw new Error("synthetic-secret-canary"); });
    const accessor = Object.defineProperty({}, "reason", { get: trap });
    const proxy = new Proxy({}, { get: trap });
    for (const fake of [accessor, proxy, trap, {}]) {
      expect(() => parseHtxV5Bills(payload(), fake as unknown as HtxV5BillsDiagnosticSink)).toThrow("HTX_V5_INVALID_RESPONSE");
      const fetchImpl = vi.fn<typeof fetch>();
      expect(() => createHtxV5ObservationReader({ credential: { binding, apiKey: "fixture-key", apiSecret: "fixture-secret", dispose() {} },
        clock: accountObservationClock, fetchImpl, timeoutMs: 1000, maxResponseBytes: 65536,
        authorizeCurrent: async () => true, billsDiagnosticSink: fake as unknown as HtxV5BillsDiagnosticSink })).toThrow("INVALID_RESPONSE");
      expect(fetchImpl).not.toHaveBeenCalled();
    }
    expect(trap).not.toHaveBeenCalled();
  });
});


describe("owned bills diagnostics lifecycle and error precedence", () => {
  it("exports the same owned-token factory from the reader module", async () => {
    expect(createReaderBillsDiagnostics).toBe(createHtxV5BillsDiagnostics);
    const diagnostic = createReaderBillsDiagnostics();
    const result = await observed({ rows: [{ ...bill, amount: "NaN" }], billsDiagnosticSink: diagnostic.sink });
    expect(result.result).toMatchObject({ bills: { status: "ERROR", error: "INVALID_RESPONSE" } });
    expect(diagnostic.read()).toBe("BILLS_AMOUNT_INVALID");
  });

  it("keeps scope expiry authoritative with an enabled token and settles pending fetch cleanup", async () => {
    let entered!: () => void;
    const reachedBills = new Promise<void>(resolve => { entered = resolve; });
    const cancelled = vi.fn();
    const diagnostic = createReaderBillsDiagnostics();
    const f = setup({ scope: { ...scope, validUntilMs: ts + 200 }, billsDiagnosticSink: diagnostic.sink,
      intercept: (url, init) => {
        if (url.pathname !== "/v5/account/bills") return undefined;
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener("abort", () => { cancelled(); reject(new Error("synthetic abort")); }, { once: true });
          entered();
        });
      } });
    const reading = f.reader.read(new AbortController().signal);
    try {
      await reachedBills;
      await vi.advanceTimersByTimeAsync(200);
      expect(await reading).toMatchObject({ balance: { status: "COMPLETE" }, bills: {
        status: "UNAVAILABLE", unavailableReason: "SCOPE_EXPIRED", values: null, groups: null } });
      f.reader.dispose();
      await f.reader.settled();
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(f.calls.filter(url => url.pathname === "/v5/account/bills")).toHaveLength(1);
      expect(diagnostic.read()).toBeNull();
    } finally { f.reader.dispose(); await f.reader.settled(); }
  });

  it.each(["abort", "dispose"] as const)("preserves %s failure and body cleanup with a token", async action => {
    let entered!: () => void;
    const reachedBody = new Promise<void>(resolve => { entered = resolve; });
    const cancelled = vi.fn();
    const diagnostic = createReaderBillsDiagnostics();
    const parent = new AbortController();
    const f = setup({ billsDiagnosticSink: diagnostic.sink, intercept: url => {
      if (url.pathname !== "/v5/account/bills") return undefined;
      const body = new ReadableStream<Uint8Array>({
        pull() { entered(); }, // Leave read pending until the existing transport cancels it.
        cancel() { cancelled(); },
      }, { highWaterMark: 0 });
      return new Response(body);
    } });
    const reading = f.reader.read(parent.signal);
    const rejected = expect(reading).rejects.toMatchObject({ code: "READ_FAILED" });
    try {
      await reachedBody;
      if (action === "abort") parent.abort(); else f.reader.dispose();
      await rejected;
      f.reader.dispose();
      await f.reader.settled();
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(f.calls.filter(url => url.pathname === "/v5/account/bills")).toHaveLength(1);
      expect(diagnostic.read()).toBeNull();
    } finally { f.reader.dispose(); await f.reader.settled(); }
  });

  it("discards a body rejection enum when post-response permission is the final error", async () => {
    async function run(sink?: HtxV5BillsDiagnosticSink) {
      let billsReturned = false;
      const f = setup({ billsDiagnosticSink: sink, intercept: url => {
        if (url.pathname === "/v5/account/bills") {
          billsReturned = true;
          return new Response(new Uint8Array([255]));
        }
        if (billsReturned && url.pathname === "/v2/user/api-key")
          return json({ code: 200, data: [{ accessKey: "fixture-key", status: "normal", permission: "readOnly,trade" }] });
        return undefined;
      } });
      try {
        await expect(f.reader.read(new AbortController().signal)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
        return f.calls.map(url => url.pathname);
      } finally { f.reader.dispose(); await f.reader.settled(); }
    }
    const withoutSink = await run();
    const diagnostic = createReaderBillsDiagnostics();
    expect(await run(diagnostic.sink)).toEqual(withoutSink);
    expect(withoutSink.filter(path => path === "/v5/account/bills")).toHaveLength(1);
    expect(diagnostic.read()).toBeNull();
  });

  it("identifies a response-clock regression at the fetch boundary without masking the original failure", async () => {
    async function run(sink?: HtxV5BillsDiagnosticSink) {
      vi.setSystemTime(ts);
      let billsReturned = false;
      const f = setup({ billsDiagnosticSink: sink, intercept: url => {
        if (url.pathname === "/v5/account/bills") {
          billsReturned = true;
          vi.setSystemTime(ts - 1); // Still in scope; response time precedes signed request time.
          return json(response(url.pathname));
        }
        if (billsReturned && url.hostname === "api.huobi.pro") vi.setSystemTime(ts);
        return undefined;
      } });
      try {
        const result = await f.reader.read(new AbortController().signal);
        expect(result).toMatchObject({ bills: { status: "ERROR", error: "INVALID_RESPONSE" } });
        return { result, routes: f.calls.map(url => url.pathname) };
      } finally { f.reader.dispose(); await f.reader.settled(); }
    }
    const withoutSink = await run();
    const diagnostic = createReaderBillsDiagnostics();
    expect(await run(diagnostic.sink)).toEqual(withoutSink);
    expect(diagnostic.read()).toBe("BILLS_RESPONSE_CLOCK_INVALID");
  });
});
