// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createHtxDerivativesObservationReader } from "@/lib/trader/account-observation/derivatives/reader";
import type { ObservationBinding, ObservationClock } from "@/lib/trader/account-observation/types";
import type { HtxDerivativesAccountFamily } from "@/lib/trader/account-observation/derivatives/types";
import type { HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";

const binding: ObservationBinding = Object.freeze({ organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "1",
  credentialRevision: "3", configurationRevision: "config-v1" });
const key = "positions-test-key";
const secret = "positions-test-secret";
const clock: ObservationClock = { now: () => 1780261200000, sleep: (_ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, _ms);
  const abort = () => { clearTimeout(timer); reject(new Error("aborted")); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
}) };
const routes: Record<HtxDerivativesAccountFamily, { account: string; positions: string; accountBody: object; positionsBody: object }> = {
  usdt_isolated_perpetual: { account: "/linear-swap-api/v1/swap_account_info", positions: "/linear-swap-api/v1/swap_position_info", accountBody: {}, positionsBody: {} },
  usdt_cross_shared: { account: "/linear-swap-api/v1/swap_cross_account_info", positions: "/linear-swap-api/v1/swap_cross_position_info", accountBody: { margin_account: "USDT" }, positionsBody: {} },
  coin_perpetual: { account: "/swap-api/v1/swap_account_info", positions: "/swap-api/v1/swap_position_info", accountBody: {}, positionsBody: {} },
  coin_delivery_futures: { account: "/api/v1/contract_account_info", positions: "/api/v1/contract_position_info", accountBody: {}, positionsBody: {} },
};
const accountRows: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","margin_mode":"isolated","margin_balance":"10","margin_available":"9"}]}`,
  usdt_cross_shared: `{"status":"ok","data":[{"margin_account":"USDT","margin_asset":"USDT","margin_mode":"cross","margin_balance":"20","withdraw_available":"19"}]}`,
  coin_perpetual: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_balance":"0.2","margin_available":"0.1"}]}`,
  coin_delivery_futures: `{"status":"ok","data":[{"symbol":"BTC","margin_balance":"0.3","margin_available":"0.2"}]}`,
};
const positionRows: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","direction":"buy","volume":"1","available":"1","frozen":"0","cost_open":"60000","cost_hold":"61000","profit_unreal":"-1","position_margin":"12","lever_rate":5}]}`,
  usdt_cross_shared: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"USDT","margin_asset":"USDT","direction":"sell","volume":"1","available":"1","frozen":"0","cost_open":"60000","cost_hold":"61000","profit_unreal":"-1","position_margin":"12","lever_rate":5,"business_type":"swap"}]}`,
  coin_perpetual: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"1","available":"1","frozen":"0","cost_open":"60000","cost_hold":"61000","profit_unreal":"-1","position_margin":"0.01","lever_rate":5}]}`,
  coin_delivery_futures: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC201225","contract_type":"quarter","direction":"sell","volume":"1","available":"1","frozen":"0","cost_open":"60000","cost_hold":"61000","profit_unreal":"-1","position_margin":"0.01","lever_rate":5}]}`,
};
function make(family: HtxDerivativesAccountFamily, overrides: Partial<{
  fetchImpl: typeof fetch;
  verifyReadOnlyAdmission(binding: ObservationBinding, keyDigest: string, signal: AbortSignal): Promise<boolean>;
}> = {}) {
  const credential = { binding: { ...binding }, apiKey: key, apiSecret: secret, dispose() {} } as HtxObservationCredentialHandle;
  const fetchImpl = overrides.fetchImpl ?? vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url)).pathname;
    if (path === routes[family].account) return new Response(accountRows[family]);
    if (path === routes[family].positions) return new Response(positionRows[family]);
    return new Response("not found", { status: 404 });
  });
  const verifyReadOnlyAdmission = overrides.verifyReadOnlyAdmission ?? vi.fn(async () => true);
  const reader = createHtxDerivativesObservationReader({ credential, families: [family], clock, fetchImpl,
    timeoutMs: 1000, maxResponseBytes: 20_000, verifyReadOnlyAdmission });
  return { reader, fetchImpl, verifyReadOnlyAdmission };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

