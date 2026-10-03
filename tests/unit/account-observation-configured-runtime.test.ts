// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import {
  createConfiguredHtxObservationRuntime,
  type ConfiguredHtxObservationAssignment,
} from "@/lib/trader/account-observation/configured-runtime";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import type { ObservationBinding, ObservationLease } from "@/lib/trader/account-observation/types";
import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";
import type { HtxDerivativesAccountFamily } from "@/lib/trader/account-observation/derivatives/types";

const ports = vi.hoisted(() => ({
  createRepository: vi.fn(),
  createReader: vi.fn(),
  isCurrentAssignment: vi.fn(),
  resolveActiveBinding: vi.fn(),
  claimDue: vi.fn(),
  isCurrent: vi.fn(),
  commitIfCurrent: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/trader/account-observation/postgres-repository", () => ({
  createPostgresObservationRepository: (sql: Sql) => {
    ports.createRepository(sql);
    return {
      claimDue: ports.claimDue,
      isCurrent: ports.isCurrent,
      commitIfCurrent: ports.commitIfCurrent,
      release: ports.release,
    };
  },
}));
vi.mock("@/lib/trader/account-observation/postgres-reader", () => ({
  createPostgresObservationReader: (sql: Sql) => {
    ports.createReader(sql);
    return {
      isCurrentAssignment: ports.isCurrentAssignment,
      resolveActiveBinding: ports.resolveActiveBinding,
    };
  },
}));
function assignment(account = "123", credentialSuffix = "2"): ConfiguredHtxObservationAssignment {
  const readerLimits = {
    pageSize: 10,
    maxPages: 2,
    maxRecords: 20,
    maxResponseBytes: 8192,
    tradeWindowMs: 60_000,
  };
  const config = createObservationConfiguration({
    symbols: ["BTCUSDT"],
    pollIntervalMs: 1000,
    maxBackoffMs: 8000,
    readTimeoutMs: 100,
    leaseTtlMs: 1000,
    htxCoverage: { ...readerLimits, host: "api.huobi.pro" },
  });
  return {
    binding: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      credentialId: `00000000-0000-4000-8000-00000000000${credentialSuffix}`,
      exchangeAccountId: account,
      credentialRevision: "1",
      configurationRevision: config.revision,
    },
    config,
    readerLimits,
  };
}
type Input = Parameters<typeof createConfiguredHtxObservationRuntime>[0];
type MutableInput = { -readonly [Key in keyof Input]: Input[Key] };
function withDerivatives(item: ConfiguredHtxObservationAssignment,
  families: readonly HtxDerivativesAccountFamily[] = ["usdt_cross_shared"]): ConfiguredHtxObservationAssignment {
  const { revision: _revision, ...parameters } = item.config;
  const config = createObservationConfiguration({ ...parameters, htxDerivativesFamilies: families });
  return { ...item, config, binding: { ...item.binding, configurationRevision: config.revision } };
}
function withV5(item: ConfiguredHtxObservationAssignment,
  htxV5: Readonly<{ enabled: boolean; fillContracts?: readonly string[]; expectedHtxUid?: string }> = {
    enabled: true, fillContracts: ["BTC-USDT", "ETH-USDT"], expectedHtxUid: "456",
  }) {
  const { revision: _revision, ...parameters } = item.config;
  const config = createObservationConfiguration({ ...parameters, leaseTtlMs: 120_401, htxV5 });
  return { ...item, config, binding: { ...item.binding, configurationRevision: config.revision } };
}
function setup(overrides: Partial<Input> = {}) {
  const item = assignment();
  const collectorSql = { purpose: "collector" } as unknown as Sql;
  const readerSql = { purpose: "reader" } as unknown as Sql;
  const getDecryptedCredentials = vi.fn(
    async (): Promise<ConnectorCredentialInput> => ({
      apiKey: "synthetic-key",
      apiSecret: "synthetic-secret",
    }),
  );
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    const target = new URL(String(url));
    const path = target.pathname;
    if (target.hostname === "api.hbdm.com") {
      if (path === "/v5/account/asset_mode")
        return Response.json({ code: 200, data: { asset_mode: "1" }, ts: Date.now() });
      if (path === "/v5/account/balance")
        return Response.json({ code: 200, data: { state: "normal", equity: "0", initial_margin: "0",
          maintenance_margin: "0", maintenance_margin_rate: "0", profit_unreal: "0",
          available_margin: "0", voucher_value: "0", details: [] }, ts: Date.now() });
      return Response.json({ code: 200, data: [], ts: Date.now() });
    }
    if (path === "/v1/account/accounts")
      return Response.json({ status: "ok", data: [{ id: 123, type: "spot", state: "working" }] });
    if (path === "/v2/user/uid") return Response.json({ code: 200, data: 456 });
    if (path === "/v2/user/api-key")
      return Response.json({
        code: 200,
        data: [{ accessKey: "synthetic-key", status: "normal", permission: "readOnly" }],
      });
    return Response.json({
      status: "ok",
      data: path.endsWith("/balance")
        ? {
            id: 123,
            type: "spot",
            state: "working",
            list: [{ currency: "usdt", type: "trade", balance: "2" }],
          }
        : [],
    });
  });
  const verifyReadAdmission = vi.fn(async () => true);
  const report = vi.fn();
  const input: MutableInput = {
    collectorSql,
    readerSql,
    protectedCredentialService: { getDecryptedCredentials },
    configured: [item],
    host: "api.huobi.pro",
    fetchImpl,
    verifyReadAdmission,
    report,
    clock: accountObservationClock,
    ownerId: "local-composition",
    intervalMs: 1000,
    iterationTimeoutMs: 2000,
    ...overrides,
  };
  return {
    input,
    item,
    collectorSql,
    readerSql,
    getDecryptedCredentials,
    fetchImpl,
    verifyReadAdmission,
    report,
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
  vi.resetAllMocks();
  ports.isCurrentAssignment.mockResolvedValue(true);
  ports.resolveActiveBinding.mockImplementation(async (scope: Partial<ObservationBinding>) => ({
    ...assignment().binding,
    ...scope,
  }));
  ports.claimDue.mockImplementation(
    async (
      binding: ObservationBinding,
      ownerId: string,
      now: number,
      ttl: number,
    ): Promise<ObservationLease> => ({
      binding,
      ownerId,
      token: "local-lease",
      expiresAtMs: now + ttl,
      consecutiveFailures: 0,
    }),
  );
  ports.isCurrent.mockResolvedValue(true);
  ports.commitIfCurrent.mockResolvedValue(true);
  ports.release.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("configured observation runtime, real local composition with mock persistence/network", () => {
  const derivativesResponse = () => Response.json({ status: "ok", ts: Date.now(), data: [{
    margin_account: "USDT", margin_balance: "200.50", withdraw_available: "190.25",
  }] });
  const derivativesPositionResponse = () => Response.json({ status: "ok", ts: Date.now(), data: [{
    symbol: "BTC", contract_code: "BTC-USDT", direction: "buy", margin_account: "USDT",
    margin_mode: "cross", margin_asset: "USDT", volume: "2", available: "1", frozen: "1",
    cost_open: "100", cost_hold: "99", profit_unreal: "1.25", profit_rate: "0.02",
    position_margin: "20", lever_rate: "5",
  }] });
  const derivativesCalls = (f: ReturnType<typeof setup>) => f.fetchImpl.mock.calls.filter(
    ([url]) => new URL(String(url)).hostname === "api.hbdm.com");
  function bindConfiguredRows(f: ReturnType<typeof setup>) {
    ports.resolveActiveBinding.mockImplementation(async (scope: Partial<ObservationBinding>) =>
      f.input.configured.find(item => item.binding.organizationId === scope.organizationId &&
        item.binding.exchangeAccountId === scope.exchangeAccountId)?.binding ?? null);
  }
  async function stopAfterTick(f: ReturnType<typeof setup>) {
    bindConfiguredRows(f);
    const stop = new AbortController();
    const work = createConfiguredHtxObservationRuntime(f.input).run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    await work;
    return work;
  }
  it("collects only the exact configured derivatives family through real admission, parser and service", async () => {
    const f = setup();
    const item = withDerivatives(f.item);
    f.input.configured = [item];
    const spot = f.fetchImpl.getMockImplementation()!;
    f.fetchImpl.mockImplementation((url, options) => {
      const target = new URL(String(url));
      if (target.hostname !== "api.hbdm.com") return spot(url, options);
      return Promise.resolve(target.pathname.endsWith("/swap_cross_position_info")
        ? derivativesPositionResponse() : derivativesResponse());
    });
    await stopAfterTick(f);
    expect(derivativesCalls(f)).toHaveLength(2);
    const [accountCall, positionsCall] = derivativesCalls(f);
    expect(new URL(String(accountCall[0])).pathname).toBe("/linear-swap-api/v1/swap_cross_account_info");
    expect(accountCall[1]).toMatchObject({ method: "POST", body: '{"margin_account":"USDT"}' });
    expect(new URL(String(positionsCall[0])).pathname).toBe("/linear-swap-api/v1/swap_cross_position_info");
    expect(positionsCall[1]).toMatchObject({ method: "POST", body: "{}" });
    expect(ports.commitIfCurrent).toHaveBeenCalledTimes(1);
    const observation = ports.commitIfCurrent.mock.calls[0][0].observation;
    expect(observation).toMatchObject({ schemaVersion: "account-observation/v2", binding: item.binding,
      derivatives: { families: expect.arrayContaining([expect.objectContaining({ family: "usdt_cross_shared", status: "COMPLETE",
        accounts: expect.arrayContaining([expect.objectContaining({ marginBalance: "200.50", collateralAsset: "USDT" })]),
        positions: expect.objectContaining({ status: "COMPLETE", values: [expect.objectContaining({
          symbol: "BTC", contractCode: "BTC-USDT", direction: "buy", unrealizedPnl: "1.25" })] }),
        readStartedAtMs: expect.any(Number), readCompletedAtMs: expect.any(Number), error: null })]) } });
    expect(observation.derivatives.families.filter((family: { status: string }) => family.status === "NOT_CONFIGURED")).toHaveLength(3);
    expect(JSON.stringify(ports.commitIfCurrent.mock.calls)).not.toMatch(/synthetic|Signature|AccessKey/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("commits the configured V5 projection through the existing repository with identity-bound GET reads", async () => {
    const f = setup();
    const item = withV5(f.item);
    f.input.configured = [item];
    f.input.iterationTimeoutMs = 200_000;
    await stopAfterTick(f);
    expect(ports.commitIfCurrent).toHaveBeenCalledTimes(1);
    const observation = ports.commitIfCurrent.mock.calls[0][0].observation;
    expect(observation).toMatchObject({ schemaVersion: "account-observation/v3", binding: item.binding,
      htxV5: { schemaVersion: "htx-v5-observation/v1", htxUid: "456",
        assetMode: { status: "COMPLETE", value: "1" },
        balance: { status: "COMPLETE", value: { account: { equityUsd: "0" }, details: [] } },
        positions: { status: "COMPLETE", values: [] }, openOrders: { status: "PARTIAL", values: [] },
        algoOrders: { status: "PARTIAL", values: [] },
        fills: { status: "PARTIAL", values: [], contracts: ["BTC-USDT", "ETH-USDT"] } } });
    expect(derivativesCalls(f).filter(([url]) => new URL(String(url)).pathname.startsWith("/v5/"))).toHaveLength(11);
    for (const [url, options] of derivativesCalls(f).filter(([url]) => new URL(String(url)).pathname.startsWith("/v5/"))) {
      expect(new URL(String(url)).hostname).toBe("api.hbdm.com");
      expect(options).toMatchObject({ method: "GET", redirect: "error" });
    }
    expect(JSON.stringify(ports.commitIfCurrent.mock.calls)).not.toMatch(/synthetic|Signature|AccessKey|apiSecret/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a real configured V5 read on shutdown and settles its late body before releasing ownership", async () => {
    const f = setup();
    f.input.configured = [withV5(f.item)];
    f.input.iterationTimeoutMs = 200_000;
    const ordinaryFetch = f.fetchImpl.getMockImplementation()!;
    let finish!: (response: Response) => void;
    let started!: () => void;
    const v5Started = new Promise<void>(resolve => { started = resolve; });
    f.fetchImpl.mockImplementation((url, options) => {
      const target = new URL(String(url));
      if (target.hostname === "api.hbdm.com" && target.pathname === "/v5/account/asset_mode") {
        started();
        return new Promise(resolve => { finish = resolve; });
      }
      return ordinaryFetch(url, options);
    });
    bindConfiguredRows(f);
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const work = runtime.run(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    await v5Started;
    const request = f.fetchImpl.mock.calls.find(([url]) => new URL(String(url)).pathname === "/v5/account/asset_mode");
    expect(request?.[1]?.signal?.aborted).toBe(false);
    runtime.dispose();
    let stopped = false;
    void work.then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(ports.release).not.toHaveBeenCalled();
    expect(request?.[1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await work;
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses the second explicit account's own family configuration instead of the first template", async () => {
    const f = setup();
    const second = withDerivatives(assignment("124", "3"));
    f.input.configured = [f.item, second];
    f.input.protectedCredentialService = { async getDecryptedCredentials(_scope, credentialId) {
      return { apiKey: `synthetic-key-${credentialId === second.binding.credentialId ? "124" : "123"}`, apiSecret: "synthetic-secret" };
    } };
    f.fetchImpl.mockImplementation(async (url) => {
      const target = new URL(String(url));
      const accessKey = target.searchParams.get("AccessKeyId")!;
      const account = accessKey.endsWith("124") ? 124 : 123;
      if (target.hostname === "api.hbdm.com") {
        expect(account).toBe(124);
        return target.pathname.endsWith("/swap_cross_position_info")
          ? derivativesPositionResponse() : derivativesResponse();
      }
      if (target.pathname === "/v1/account/accounts") return Response.json({ status: "ok",
        data: [{ id: account, type: "spot", state: "working" }] });
      if (target.pathname === "/v2/user/uid") return Response.json({ code: 200, data: account + 1000 });
      if (target.pathname === "/v2/user/api-key") return Response.json({ code: 200,
        data: [{ accessKey, status: "normal", permission: "readOnly" }] });
      return Response.json({ status: "ok", data: target.pathname.endsWith("/balance")
        ? { id: account, type: "spot", state: "working", list: [] } : [] });
    });
    await stopAfterTick(f);
    expect(ports.commitIfCurrent).toHaveBeenCalledTimes(2);
    const observations = ports.commitIfCurrent.mock.calls.map(([value]) => value.observation);
    expect(observations.find(value => value.binding.exchangeAccountId === "123")).toMatchObject({ schemaVersion: "account-observation/v1" });
    const secondObservation = observations.find(value => value.binding.exchangeAccountId === "124");
    expect(secondObservation).toMatchObject({ schemaVersion: "account-observation/v2" });
    expect(secondObservation.derivatives.families.find((family: { family: string }) => family.family === "usdt_cross_shared"))
      .toMatchObject({ positions: { status: "COMPLETE", values: [expect.objectContaining({
        symbol: "BTC", contractCode: "BTC-USDT", direction: "buy", unrealizedPnl: "1.25" })] } });
    expect(derivativesCalls(f)).toHaveLength(2);
    expect(derivativesCalls(f).map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/linear-swap-api/v1/swap_cross_account_info", "/linear-swap-api/v1/swap_cross_position_info",
    ]);
  });
  it("does not let an extra verifier grant a derivatives read for a trading key", async () => {
    const f = setup();
    f.input.configured = [withDerivatives(f.item)];
    const spot = f.fetchImpl.getMockImplementation()!;
    f.fetchImpl.mockImplementation((url, options) => new URL(String(url)).pathname === "/v2/user/api-key"
      ? Promise.resolve(Response.json({ code: 200, data: [{ accessKey: "synthetic-key", status: "normal", permission: "readOnly,trade" }] }))
      : spot(url, options));
    await stopAfterTick(f);
    expect(f.verifyReadAdmission).toHaveBeenCalled();
    expect(derivativesCalls(f)).toHaveLength(0);
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
  });
  it("fences the tick if fresh venue permission changes during the balance read", async () => {
    const f = setup();
    f.input.configured = [withDerivatives(f.item)];
    const spot = f.fetchImpl.getMockImplementation()!;
    let changed = false;
    f.fetchImpl.mockImplementation((url, options) => {
      const target = new URL(String(url));
      if (target.hostname === "api.hbdm.com") { changed = true; return Promise.resolve(derivativesResponse()); }
      if (changed && target.pathname === "/v2/user/api-key") return Promise.resolve(Response.json({ code: 200,
        data: [{ accessKey: "synthetic-key", status: "normal", permission: "readOnly,trade" }] }));
      return spot(url, options);
    });
    await stopAfterTick(f);
    expect(derivativesCalls(f)).toHaveLength(1);
    expect(new URL(String(derivativesCalls(f)[0][0])).pathname).toBe("/linear-swap-api/v1/swap_cross_account_info");
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(ports.release).toHaveBeenCalledTimes(1);
    expect(f.report).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(derivativesCalls(f).some(([url]) => new URL(String(url)).pathname.endsWith("/swap_cross_position_info"))).toBe(false);
  });
  it("fences the whole commit when the persisted assignment is revoked during a futures read", async () => {
    const f = setup();
    f.input.configured = [withDerivatives(f.item)];
    const spot = f.fetchImpl.getMockImplementation()!;
    f.fetchImpl.mockImplementation((url, options) => {
      if (new URL(String(url)).hostname === "api.hbdm.com") {
        ports.isCurrentAssignment.mockResolvedValue(false);
        ports.isCurrent.mockResolvedValue(false);
        return Promise.resolve(derivativesResponse());
      }
      return spot(url, options);
    });
    await stopAfterTick(f);
    expect(derivativesCalls(f)).toHaveLength(1);
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
  });
  it("aborts an active derivatives request on shutdown and cancels a late response body", async () => {
    const f = setup();
    f.input.configured = [withDerivatives(f.item)];
    const spot = f.fetchImpl.getMockImplementation()!;
    let finish!: (response: Response) => void;
    f.fetchImpl.mockImplementation((url, options) => new URL(String(url)).hostname === "api.hbdm.com"
      ? new Promise(resolve => { finish = resolve; }) : spot(url, options));
    bindConfiguredRows(f);
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const work = runtime.run(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(derivativesCalls(f)).toHaveLength(1);
    runtime.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.release).not.toHaveBeenCalled();
    expect(derivativesCalls(f)[0][1]?.signal?.aborted).toBe(true);
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await work;
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fail-stops opening while cancelled metadata remains unresolved without releasing its lease", async () => {
    const f = setup();
    f.input.configured = [withDerivatives(f.item)];
    bindConfiguredRows(f);
    const finish: Array<(response: Response) => void> = [];
    f.fetchImpl.mockImplementation(() => new Promise(resolve => { finish.push(resolve); }));
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const work = runtime.run(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(25000);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(ports.release).not.toHaveBeenCalled();
    runtime.dispose();
    const cancel = vi.fn();
    for (const resolve of finish) resolve(new Response(new ReadableStream({ cancel })));
    await work;
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ports.release).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does no I/O before run, keeps pool roles separate, and commits through all local adapters", async () => {
    const f = setup();
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    expect(ports.createRepository).toHaveBeenCalledWith(f.collectorSql);
    expect(ports.createReader.mock.calls.every(([sql]) => sql === f.readerSql)).toBe(true);
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
    expect(ports.claimDue).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    const stop = new AbortController();
    const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.commitIfCurrent).toHaveBeenCalledTimes(1);
    expect(ports.commitIfCurrent.mock.calls[0][0].observation).toMatchObject({
      binding: f.item.binding,
      status: "PARTIAL",
      balances: { status: "COMPLETE", values: [{ asset: "USDT", total: "2" }] },
      openOrders: { status: "PARTIAL" },
      trades: [{ component: { status: "PARTIAL" } }],
    });
    expect(f.getDecryptedCredentials).toHaveBeenCalledWith(
      {
        organizationId: f.item.binding.organizationId,
        exchangeAccountId: f.item.binding.exchangeAccountId,
      },
      f.item.binding.credentialId,
    );
    expect(f.fetchImpl).toHaveBeenCalledTimes(24);
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(ports.commitIfCurrent.mock.calls)).not.toMatch(/synthetic|Signature/);
    stop.abort();
    await work;
    expect(vi.getTimerCount()).toBe(0);
    await expect(runtime.run(new AbortController().signal)).rejects.toThrow();
    runtime.dispose();
  });
  it("does not open inactive or revoked assignments", async () => {
    ports.isCurrentAssignment.mockResolvedValue(false);
    const f = setup();
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const stop = new AbortController();
    const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    await work;
    expect(ports.claimDue).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("cannot substitute database currentness for exchange admission", async () => {
    const f = setup();
    f.verifyReadAdmission.mockResolvedValue(false);
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const stop = new AbortController();
    const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    await work;
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(ports.release).toHaveBeenCalledTimes(1);
    expect(f.report).toHaveBeenCalledWith("COLLECTION_FAILED");
  });
  it("rejects a legacy timing-only configuration even when its digest is internally consistent", () => {
    const f = setup();
    const { symbols, pollIntervalMs, maxBackoffMs, readTimeoutMs, leaseTtlMs } = f.item.config;
    const config = createObservationConfiguration({
      symbols,
      pollIntervalMs,
      maxBackoffMs,
      readTimeoutMs,
      leaseTtlMs,
    });
    f.input.configured = [
      { ...f.item, config, binding: { ...f.item.binding, configurationRevision: config.revision } },
    ];
    expect(() => createConfiguredHtxObservationRuntime(f.input)).toThrow();
    expect(ports.createRepository).not.toHaveBeenCalled();
    expect(ports.createReader).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("cannot bypass actual venue admission with an always-true extra verifier", async () => {
    const f = setup();
    f.fetchImpl.mockResolvedValue(
      Response.json({ status: "ok", data: [{ id: 999, type: "spot", state: "working" }] }),
    );
    const stop = new AbortController();
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    await work;
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledWith("COLLECTION_FAILED");
  });
  it("uses concrete venue admission even without an extra caller verifier", async () => {
    const f = setup({ verifyReadAdmission: undefined });
    const stop = new AbortController();
    const work = createConfiguredHtxObservationRuntime(f.input).run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    await work;
    expect(f.verifyReadAdmission).not.toHaveBeenCalled();
    expect(f.fetchImpl).toHaveBeenCalledTimes(24);
    expect(ports.commitIfCurrent).toHaveBeenCalledTimes(1);
  });
  it.each([
    "same-pool",
    "invalid-admission",
    "missing-fetch",
    "duplicate",
    "revision",
    "account",
    "reader-page",
    "coverage-page",
    "coverage-pages",
    "coverage-records",
    "coverage-bytes",
    "coverage-window",
    "coverage-host",
    "reader-window",
    "reader-extra",
    "lease-timeout",
    "scheduler-interval",
    "missing-owner",
  ])("rejects unsafe %s configuration before I/O", (mode) => {
    const f = setup();
    const item = f.item;
    if (mode === "same-pool") f.input.readerSql = f.collectorSql;
    if (mode === "invalid-admission")
      f.input.verifyReadAdmission = true as unknown as Input["verifyReadAdmission"];
    if (mode === "missing-fetch") f.input.fetchImpl = undefined as unknown as typeof fetch;
    if (mode === "duplicate")
      f.input.configured = [
        item,
        {
          ...item,
          binding: { ...item.binding, credentialId: "00000000-0000-4000-8000-000000000003" },
        },
      ];
    if (mode === "revision")
      f.input.configured = [{ ...item, config: { ...item.config, pollIntervalMs: 2000 } }];
    if (mode === "account")
      f.input.configured = [
        { ...item, binding: { ...item.binding, exchangeAccountId: "../other" } },
      ];
    if (mode === "reader-page")
      f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, maxPages: 999 } }];
    if (mode === "coverage-page")
      f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, pageSize: 11 } }];
    if (mode === "coverage-pages")
      f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, maxPages: 3 } }];
    if (mode === "coverage-records")
      f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, maxRecords: 21 } }];
    if (mode === "coverage-bytes")
      f.input.configured = [
        { ...item, readerLimits: { ...item.readerLimits, maxResponseBytes: 8193 } },
      ];
    if (mode === "coverage-window")
      f.input.configured = [
        { ...item, readerLimits: { ...item.readerLimits, tradeWindowMs: 61_000 } },
      ];
    if (mode === "coverage-host") f.input.host = "api-aws.huobi.pro";
    if (mode === "reader-window")
      f.input.configured = [
        { ...item, readerLimits: { ...item.readerLimits, tradeWindowMs: 172_800_001 } },
      ];
    if (mode === "reader-extra")
      f.input.configured = [
        {
          ...item,
          readerLimits: { ...item.readerLimits, invented: true },
        } as ConfiguredHtxObservationAssignment,
      ];
    if (mode === "lease-timeout") f.input.iterationTimeoutMs = 500;
    if (mode === "scheduler-interval") f.input.intervalMs = 100;
    if (mode === "missing-owner") f.input.ownerId = undefined as unknown as string;
    expect(() => createConfiguredHtxObservationRuntime(f.input)).toThrow();
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
    expect(ports.claimDue).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("captures account options immutably before the first read", async () => {
    const f = setup();
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    (f.item.readerLimits as { pageSize: number }).pageSize = 500;
    (f.item.binding as { exchangeAccountId: string }).exchangeAccountId = "999";
    const stop = new AbortController();
    const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    stop.abort();
    await work;
    expect(
      f.fetchImpl.mock.calls.some(
        ([url]) => new URL(String(url)).pathname === "/v1/account/accounts/123/balance",
      ),
    ).toBe(true);
    expect(
      f.fetchImpl.mock.calls.some(
        ([url]) => new URL(String(url)).searchParams.get("size") === "10",
      ),
    ).toBe(true);
    expect(
      f.fetchImpl.mock.calls.some(
        ([url]) => new URL(String(url)).searchParams.get("size") === "500",
      ),
    ).toBe(false);
  });
  it("shutdown cancels opening and late secrets cannot reach fetch or a commit", async () => {
    const f = setup();
    let finish!: (value: ConnectorCredentialInput) => void;
    f.getDecryptedCredentials.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const work = runtime.run(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
    runtime.dispose();
    let stopped = false;
    void work.then(() => { stopped = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(ports.release).not.toHaveBeenCalled();
    finish({ apiKey: "late-synthetic", apiSecret: "late-secret" });
    await work;
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(ports.release).toHaveBeenCalledOnce();
    await expect(runtime.run(new AbortController().signal)).rejects.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shutdown aborts an active GET, rejects overlap/restart, and cancels its late body", async () => {
    const f = setup();
    let finish!: (value: Response) => void;
    f.fetchImpl.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const work = runtime.run(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    await expect(runtime.run(new AbortController().signal)).rejects.toThrow();
    runtime.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.release).not.toHaveBeenCalled();
    const cancel = vi.fn();
    finish(new Response(new ReadableStream({ cancel })));
    await work;
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("already cancelled run or disposal before run never touches dependency I/O", async () => {
    const f = setup();
    const runtime = createConfiguredHtxObservationRuntime(f.input);
    const stop = new AbortController();
    stop.abort();
    await runtime.run(stop.signal);
    expect(ports.claimDue).not.toHaveBeenCalled();
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
    const fresh = createConfiguredHtxObservationRuntime(f.input);
    fresh.dispose();
    await expect(fresh.run(new AbortController().signal)).rejects.toThrow();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
  });
});
