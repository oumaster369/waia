// @vitest-environment node
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHtxDerivativesObservationReader } from "@/lib/trader/account-observation/derivatives/reader";
import {
  HTX_DERIVATIVES_ACCOUNT_FAMILIES,
  type HtxDerivativesAccountFamily,
} from "@/lib/trader/account-observation/derivatives/types";
import type { HtxObservationCredentialHandle } from "@/lib/trader/account-observation/htx-reader-opener";
import type { ObservationBinding, ObservationClock } from "@/lib/trader/account-observation/types";

const binding: ObservationBinding = Object.freeze({
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "123",
  credentialRevision: "7",
  configurationRevision: "config-v1",
});
const key = "synthetic_derivatives_key";
const secret = "synthetic-derivatives-secret";
const now = Date.parse("2026-10-01T09:00:00Z");
const clock: ObservationClock = {
  now: () => now,
  sleep: (_ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, _ms);
      const abort = () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    }),
};

const payloads: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","margin_mode":"isolated","margin_balance":"10.25","margin_available":"9.75"}]}`,
  usdt_cross_shared: `{"status":"ok","ts":1780261200000,"data":[{"margin_account":"USDT","margin_asset":"USDT","margin_mode":"cross","margin_balance":"20.5","margin_available":"18"}]}`,
  coin_perpetual: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","contract_code":"BTC-USD","margin_balance":"0.25","margin_available":"0.2"}]}`,
  coin_delivery_futures: `{"status":"ok","ts":1780261200000,"data":[{"symbol":"BTC","margin_balance":"0.5","margin_available":"0.4"}]}`,
};
const positionPayloads: Record<HtxDerivativesAccountFamily, string> = {
  usdt_isolated_perpetual: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"BTC-USDT","margin_asset":"USDT","direction":"buy","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
  usdt_cross_shared: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USDT","margin_account":"USDT","margin_asset":"USDT","direction":"sell","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
  coin_perpetual: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC-USD","direction":"buy","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
  coin_delivery_futures: `{"status":"ok","data":[{"symbol":"BTC","contract_code":"BTC201225","contract_type":"quarter","direction":"sell","volume":"1","available":"1","frozen":"0","cost_open":"10","cost_hold":"10","profit_unreal":"0","position_margin":"1","lever_rate":2}]}`,
};
const endpoints: Record<
  HtxDerivativesAccountFamily,
  { path: string; body: Record<string, string> }
> = {
  usdt_isolated_perpetual: { path: "/linear-swap-api/v1/swap_account_info", body: {} },
  usdt_cross_shared: {
    path: "/linear-swap-api/v1/swap_cross_account_info",
    body: { margin_account: "USDT" },
  },
  coin_perpetual: { path: "/swap-api/v1/swap_account_info", body: {} },
  coin_delivery_futures: { path: "/api/v1/contract_account_info", body: {} },
};
const positionEndpoints: Record<
  HtxDerivativesAccountFamily,
  { path: string; body: Record<string, string> }
> = {
  usdt_isolated_perpetual: { path: "/linear-swap-api/v1/swap_position_info", body: {} },
  usdt_cross_shared: { path: "/linear-swap-api/v1/swap_cross_position_info", body: {} },
  coin_perpetual: { path: "/swap-api/v1/swap_position_info", body: {} },
  coin_delivery_futures: { path: "/api/v1/contract_position_info", body: {} },
};