describe("HTX derivatives positions reader", () => {
  it.each(Object.keys(routes) as HtxDerivativesAccountFamily[])("reads account and positions sequentially for %s", async family => {
    const f = make(family); const result = await f.reader.readDerivativesAccount(family, signal());
    expect(result.snapshot.accounts).toHaveLength(1);
    expect(result.positions).toMatchObject({ status: "COMPLETE", readStartedAtMs: 1780261200000,
      readCompletedAtMs: 1780261200000, error: null });
    expect(result.positions.values?.[0]?.marginAsset).toBe(family.startsWith("usdt_") ? "USDT" : "BTC");
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(vi.mocked(f.fetchImpl).mock.calls.map(([url]) => new URL(String(url)).pathname))
      .toEqual([routes[family].account, routes[family].positions]);
    for (const [url, init] of vi.mocked(f.fetchImpl).mock.calls) {
      expect(new URL(String(url)).origin).toBe("https://api.hbdm.com");
      expect(init?.method).toBe("POST");
      const route = new URL(String(url)).pathname === routes[family].account ? "accountBody" : "positionsBody";
      expect(init?.body).toBe(JSON.stringify(routes[family][route]));
      expect(String(url)).not.toContain(secret);
    }
    expect(f.verifyReadOnlyAdmission).toHaveBeenCalledTimes(4);
    const digest = createHash("sha256").update(key).digest("hex");
    expect(vi.mocked(f.verifyReadOnlyAdmission).mock.calls.map(([, keyDigest]) => keyDigest)).toEqual(Array(4).fill(digest));
    await f.reader.settled();
  });

  it("retains a successful balance when positions HTTP read fails, with a separate positions error", async () => {
    const f = make("coin_perpetual", { fetchImpl: vi.fn<typeof fetch>(async url =>
      new URL(String(url)).pathname === routes.coin_perpetual.account
        ? new Response(accountRows.coin_perpetual)
        : new Response("unavailable", { status: 503 })) });
    const result = await f.reader.readDerivativesAccount("coin_perpetual", signal());
    expect(result.snapshot.accounts[0]?.marginBalance).toBe("0.2");
    expect(result.positions).toMatchObject({ status: "ERROR", values: null, error: "READ_FAILED" });
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    await f.reader.settled();
  });

  it("does not publish the balance when positions fails and post-read admission is revoked", async () => {
    const verifyReadOnlyAdmission = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const f = make("coin_perpetual", {
      verifyReadOnlyAdmission,
      fetchImpl: vi.fn<typeof fetch>(async url => new URL(String(url)).pathname === routes.coin_perpetual.account
        ? new Response(accountRows.coin_perpetual)
        : new Response("unavailable", { status: 503 })),
    });
    await expect(f.reader.readDerivativesAccount("coin_perpetual", signal())).rejects.toThrow("PERMISSION_DENIED");
    expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(verifyReadOnlyAdmission).toHaveBeenCalledTimes(4);
    await f.reader.settled();
  });

  it("marks positions partial when a documented required metric is unavailable", async () => {
    const f = make("coin_perpetual", {
      fetchImpl: vi.fn<typeof fetch>(async url => new URL(String(url)).pathname === routes.coin_perpetual.account
        ? new Response(accountRows.coin_perpetual)
        : new Response(`{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"1","available":"1","frozen":"0","cost_open":"60000","cost_hold":"60000","profit_unreal":"-1","position_margin":null,"lever_rate":5,"last_price":null,"liquidation_price":null}]}`)),
    });
    const result = await f.reader.readDerivativesAccount("coin_perpetual", signal());
    expect(result.snapshot.accounts[0]?.marginBalance).toBe("0.2");
    expect(result.positions).toMatchObject({ status: "PARTIAL", error: null,
      values: [{ positionMargin: null, lastPrice: null, liquidationPrice: null }] });
    await f.reader.settled();
  });

  it("discards the full family read when admission is revoked before the positions request", async () => {
    const verifyReadOnlyAdmission = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const f = make("usdt_cross_shared", { verifyReadOnlyAdmission });
    await expect(f.reader.readDerivativesAccount("usdt_cross_shared", signal())).rejects.toThrow("PERMISSION_DENIED");
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(verifyReadOnlyAdmission).toHaveBeenCalledTimes(3);
    await f.reader.settled();
  });
});
