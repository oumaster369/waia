// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHtxDerivativesAccountTransport } from "@/lib/trader/account-observation/derivatives/htx-account-transport";
import { parseHtxDerivativesAccountSnapshot } from "@/lib/trader/account-observation/derivatives/parser";
import type { ObservationClock } from "@/lib/trader/account-observation/types";
import { buildSignedPostQueryString } from "@/lib/trader/connectors/htx/signing";
import { createHash } from "node:crypto";
import type { HtxDerivativesReadAdmissionRequest } from "@/lib/trader/account-observation/derivatives/types";

const binding = Object.freeze({ organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", credentialRevision: "7" });
const key = "synthetic_public_test_key";
const secret = "synthetic-secret-used-only-in-unit-tests";
const now = Date.parse("2026-10-01T09:00:00Z");
const clock: ObservationClock = { now: () => now, sleep: (_ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, _ms);
  const abort = () => { clearTimeout(timer); reject(new Error("aborted")); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
}) };

const fixtures = {
  usdt_isolated_perpetual: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_balance":99.755058840000000000,"margin_position":0,"margin_frozen":12.730000000000000000,"margin_available":87.025058840000000000,"profit_real":0,"profit_unreal":0,"risk_rate":123.5,"liquidation_price":null,"lever_rate":5,"margin_mode":"isolated","margin_account":"BTC-USDT","margin_asset":"USDT"}]}`,
  usdt_cross_shared: `{"status":"ok","ts":1780261200000,"data":[{"margin_account":"USDT","margin_asset":"USDT","margin_balance":10000.000000000000000000,"margin_available":9000.000000000000000000,"margin_position":500.000000000000000000,"margin_frozen":500.000000000000000000,"margin_static":9800.000000000000000000,"profit_real":100.000000000000000000,"profit_unreal":100.000000000000000000,"risk_rate":12.500000000000000000,"margin_mode":"cross","contract_detail":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_position":0,"margin_frozen":0,"margin_available":10000.000000000000000000,"profit_unreal":0,"liquidation_price":null,"lever_rate":5,"contract_type":"swap","pair":"BTC-USDT","business_type":"swap"}],"futures_contract_detail":[{"symbol":"BTC","contract_code":"BTC-USDT-211217","margin_position":0,"margin_frozen":0,"margin_available":10000.000000000000000000,"profit_unreal":0,"liquidation_price":null,"lever_rate":5,"contract_type":"next_week","pair":"BTC-USDT","business_type":"futures"}]}]}`,
  coin_perpetual: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"THETA","contract_code":"THETA-USD","margin_balance":717.600960962561438668000000000000000000000000000000000000,"margin_position":15.483471394286599055,"margin_frozen":13.765413852951653365,"margin_available":688.352075715323186248,"profit_real":-1.234500000000000001,"profit_unreal":-6.321988896485647800000000000000000000000000000000000000,"risk_rate":24.134301218550508200,"liquidation_price":0.198584522842823398,"lever_rate":20,"margin_static":723.922949859047086468}]}`,
  coin_delivery_futures: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","margin_balance":0.987654321098765432,"margin_available":0.800000000000000000,"margin_position":0.100000000000000000,"margin_frozen":0.087654321098765432,"profit_real":-0.000000000000000001,"profit_unreal":-0.000000000000000002,"risk_rate":null,"liquidation_price":null,"lever_rate":10,"margin_static":0.987654321098765432}]}`,
} as const;

function setup(overrides: Partial<Parameters<typeof createHtxDerivativesAccountTransport>[0]> = {}) {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(fixtures.usdt_isolated_perpetual));
  const verifyReadAdmission = vi.fn(async (request: HtxDerivativesReadAdmissionRequest) => request.family.length > 0);
  const transport = createHtxDerivativesAccountTransport({ binding, accessKey: key, secret,
    host: "api.hbdm.com", timeoutMs: 500, maxResponseBytes: 20_000, clock, fetchImpl, verifyReadAdmission, ...overrides });
  return { transport, fetchImpl, verifyReadAdmission };
}

afterEach(() => vi.useRealTimers());

