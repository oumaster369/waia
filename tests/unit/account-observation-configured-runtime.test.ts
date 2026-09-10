// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { createConfiguredHtxObservationRuntime, type ConfiguredHtxObservationAssignment } from "@/lib/trader/account-observation/configured-runtime";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";
import type { ObservationBinding, ObservationLease } from "@/lib/trader/account-observation/types";
import type { ConnectorCredentialInput } from "@/lib/trader/connectors/types";

const ports = vi.hoisted(() => ({
  createRepository: vi.fn(), createReader: vi.fn(), isCurrentAssignment: vi.fn(), resolveActiveBinding: vi.fn(),
  claimDue: vi.fn(), isCurrent: vi.fn(), commitIfCurrent: vi.fn(), release: vi.fn(),
}));
vi.mock("@/lib/trader/account-observation/postgres-repository", () => ({
  createPostgresObservationRepository: (sql: Sql) => {
    ports.createRepository(sql); return { claimDue: ports.claimDue, isCurrent: ports.isCurrent,
      commitIfCurrent: ports.commitIfCurrent, release: ports.release };
  },
}));
vi.mock("@/lib/trader/account-observation/postgres-reader", () => ({
  createPostgresObservationReader: (sql: Sql) => {
    ports.createReader(sql); return { isCurrentAssignment: ports.isCurrentAssignment, resolveActiveBinding: ports.resolveActiveBinding };
  },
}));
function assignment(account = "123", credentialSuffix = "2"): ConfiguredHtxObservationAssignment {
  const readerLimits = { pageSize: 10, maxPages: 2, maxRecords: 20, maxResponseBytes: 8192, tradeWindowMs: 60_000 };
  const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
    maxBackoffMs: 8000, readTimeoutMs: 100, leaseTtlMs: 1000,
    htxCoverage: { ...readerLimits, host: "api.huobi.pro" } });
  return { binding: { organizationId: "00000000-0000-4000-8000-000000000001",
    credentialId: `00000000-0000-4000-8000-00000000000${credentialSuffix}`, exchangeAccountId: account,
    credentialRevision: "1", configurationRevision: config.revision }, config,
  readerLimits };
}
type Input = Parameters<typeof createConfiguredHtxObservationRuntime>[0];
type MutableInput = { -readonly [Key in keyof Input]: Input[Key] };
function setup(overrides: Partial<Input> = {}) {
  const item = assignment(); const collectorSql = { purpose: "collector" } as unknown as Sql;
  const readerSql = { purpose: "reader" } as unknown as Sql;
  const getDecryptedCredentials = vi.fn(async (): Promise<ConnectorCredentialInput> => ({ apiKey: "synthetic-key", apiSecret: "synthetic-secret" }));
  const fetchImpl = vi.fn<typeof fetch>(async url => {
    const path = new URL(String(url)).pathname;
    if (path === "/v1/account/accounts") return Response.json({ status: "ok", data: [{ id: 123, type: "spot", state: "working" }] });
    if (path === "/v2/user/uid") return Response.json({ code: 200, data: 456 });
    if (path === "/v2/user/api-key") return Response.json({ code: 200,
      data: [{ accessKey: "synthetic-key", status: "normal", permission: "readOnly" }] });
    return Response.json({ status: "ok", data: path.endsWith("/balance") ? { id: 123, type: "spot", state: "working", list: [
      { currency: "usdt", type: "trade", balance: "2" }] } : [] });
  });
  const verifyReadAdmission = vi.fn(async () => true); const report = vi.fn();
  const input: MutableInput = { collectorSql, readerSql, protectedCredentialService: { getDecryptedCredentials },
    configured: [item], host: "api.huobi.pro", fetchImpl, verifyReadAdmission, report,
    clock: accountObservationClock, ownerId: "local-composition", intervalMs: 1000,
    iterationTimeoutMs: 2000, ...overrides };
  return { input, item, collectorSql, readerSql, getDecryptedCredentials, fetchImpl, verifyReadAdmission, report };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-09T12:00:00Z")); vi.resetAllMocks();
  ports.isCurrentAssignment.mockResolvedValue(true);
  ports.resolveActiveBinding.mockImplementation(async (scope: Partial<ObservationBinding>) => ({ ...assignment().binding, ...scope }));
  ports.claimDue.mockImplementation(async (binding: ObservationBinding, ownerId: string, now: number, ttl: number): Promise<ObservationLease> =>
    ({ binding, ownerId, token: "local-lease", expiresAtMs: now + ttl, consecutiveFailures: 0 }));
  ports.isCurrent.mockResolvedValue(true); ports.commitIfCurrent.mockResolvedValue(true); ports.release.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("configured observation runtime, real local composition with mock persistence/network", () => {
  it("does no I/O before run, keeps pool roles separate, and commits through all local adapters", async () => {
    const f = setup(); const runtime = createConfiguredHtxObservationRuntime(f.input);
    expect(ports.createRepository).toHaveBeenCalledWith(f.collectorSql);
    expect(ports.createReader.mock.calls.every(([sql]) => sql === f.readerSql)).toBe(true);
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled(); expect(ports.claimDue).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
    const stop = new AbortController(); const work = runtime.run(stop.signal); await vi.advanceTimersByTimeAsync(0);
    expect(ports.commitIfCurrent).toHaveBeenCalledTimes(1);
    expect(ports.commitIfCurrent.mock.calls[0][0].observation).toMatchObject({ binding: f.item.binding,
      status: "PARTIAL", balances: { status: "COMPLETE", values: [{ asset: "USDT", total: "2" }] },
      openOrders: { status: "PARTIAL" }, trades: [{ component: { status: "PARTIAL" } }] });
    expect(f.getDecryptedCredentials).toHaveBeenCalledWith({ organizationId: f.item.binding.organizationId }, f.item.binding.credentialId);
    expect(f.fetchImpl).toHaveBeenCalledTimes(24); expect(f.verifyReadAdmission).toHaveBeenCalledTimes(7);
    expect(JSON.stringify(ports.commitIfCurrent.mock.calls)).not.toMatch(/synthetic|Signature/);
    stop.abort(); await work; expect(vi.getTimerCount()).toBe(0);
    await expect(runtime.run(new AbortController().signal)).rejects.toThrow(); runtime.dispose();
  });
  it("does not open inactive or revoked assignments", async () => {
    ports.isCurrentAssignment.mockResolvedValue(false);
    const f = setup(); const runtime = createConfiguredHtxObservationRuntime(f.input); const stop = new AbortController();
    const work = runtime.run(stop.signal); await vi.advanceTimersByTimeAsync(0); stop.abort(); await work;
    expect(ports.claimDue).not.toHaveBeenCalled(); expect(f.getDecryptedCredentials).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("cannot substitute database currentness for exchange admission", async () => {
    const f = setup(); f.verifyReadAdmission.mockResolvedValue(false);
    const runtime = createConfiguredHtxObservationRuntime(f.input); const stop = new AbortController(); const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0); stop.abort(); await work;
    expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1); expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(ports.commitIfCurrent).not.toHaveBeenCalled(); expect(ports.release).toHaveBeenCalledTimes(1);
    expect(f.report).toHaveBeenCalledWith("COLLECTION_FAILED");
  });
  it("rejects a legacy timing-only configuration even when its digest is internally consistent", () => {
    const f = setup();
    const { symbols, pollIntervalMs, maxBackoffMs, readTimeoutMs, leaseTtlMs } = f.item.config;
    const config = createObservationConfiguration({ symbols, pollIntervalMs, maxBackoffMs, readTimeoutMs, leaseTtlMs });
    f.input.configured = [{ ...f.item, config, binding: { ...f.item.binding, configurationRevision: config.revision } }];
    expect(() => createConfiguredHtxObservationRuntime(f.input)).toThrow();
    expect(ports.createRepository).not.toHaveBeenCalled(); expect(ports.createReader).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("cannot bypass actual venue admission with an always-true extra verifier", async () => {
    const f = setup(); f.fetchImpl.mockResolvedValue(Response.json({ status: "ok", data: [{ id: 999, type: "spot", state: "working" }] }));
    const stop = new AbortController(); const runtime = createConfiguredHtxObservationRuntime(f.input);
    const work = runtime.run(stop.signal); await vi.advanceTimersByTimeAsync(0); stop.abort(); await work;
    expect(f.verifyReadAdmission).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).toHaveBeenCalledTimes(1); expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    expect(f.report).toHaveBeenCalledWith("COLLECTION_FAILED");
  });
  it("uses concrete venue admission even without an extra caller verifier", async () => {
    const f = setup({ verifyReadAdmission: undefined }); const stop = new AbortController();
    const work = createConfiguredHtxObservationRuntime(f.input).run(stop.signal);
    await vi.advanceTimersByTimeAsync(0); stop.abort(); await work;
    expect(f.verifyReadAdmission).not.toHaveBeenCalled(); expect(f.fetchImpl).toHaveBeenCalledTimes(24);
    expect(ports.commitIfCurrent).toHaveBeenCalledTimes(1);
  });
  it.each(["same-pool", "invalid-admission", "missing-fetch", "duplicate", "revision", "account", "reader-page",
    "coverage-page", "coverage-pages", "coverage-records", "coverage-bytes", "coverage-window", "coverage-host",
    "reader-window", "reader-extra", "lease-timeout", "scheduler-interval", "missing-owner"])("rejects unsafe %s configuration before I/O", mode => {
    const f = setup(); const item = f.item;
    if (mode === "same-pool") f.input.readerSql = f.collectorSql;
    if (mode === "invalid-admission") f.input.verifyReadAdmission = true as unknown as Input["verifyReadAdmission"];
    if (mode === "missing-fetch") f.input.fetchImpl = undefined as unknown as typeof fetch;
    if (mode === "duplicate") f.input.configured = [item, { ...item, binding: { ...item.binding,
      credentialId: "00000000-0000-4000-8000-000000000003" } }];
    if (mode === "revision") f.input.configured = [{ ...item, config: { ...item.config, pollIntervalMs: 2000 } }];
    if (mode === "account") f.input.configured = [{ ...item, binding: { ...item.binding, exchangeAccountId: "../other" } }];
    if (mode === "reader-page") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, maxPages: 999 } }];
    if (mode === "coverage-page") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, pageSize: 11 } }];
    if (mode === "coverage-pages") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, maxPages: 3 } }];
    if (mode === "coverage-records") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, maxRecords: 21 } }];
    if (mode === "coverage-bytes") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, maxResponseBytes: 8193 } }];
    if (mode === "coverage-window") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, tradeWindowMs: 61_000 } }];
    if (mode === "coverage-host") f.input.host = "api-aws.huobi.pro";
    if (mode === "reader-window") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, tradeWindowMs: 172_800_001 } }];
    if (mode === "reader-extra") f.input.configured = [{ ...item, readerLimits: { ...item.readerLimits, invented: true } } as ConfiguredHtxObservationAssignment];
    if (mode === "lease-timeout") f.input.iterationTimeoutMs = 500;
    if (mode === "scheduler-interval") f.input.intervalMs = 100;
    if (mode === "missing-owner") f.input.ownerId = undefined as unknown as string;
    expect(() => createConfiguredHtxObservationRuntime(f.input)).toThrow();
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled(); expect(ports.claimDue).not.toHaveBeenCalled();
    expect(f.getDecryptedCredentials).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it("captures account options immutably before the first read", async () => {
    const f = setup(); const runtime = createConfiguredHtxObservationRuntime(f.input);
    (f.item.readerLimits as { pageSize: number }).pageSize = 500;
    (f.item.binding as { exchangeAccountId: string }).exchangeAccountId = "999";
    const stop = new AbortController(); const work = runtime.run(stop.signal); await vi.advanceTimersByTimeAsync(0); stop.abort(); await work;
    expect(f.fetchImpl.mock.calls.some(([url]) => new URL(String(url)).pathname === "/v1/account/accounts/123/balance")).toBe(true);
    expect(f.fetchImpl.mock.calls.some(([url]) => new URL(String(url)).searchParams.get("size") === "10")).toBe(true);
    expect(f.fetchImpl.mock.calls.some(([url]) => new URL(String(url)).searchParams.get("size") === "500")).toBe(false);
  });
  it("shutdown cancels opening and late secrets cannot reach fetch or a commit", async () => {
    const f = setup(); let finish!: (value: ConnectorCredentialInput) => void;
    f.getDecryptedCredentials.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const runtime = createConfiguredHtxObservationRuntime(f.input); const work = runtime.run(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0); expect(f.getDecryptedCredentials).toHaveBeenCalledTimes(1);
    runtime.dispose(); await work; finish({ apiKey: "late-synthetic", apiSecret: "late-secret" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(ports.commitIfCurrent).not.toHaveBeenCalled();
    await expect(runtime.run(new AbortController().signal)).rejects.toThrow(); expect(vi.getTimerCount()).toBe(0);
  });
  it("shutdown aborts an active GET, rejects overlap/restart, and cancels its late body", async () => {
    const f = setup(); let finish!: (value: Response) => void;
    f.fetchImpl.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const runtime = createConfiguredHtxObservationRuntime(f.input); const work = runtime.run(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0); expect(f.fetchImpl).toHaveBeenCalledTimes(1);
    await expect(runtime.run(new AbortController().signal)).rejects.toThrow(); runtime.dispose(); await work;
    const cancel = vi.fn(); finish(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0); expect(cancel).toHaveBeenCalledTimes(1);
    expect(ports.commitIfCurrent).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("already cancelled run or disposal before run never touches dependency I/O", async () => {
    const f = setup(); const runtime = createConfiguredHtxObservationRuntime(f.input); const stop = new AbortController(); stop.abort();
    await runtime.run(stop.signal); expect(ports.claimDue).not.toHaveBeenCalled(); expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
    const fresh = createConfiguredHtxObservationRuntime(f.input); fresh.dispose();
    await expect(fresh.run(new AbortController().signal)).rejects.toThrow(); expect(f.getDecryptedCredentials).not.toHaveBeenCalled();
  });
});
