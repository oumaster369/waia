// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHtxReadAdmission } from "@/lib/trader/account-observation/htx-read-admission";
import { createHtxMetadataGetTransport } from "@/lib/trader/account-observation/htx-get-transport";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";

const binding: ObservationBinding = { organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "123",
  credentialRevision: "1", configurationRevision: "config-v1" };
const apiKey = "synthetic-key", apiSecret = "synthetic-secret";
const digest = createHash("sha256").update(apiKey).digest("hex");
const signal = () => new AbortController().signal;
const json = (value: unknown) => new Response(JSON.stringify(value));
function payload(path: string): unknown {
  if (path === "/v1/account/accounts") return { status: "ok", data: [{ id: 123, type: "spot", state: "working" }] };
  if (path === "/v2/user/uid") return { code: 200, data: 456 };
  return { code: 200, data: [{ accessKey: apiKey, status: "normal", permission: "readOnly" }] };
}
function setup(change?: (path: string, value: unknown) => unknown) {
  const fetchImpl = vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url)).pathname;
    return json(change ? change(path, payload(path)) : payload(path));
  });
  const credential = { binding: { ...binding }, apiKey, apiSecret, dispose: vi.fn() };
  const authorizeCurrent = vi.fn(async () => true);
  const input = { credential, host: "api.huobi.pro" as const, clock: accountObservationClock,
    fetchImpl, timeoutMs: 1000, maxResponseBytes: 4096, authorizeCurrent };
  const admission = createHtxReadAdmission(input);
  return { ...input, admission, check: () => admission.verifyReadAdmission(binding, digest, signal()) };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-10T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("fresh exact-key read-only HTX admission, synthetic keys and mock fetch only", () => {
  it("signs exactly three metadata GETs for the same key/account without an optimistic cache", async () => {
    const f = setup(); expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(Object.keys(f.admission).sort()).toEqual(["dispose", "verifyReadAdmission"]);
    expect(await f.check()).toBe(true); expect(await f.check()).toBe(true);
    expect(f.fetchImpl).toHaveBeenCalledTimes(6); expect(f.authorizeCurrent).toHaveBeenCalledTimes(12);
    for (const [url, init] of f.fetchImpl.mock.calls) {
      const u = new URL(String(url)); expect(u.origin).toBe("https://api.huobi.pro");
      expect(u.searchParams.get("AccessKeyId")).toBe(apiKey); expect(u.searchParams.has("Signature")).toBe(true);
      expect(init).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
      if (u.pathname === "/v2/user/api-key") {
        expect(u.searchParams.get("uid")).toBe("456"); expect(u.searchParams.get("accessKey")).toBe(apiKey);
      }
    }
    f.admission.dispose(); expect(f.credential.dispose).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision", "key"])(
    "refuses mismatched %s before metadata I/O", async field => {
      const f = setup(); const scope = field === "key" ? binding : { ...binding, [field]: "other" };
      await expect(f.admission.verifyReadAdmission(scope, field === "key" ? "a".repeat(64) : digest, signal())).rejects.toThrow();
      expect(f.fetchImpl).not.toHaveBeenCalled();
    });
  it.each(["empty", "wrong", "ambiguous", "unsafe", "inactive", "malformed", "bad-status"])(
    "refuses %s account metadata", async mode => {
      const row = { id: 123, type: "spot", state: "working" };
      const f = setup((path, value) => path !== "/v1/account/accounts" ? value : mode === "bad-status"
        ? { status: "error", data: [row] } : { status: "ok", data: mode === "empty" ? [] :
          mode === "wrong" ? [{ ...row, id: 124 }] : mode === "ambiguous" ? [row, row] :
          mode === "unsafe" ? [{ ...row, id: Number.MAX_SAFE_INTEGER + 1 }] :
          mode === "inactive" ? [{ ...row, state: "locked" }] : [null] });
      await expect(f.check()).rejects.toThrow(); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    });
  it.each([null, "456", 0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1])("refuses malformed UID %s", async uid => {
    const f = setup((path, value) => path === "/v2/user/uid" ? { code: 200, data: uid } : value);
    await expect(f.check()).rejects.toThrow(); expect(f.fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each(["missing", "other", "duplicate", "malformed", "expired", "bad-code", "invalid-days"])(
    "refuses %s exact-key metadata", async mode => {
      const row = { accessKey: apiKey, status: "normal", permission: "readOnly" };
      const f = setup((path, value) => path !== "/v2/user/api-key" ? value :
        { code: mode === "bad-code" ? 400 : 200, data: mode === "missing" ? [] : mode === "other" ? [{ ...row, accessKey: "other" }] :
          mode === "duplicate" ? [row, row] : mode === "malformed" ? [row, null] :
          mode === "expired" ? [{ ...row, status: "expired" }] : [{ ...row, validDays: 0 }] });
      await expect(f.check()).rejects.toThrow();
    });
  it("tolerates known trade only as read admission, never as no-transfer or write proof", async () => {
    const f = setup((path, value) => path === "/v2/user/api-key"
      ? { code: 200, data: [{ accessKey: apiKey, status: "normal", permission: "readOnly,trade" }] } : value);
    expect(await f.check()).toBe(true); expect(Object.keys(f.admission).sort()).toEqual(["dispose", "verifyReadAdmission"]);
    expect(f.fetchImpl.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true); f.admission.dispose();
  });
  it("accepts the documented API-key envelope and metadata fields for the exact synthetic key", async () => {
    // https://huobiapi.github.io/docs/spot/v1/en/#api-key-query; synthetic identities only.
    const f = setup((path, value) => path === "/v2/user/api-key" ? {
      code: 200, message: "success", data: [
        { accessKey: apiKey, status: "normal", note: "host", permission: "trade,readOnly",
          ipAddresses: "192.168.0.1,192.168.1.1", validDays: -1, createTime: 1615192704000, updateTime: 1623030338000 },
        { accessKey: "other-synthetic-key", status: "normal", note: "host two", permission: "readOnly,trade,withdraw",
          ipAddresses: "", validDays: 7, createTime: 1623158078000, updateTime: 1629875976000 },
      ], ok: true,
    } : value);
    expect(await f.check()).toBe(true); expect(f.fetchImpl).toHaveBeenCalledTimes(3); f.admission.dispose();
  });
  it.each(["/v2/user/uid", "/v2/user/api-key"])("accepts only an optional affirmative ok on %s", async target => {
    const positive = setup((path, value) => path === target ? { ...(value as object), ok: true } : value);
    expect(await positive.check()).toBe(true); positive.admission.dispose();
    for (const extra of [{ ok: false }, { ok: true, unknownFlag: false }]) {
      const negative = setup((path, value) => path === target ? { ...(value as object), ...extra } : value);
      await expect(negative.check()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    }
  });
  it.each(["", "trade", "readOnly,withdraw", "readOnly,transfer", "readOnly,unknown", "readOnly,", "readOnly,readOnly"])(
    "refuses unsafe or incomplete permission %s", async permission => {
      const f = setup((path, value) => path === "/v2/user/api-key"
        ? { code: 200, data: [{ accessKey: apiKey, status: "normal", permission }] } : value);
      await expect(f.check()).rejects.toThrow();
    });
  it.each(["canWithdraw", "canTransfer", "canTrade", "withdrawEnabled", "transferEnabled", "unknownFlag"])(
    "does not overlook additional permission flag %s", async flag => {
      const f = setup((path, value) => path === "/v2/user/api-key"
        ? { code: 200, data: [{ accessKey: apiKey, status: "normal", permission: "readOnly", [flag]: true }] } : value);
      await expect(f.check()).rejects.toThrow();
    });
  it("checks database currentness before and after metadata and stops on revoke", async () => {
    const f = setup(); f.authorizeCurrent.mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(f.check()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    await expect(f.check()).rejects.toThrow(); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("observes changed venue permissions on the next verification rather than reusing success", async () => {
    const f = setup(); expect(await f.check()).toBe(true);
    f.fetchImpl.mockImplementation(async url => {
      const path = new URL(String(url)).pathname;
      return json(path === "/v2/user/api-key" ? { code: 200, data: [
        { accessKey: apiKey, status: "normal", permission: "readOnly,withdraw" }] } : payload(path));
    });
    await expect(f.check()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(6);
  });
  it("captures mutable input key/account/host and refuses reuse after disposal", async () => {
    const f = setup(); f.credential.apiKey = "different"; f.credential.binding.exchangeAccountId = "999";
    expect(await f.check()).toBe(true); expect(new URL(String(f.fetchImpl.mock.calls[2][0])).searchParams.get("accessKey")).toBe(apiKey);
    f.admission.dispose(); await expect(f.check()).rejects.toThrow(); expect(f.fetchImpl).toHaveBeenCalledTimes(3);
  });
  it.each([302, 403, 429, 500])("discards HTTP %s response details and body", async status => {
    const f = setup(); const cancel = vi.fn(); f.fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status }));
    await expect(f.check()).rejects.not.toThrow(apiSecret); expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("bounds bytes before parsing and refuses invalid UTF-8", async () => {
    for (const bytes of [new Uint8Array(4097), new Uint8Array([0xff])]) {
      const f = setup(); const cancel = vi.fn();
      f.fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.enqueue(bytes); }, cancel })));
      await expect(f.check()).rejects.toThrow(); expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
  it("abort/timeout cannot publish late metadata or leak an ignored-fetch body", async () => {
    const f = setup(); let finish!: (r: Response) => void;
    f.fetchImpl.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.check(); const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000); await rejected;
    const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledTimes(1);
    await expect(f.check()).rejects.toThrow(); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels active body reads and rejects overlapping admission", async () => {
    const f = setup(); const cancel = vi.fn(); f.fetchImpl.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })));
    const abort = new AbortController(); const pending = f.admission.verifyReadAdmission(binding, digest, abort.signal);
    const rejected = expect(pending).rejects.toThrow(); await vi.advanceTimersByTimeAsync(0);
    await expect(f.check()).rejects.toThrow(); abort.abort(); await rejected;
    expect(cancel).toHaveBeenCalledTimes(1); expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("uses one aggregate deadline across the three metadata requests", async () => {
    const f = setup(); const cancel = vi.fn();
    f.fetchImpl.mockImplementation(url => new Promise(resolve => setTimeout(() => {
      const path = new URL(String(url)).pathname;
      resolve(path === "/v2/user/api-key" ? new Response(new ReadableStream({ cancel })) : json(payload(path)));
    }, 400)));
    const rejected = expect(f.check()).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000); await rejected;
    expect(f.fetchImpl).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(200); expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does no work for an already aborted signal", async () => {
    const f = setup(); const abort = new AbortController(); abort.abort();
    await expect(f.admission.verifyReadAdmission(binding, digest, abort.signal)).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); f.admission.dispose();
  });
  it("sanitizes dependency and credential getter exceptions", async () => {
    const f = setup(); f.authorizeCurrent.mockRejectedValue(new Error(apiSecret));
    await expect(f.check()).rejects.not.toThrow(apiSecret);
    expect(() => createHtxReadAdmission({ ...f, credential: { ...f.credential, get apiSecret(): string { throw new Error(apiSecret); } } })).toThrow("PERMISSION_DENIED");
  });
  it.each([
    {}, { uid: "456" }, { uid: "456", accessKey: "other" }, { uid: "0", accessKey: apiKey },
    { uid: "9007199254740992", accessKey: apiKey }, { uid: "456", accessKey: apiKey, Signature: "injected" },
  ] as ReadonlyArray<Record<string, string>>)("metadata API-key query refuses missing/forged parameters %j", async query => {
    const f = setup(); const transport = createHtxMetadataGetTransport({ binding, apiKey, apiSecret, host: f.host,
      clock: f.clock, timeoutMs: 1000, fetchImpl: f.fetchImpl, authorizeCurrent: f.authorizeCurrent });
    await expect(transport.signedGet({ method: "GET", path: "/v2/user/api-key", query, signal: signal(), maxResponseBytes: 4096 })).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled(); transport.dispose(); f.admission.dispose();
  });
  it("metadata transport refuses POST even on a metadata path", async () => {
    const f = setup(); const transport = createHtxMetadataGetTransport({ binding, apiKey, apiSecret, host: f.host,
      clock: f.clock, timeoutMs: 1000, fetchImpl: f.fetchImpl, authorizeCurrent: f.authorizeCurrent });
    await expect(transport.signedGet({ method: "POST" as "GET", path: "/v2/user/uid", query: {}, signal: signal(), maxResponseBytes: 4096 })).rejects.toThrow();
    expect(f.fetchImpl).not.toHaveBeenCalled(); transport.dispose(); f.admission.dispose();
  });
  it.each(["/v1/order/orders/place", "/v1/order/openOrders", "/v1/account/accounts/123/balance", "/v2/sub-user/api-key-generation"])(
    "metadata transport cannot sign %s", async path => {
      const f = setup(); const transport = createHtxMetadataGetTransport({ binding, apiKey, apiSecret, host: f.host,
        clock: f.clock, timeoutMs: 1000, fetchImpl: f.fetchImpl, authorizeCurrent: f.authorizeCurrent });
      await expect(transport.signedGet({ method: "GET", path: path as "/v2/user/uid", query: {}, signal: signal(), maxResponseBytes: 4096 })).rejects.toThrow();
      expect(f.fetchImpl).not.toHaveBeenCalled(); transport.dispose(); f.admission.dispose();
    });
});
