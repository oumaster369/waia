import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountObservationFailure, AccountObservationReadFailure, createAccountObservationService } from
  "@/lib/trader/account-observation/service";
import { parseAccountObservation } from "@/lib/trader/account-observation/validation";
import type { AccountObservation, AccountObservationReader, ObservationBinding, ObservationClock,
  HtxV5AccountObservation, ObservationConfig, ObservationLease, ObservationRepository, ObservedOrder, ReadEnvelope } from
  "@/lib/trader/account-observation/types";
import type { Balance, Trade } from "@/lib/trader/connectors/types";
import { HTX_DERIVATIVES_ACCOUNT_FAMILIES, type HtxDerivativesAccountFamily,
  type HtxDerivativesAccountSnapshot } from "@/lib/trader/account-observation/derivatives/types";

const initial: ObservationBinding = { organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "account-1",
  credentialRevision: "1", configurationRevision: "config-1" };
const config: ObservationConfig = { revision: "config-1", symbols: ["BTCUSDT", "ETHUSDT"],
  pollIntervalMs: 100, maxBackoffMs: 800, readTimeoutMs: 10, leaseTtlMs: 1000 };
const clock: ObservationClock = { now: () => Date.now(), sleep: (ms, signal) => new Promise((resolve, reject) => {
  const cancel = () => { clearTimeout(timer); reject(new Error("ABORTED")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
}) };
function setup(overrides: Partial<ObservationConfig> = {}) {
  const state = { binding: { ...initial }, active: true, lease: null as ObservationLease | null,
    nextDue: 0, failures: 0, counter: 0, observations: [] as AccountObservation[] };
  const matches = (binding: ObservationBinding) => JSON.stringify(binding) === JSON.stringify(state.binding);
  const current = (lease: ObservationLease, time: number) => state.active && matches(lease.binding) &&
    state.lease?.token === lease.token && lease.expiresAtMs > time;
  const beforeCommit = vi.fn(() => {});
  // Atomic fake port, not proof of SQL/RLS/concurrent transaction implementation.
  const repository: ObservationRepository = {
    claimDue: vi.fn(async (binding, ownerId, nowMs, ttlMs) => {
      if (!state.active || !matches(binding) || state.nextDue > nowMs ||
        (state.lease && state.lease.expiresAtMs > nowMs)) return null;
      state.lease = { binding: { ...binding }, ownerId, token: `lease-${++state.counter}`,
        expiresAtMs: nowMs + ttlMs, consecutiveFailures: state.failures };
      return state.lease;
    }),
    isCurrent: vi.fn(async (lease, time) => current(lease, time)),
    commitIfCurrent: vi.fn(async input => {
      beforeCommit();
      if (!current(input.lease, input.nowMs)) return false;
      state.observations.push(input.observation); state.nextDue = input.nextDueAtMs;
      state.failures = input.consecutiveFailures; state.lease = null; return true;
    }),
    release: vi.fn(async lease => { if (state.lease?.token === lease.token) state.lease = null; }),
  };
  const envelope = <T>(values: readonly T[] = []): ReadEnvelope<T> =>
    ({ binding: { ...state.binding }, values, complete: true, sourceAsOfMs: null });
  const snapshot = (family: HtxDerivativesAccountFamily): HtxDerivativesAccountSnapshot => {
    const accountCode = family === "usdt_cross_shared" ? "USDT" :
      family === "usdt_isolated_perpetual" ? "BTC-USDT" : family === "coin_perpetual" ? "THETA-USD" : "BTC";
    const collateralAsset = family === "usdt_cross_shared" || family === "usdt_isolated_perpetual" ? "USDT" :
      family === "coin_perpetual" ? "THETA" : "BTC";
    return { schemaVersion: "htx-derivatives-account/v1", family, responseGeneratedAtMs: null,
      accounts: [{ accountCode, collateralAsset,
        marginMode: family === "usdt_cross_shared" ? "cross" : family === "usdt_isolated_perpetual" ? "isolated" : null,
        marginBalance: "1.250000000000000001", marginAvailable: "1",
        withdrawAvailable: family === "usdt_cross_shared" ? "1" : null,
        marginPosition: "0", marginFrozen: "0",
        marginStatic: "1", realizedPnl: "0", unrealizedPnl: "-0.000000000000000001", riskRate: "0",
        liquidationPrice: "0", leverage: "1" }],
    };
  };
  const position = (family: HtxDerivativesAccountFamily) => ({
    status: "COMPLETE" as const,
    values: [{ symbol: family === "usdt_isolated_perpetual" ? "BTC" : family === "coin_perpetual" ? "THETA" : "BTC",
      contractCode: family === "usdt_isolated_perpetual" ? "BTC-USDT" : family === "usdt_cross_shared" ? "BTC-USDT" :
        family === "coin_perpetual" ? "THETA-USD" : "BTC201225",
      contractType: family === "coin_delivery_futures" ? "quarter" : null,
      direction: "buy" as const, volume: "1", available: "1", frozen: "0", costOpen: "100", costHold: "100",
      unrealizedPnl: "-0.01", profitRate: null, positionMargin: "1",
      marginAsset: family.startsWith("usdt_") ? "USDT" : family === "coin_perpetual" ? "THETA" : "BTC",
      leverage: "2", lastPrice: null, liquidationPrice: null }],
    readStartedAtMs: Date.now(), readCompletedAtMs: Date.now(), responseGeneratedAtMs: null, error: null,
  });
  const reader: AccountObservationReader = { readBalances: vi.fn(async () => envelope<Balance>()),
    readOpenOrders: vi.fn(async () => envelope<ObservedOrder>()), readTrades: vi.fn(async () => envelope<Trade>()),
    readDerivativesAccount: vi.fn(async (family: HtxDerivativesAccountFamily) => ({
      binding: { ...state.binding }, snapshot: snapshot(family), positions: position(family),
    })), dispose: vi.fn() };
  const openReader = vi.fn(async (_binding: ObservationBinding, _signal: AbortSignal) => {
    void _binding; void _signal; return reader;
  });
  const deps = { repository, clock, openReader,
    newObservationId: () => `10000000-0000-4000-8000-${String(state.counter).padStart(12, "0")}` };
  const service = createAccountObservationService(deps, { ...config, ...overrides });
  return { state, repository, reader, openReader, service, envelope, snapshot, position, beforeCommit, deps };
}
function htxV5Projection(htxUid = "456", withPartialError = false): HtxV5AccountObservation {
  const started = Date.now();
  const completeValue = <T>(value: T) => ({ status: "COMPLETE" as const, value,
    readStartedAtMs: started, readCompletedAtMs: started, responseGeneratedAtMs: null, error: null });
  const completeRows = <T>(values: readonly T[]) => ({ status: "COMPLETE" as const, values,
    readStartedAtMs: started, readCompletedAtMs: started, responseGeneratedAtMs: null, error: null, pageScope: null });
  const algoTypes = ["tp", "sl", "tpsl", "trigger", "trailing_stop"] as const;
  return { schemaVersion: "htx-v5-observation/v1", htxUid,
    assetMode: completeValue("1"),
    balance: completeValue({ state: "normal", account: { equityUsd: "0", initialMarginUsd: "0",
      maintenanceMarginUsd: "0", maintenanceMarginRate: "0", profitUnrealUsd: "0", availableMarginUsd: "0",
      voucherValue: "0", createdTimeMs: null, updatedTimeMs: null }, details: [] }),
    positions: completeRows([]),
    openOrders: withPartialError ? { status: "PARTIAL", values: [], readStartedAtMs: started,
      readCompletedAtMs: started, responseGeneratedAtMs: null, error: "INVALID_RESPONSE",
      pageScope: { pageSize: 100, maxPages: 2, pagesRead: 1, nextFrom: null, completeness: "UNKNOWN" } }
      : { status: "PARTIAL", values: [], readStartedAtMs: started, readCompletedAtMs: started,
        responseGeneratedAtMs: null, error: null,
        pageScope: { pageSize: 100, maxPages: 2, pagesRead: 1, nextFrom: null, completeness: "UNKNOWN" } },
    algoOrders: { status: "PARTIAL", values: [], readStartedAtMs: started, readCompletedAtMs: started,
      responseGeneratedAtMs: null, error: null, pageScope: { pageSize: 20, maxPagesPerType: 2,
        queries: algoTypes.map(type => ({ type, pagesRead: 1, nextFrom: null })), completeness: "UNKNOWN" } },
    fills: { status: "NOT_CONFIGURED", values: null, readStartedAtMs: null, readCompletedAtMs: null,
      responseGeneratedAtMs: null, error: null, coverage: "NOT_CONFIGURED", contracts: [],
      windowStartMs: null, windowEndMs: null, pageScope: null } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
afterEach(() => { vi.useRealTimers(); });

describe("DEE-960 injected account observation — no production adapter or real venue", () => {
  it("validates the additional V5 lease budget and backs off on a partial classified failure", async () => {
    expect(() => setup({ htxV5: { enabled: true }, leaseTtlMs: 120_050 })).toThrow();
    const f = setup({ htxV5: { enabled: true }, leaseTtlMs: 120_051 });
    Object.defineProperty(f.reader, "readHtxV5", { configurable: true, value: vi.fn(async () => ({
      binding: { ...f.state.binding }, projection: htxV5Projection("456", true) })) });
    const result = await f.service.tick(initial, "owner");
    expect(result).toMatchObject({ status: "COMMITTED", observation: { schemaVersion: "account-observation/v3",
      htxV5: { htxUid: "456", openOrders: { status: "PARTIAL", error: "INVALID_RESPONSE" } } } });
    expect(f.state.failures).toBe(1);
    expect(f.state.nextDue).toBe(Date.now() + 200);
  });

  it.each([
    { enabled: false, fillContracts: ["BTC-USDT"] },
    { enabled: false, expectedHtxUid: "456" },
    { enabled: true, fillContracts: ["BTC-USDT", "BTC-USDT"] },
  ])("rejects invalid direct-service V5 configuration %#", htxV5 => {
    const f = setup();
    expect(() => createAccountObservationService(f.deps, {
      ...config, htxV5, leaseTtlMs: 120_051,
    })).toThrow();
  });

  it("fences a changed lease after the V5 reader returns and before repository commit", async () => {
    const f = setup({ htxV5: { enabled: true }, leaseTtlMs: 120_051 });
    Object.defineProperty(f.reader, "readHtxV5", { configurable: true, value: vi.fn(async () => {
      f.state.active = false;
      return { binding: { ...f.state.binding }, projection: htxV5Projection() };
    }) });
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.reader.readHtxV5).toHaveBeenCalledTimes(1);
  });

  it("rejects a V5 fill projection whose contract scope differs from the digest-bound configuration", async () => {
    const f = setup({ htxV5: { enabled: true, fillContracts: ["BTC-USDT"] }, leaseTtlMs: 120_051 });
    Object.defineProperty(f.reader, "readHtxV5", { configurable: true, value: vi.fn(async () => ({
      binding: { ...f.state.binding }, projection: htxV5Projection() })) });
    const result = await f.service.tick(initial, "owner");
    expect(result).toMatchObject({ status: "COMMITTED", observation: { schemaVersion: "account-observation/v3",
      htxV5: { fills: { status: "ERROR", error: "INVALID_RESPONSE", coverage: "CONFIGURED_CONTRACTS_AND_WINDOW",
        contracts: ["BTC-USDT"], windowStartMs: null, windowEndMs: null } } } });
    expect(f.state.failures).toBe(1);
  });

  it("rejects fill data when no contracts were configured", async () => {
    const f = setup({ htxV5: { enabled: true }, leaseTtlMs: 120_051 });
    const base = htxV5Projection();
    const projection: HtxV5AccountObservation = { ...base, fills: { status: "ERROR", values: null,
      readStartedAtMs: 10_000, readCompletedAtMs: 10_000,
      responseGeneratedAtMs: null, error: "READ_FAILED", coverage: "CONFIGURED_CONTRACTS_AND_WINDOW",
      contracts: ["BTC-USDT"], windowStartMs: null, windowEndMs: null, pageScope: null } };
    Object.defineProperty(f.reader, "readHtxV5", { configurable: true, value: vi.fn(async () => ({
      binding: { ...f.state.binding }, projection })) });
    const result = await f.service.tick(initial, "owner");
    expect(result).toMatchObject({ status: "COMMITTED", observation: { schemaVersion: "account-observation/v3",
      htxV5: { assetMode: { status: "ERROR", error: "INVALID_RESPONSE" },
        fills: { status: "NOT_CONFIGURED", error: null, coverage: "NOT_CONFIGURED", contracts: [] } } } });
  });

  it("keeps total V5 read failure as an unavailable observation when the expected UID was never observed", async () => {
    const f = setup({ htxV5: { enabled: true, expectedHtxUid: "456" }, leaseTtlMs: 120_051 });
    const base = htxV5Projection();
    const errorValue = <T>(value: T | null) => ({ status: "ERROR" as const, value,
      readStartedAtMs: 10_000, readCompletedAtMs: 10_000, responseGeneratedAtMs: null,
      error: "READ_FAILED" as const });
    const errorRows = { status: "ERROR" as const, values: null, readStartedAtMs: 10_000,
      readCompletedAtMs: 10_000, responseGeneratedAtMs: null, error: "READ_FAILED" as const, pageScope: null };
    const projection: HtxV5AccountObservation = { ...base, htxUid: null,
      assetMode: errorValue(null), balance: errorValue(null), positions: errorRows, openOrders: errorRows,
      algoOrders: { status: "ERROR", values: null, readStartedAtMs: 10_000, readCompletedAtMs: 10_000,
        responseGeneratedAtMs: null, error: "READ_FAILED", pageScope: null } };
    Object.defineProperty(f.reader, "readHtxV5", { configurable: true, value: vi.fn(async () => ({
      binding: { ...f.state.binding }, projection })) });
    const result = await f.service.tick(initial, "owner");
    expect(result).toMatchObject({ status: "COMMITTED", observation: { schemaVersion: "account-observation/v3",
      htxV5: { htxUid: null, assetMode: { status: "ERROR", error: "READ_FAILED" } } } });
    expect(f.state.failures).toBe(1);
  });

  it("fences a missing UID when any V5 component reports data", async () => {
    const f = setup({ htxV5: { enabled: true, expectedHtxUid: "456" }, leaseTtlMs: 120_051 });
    const base = htxV5Projection();
    const projection = { ...base, htxUid: null };
    Object.defineProperty(f.reader, "readHtxV5", { configurable: true, value: vi.fn(async () => ({
      binding: { ...f.state.binding }, projection })) });
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
  });

  it.each(["before-read", "before-commit"])("fences cancellation during async currentness %s", async phase => {
    const f = setup(); const stop = new AbortController();
    let finish!: (value: boolean) => void; let reached!: () => void;
    const checking = new Promise<void>(resolve => { reached = resolve; });
    let checks = 0; let disposed = false;
    vi.mocked(f.reader.dispose).mockImplementation(() => { disposed = true; });
    vi.mocked(f.repository.isCurrent).mockImplementation(async () => {
      checks++;
      if (phase === "before-read" ? checks === 2 : disposed) {
        reached(); return new Promise<boolean>(resolve => { finish = resolve; });
      }
      return true;
    });
    const work = f.service.tick(initial, "owner", stop.signal);
    await checking; stop.abort(); finish(true);
    expect(await work).toEqual({ status: "FENCED" });
    if (phase === "before-read") expect(f.reader.readBalances).not.toHaveBeenCalled();
    else expect(f.reader.readTrades).toHaveBeenCalledTimes(2);
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.state.observations).toEqual([]);
    expect(f.reader.dispose).toHaveBeenCalledOnce();
    expect(f.repository.release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps normal cadence for successful but explicitly bounded history coverage", async () => {
    const f = setup(); f.state.failures = 3;
    vi.mocked(f.reader.readTrades).mockResolvedValue({ ...f.envelope<Trade>(), complete: false });
    await f.service.tick(initial, "owner");
    expect(f.state.observations[0]?.status).toBe("PARTIAL");
    expect(f.state.failures).toBe(0); expect(f.state.nextDue).toBe(10100);
  });
  it("preserves an explicitly unknown order update time instead of inventing one", async () => {
    const f = setup();
    vi.mocked(f.reader.readOpenOrders).mockResolvedValue(f.envelope<ObservedOrder>([{
      orderId: "order-1", clientOrderId: "client-1", symbol: "BTCUSDT", side: "buy", type: "limit", status: "open",
      quantity: "1", filledQuantity: "0", price: "100", createdAt: "2026-01-01T00:00:00Z", updatedAt: null,
    }]));
    expect((await f.service.tick(initial, "owner")).status).toBe("COMMITTED");
    expect(f.state.observations[0]?.openOrders).toMatchObject({ status: "COMPLETE", values: [{ updatedAt: null }] });
  });
  it("commits one bounded scope/window with actual empty balances, symbol-bound trades and disposal", async () => {
    const f = setup(); const result = await f.service.tick(initial, "owner-1");
    expect(result.status).toBe("COMMITTED");
    const observation = f.state.observations[0]!;
    expect(observation).toMatchObject({ observationId: "10000000-0000-4000-8000-000000000001", binding: initial,
      status: "COMPLETE", holdings: [], collectionStartedAtMs: 10000, collectionCompletedAtMs: 10000,
      balances: { status: "COMPLETE", values: [], sourceAsOfMs: null } });
    expect(f.reader.readTrades).toHaveBeenNthCalledWith(1, "BTCUSDT", expect.any(AbortSignal));
    expect(f.reader.readTrades).toHaveBeenNthCalledWith(2, "ETHUSDT", expect.any(AbortSignal));
    expect(f.reader.dispose).toHaveBeenCalledOnce();
    expect(f.state.nextDue).toBe(10100);
    expect(Object.isFrozen(observation)).toBe(true);
    expect(observation.schemaVersion).toBe("account-observation/v1");
  });
  it("commits configured derivatives families as v2 with other families explicitly unconfigured", async () => {
    const family: HtxDerivativesAccountFamily = "usdt_isolated_perpetual";
    const f = setup({ htxDerivativesFamilies: [family] });
    expect(await f.service.tick(initial, "owner")).toMatchObject({ status: "COMMITTED" });
    const observation = f.state.observations[0]!;
    expect(observation.schemaVersion).toBe("account-observation/v2");
    if (observation.schemaVersion !== "account-observation/v2") throw new Error("expected v2");
    expect(f.reader.readDerivativesAccount).toHaveBeenCalledOnce();
    expect(f.reader.readDerivativesAccount).toHaveBeenCalledWith(family, expect.any(AbortSignal));
    expect(observation.derivatives!.families.map(item => [item.family, item.status])).toEqual(
      HTX_DERIVATIVES_ACCOUNT_FAMILIES.map(item => [item, item === family ? "COMPLETE" : "NOT_CONFIGURED"]));
    expect(observation.derivatives!.families[0]?.accounts?.[0]?.marginBalance).toBe("1.250000000000000001");
    expect(observation.derivatives!.families[0]?.positions).toMatchObject({ status: "COMPLETE",
      values: [{ contractCode: "BTC-USDT", marginAsset: "USDT", unrealizedPnl: "-0.01" }] });
    expect(observation.status).toBe("COMPLETE");
    expect(f.reader.dispose).toHaveBeenCalledOnce();
  });
  it("keeps a successful account balance visible when the position component is partial", async () => {
    const f = setup({ htxDerivativesFamilies: ["coin_perpetual"] });
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => ({
      binding: { ...initial }, snapshot: f.snapshot(family),
      positions: { ...f.position(family), status: "PARTIAL", values: [{
        ...f.position(family).values[0]!, positionMargin: null,
      }] },
    }));
    expect(await f.service.tick(initial, "owner")).toMatchObject({ status: "COMMITTED" });
    const observation = f.state.observations[0]!;
    expect(observation.status).toBe("PARTIAL");
    expect(observation.derivatives!.families.find(item => item.family === "coin_perpetual"))
      .toMatchObject({ status: "COMPLETE", accounts: [{ marginBalance: "1.250000000000000001" }],
        positions: { status: "PARTIAL", values: [{ positionMargin: null }] } });
  });
  it("uses cross withdrawAvailable as transferable balance without requiring per-contract marginAvailable", async () => {
    const f = setup({ htxDerivativesFamilies: ["usdt_cross_shared"] });
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => ({
      binding: { ...initial },
      positions: f.position(family),
      snapshot: {
        ...f.snapshot(family),
        accounts: [{
          ...f.snapshot(family).accounts[0]!,
          marginAvailable: null,
          withdrawAvailable: "0.75",
        } as unknown as HtxDerivativesAccountSnapshot["accounts"][number]],
      },
    }));

    expect(await f.service.tick(initial, "owner")).toMatchObject({ status: "COMMITTED" });
    const observation = f.state.observations[0]!;
    expect(observation.status).toBe("COMPLETE");
    expect(observation.derivatives!.families.find(item => item.family === "usdt_cross_shared")?.accounts?.[0])
      .toMatchObject({ marginAvailable: null, withdrawAvailable: "0.75" });
    const malformedDerivatives = {
      ...observation.derivatives!,
      families: observation.derivatives!.families.map(item => item.family === "usdt_cross_shared"
        ? { ...item, accounts: item.accounts?.map(account => ({ ...account, withdrawAvailable: null })) }
        : item),
    };
    expect(() => parseAccountObservation({ ...observation, derivatives: malformedDerivatives }))
      .toThrow("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");

    const missingTransferBalance = setup({ htxDerivativesFamilies: ["usdt_cross_shared"] });
    vi.mocked(missingTransferBalance.reader.readDerivativesAccount!).mockImplementation(async family => ({
      binding: { ...initial },
      positions: missingTransferBalance.position(family),
      snapshot: { ...missingTransferBalance.snapshot(family), accounts: [{
        ...missingTransferBalance.snapshot(family).accounts[0]!, withdrawAvailable: null,
      }] },
    }));
    await missingTransferBalance.service.tick(initial, "owner");
    expect(missingTransferBalance.state.observations[0]?.status).toBe("PARTIAL");
    expect(missingTransferBalance.state.observations[0]?.derivatives!.families
      .find(item => item.family === "usdt_cross_shared")?.status).toBe("PARTIAL");
  });

  it.each(["PARTIAL", "ERROR"] as const)(
    "includes configured derivative %s in aggregate status without treating unconfigured families as failures",
    async derivativeStatus => {
      const f = setup({ htxDerivativesFamilies: ["coin_perpetual"] });
      if (derivativeStatus === "PARTIAL") {
        vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => ({
          binding: { ...initial },
          positions: f.position(family),
          snapshot: { ...f.snapshot(family), accounts: [{
            ...f.snapshot(family).accounts[0]!, marginAvailable: null,
          }] },
        }));
      } else {
        vi.mocked(f.reader.readDerivativesAccount!).mockRejectedValue(new Error("synthetic read failure"));
      }

      const result = await f.service.tick(initial, "owner");
      expect(result).toMatchObject({ status: "COMMITTED" });
      const observation = f.state.observations[0]!;
      expect(observation.status).toBe("PARTIAL");
      expect(observation.derivatives!.families.find(item => item.family === "coin_perpetual")?.status)
        .toBe(derivativeStatus);
      expect(() => parseAccountObservation({ ...observation, status: "COMPLETE" }))
        .toThrow("ACCOUNT_OBSERVATION_INVALID_PAYLOAD");
      expect(observation.derivatives!.families.filter(item => item.status === "NOT_CONFIGURED"))
        .toHaveLength(HTX_DERIVATIVES_ACCOUNT_FAMILIES.length - 1);
    },
  );

  it("copies the configured family list and rejects empty, duplicate, or non-family entries", async () => {
    const families: HtxDerivativesAccountFamily[] = ["usdt_cross_shared"];
    const f = setup({ htxDerivativesFamilies: families });
    families.push("coin_perpetual");
    await f.service.tick(initial, "owner");
    const observation = f.state.observations[0]!;
    expect(observation.schemaVersion).toBe("account-observation/v2");
    if (observation.schemaVersion !== "account-observation/v2") throw new Error("expected v2");
    expect(f.reader.readDerivativesAccount).toHaveBeenCalledOnce();
    expect(observation.derivatives!.families.find(item => item.family === "coin_perpetual")?.status)
      .toBe("NOT_CONFIGURED");
    for (const value of [[], ["usdt_cross_shared", "usdt_cross_shared"], ["unknown-family"]]) {
      const f = setup();
      expect(() => createAccountObservationService(f.deps,
        { ...config, htxDerivativesFamilies: value as HtxDerivativesAccountFamily[] }))
        .toThrow("ACCOUNT_OBSERVATION_INVALID_CONFIG");
    }
  });
  it("uses PARTIAL for a valid row with null account metrics, not an error", async () => {
    const f = setup({ htxDerivativesFamilies: ["coin_perpetual"] });
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => ({
      binding: { ...initial },
      positions: f.position(family),
      snapshot: { ...f.snapshot(family), accounts: [{ ...f.snapshot(family).accounts[0]!, marginAvailable: null }] },
    }));
    await f.service.tick(initial, "owner");
    const observation = f.state.observations[0]!;
    expect(observation.schemaVersion).toBe("account-observation/v2");
    if (observation.schemaVersion !== "account-observation/v2") throw new Error("expected v2");
    expect(observation.derivatives!.families.find(item => item.family === "coin_perpetual"))
      .toMatchObject({ status: "PARTIAL", error: null, accounts: [{ marginAvailable: null }] });
  });
  it("preserves a complete balance summary when optional position metrics are unavailable", async () => {
    const f = setup({ htxDerivativesFamilies: ["coin_perpetual"] });
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => ({
      binding: { ...initial }, positions: f.position(family), snapshot: { ...f.snapshot(family), accounts: [{
        ...f.snapshot(family).accounts[0]!, riskRate: null, liquidationPrice: null, leverage: null,
        realizedPnl: null, unrealizedPnl: null, marginPosition: null, marginStatic: null, marginFrozen: null,
      }] },
    }));
    await f.service.tick(initial, "owner");
    expect(f.state.observations[0]!.derivatives!.families.find(item => item.family === "coin_perpetual"))
      .toMatchObject({ status: "COMPLETE", error: null, accounts: [{ marginAvailable: "1", liquidationPrice: null }] });
  });
  it.each(["binding", "family"] as const)("fences a derivatives %s mismatch without publishing", async mismatch => {
    const f = setup({ htxDerivativesFamilies: ["usdt_isolated_perpetual", "coin_perpetual"] });
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => ({
      binding: mismatch === "binding" ? { ...initial, credentialRevision: "2" } : { ...initial },
      positions: f.position(family),
      snapshot: mismatch === "family" ? f.snapshot("usdt_cross_shared") : f.snapshot(family),
    }));
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.reader.readDerivativesAccount).toHaveBeenCalledOnce();
    expect(f.state.observations).toEqual([]);
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.repository.release).toHaveBeenCalledOnce();
  });
  it("rechecks the exact current binding after each family and fences a mid-read rotation", async () => {
    const f = setup({ htxDerivativesFamilies: ["usdt_isolated_perpetual", "usdt_cross_shared"] });
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => {
      const response = { binding: { ...initial }, snapshot: f.snapshot(family), positions: f.position(family) };
      f.state.binding.credentialRevision = "2";
      return response;
    });
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.reader.readDerivativesAccount).toHaveBeenCalledOnce();
    expect(f.state.observations).toEqual([]);
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.repository.release).toHaveBeenCalledOnce();
  });
  it("fails configured families closed when the reader method is absent", async () => {
    const f = setup({ htxDerivativesFamilies: ["usdt_cross_shared"] });
    Object.defineProperty(f.reader, "readDerivativesAccount", { value: undefined });
    await expect(f.service.tick(initial, "owner")).rejects.toMatchObject({
      code: "ACCOUNT_OBSERVATION_DERIVATIVES_READER_UNAVAILABLE",
    });
    expect(f.reader.readBalances).not.toHaveBeenCalled();
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.state.observations).toEqual([]);
  });
  it("stores malformed family projection as safe ERROR and includes it in backoff", async () => {
    const f = setup({ htxDerivativesFamilies: ["usdt_isolated_perpetual"] });
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async family => ({
      binding: { ...initial },
      positions: f.position(family),
      snapshot: { ...f.snapshot(family), accounts: [{ ...f.snapshot(family).accounts[0]!, collateralAsset: "BTC" }] },
    }));
    await f.service.tick(initial, "owner");
    const observation = f.state.observations[0]!;
    expect(observation.schemaVersion).toBe("account-observation/v2");
    if (observation.schemaVersion !== "account-observation/v2") throw new Error("expected v2");
    expect(observation.derivatives!.families[0]).toMatchObject({
      status: "ERROR", accounts: null, error: "INVALID_RESPONSE",
    });
    expect(f.state.failures).toBe(1);
    expect(f.state.nextDue).toBe(10200);
  });
  it("bounds derivative reads, aborts timed-out calls and stores only a safe error", async () => {
    const f = setup({ htxDerivativesFamilies: ["coin_delivery_futures"] });
    let signal!: AbortSignal;
    vi.mocked(f.reader.readDerivativesAccount!).mockImplementation(async (_family, requestSignal) => {
      signal = requestSignal;
      return new Promise(() => {});
    });
    const pending = f.service.tick(initial, "owner");
    await vi.advanceTimersByTimeAsync(11);
    const result = await pending;
    expect(result).toMatchObject({ status: "COMMITTED", observation: { schemaVersion: "account-observation/v2" } });
    expect(signal.aborted).toBe(true);
    const observation = f.state.observations[0]!;
    expect(observation.schemaVersion).toBe("account-observation/v2");
    if (observation.schemaVersion !== "account-observation/v2") throw new Error("expected v2");
    expect(observation.derivatives!.families.find(item => item.family === "coin_delivery_futures"))
      .toMatchObject({ status: "ERROR", accounts: null, error: "TIMEOUT" });
  });
  it.each(["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision"] as const)(
    "refuses caller mismatch in %s before reading", async key => {
      const f = setup(); const result = await f.service.tick({ ...initial, [key]: "other" }, "owner");
      expect(["NOT_CLAIMED", "FENCED"]).toContain(result.status); expect(f.openReader).not.toHaveBeenCalled();
    });
  it.each(["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision"] as const)(
    "refuses returned account identity mismatch in %s without publishing", async key => {
      const f = setup(); vi.mocked(f.reader.readBalances).mockResolvedValue({ ...f.envelope(),
        binding: { ...initial, [key]: "other" } });
      expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
      expect(f.state.observations).toEqual([]); expect(f.reader.readOpenOrders).not.toHaveBeenCalled();
    });
  it("does not open an already-revoked credential", async () => {
    const f = setup(); f.state.active = false;
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "NOT_CLAIMED" });
    expect(f.openReader).not.toHaveBeenCalled();
  });
  it.each(["revoke", "rotate", "configuration"])("fences %s during fetch before any later read/commit", async change => {
    const f = setup(); vi.mocked(f.reader.readBalances).mockImplementation(async () => {
      const result = f.envelope<Balance>();
      if (change === "revoke") f.state.active = false;
      else if (change === "rotate") f.state.binding.credentialRevision = "new";
      else f.state.binding.configurationRevision = "new";
      return result;
    });
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.reader.readOpenOrders).not.toHaveBeenCalled(); expect(f.state.observations).toEqual([]);
  });
  it.each(["revoke", "rotate", "successor"])("atomic port rejects %s between final check and commit", async change => {
    const f = setup(); f.beforeCommit.mockImplementation(() => {
      if (change === "revoke") f.state.active = false;
      else if (change === "rotate") f.state.binding.credentialRevision = "new";
      else f.state.lease = { ...f.state.lease!, token: "successor", expiresAtMs: 50000 };
    });
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.state.observations).toEqual([]);
    if (change === "successor") expect(f.state.lease?.token).toBe("successor");
  });
  it("only one overlapping collector reads the account", async () => {
    const f = setup(); let finish!: (value: ReadEnvelope<Balance>) => void;
    vi.mocked(f.reader.readBalances).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const first = f.service.tick(initial, "owner-1");
    await vi.waitFor(() => expect(f.reader.readBalances).toHaveBeenCalledOnce(), { interval: 1 });
    expect(await f.service.tick(initial, "owner-2")).toEqual({ status: "NOT_CLAIMED" });
    finish(f.envelope()); expect((await first).status).toBe("COMMITTED");
  });
  it("rejects lease expiry before commit", async () => {
    const f = setup(); vi.mocked(f.reader.dispose).mockImplementation(() => vi.setSystemTime(11000));
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.state.observations).toEqual([]);
  });
  it("keeps component failure missing, not zero or stale prior rows; stores safe error only", async () => {
    const f = setup(); vi.mocked(f.reader.readBalances).mockRejectedValue(new Error("synthetic-secret-do-not-publish"));
    const result = await f.service.tick(initial, "owner");
    expect(result).toMatchObject({ status: "COMMITTED", observation: { status: "PARTIAL", holdings: null,
      balances: { status: "ERROR", values: null, error: "READ_FAILED" }, openOrders: { status: "COMPLETE", values: [] } } });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret"); expect(f.state.nextDue).toBe(10200);
  });
  it("bounds timeout, aborts read, and does not publish a late reply", async () => {
    const f = setup(); let signal!: AbortSignal; let finish!: (value: ReadEnvelope<Balance>) => void;
    vi.mocked(f.reader.readBalances).mockImplementation(input => { signal = input;
      return new Promise(resolve => { finish = resolve; }); });
    const pending = f.service.tick(initial, "owner"); await vi.advanceTimersByTimeAsync(11);
    const result = await pending;
    expect(result).toMatchObject({ status: "COMMITTED", observation: { balances: { error: "TIMEOUT", values: null } } });
    expect(signal.aborted).toBe(true); finish(f.envelope([{ asset: "BTC", free: "100", locked: "0", total: "100" }]));
    await Promise.resolve(); expect(f.state.observations[0]!.balances.values).toBeNull();
  });
  it("retains backoff across service restart and caps successive429 failures", async () => {
    const f = setup(); vi.mocked(f.reader.readBalances).mockRejectedValue(new AccountObservationReadFailure("RATE_LIMITED"));
    for (const delay of [200, 400, 800, 800]) {
      const restarted = createAccountObservationService(f.deps, config); const started = Date.now();
      expect((await restarted.tick(initial, "owner")).status).toBe("COMMITTED");
      expect(f.state.nextDue).toBe(started + delay);
      expect((await restarted.tick(initial, "owner")).status).toBe("NOT_CLAIMED");
      vi.setSystemTime(f.state.nextDue);
    }
    vi.mocked(f.reader.readBalances).mockResolvedValue(f.envelope());
    await f.service.tick(initial, "owner"); expect(f.state.failures).toBe(0);
  });
  it("preserves source timestamps and partial coverage without claiming known holdings", async () => {
    const f = setup(); vi.mocked(f.reader.readBalances).mockResolvedValue({ ...f.envelope([{ asset: "BTC",
      free: "0", locked: "0", total: "0" }]), complete: false, sourceAsOfMs: 9000 });
    await f.service.tick(initial, "owner");
    expect(f.state.observations[0]).toMatchObject({ status: "PARTIAL", holdings: null,
      balances: { status: "PARTIAL", sourceAsOfMs: 9000, values: [{ total: "0" }] } });
  });
  it.each([null, {}, [{ asset: "BTC", free: "NaN", locked: "0", total: "0" }]])(
    "malformed balance data is not an observed zero: %j", async values => {
      const f = setup(); vi.mocked(f.reader.readBalances).mockResolvedValue({ ...f.envelope(), values } as ReadEnvelope<Balance>);
      await f.service.tick(initial, "owner"); expect(f.state.observations[0]!.balances).toMatchObject({ values: null, error: "INVALID_RESPONSE" });
    });
  it("does not accept a future source timestamp", async () => {
    const f = setup(); vi.mocked(f.reader.readBalances).mockResolvedValue({ ...f.envelope(), sourceAsOfMs: 20000 });
    await f.service.tick(initial, "owner"); expect(f.state.observations[0]!.balances.error).toBe("INVALID_RESPONSE");
  });
  it("projects allowed balance fields only; never copies raw transport metadata", async () => {
    const f = setup(); vi.mocked(f.reader.readBalances).mockResolvedValue(f.envelope([{ asset: "BTC", free: "0",
      locked: "0", total: "0", rawVenueObservation: { secret: "do-not-copy" } } as Balance]));
    await f.service.tick(initial, "owner"); expect(JSON.stringify(f.state.observations)).not.toContain("do-not-copy");
    expect(f.state.observations[0]!.holdings).toEqual([{ asset: "BTC", free: "0", locked: "0", total: "0" }]);
  });
  it("fences cancellation during disposal and always releases ownership", async () => {
    const f = setup(); const abort = new AbortController(); vi.mocked(f.reader.dispose).mockImplementation(() => abort.abort());
    expect(await f.service.tick(initial, "owner", abort.signal)).toEqual({ status: "FENCED" });
    expect(f.state.observations).toEqual([]); expect(f.state.lease).toBeNull();
  });
  it("disposal failure prevents commit and redacts the underlying exception", async () => {
    const f = setup(); vi.mocked(f.reader.dispose).mockImplementation(() => { throw new Error("synthetic-secret"); });
    await expect(f.service.tick(initial, "owner")).rejects.toThrow("ACCOUNT_OBSERVATION_INTERNAL_FAILURE");
    expect(f.reader.dispose).toHaveBeenCalledOnce(); expect(f.state.lease).toBeNull(); expect(f.state.observations).toEqual([]);
  });
  it("pre-cancelled tick makes no claim or reads", async () => {
    const f = setup(); const abort = new AbortController(); abort.abort();
    expect(await f.service.tick(initial, "owner", abort.signal)).toEqual({ status: "FENCED" });
    expect(f.repository.claimDue).not.toHaveBeenCalled();
  });
  it.each([NaN, Infinity, -1, 0, 1.5])("rejects non-bounded scheduling inputs: %s", value => {
    expect(() => setup({ maxBackoffMs: value })).toThrow("ACCOUNT_OBSERVATION_INVALID_CONFIG");
  });
  it("rejects nonfinite clock without claiming a lease", async () => {
    const f = setup(); const service = createAccountObservationService({ ...f.deps, clock: { ...clock, now: () => Infinity } }, config);
    await expect(service.tick(initial, "owner")).rejects.toThrow("INVALID_RESPONSE");
    expect(f.repository.claimDue).not.toHaveBeenCalled();
  });
  it("times out a never-resolving reader factory and releases its lease", async () => {
    const f = setup(); let signal!: AbortSignal;
    f.openReader.mockImplementation(async (_, input) => { signal = input; return new Promise(() => {}); });
    const pending = f.service.tick(initial, "owner").catch(error => error as AccountObservationFailure);
    await vi.advanceTimersByTimeAsync(11); const failure = await pending;
    expect(failure).toMatchObject({ code: "ACCOUNT_OBSERVATION_OPEN_FAILED", secondary: ["OPEN_TIMEOUT"] });
    expect(signal.aborted).toBe(true); expect(f.state.lease).toBeNull();
    expect(f.reader.readBalances).not.toHaveBeenCalled(); expect(f.state.observations).toEqual([]);
  });
  it("aborts opening promptly and disposes a late reader exactly once", async () => {
    const f = setup(); const abort = new AbortController(); let finish!: (reader: AccountObservationReader) => void;
    f.openReader.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = f.service.tick(initial, "owner", abort.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0); abort.abort();
    expect(await pending).toMatchObject({ code: "ACCOUNT_OBSERVATION_OPEN_FAILED" });
    expect(f.state.lease).toBeNull(); finish(f.reader); await vi.advanceTimersByTimeAsync(0);
    expect(f.reader.dispose).toHaveBeenCalledOnce(); expect(f.reader.readBalances).not.toHaveBeenCalled();
  });
  it("disposes a reader arriving after deadline and preserves classified late disposal failure", async () => {
    const f = setup(); let finish!: (reader: AccountObservationReader) => void;
    f.openReader.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    vi.mocked(f.reader.dispose).mockImplementation(() => { throw new Error("synthetic-secret"); });
    const pending = f.service.tick(initial, "owner").catch(error => error as AccountObservationFailure);
    await vi.advanceTimersByTimeAsync(11); const failure = await pending;
    finish(f.reader); await vi.advanceTimersByTimeAsync(0);
    expect(f.reader.dispose).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({ secondary: ["OPEN_TIMEOUT", "LATE_DISPOSAL_FAILED"] });
    expect(JSON.stringify(failure)).not.toContain("synthetic-secret");
    expect(f.state.observations).toEqual([]);
  });
  it("keeps primary opening failure when lease release also fails", async () => {
    const f = setup(); f.openReader.mockRejectedValue(new Error("private-open-message"));
    vi.mocked(f.repository.release).mockRejectedValue(new Error("private-db-message"));
    const failure = await f.service.tick(initial, "owner").catch(error => error);
    expect(failure).toMatchObject({ code: "ACCOUNT_OBSERVATION_OPEN_FAILED",
      secondary: ["ACCOUNT_OBSERVATION_RELEASE_FAILED"] });
    expect(JSON.stringify(failure)).not.toContain("private");
  });
  it("accepts an HTX trade without a client order ID but refuses another symbol", async () => {
    const f = setup(); const value: Trade = { tradeId: "1", orderId: "2", clientOrderId: "", symbol: "BTCUSDT",
      side: "buy", price: "1", quantity: "2", fee: "0", feeAsset: "USDT", executedAt: new Date(9000).toISOString() };
    vi.mocked(f.reader.readTrades).mockImplementation(async () => f.envelope([value]));
    await f.service.tick(initial, "owner");
    expect(f.state.observations[0]!.trades[0]!.component).toMatchObject({ status: "COMPLETE", values: [value] });
    expect(f.state.observations[0]!.trades[1]!.component).toMatchObject({ status: "ERROR", values: null });
  });
  it("cancellation during a read does not commit partial observations", async () => {
    const f = setup(); const abort = new AbortController();
    vi.mocked(f.reader.readBalances).mockImplementation(() => new Promise(() => {}));
    const pending = f.service.tick(initial, "owner", abort.signal);
    await vi.advanceTimersByTimeAsync(0); abort.abort();
    expect(await pending).toEqual({ status: "FENCED" });
    expect(f.state.observations).toEqual([]); expect(f.reader.dispose).toHaveBeenCalledOnce();
  });
  it("a permission-denied component remains an error, never fabricated empty data", async () => {
    const f = setup(); vi.mocked(f.reader.readOpenOrders).mockRejectedValue(new AccountObservationReadFailure("PERMISSION_DENIED"));
    await f.service.tick(initial, "owner");
    expect(f.state.observations[0]!.openOrders).toMatchObject({ status: "ERROR", values: null, error: "PERMISSION_DENIED" });
  });
  it("does not redirect cleanup to a different organization from a malformed claim response", async () => {
    const f = setup(); vi.mocked(f.repository.claimDue).mockResolvedValue({ binding: { ...initial, organizationId: "other" },
      ownerId: "other-owner", token: "other-token", consecutiveFailures: 0, expiresAtMs: 20000 });
    expect(await f.service.tick(initial, "owner")).toEqual({ status: "FENCED" });
    expect(f.repository.release).toHaveBeenCalledWith(expect.objectContaining({ binding: initial, ownerId: "owner" }));
    expect(f.openReader).not.toHaveBeenCalled();
  });
  it("classifies a claim driver rejection without exposing sensitive connection details", async () => {
    const f = setup(); const sensitive = "postgres://synthetic-user:synthetic-password@private-db/tenant";
    vi.mocked(f.repository.claimDue).mockRejectedValue(new Error(sensitive));
    const failure = await f.service.tick(initial, "owner").catch(error => error);
    expect(failure).toBeInstanceOf(AccountObservationFailure);
    expect(failure).toMatchObject({ code: "ACCOUNT_OBSERVATION_CLAIM_FAILED", secondary: [] });
    expect(String(failure)).not.toContain(sensitive);
    expect(JSON.stringify(failure)).not.toContain(sensitive);
    expect(failure.cause).toBeUndefined();
    expect(f.openReader).not.toHaveBeenCalled(); expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.repository.release).not.toHaveBeenCalled();
  });
  it.each([null, { ...initial, credentialId: "" }])("releases a valid claimed token when returned binding is malformed: %j", async badBinding => {
    const f = setup(); const claim = vi.mocked(f.repository.claimDue).getMockImplementation()!;
    vi.mocked(f.repository.claimDue).mockImplementation(async (...args) => {
      const lease = (await claim(...args))!;
      return { ...lease, binding: badBinding as unknown as ObservationBinding };
    });
    await expect(f.service.tick(initial, "owner")).rejects.toMatchObject({ code: "ACCOUNT_OBSERVATION_INTERNAL_FAILURE" });
    expect(f.repository.release).toHaveBeenCalledOnce();
    expect(f.repository.release).toHaveBeenCalledWith({ binding: initial, ownerId: "owner", token: "lease-1" });
    expect(f.state.lease).toBeNull(); expect(f.openReader).not.toHaveBeenCalled();
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
  });
  it.each(["", 42])("never attempts release with an invalid claimed token: %j", async token => {
    const f = setup(); vi.mocked(f.repository.claimDue).mockResolvedValue({ binding: initial, ownerId: "owner",
      token: token as string, consecutiveFailures: 0, expiresAtMs: 20000 });
    await expect(f.service.tick(initial, "owner")).rejects.toMatchObject({ code: "ACCOUNT_OBSERVATION_INTERNAL_FAILURE" });
    expect(f.repository.release).not.toHaveBeenCalled(); expect(f.openReader).not.toHaveBeenCalled();
    expect(f.repository.commitIfCurrent).not.toHaveBeenCalled();
  });
});