type MutableCredential = {
  binding: ObservationBinding;
  apiKey: string;
  apiSecret: string;
  dispose(): void;
};
function setup(
  options: {
    families?: HtxDerivativesAccountFamily[];
    verifyReadOnlyAdmission?: (
      binding: ObservationBinding,
      keyDigest: string,
      signal: AbortSignal,
    ) => Promise<boolean>;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const credential: MutableCredential = {
    binding: { ...binding },
    apiKey: key,
    apiSecret: secret,
    dispose: vi.fn(),
  };
  const families = options.families ?? [...HTX_DERIVATIVES_ACCOUNT_FAMILIES];
  const fetchImpl =
    options.fetchImpl ??
    vi.fn<typeof fetch>(async (url) => {
      const pathname = new URL(String(url)).pathname;
      const accountEntry = Object.entries(endpoints).find(
        ([, endpoint]) => endpoint.path === pathname,
      );
      const positionEntry = Object.entries(positionEndpoints).find(
        ([, endpoint]) => endpoint.path === pathname,
      );
      const family = (accountEntry?.[0] ?? positionEntry?.[0]) as
        | HtxDerivativesAccountFamily
        | undefined;
      return new Response(
        accountEntry && family
          ? payloads[family]
          : positionEntry && family
            ? positionPayloads[family]
            : "not found",
        { status: family ? 200 : 404 },
      );
    });
  const verifyReadOnlyAdmission = options.verifyReadOnlyAdmission ?? vi.fn(async () => true);
  const input = {
    credential: credential as HtxObservationCredentialHandle,
    families,
    clock,
    fetchImpl,
    timeoutMs: 1000,
    maxResponseBytes: 20_000,
    verifyReadOnlyAdmission,
  };
  const reader = createHtxDerivativesObservationReader(input);
  return { input, reader, credential, families, fetchImpl, verifyReadOnlyAdmission };
}

const signal = () => new AbortController().signal;
afterEach(() => vi.useRealTimers());

describe("HTX derivatives observation reader composition", () => {
  it.each(HTX_DERIVATIVES_ACCOUNT_FAMILIES)(
    "reads %s through its exact fixed account-info endpoint",
    async (family) => {
      const f = setup({ families: [family] });
      const result = await f.reader.readDerivativesAccount(family, signal());
      expect(Object.keys(result).sort()).toEqual([
        "binding",
        "executions",
        "positions",
        "snapshot",
      ]);
      expect(result.executions).toMatchObject({
        status: "NOT_CONFIGURED",
        coverage: "NOT_CONFIGURED",
        values: null,
      });
      expect(result.binding).toEqual(binding);
      expect(result.snapshot.family).toBe(family);
      expect(result.snapshot.accounts).toHaveLength(1);
      expect(result.positions.status).toBe("COMPLETE");
      expect(f.fetchImpl).toHaveBeenCalledTimes(2);
      for (const [index, [url, init]] of vi.mocked(f.fetchImpl).mock.calls.entries()) {
        const route = index === 0 ? endpoints[family] : positionEndpoints[family];
        expect(new URL(String(url)).origin).toBe("https://api.hbdm.com");
        expect(new URL(String(url)).pathname).toBe(route.path);
        expect(init).toMatchObject({
          method: "POST",
          redirect: "error",
          credentials: "omit",
          cache: "no-store",
        });
        expect(init?.body).toBe(JSON.stringify(route.body));
        expect(String(url)).not.toContain(secret);
      }
      const digest = createHash("sha256").update(key).digest("hex");
      const expectedBinding = binding;
      expect(f.verifyReadOnlyAdmission).toHaveBeenCalledTimes(4);
      const calls = vi.mocked(f.verifyReadOnlyAdmission).mock.calls;
      expect(calls.map(([admissionBinding, keyDigest]) => [admissionBinding, keyDigest])).toEqual(
        Array.from({ length: 4 }, () => [expectedBinding, digest]),
      );
      expect(calls[0]?.[0]).toBe(calls[1]?.[0]);
      expect(calls[2]?.[0]).toBe(calls[3]?.[0]);
      expect(calls.every(([, , admissionSignal]) => admissionSignal instanceof AbortSignal)).toBe(
        true,
      );
      expect(Object.isFrozen(calls[0]?.[0])).toBe(true);
      await f.reader.settled();
    },
  );

  it("does not fetch when read-only admission refuses before the venue read", async () => {
    const verifyReadOnlyAdmission = vi.fn(async () => false);
    const f = setup({ verifyReadOnlyAdmission });
    await expect(f.reader.readDerivativesAccount("usdt_cross_shared", signal())).rejects.toThrow(
      "PERMISSION_DENIED",
    );
    expect(verifyReadOnlyAdmission).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    await f.reader.settled();
  });

  it("returns no snapshot when fresh read-only admission refuses after the venue response", async () => {
    const verifyReadOnlyAdmission = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const f = setup({ verifyReadOnlyAdmission });
    await expect(f.reader.readDerivativesAccount("coin_perpetual", signal())).rejects.toThrow(
      "PERMISSION_DENIED",
    );
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(verifyReadOnlyAdmission).toHaveBeenCalledTimes(3);
    await f.reader.settled();
  });

  it("captures the configured family list and verifier so post-construction mutation cannot widen access", async () => {
    const families: HtxDerivativesAccountFamily[] = ["usdt_isolated_perpetual"];
    const verifyReadOnlyAdmission = vi.fn(async () => false);
    const f = setup({ families, verifyReadOnlyAdmission });
    families.push("coin_perpetual");
    f.input.verifyReadOnlyAdmission = async () => true;
    await expect(f.reader.readDerivativesAccount("coin_perpetual", signal())).rejects.toThrow(
      "PERMISSION_DENIED",
    );
    await expect(
      f.reader.readDerivativesAccount("usdt_isolated_perpetual", signal()),
    ).rejects.toThrow("PERMISSION_DENIED");
    expect(verifyReadOnlyAdmission).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    await f.reader.settled();
  });

  it.each([
    "organizationId",
    "credentialId",
    "exchangeAccountId",
    "credentialRevision",
    "configurationRevision",
  ] as const)(
    "refuses a mutated full credential binding (%s) before metadata or account I/O",
    async (field) => {
      const f = setup();
      (f.credential.binding as unknown as Record<string, string>)[field] = "different";
      await expect(f.reader.readDerivativesAccount("coin_perpetual", signal())).rejects.toThrow(
        "IDENTITY_MISMATCH",
      );
      expect(f.verifyReadOnlyAdmission).not.toHaveBeenCalled();
      expect(f.fetchImpl).not.toHaveBeenCalled();
      await f.reader.settled();
    },
  );

  it.each(["apiKey", "apiSecret"] as const)(
    "refuses a mutated opened credential %s before any request",
    async (field) => {
      const f = setup();
      f.credential[field] = `changed-${field}`;
      await expect(
        f.reader.readDerivativesAccount("coin_delivery_futures", signal()),
      ).rejects.toThrow("IDENTITY_MISMATCH");
      expect(f.verifyReadOnlyAdmission).not.toHaveBeenCalled();
      expect(f.fetchImpl).not.toHaveBeenCalled();
      await f.reader.settled();
    },
  );

  it.each(["apiKey", "apiSecret"] as const)(
    "refuses a changed %s during fresh admission before account fetch",
    async (field) => {
      let announce!: () => void;
      const callbackStarted = new Promise<void>((resolve) => {
        announce = resolve;
      });
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const verifyReadOnlyAdmission = vi.fn(async () => {
        announce();
        await hold;
        return true;
      });
      const f = setup({ verifyReadOnlyAdmission });
      const pending = f.reader.readDerivativesAccount("coin_perpetual", signal());
      await callbackStarted;
      f.credential[field] = `changed-during-admission-${field}`;
      release();
      await expect(pending).rejects.toThrow("PERMISSION_DENIED");
      expect(f.fetchImpl).not.toHaveBeenCalled();
      await f.reader.settled();
    },
  );

  it("refuses a family not in the captured list without contacting admission or fetch", async () => {
    const f = setup({ families: ["usdt_cross_shared"] });
    await expect(f.reader.readDerivativesAccount("coin_perpetual", signal())).rejects.toThrow(
      "PERMISSION_DENIED",
    );
    expect(f.verifyReadOnlyAdmission).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    await f.reader.settled();
  });

  it("allows another configured family to read after one family's HTTP failure", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response(payloads.coin_perpetual))
      .mockResolvedValueOnce(new Response(positionPayloads.coin_perpetual));
    const f = setup({ families: ["usdt_isolated_perpetual", "coin_perpetual"], fetchImpl });
    await expect(
      f.reader.readDerivativesAccount("usdt_isolated_perpetual", signal()),
    ).rejects.toThrow("READ_FAILED");
    const result = await f.reader.readDerivativesAccount("coin_perpetual", signal());
    expect(result.snapshot.family).toBe("coin_perpetual");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await f.reader.settled();
  });

  it("does not start work for a pre-aborted request and can be disposed cleanly", async () => {
    const f = setup();
    const aborted = new AbortController();
    aborted.abort();
    await expect(f.reader.readDerivativesAccount("coin_perpetual", aborted.signal)).rejects.toThrow(
      "PERMISSION_DENIED",
    );
    expect(f.verifyReadOnlyAdmission).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    f.reader.dispose();
    await f.reader.settled();
    await expect(f.reader.readDerivativesAccount("coin_perpetual", signal())).rejects.toThrow(
      "PERMISSION_DENIED",
    );
  });

  it("aborts an in-flight venue request when the reader is disposed", async () => {
    let reachedFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      reachedFetch = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          reachedFetch();
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
    );
    const f = setup({ fetchImpl });
    const pending = f.reader.readDerivativesAccount("coin_perpetual", signal());
    await fetchStarted;
    f.reader.dispose();
    await expect(pending).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await f.reader.settled();
  });
});
