// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHtxV5ObservationReader } from "@/lib/trader/account-observation/derivatives/htx-v5-reader";
import { createHtxV5ReadTransport } from "@/lib/trader/account-observation/derivatives/htx-v5-read-transport";
import { buildHtxV5BillsRequest } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { accountObservationFinancialScopeAt, parseAccountObservation } from "@/lib/trader/account-observation/validation";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { createAccountObservationSelfServiceConfiguration } from "@/lib/trader/account-observation/self-service-envelope";
import { accountObservationManifestDigest, parseAccountObservationAssignmentManifest } from "@/lib/trader/account-observation/assignment-manifest";
import { manifestBody, manifestAssignment, MANIFEST_RELEASE_SHA } from "./account-observation-manifest-fixtures";
import type { AccountObservation, HtxV5AccountObservation, HtxV5FinancialHistoryScope } from "@/lib/trader/account-observation/types";
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
  intercept?: (url: URL, init?: RequestInit) => Response | undefined | Promise<Response | undefined>; authorize?: () => Promise<boolean> } = {}) {
  const calls: URL[] = [];
  const input = { credential: { binding, apiKey: "fixture-key", apiSecret: "fixture-secret", dispose() {} },
    clock: accountObservationClock, timeoutMs: 1000, maxResponseBytes: 65536, expectedHtxUid: "456",
    authorizeCurrent: options.authorize ?? (async () => true),
    fetchImpl: vi.fn<typeof fetch>(async (url, init) => { const parsed = new URL(String(url)); calls.push(parsed);
      return await options.intercept?.(parsed, init) ?? json(response(parsed.pathname, options.rows)); }) };
  const reader = createHtxV5ObservationReader({ ...input, ...(options.scope === null ? {} : { financialHistory: options.scope ?? scope }) });
  return { reader, input, calls };
}
function envelope(projection: HtxV5AccountObservation): AccountObservation {
  const component = { status: "COMPLETE" as const, values: [], sourceAsOfMs: null, readStartedAtMs: ts, readCompletedAtMs: Date.now(), error: null };
  return { schemaVersion: projection.schemaVersion === "htx-v5-observation/v2" ? "account-observation/v4" : "account-observation/v3",
    observationId: "00000000-0000-4000-8000-000000000004", binding,
    collectionStartedAtMs: ts, collectionCompletedAtMs: Date.now(), status: "PARTIAL",
    balances: component, openOrders: component, trades: [{ symbol: "BTCUSDT", component }], holdings: [], htxV5: projection };
}
async function read(options: Parameters<typeof setup>[0] = {}) {
  const f = setup(options); const projection = await f.reader.read(new AbortController().signal);
  f.reader.dispose(); await f.reader.settled(); return { ...f, projection, observation: parseAccountObservation(envelope(projection)) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(ts); });
afterEach(() => vi.useRealTimers());

