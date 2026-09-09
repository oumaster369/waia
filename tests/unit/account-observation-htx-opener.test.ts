// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openHtxObservationReader, type HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import type { HtxObservationReaderOptions } from "@/lib/trader/account-observation/htx-reader";
import { createAccountObservationService } from "@/lib/trader/account-observation/service";

const binding = { organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "123",
  credentialRevision: "1", configurationRevision: "local-config" };
const options: HtxObservationReaderOptions = { binding, symbols: ["BTCUSDT"],
  readTimeoutMs: 1000, pageSize: 10, maxPages: 2, maxRecords: 20,
  maxResponseBytes: 1024, tradeWindowMs: 60000 };
function setup() {
  const dispose = vi.fn();
  const handle: HtxObservationCredentialHandle = { binding, apiKey: "synthetic-key", apiSecret: "synthetic-secret", dispose };
  const deps = { clock: accountObservationClock, host: "api.huobi.pro" as const,
    fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ status: "ok", data: {
      id: "123", type: "spot", state: "working", list: [{ currency: "usdt", type: "trade", balance: "2" }],
    } }))),
    authorizeOpen: vi.fn(async () => true), openCredential: vi.fn(async () => handle),
    verifyReadAdmission: vi.fn(async () => true) };
  const controller = new AbortController();
  return { deps, handle, dispose, controller, open: () => openHtxObservationReader(deps, options, controller.signal) };
}
describe("local admitted credential → GET transport → reader composition", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it("opens without network, survives open-timer cancellation, reads and disposes exactly once", async () => {
    const f = setup(); const reader = await f.open();
    expect(f.deps.fetchImpl).not.toHaveBeenCalled();
    expect(f.deps.verifyReadAdmission).toHaveBeenCalledWith(binding,
      createHash("sha256").update("synthetic-key").digest("hex"), expect.any(AbortSignal));
    f.controller.abort(); // domain service aborts the OPEN timer on successful return
    const result = await reader.readBalances(new AbortController().signal);
    expect(result.values).toEqual([{ asset: "USDT", free: "2", locked: "0", total: "2" }]);
    expect(f.deps.verifyReadAdmission).toHaveBeenCalledTimes(3);
    expect(Object.keys(reader).sort()).toEqual(["dispose", "readBalances", "readOpenOrders", "readTrades"]);
    reader.dispose(); reader.dispose(); expect(f.dispose).toHaveBeenCalledTimes(1);
    await expect(reader.readBalances(new AbortController().signal)).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses opening before key access when authority is absent", async () => {
    const f = setup(); f.deps.authorizeOpen.mockResolvedValue(false);
    await expect(f.open()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.deps.openCredential).not.toHaveBeenCalled(); expect(f.deps.fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision"] as const)(
    "refuses a changed credential %s and releases the handle", async field => {
      const f = setup(); const value = field.endsWith("Id") && field !== "exchangeAccountId"
        ? "00000000-0000-4000-8000-000000000009" : "999";
      f.deps.openCredential.mockResolvedValue({ ...f.handle, binding: { ...binding, [field]: value } });
      await expect(f.open()).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
      expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.deps.fetchImpl).not.toHaveBeenCalled();
    });
  it("releases keys if exact-key admission is revoked while opening", async () => {
    const f = setup(); f.deps.verifyReadAdmission.mockResolvedValue(false);
    await expect(f.open()).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.deps.fetchImpl).not.toHaveBeenCalled();
  });
  it("sanitizes key-store failures", async () => {
    const f = setup(); f.deps.openCredential.mockRejectedValue(new Error("synthetic-sensitive-driver-error"));
    await expect(f.open()).rejects.toMatchObject({ message: "READ_FAILED" });
    expect(f.deps.fetchImpl).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["timeout", "cancel"])("releases a late credential after %s without sending a request", async mode => {
    const f = setup(); let finish!: (h: HtxObservationCredentialHandle) => void;
    f.deps.openCredential.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = f.open(); const result = expect(pending).rejects.toMatchObject({ code: mode === "timeout" ? "TIMEOUT" : "READ_FAILED" });
    await vi.advanceTimersByTimeAsync(0);
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(1000); else f.controller.abort();
    await result; finish(f.handle); await vi.advanceTimersByTimeAsync(0);
    expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.deps.fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses and disposes malformed reader options without network", async () => {
    const f = setup(); await expect(openHtxObservationReader(f.deps, { ...options, maxPages: 999 }, f.controller.signal)).rejects.toThrow();
    expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.deps.fetchImpl).not.toHaveBeenCalled();
  });
  it("revocation after open still prevents the first GET", async () => {
    const f = setup(); const reader = await f.open(); f.deps.verifyReadAdmission.mockResolvedValue(false);
    await expect(reader.readBalances(new AbortController().signal)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    reader.dispose(); expect(f.dispose).toHaveBeenCalledTimes(1); expect(f.deps.fetchImpl).not.toHaveBeenCalled();
  });
  it("does not open a credential after a timed-out authorization eventually succeeds", async () => {
    const f = setup(); let finish!: (v: boolean) => void;
    f.deps.authorizeOpen.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const result = expect(f.open()).rejects.toMatchObject({ code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(1000); await result;
    finish(true); await vi.advanceTimersByTimeAsync(0);
    expect(f.deps.openCredential).not.toHaveBeenCalled(); expect(f.deps.fetchImpl).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses an already cancelled opening without invoking adapters", async () => {
    const f = setup(); f.controller.abort();
    await expect(f.open()).rejects.toMatchObject({ code: "READ_FAILED" });
    expect(f.deps.authorizeOpen).not.toHaveBeenCalled(); expect(f.deps.openCredential).not.toHaveBeenCalled();
  });
  it("sanitizes disposal failures and never retries a consumed handle", async () => {
    const f = setup(); const reader = await f.open();
    f.dispose.mockImplementation(() => { throw new Error("synthetic-private-dispose-error"); });
    expect(() => reader.dispose()).toThrow("READ_FAILED");
    expect(() => reader.dispose()).not.toThrow(); expect(f.dispose).toHaveBeenCalledTimes(1);
    await expect(reader.readBalances(new AbortController().signal)).rejects.toThrow();
  });
  it("commits through the real domain service with mocked storage and raw GET responses", async () => {
    const f = setup(); const balances = f.deps.fetchImpl.getMockImplementation()!;
    f.deps.fetchImpl.mockImplementation(async (url, init) => String(url).includes("/balance?")
      ? balances(url, init) : new Response(JSON.stringify({ status: "ok", data: [] })));
    const commit = vi.fn(async () => true);
    const service = createAccountObservationService({ clock: accountObservationClock,
      repository: { claimDue: async () => ({ binding, token: "local-lease", ownerId: "test-owner",
        expiresAtMs: Date.now() + 10000, consecutiveFailures: 0 }), isCurrent: async () => true,
        commitIfCurrent: commit, release: vi.fn(async () => {}) },
      newObservationId: () => "00000000-0000-4000-8000-000000000003",
      openReader: (scope, signal) => openHtxObservationReader(f.deps, { ...options, binding: scope }, signal),
    }, { revision: binding.configurationRevision, symbols: options.symbols, readTimeoutMs: 1000,
      pollIntervalMs: 1000, maxBackoffMs: 8000, leaseTtlMs: 10000 });
    const result = await service.tick(binding, "test-owner", new AbortController().signal);
    expect(result.status).toBe("COMMITTED");
    if (result.status !== "COMMITTED") throw new Error("expected commit");
    expect(result.observation.balances.status).toBe("COMPLETE");
    expect(result.observation.status).toBe("PARTIAL");
    expect(result.observation.holdings?.[0].total).toBe("2");
    expect(f.deps.fetchImpl).toHaveBeenCalledTimes(3); expect(commit).toHaveBeenCalledTimes(1);
    expect(f.dispose).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-key|synthetic-secret|Signature/);
  });
});