describe("HTX derivatives account projection", () => {
  it.each(Object.entries(fixtures))("preserves official %s account decimal tokens exactly", (family, payload) => {
    const result = parseHtxDerivativesAccountSnapshot(family as keyof typeof fixtures, payload);
    expect(result.family).toBe(family);
    expect(result.responseGeneratedAtMs).toBe(1780261200000);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0]?.marginBalance).toMatch(/\d/);
    if (family === "coin_perpetual") {
      expect(result.accounts[0]?.marginBalance).toBe("717.600960962561438668000000000000000000000000000000000000");
      expect(result.accounts[0]?.realizedPnl).toBe("-1.234500000000000001");
      expect(result.accounts[0]?.unrealizedPnl).toBe("-6.321988896485647800000000000000000000000000000000000000");
      expect(result.accounts[0]?.marginStatic).toBe("723.922949859047086468");
      expect(result.accounts[0]?.liquidationPrice).toBe("0.198584522842823398");
    }
    if (family === "usdt_isolated_perpetual") { expect(result.accounts[0]?.accountCode).toBe("BTC-USDT"); expect(result.accounts[0]?.collateralAsset).toBe("USDT"); }
    if (family === "usdt_cross_shared") {
      expect(result.accounts[0]?.accountCode).toBe("USDT");
      expect(result.accounts[0]?.collateralAsset).toBe("USDT");
      expect(result.accounts[0]?.marginBalance).toBe("10000.000000000000000000");
      expect(result.accounts[0]?.marginAvailable).toBe("9000.000000000000000000");
    }
    if (family === "coin_perpetual") { expect(result.accounts[0]?.accountCode).toBe("THETA-USD"); expect(result.accounts[0]?.collateralAsset).toBe("THETA"); }
    if (family === "coin_delivery_futures") {
      expect(result.accounts[0]?.accountCode).toBe("BTC"); expect(result.accounts[0]?.collateralAsset).toBe("BTC");
      expect(result.accounts[0]?.realizedPnl).toBe("-0.000000000000000001");
      expect(result.accounts[0]?.unrealizedPnl).toBe("-0.000000000000000002");
      expect(result.accounts[0]?.riskRate).toBeNull(); expect(result.accounts[0]?.liquidationPrice).toBeNull();
      expect(result.accounts[0]?.marginStatic).toBe("0.987654321098765432");
    }
  });

  it("uses shared cross-pool top-level totals once despite perpetual and delivery details", () => {
    const [account] = parseHtxDerivativesAccountSnapshot("usdt_cross_shared", fixtures.usdt_cross_shared).accounts;
    expect(account?.marginBalance).toBe("10000.000000000000000000");
    expect(account?.marginAvailable).toBe("9000.000000000000000000");
  });

  it("keeps valid empty data distinct from a zero-balance account", () => {
    const empty = parseHtxDerivativesAccountSnapshot("coin_perpetual", `{"status":"ok","ts":1780261200000,"data":[]}`);
    const zero = parseHtxDerivativesAccountSnapshot("coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_balance":0}]}`);
    expect(empty.accounts).toEqual([]);
    expect(zero.accounts[0]?.marginBalance).toBe("0");
  });

  it.each([
    `{"status":"error","data":[]}`,
    `{"status":"ok","data":[{"symbol":"BTC","margin_balance":"NaN"}]}`,
    `{"status":"ok","data":[{"symbol":"BTC","margin_balance":0},{"symbol":"BTC","margin_balance":1}]}`,
    `{"status":"ok","data":[{"symbol":"BTC","margin_balance":1,"margin_mode":"cross"}]}`,
    `{"status":"ok","data":null}`,
    `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_balance":0,"margin_balance":1}]}`,
    `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_balance":01}]}`,
    `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_balance":0}],0:"bad"}`,
    `{"status":"ok","data":[{"symbol":"BTC","contract_code":"ETH-USD","margin_asset":"BTC","margin_balance":0}]}`,
    `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_account":"BTC-USDT","margin_asset":"ETH","margin_balance":0}]}`,
  ])("rejects invalid, ambiguous, or wrong-family payload %s", payload => {
    expect(() => parseHtxDerivativesAccountSnapshot("usdt_isolated_perpetual", payload)).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
  });

  it.each([
    ["usdt_isolated_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"ETH-USDT","margin_asset":"USDT"}]}`],
    ["usdt_isolated_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_asset":"USDT"}]}`],
    ["usdt_isolated_perpetual", `{"status":"ok","data":[{"symbol":"ETH","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT"}]}`],
    ["usdt_cross_shared", `{"status":"ok","data":[{"margin_account":"BTC-USDT","margin_asset":"USDT"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_asset":"ETH"}]}`],
    ["coin_perpetual", `{"status":"ok","data":[{"symbol":"BTC","contract_code":"ETH-USD","margin_asset":"BTC"}]}`],
  ] as const)("rejects contradictory family identity/currency for %s", (family, payload) => {
    expect(() => parseHtxDerivativesAccountSnapshot(family, payload)).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
  });

  it("rejects over-deep and over-budget strict JSON before schema projection", () => {
    const deeplyNested = `${"{\"x\":".repeat(65)}0${"}".repeat(65)}`;
    const tooManyNodes = `{"status":"ok","data":[${Array.from({ length: 20_001 }, () => "null").join(",")}]}`;
    expect(() => parseHtxDerivativesAccountSnapshot("coin_perpetual", deeplyNested)).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
    expect(() => parseHtxDerivativesAccountSnapshot("coin_perpetual", tooManyNodes)).toThrow("HTX_DERIVATIVES_INVALID_RESPONSE");
  });
});