describe("bounded optional financial-history ingestion", () => {
  it("keeps the absent capability on the exact legacy schema without bills calls", async () => {
    const f = await read({ scope: null });
    expect(f.projection.schemaVersion).toBe("htx-v5-observation/v1");
    expect(f.calls.some(url => url.pathname === "/v5/account/bills")).toBe(false);
  });
  it("reads exactly one signed page and groups raw values separately by currency/type", async () => {
    const f = await read({ rows: [bill, { ...bill, id: "2", amount: "0.2" }, { ...bill, id: "3", type: "999", currency: "USD", amount: "-2" }] });
    const calls = f.calls.filter(url => url.pathname === "/v5/account/bills");
    expect(calls).toHaveLength(1); expect(calls[0]!.host).toBe("api.hbdm.com");
    expect(calls[0]!.searchParams.get("start_time")).toBe(String(scope.windowStartMs));
    expect(calls[0]!.searchParams.get("end_time")).toBe(String(scope.windowEndMs - 1));
    expect(calls[0]!.searchParams.get("Signature")).toBeTruthy();
    expect([...calls[0]!.searchParams.entries()]).toEqual(expect.arrayContaining([["limit", "100"], ["direct", "next"], ["from", "0"]]));
    expect(f.projection).toMatchObject({ schemaVersion: "htx-v5-observation/v2", balance: { status: "COMPLETE" }, bills: {
      status: "PARTIAL", completeness: "UNKNOWN", netPnl: null, dailyPnl: null,
      groups: [{ currency: "USD", type: "999", category: "UNKNOWN", observedAmountSum: "-2", recordCount: 1 },
        { currency: "USDT", type: "30", observedAmountSum: "0.30000000000000000001", recordCount: 2 }] } });
  });
  it("keeps an empty successful page partial and never returns a zero-money substitute", async () => {
    const f = await read({ rows: [] }); expect(f.projection).toMatchObject({ bills: { status: "PARTIAL", values: [], groups: [], completeness: "UNKNOWN", netPnl: null } });
  });
  it.each([
    ["SCOPE_EXPIRED", { ...scope, validFromMs: ts - 1, validUntilMs: ts }],
    ["SCOPE_NOT_YET_VALID", { ...scope, validFromMs: ts + 1, validUntilMs: ts + 1000 }],
  ] as const)("preserves base observations with %s before the cycle", async (reason, financialScope) => {
    const f = await read({ scope: financialScope });
    expect(f.calls.some(url => url.pathname === "/v5/account/bills")).toBe(false);
    expect(f.projection).toMatchObject({ balance: { status: "COMPLETE" }, bills: { status: "UNAVAILABLE", unavailableReason: reason,
      values: null, groups: null, readStartedAtMs: null, responseReceivedAtMs: null, error: null } });
  });
  it("discards financial amounts when scope expires during the financial response, retaining balances", async () => {
    const f = await read({ intercept: url => { if (url.pathname === "/v5/account/bills") vi.setSystemTime(scope.validUntilMs); return undefined; } });
    expect(f.projection).toMatchObject({ balance: { status: "COMPLETE" }, bills: { status: "UNAVAILABLE", unavailableReason: "SCOPE_EXPIRED", values: null, groups: null } });
  });
  it("aborts a pending optional financial request on expiry and completes the base snapshot", async () => {
    const pending = read({ scope: { ...scope, validUntilMs: ts + 200 }, intercept: (url, init) => {
      if (url.pathname !== "/v5/account/bills") return undefined;
      return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    } });
    await vi.advanceTimersByTimeAsync(200);
    const f = await pending;
    expect(f.projection).toMatchObject({ balance: { status: "COMPLETE" }, bills: { status: "UNAVAILABLE",
      unavailableReason: "SCOPE_EXPIRED", values: null, groups: null } });
  });
  it("checks the optional scope after awaited admission and before sending financial GET", async () => {
    let count = 0;
    const f = setup({ authorize: async () => { if (++count === 1) vi.setSystemTime(scope.validUntilMs); return true; } });
    const transport = createHtxV5ReadTransport(f.input);
    await expect(transport.readBills(scope, new AbortController().signal)).rejects.toMatchObject({ reason: "SCOPE_EXPIRED" });
    expect(f.calls.some(url => url.pathname === "/v5/account/bills")).toBe(false);
    transport.dispose(); await transport.settled(); f.reader.dispose(); await f.reader.settled();
  });
  it.each([
    ["duplicate", [bill, bill]], ["unsupported-arithmetic", [{ ...bill, amount: "1e129" }]], ["outside-window", [{ ...bill, created_time: String(scope.windowEndMs) }]],
    ["over-page", Array.from({ length: 101 }, (_, index) => ({ ...bill, id: String(index + 1) }))],
  ])("rejects %s financial rows without erasing current balance data", async (_name, rows) => {
    const f = await read({ rows: rows as unknown[] });
    expect(f.projection).toMatchObject({ balance: { status: "COMPLETE" }, bills: { status: "ERROR", error: "INVALID_RESPONSE", values: null, groups: null } });
  });
  it("classifies 429 as an optional financial error without retry", async () => {
    const f = await read({ intercept: url => url.pathname === "/v5/account/bills" ? json({}, 429) : undefined });
    expect(f.calls.filter(url => url.pathname === "/v5/account/bills")).toHaveLength(1);
    expect(f.projection).toMatchObject({ balance: { status: "COMPLETE" }, bills: { status: "ERROR", error: "RATE_LIMITED" } });
  });
  it("discards amounts at a later persistence time and recomputes a valid parent", async () => {
    const f = await read();
    const sanitized = accountObservationFinancialScopeAt(f.observation, scope.validUntilMs);
    expect(sanitized).toMatchObject({ schemaVersion: "account-observation/v4", balances: f.observation.balances,
      htxV5: { balance: { status: "COMPLETE" }, bills: { status: "UNAVAILABLE", unavailableReason: "SCOPE_EXPIRED", values: null, groups: null } } });
    expect(parseAccountObservation(sanitized)).toEqual(sanitized);
    expect(f.observation).toMatchObject({ htxV5: { bills: { status: "PARTIAL" } } });
  });
  it.each(["sum", "count", "category", "complete", "pnl", "wrong-version", "missing-bills"])("rejects forged %s DTO evidence", async kind => {
    const f = await read(); const value = JSON.parse(JSON.stringify(f.observation)); const bills = value.htxV5.bills;
    if (kind === "sum") bills.groups[0].observedAmountSum = "900";
    if (kind === "count") bills.groups[0].recordCount = 2;
    if (kind === "category") bills.values[0].category = "UNKNOWN";
    if (kind === "complete") bills.status = "COMPLETE";
    if (kind === "pnl") bills.dailyPnl = "0";
    if (kind === "wrong-version") { value.schemaVersion = "account-observation/v3"; value.htxV5.schemaVersion = "htx-v5-observation/v1"; }
    if (kind === "missing-bills") delete value.htxV5.bills;
    expect(() => parseAccountObservation(value)).toThrow();
  });
  it("binds valid financial scope to a new configuration hash and explicit v2 manifest", () => {
    const legacy = manifestAssignment({ htxV5: { enabled: true, expectedHtxUid: "456" }, leaseTtlMs: 300000 });
    const configured = createObservationConfiguration({ symbols: legacy.symbols, pollIntervalMs: legacy.pollIntervalMs,
      maxBackoffMs: legacy.maxBackoffMs, readTimeoutMs: legacy.readTimeoutMs, leaseTtlMs: legacy.leaseTtlMs,
      htxCoverage: { ...legacy.readerLimits, host: "api.huobi.pro" }, htxV5: { ...legacy.htxV5!, financialHistory: scope } });
    expect(configured.revision).not.toBe(legacy.configurationRevision);
    const base = manifestBody({ assignments: [{ ...legacy, configurationRevision: configured.revision,
      htxV5: { enabled: true, expectedHtxUid: "456", financialHistory: scope } }] });
    const parse = (body: typeof base) => { const digest = accountObservationManifestDigest(body);
      return parseAccountObservationAssignmentManifest(JSON.stringify({ ...body, contentSha256: digest }), { expectedDigest: digest, expectedReleaseSha: MANIFEST_RELEASE_SHA }); };
    expect(() => parse(base)).toThrow("SCHEMA");
    expect(parse({ ...base, schemaVersion: "waia.account_observation_assignment_manifest.v2" }).configured[0]!.config).toEqual(configured);
    expect(createAccountObservationSelfServiceConfiguration().revision).toBe("sha256:6adf6fd4a1f08081df76d44651d17f2030ae1a4d7f94e1d9cfd554f6ba5e7254");
  });
  it.each([
    { ...scope, windowEndMs: scope.windowStartMs }, { ...scope, validUntilMs: scope.validFromMs + 600001 },
    { ...scope, windowEndMs: scope.validFromMs + 1 },
  ])("rejects structurally invalid scopes", invalidScope => {
    expect(() => setup({ scope: invalidScope })).toThrow();
  });
  it("uses a hostile-input-safe fixed one-page builder", () => {
    expect(buildHtxV5BillsRequest({ windowStartMs: 1, windowEndMs: 2 })).toEqual({ method: "GET", path: "/v5/account/bills",
      query: { start_time: "1", end_time: "1", from: "0", limit: "100", direct: "next" } });
    const getter = vi.fn(() => 1);
    expect(() => buildHtxV5BillsRequest(Object.defineProperty({ windowEndMs: 2 }, "windowStartMs", { get: getter }) as never)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => buildHtxV5BillsRequest({ windowStartMs: 1, windowEndMs: 2, from: "3" } as never)).toThrow();
  });
});
