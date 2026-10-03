import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  createObservationConfiguration,
  createPostgresAccountObservationRuntime,
} from "@/lib/trader/account-observation/runtime";
import type { ObservationAssignment } from "@/lib/trader/account-observation/runtime";
import { createHash } from "node:crypto";
import type { HtxDerivativesAccountFamily } from "@/lib/trader/account-observation/derivatives/types";

const ports = vi.hoisted(() => ({ claimDue: vi.fn(async () => null) }));
vi.mock("@/lib/trader/account-observation/postgres-repository", () => ({
  createPostgresObservationRepository: () => ports,
}));
const parameters = {
  symbols: ["BTCUSDT"],
  pollIntervalMs: 1000,
  maxBackoffMs: 8000,
  readTimeoutMs: 100,
  leaseTtlMs: 1000,
};
const assignment = (): ObservationAssignment => {
  const config = createObservationConfiguration(parameters);
  return {
    config,
    binding: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      credentialId: "00000000-0000-4000-8000-000000000002",
      exchangeAccountId: "account",
      credentialRevision: "1",
      configurationRevision: config.revision,
    },
  };
};
describe("explicit recurring PostgreSQL observation composition", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());
  it("binds every configuration parameter and rejects unsafe timing/symbols", () => {
    const c = createObservationConfiguration(parameters);
    expect(createObservationConfiguration({ ...parameters })).toEqual(c);
    expect(createObservationConfiguration({ ...parameters, maxBackoffMs: 9000 }).revision).not.toBe(
      c.revision,
    );
    expect(Object.isFrozen(c.symbols)).toBe(true);
    expect(() =>
      createObservationConfiguration({ ...parameters, symbols: ["BTCUSDT", "BTCUSDT"] }),
    ).toThrow();
    expect(() => createObservationConfiguration({ ...parameters, readTimeoutMs: 1000 })).toThrow();
  });
  it("retains legacy digest bytes for the generic reader, and canonically seals all HTX coverage", () => {
    expect(createObservationConfiguration(parameters).revision).toBe(
      "sha256:" + createHash("sha256").update(JSON.stringify(parameters)).digest("hex"),
    );
    const htxCoverage = {
      host: "api.huobi.pro" as const,
      pageSize: 10,
      maxPages: 2,
      maxRecords: 20,
      maxResponseBytes: 8192,
      tradeWindowMs: 60_000,
    };
    const config = createObservationConfiguration({ ...parameters, htxCoverage });
    expect(config.revision).not.toBe(createObservationConfiguration(parameters).revision);
    expect(
      createObservationConfiguration({
        ...parameters,
        htxCoverage: {
          tradeWindowMs: 60_000,
          maxResponseBytes: 8192,
          maxRecords: 20,
          maxPages: 2,
          pageSize: 10,
          host: "api.huobi.pro",
        },
      }),
    ).toEqual(config);
    for (const mutation of [
      { pageSize: 11 },
      { maxPages: 3 },
      { maxRecords: 21 },
      { maxResponseBytes: 8193 },
      { tradeWindowMs: 61_000 },
      { host: "api-aws.huobi.pro" as const },
    ]) {
      expect(
        createObservationConfiguration({
          ...parameters,
          htxCoverage: { ...htxCoverage, ...mutation },
        }).revision,
      ).not.toBe(config.revision);
    }
    htxCoverage.pageSize = 500;
    expect(config.htxCoverage?.pageSize).toBe(10);
    expect(Object.isFrozen(config.htxCoverage)).toBe(true);
    expect(() =>
      createObservationConfiguration({
        ...parameters,
        htxCoverage: { ...htxCoverage, maxResponseBytes: 1048577 },
      }),
    ).toThrow();
  });
  it("binds an immutable explicit derivatives family allowlist while preserving the legacy spot digest", () => {
    const inputFamilies: HtxDerivativesAccountFamily[] = ["usdt_cross_shared", "coin_perpetual"];
    const configured = createObservationConfiguration({
      ...parameters,
      htxDerivativesFamilies: inputFamilies,
    });
    inputFamilies.push("coin_delivery_futures");
    expect(configured.htxDerivativesFamilies).toEqual(["usdt_cross_shared", "coin_perpetual"]);
    expect(configured.htxDerivativesFamilies).not.toBe(inputFamilies);
    expect(Object.isFrozen(configured.htxDerivativesFamilies)).toBe(true);
    expect(configured.revision).not.toBe(createObservationConfiguration(parameters).revision);
    expect(() =>
      createObservationConfiguration({ ...parameters, htxDerivativesFamilies: [] }),
    ).toThrow();
    expect(() =>
      createObservationConfiguration({
        ...parameters,
        htxDerivativesFamilies: ["coin_perpetual", "coin_perpetual"],
      }),
    ).toThrow();
    expect(() =>
      createObservationConfiguration({
        ...parameters,
        htxDerivativesFamilies: ["unknown-family"] as unknown as HtxDerivativesAccountFamily[],
      }),
    ).toThrow();
    expect(() =>
      createObservationConfiguration({
        ...parameters,
        readTimeoutMs: 200,
        leaseTtlMs: 1200,
        htxDerivativesFamilies: [
          "usdt_isolated_perpetual",
          "usdt_cross_shared",
          "coin_perpetual",
          "coin_delivery_futures",
        ],
      }),
    ).toThrow();
  });
  it("binds fill contracts into the digest and leaves configs that omit them unchanged", () => {
    const families: HtxDerivativesAccountFamily[] = [
      "usdt_isolated_perpetual",
      "usdt_cross_shared",
      "coin_perpetual",
      "coin_delivery_futures",
    ];
    const withoutFills = createObservationConfiguration({
      ...parameters,
      htxDerivativesFamilies: families,
      leaseTtlMs: 2000,
    });
    expect(withoutFills.htxDerivativesFillContracts).toBeUndefined();
    expect(withoutFills.revision).toBe(
      createObservationConfiguration({
        ...parameters,
        htxDerivativesFamilies: families,
        leaseTtlMs: 2000,
      }).revision,
    );
    const fills = [
      { family: "usdt_cross_shared" as const, contract: "ETH-USDT" },
      { family: "usdt_isolated_perpetual" as const, contract: "BTC-USDT" },
      { family: "coin_perpetual" as const, contract: "BTC-USD" },
      { family: "coin_delivery_futures" as const, contract: "BTC201225" },
    ];
    const configured = createObservationConfiguration({
      ...parameters,
      htxDerivativesFamilies: families,
      leaseTtlMs: 3000,
      htxDerivativesFillContracts: fills,
    });
    expect(
      configured.htxDerivativesFillContracts?.map((item) => `${item.family}:${item.contract}`),
    ).toEqual([
      "usdt_isolated_perpetual:BTC-USDT",
      "usdt_cross_shared:ETH-USDT",
      "coin_perpetual:BTC-USD",
      "coin_delivery_futures:BTC201225",
    ]);
    fills[0] = { family: "usdt_isolated_perpetual", contract: "MUTATED-USDT" };
    expect(configured.htxDerivativesFillContracts?.[1]?.contract).toBe("ETH-USDT");
    expect(Object.isFrozen(configured.htxDerivativesFillContracts)).toBe(true);
    expect(configured.revision).not.toBe(withoutFills.revision);
    expect(() =>
      createObservationConfiguration({
        ...parameters,
        htxDerivativesFamilies: ["usdt_isolated_perpetual"],
        leaseTtlMs: 3000,
        htxDerivativesFillContracts: [{ family: "coin_perpetual", contract: "BTC-USD" }],
      }),
    ).toThrow();
    expect(() =>
      createObservationConfiguration({
        ...parameters,
        htxDerivativesFamilies: families,
        leaseTtlMs: 3000,
        htxDerivativesFillContracts: [
          { family: "usdt_isolated_perpetual", contract: "BTC-USDT-211217" },
        ],
      }),
    ).toThrow();
  });
  it("digest-binds protected V5 scope and reserves its full reader budget in the lease", () => {
    const withV5 = createObservationConfiguration({ ...parameters, leaseTtlMs: 120_401,
      htxV5: { enabled: true, fillContracts: ["ETH-USDT", "BTC-USDT"], expectedHtxUid: "594179655" } });
    expect(withV5.revision).not.toBe(createObservationConfiguration({ ...parameters, leaseTtlMs: 120_401 }).revision);
    expect(withV5.htxV5).toEqual({ enabled: true, fillContracts: ["BTC-USDT", "ETH-USDT"], expectedHtxUid: "594179655" });
    expect(Object.isFrozen(withV5.htxV5)).toBe(true);
    expect(Object.isFrozen(withV5.htxV5?.fillContracts)).toBe(true);
    expect(() => createObservationConfiguration({ ...parameters, leaseTtlMs: 120_400,
      htxV5: { enabled: true } })).toThrow();
    expect(() => createObservationConfiguration({ ...parameters, htxV5: { enabled: true,
      fillContracts: ["BTC-USDT", "BTC-USDT"] }, leaseTtlMs: 120_401 })).toThrow();
    expect(() => createObservationConfiguration({ ...parameters, htxV5: { enabled: false,
      expectedHtxUid: "594179655" } })).toThrow();
  });
  it("starts only when awaited, recurs without a browser, and stops cleanly", async () => {
    const stop = new AbortController();
    const openReader = vi.fn();
    const loadAssignments = vi.fn(async () => [assignment()]);
    const runtime = createPostgresAccountObservationRuntime({
      sql: {} as Sql,
      loadAssignments,
      openReader,
      report: vi.fn(),
      ownerId: "local-proof",
    });
    expect(loadAssignments).not.toHaveBeenCalled();
    const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.claimDue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ports.claimDue).toHaveBeenCalledTimes(2);
    expect(openReader).not.toHaveBeenCalled();
    stop.abort();
    await work;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["configuration", "duplicate-account", "invalid-binding"])(
    "rejects %s before any lease or credential open",
    async (mode) => {
      const a = assignment();
      let list = [a];
      if (mode === "configuration") list = [{ ...a, config: { ...a.config, maxBackoffMs: 9000 } }];
      if (mode === "duplicate-account")
        list = [
          a,
          { ...a, binding: { ...a.binding, credentialId: "00000000-0000-4000-8000-000000000003" } },
        ];
      if (mode === "invalid-binding")
        list = [{ ...a, binding: { ...a.binding, credentialRevision: "invalid" } }];
      const stop = new AbortController();
      const report = vi.fn();
      const openReader = vi.fn();
      const runtime = createPostgresAccountObservationRuntime({
        sql: {} as Sql,
        loadAssignments: async () => list,
        openReader,
        report,
      });
      const work = runtime.run(stop.signal);
      await vi.advanceTimersByTimeAsync(0);
      expect(report).toHaveBeenCalledWith("ASSIGNMENTS_FAILED");
      expect(ports.claimDue).not.toHaveBeenCalled();
      expect(openReader).not.toHaveBeenCalled();
      stop.abort();
      await work;
    },
  );
});