describe("HTX derivatives private read transport", () => {
  it.each([
    ["usdt_isolated_perpetual", "/linear-swap-api/v1/swap_account_info", {}],
    ["usdt_cross_shared", "/linear-swap-api/v1/swap_cross_account_info", { margin_account: "USDT" }],
    ["coin_perpetual", "/swap-api/v1/swap_account_info", {}],
    ["coin_delivery_futures", "/api/v1/contract_account_info", {}],
  ] as const)("issues only the fixed read-only account-info request for %s", async (family, path, requestBody) => {
    const { transport, fetchImpl, verifyReadAdmission } = setup();
    await expect(transport.readAccount(family, new AbortController().signal)).resolves.toBe(fixtures.usdt_isolated_perpetual);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toMatch(new RegExp(`${path.replaceAll("/", "\\/")}\\?`));
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(init?.body).toBe(JSON.stringify(requestBody));
    expect(String(url)).not.toContain(secret);
    expect(String(url)).toMatch(/^https:\/\/api\.hbdm\.com\//);
    expect(String(url).split("?")[1]).toBe(buildSignedPostQueryString({ accessKeyId: key, secret, host: "api.hbdm.com", path,
      timestamp: "2026-10-01T09:00:00" }));
    expect(verifyReadAdmission).toHaveBeenCalledTimes(2);
    const admissionCalls = verifyReadAdmission.mock.calls.map(([request]) => request);
    const expectedAdmission = { binding, family, accessKeySha256: createHash("sha256").update(key).digest("hex") };
    expect(admissionCalls).toEqual([expectedAdmission, expectedAdmission]);
    expect(admissionCalls.every(Object.isFrozen)).toBe(true);
    await transport.settled();
  });

  it("has no expressible arbitrary path/body and rejects families outside the literal registry", async () => {
    const { transport, fetchImpl } = setup();
    await expect(transport.readAccount("/linear-swap-api/v1/swap_order" as never, new AbortController().signal))
      .rejects.toThrow("PERMISSION_DENIED");
    expect(fetchImpl).not.toHaveBeenCalled();
    await transport.settled();
  });

  it("rejects spot hosts", () => {
    expect(() => setup({ host: "api.huobi.pro" as never })).toThrow("INVALID_RESPONSE");
    expect(() => setup({ host: "api-aws.huobi.pro" as never })).toThrow("INVALID_RESPONSE");
  });

  it("rechecks admission before and after read, and stops on denial", async () => {
    const verifyReadAdmission = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { transport, fetchImpl } = setup({ verifyReadAdmission });
    await expect(transport.readAccount("coin_perpetual", new AbortController().signal)).rejects.toThrow("PERMISSION_DENIED");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await transport.settled();
  });

  it("pins verifier, fetch, and clock capabilities across pre/post admission", async () => {
    const input: Record<string, unknown> = {
      binding, accessKey: key, secret, host: "api.hbdm.com", timeoutMs: 500, maxResponseBytes: 20_000, clock,
      fetchImpl: undefined, verifyReadAdmission: undefined,
    };
    const originalFetch = vi.fn<typeof fetch>(async () => {
      input.verifyReadAdmission = vi.fn(async () => false);
      input.fetchImpl = vi.fn<typeof fetch>(async () => new Response("replacement"));
      input.clock = { now: () => 0, sleep: async () => new Promise<void>(() => {}) };
      return new Response(fixtures.coin_perpetual);
    });
    const originalVerifier = vi.fn(async (request: HtxDerivativesReadAdmissionRequest) => request.family === "coin_perpetual");
    input.fetchImpl = originalFetch;
    input.verifyReadAdmission = originalVerifier;
    const transport = createHtxDerivativesAccountTransport(input as unknown as Parameters<typeof createHtxDerivativesAccountTransport>[0]);
    await expect(transport.readAccount("coin_perpetual", new AbortController().signal)).resolves.toBe(fixtures.coin_perpetual);
    expect(originalVerifier).toHaveBeenCalledTimes(2);
    expect(originalFetch).toHaveBeenCalledTimes(1);
    await transport.settled();
  });

  it("denies a B-family request when admission approves only family A, before any request", async () => {
    const verifier = vi.fn(async (request: HtxDerivativesReadAdmissionRequest) => request.family === "coin_perpetual");
    const { transport, fetchImpl } = setup({ verifyReadAdmission: verifier });
    await expect(transport.readAccount("usdt_cross_shared", new AbortController().signal)).rejects.toThrow("PERMISSION_DENIED");
    expect(verifier).toHaveBeenCalledTimes(1);
    expect(verifier.mock.calls[0]?.[0].family).toBe("usdt_cross_shared");
    expect(fetchImpl).not.toHaveBeenCalled();
    await transport.settled();
  });

  it("bounds the response body and converts HTTP 429 to a safe rate-limit code", async () => {
    const tooLarge = setup({ maxResponseBytes: 8 });
    await expect(tooLarge.transport.readAccount("coin_perpetual", new AbortController().signal)).rejects.toThrow("INVALID_RESPONSE");
    await tooLarge.transport.settled();
    const rateLimited = setup({ fetchImpl: vi.fn<typeof fetch>(async () => new Response("", { status: 429 })) });
    await expect(rateLimited.transport.readAccount("coin_perpetual", new AbortController().signal)).rejects.toThrow("RATE_LIMITED");
    await rateLimited.transport.settled();
  });
});
