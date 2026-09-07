import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountObservationFailure, AccountObservationReadFailure, createAccountObservationService } from
  "@/lib/trader/account-observation/service";
import type { AccountObservation, AccountObservationReader, ObservationBinding, ObservationClock,
  ObservationConfig, ObservationLease, ObservationRepository, ObservedOrder, ReadEnvelope } from
  "@/lib/trader/account-observation/types";
import type { Balance, Trade } from "@/lib/trader/connectors/types";

const initial: ObservationBinding = { organizationId: "org-1", credentialId: "credential-1",
  exchangeAccountId: "account-1", credentialRevision: "revision-1", configurationRevision: "config-1" };
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
  const reader: AccountObservationReader = { readBalances: vi.fn(async () => envelope<Balance>()),
    readOpenOrders: vi.fn(async () => envelope<ObservedOrder>()), readTrades: vi.fn(async () => envelope<Trade>()), dispose: vi.fn() };
  const openReader = vi.fn(async (_binding: ObservationBinding, _signal: AbortSignal) => {
    void _binding; void _signal; return reader;
  });
  const deps = { repository, clock, openReader, newObservationId: () => `observation-${state.counter}` };
  const service = createAccountObservationService(deps, { ...config, ...overrides });
  return { state, repository, reader, openReader, service, envelope, beforeCommit, deps };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000); });
afterEach(() => { vi.useRealTimers(); });

describe("DEE-960 injected account observation — no production adapter or real venue", () => {
  it("commits one bounded scope/window with actual empty balances, symbol-bound trades and disposal", async () => {
    const f = setup(); const result = await f.service.tick(initial, "owner-1");
    expect(result.status).toBe("COMMITTED");
    const observation = f.state.observations[0]!;
    expect(observation).toMatchObject({ observationId: "observation-1", binding: initial,
      status: "COMPLETE", holdings: [], collectionStartedAtMs: 10000, collectionCompletedAtMs: 10000,
      balances: { status: "COMPLETE", values: [], sourceAsOfMs: null } });
    expect(f.reader.readTrades).toHaveBeenNthCalledWith(1, "BTCUSDT", expect.any(AbortSignal));
    expect(f.reader.readTrades).toHaveBeenNthCalledWith(2, "ETHUSDT", expect.any(AbortSignal));
    expect(f.reader.dispose).toHaveBeenCalledOnce();
    expect(f.state.nextDue).toBe(10100);
    expect(Object.isFrozen(observation)).toBe(true);
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
});
