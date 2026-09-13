// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { createAccountObservationHost, type ObservationHostInput } from "@/lib/trader/account-observation/host";
import { observationPoolLimits, probeObservationPool } from "@/lib/trader/account-observation/host-role-probe";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { accountObservationClock } from "@/lib/trader/account-observation/clock";

const lifecycle = vi.hoisted(() => ({ construct: vi.fn(), run: vi.fn(), dispose: vi.fn() }));
vi.mock("@/lib/trader/account-observation/configured-runtime", () => ({
  createConfiguredHtxObservationRuntime: (input: unknown) => {
    lifecycle.construct(input); return { run: lifecycle.run, dispose: lifecycle.dispose };
  },
}));
const goodRow = (login: string) => ({ login, original_session: true, supported: true, safe_login: true,
  safe_role: true, can_set: true, exclusive_role: true, no_ciphertext: true, no_destructive: true,
  reader_no_writes: true, forced_rls: true });
function pool(login: string) {
  const row = goodRow(login); const statements: string[] = [];
  const tx = vi.fn(async (chunks: TemplateStringsArray) => {
    const statement = chunks.join("?"); statements.push(statement);
    return statement.includes("AS login") ? [row] : [];
  });
  const sql = Object.assign(vi.fn(), { options: { ...observationPoolLimits },
    begin: vi.fn(async (callback: (transaction: unknown) => unknown) => callback(tx)) }) as unknown as Sql;
  return { sql, row, statements, dispose: vi.fn(async () => {}) };
}
function setup() {
  const readerLimits = { pageSize: 10, maxPages: 2, maxRecords: 20, maxResponseBytes: 8192, tradeWindowMs: 60000 };
  const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000, maxBackoffMs: 8000,
    readTimeoutMs: 100, leaseTtlMs: 1000, htxCoverage: { ...readerLimits, host: "api.huobi.pro" } });
  const item = { config, readerLimits, binding: { organizationId: "00000000-0000-4000-8000-000000000001",
    credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "123", credentialRevision: "1",
    configurationRevision: config.revision } };
  const collector = pool("collector_login"); const reader = pool("reader_login");
  const credentials = { service: { getDecryptedCredentials: vi.fn() }, dispose: vi.fn(async () => {}) };
  const input = { configured: [item], host: "api.huobi.pro" as const, ownerId: "host-test", intervalMs: 1000,
    iterationTimeoutMs: 2000, openTimeoutMs: 500, shutdownTimeoutMs: 500,
    openCollector: vi.fn(async () => collector), openReader: vi.fn(async () => reader),
    openCredentialService: vi.fn(async () => credentials), fetchImpl: vi.fn<typeof fetch>(),
    clock: accountObservationClock, report: vi.fn() };
  return { input, collector, reader, credentials, item };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  lifecycle.run.mockImplementation(async (signal: AbortSignal) => {
    if (signal.aborted) return;
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  });
});
afterEach(() => { vi.useRealTimers(); });

describe("explicit observation host lifecycle (synthetic resources, existing composition port)", () => {
  it("validates without opening, then probes separate sessions before service and composes once", async () => {
    const f = setup(); const host = createAccountObservationHost(f.input);
    expect(f.input.openCollector).not.toHaveBeenCalled(); expect(lifecycle.construct).not.toHaveBeenCalled();
    const work = host.run(new AbortController().signal); await vi.advanceTimersByTimeAsync(0);
    expect(f.input.openCollector).toHaveBeenCalledWith(expect.any(AbortSignal), observationPoolLimits);
    expect(lifecycle.construct).toHaveBeenCalledWith(expect.objectContaining({ collectorSql: f.collector.sql,
      readerSql: f.reader.sql, protectedCredentialService: f.credentials.service }));
    expect(f.input.openCredentialService.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(f.reader.sql.begin).mock.invocationCallOrder[0]);
    expect((f.input.openCollector.mock.calls[0] as unknown as [AbortSignal])[0].aborted).toBe(false);
    await expect(host.run(new AbortController().signal)).rejects.toThrow("ACCOUNT_OBSERVATION_HOST_FAILED");
    await host.stop(); await work; await host.stop();
    for (const resource of [f.collector, f.reader, f.credentials]) expect(resource.dispose).toHaveBeenCalledTimes(1);
    expect(lifecycle.dispose).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    expect(f.input.report.mock.calls.flat()).toEqual(["HOST_STARTED", "HOST_STOPPED"]);
  });
  it.each(["duplicate", "digest", "coverage", "timing", "callback", "timeout", "account"])("rejects %s before opening any resources", mode => {
    const f = setup(); const input = f.input as unknown as { -readonly [K in keyof ObservationHostInput]: ObservationHostInput[K] };
    if (mode === "duplicate") input.configured = [f.item, f.item];
    if (mode === "digest") f.item.binding.configurationRevision = "wrong";
    if (mode === "coverage") f.item.readerLimits.pageSize++;
    if (mode === "timing") input.iterationTimeoutMs = 500;
    if (mode === "callback") input.openReader = undefined as unknown as ObservationHostInput["openReader"];
    if (mode === "timeout") input.openTimeoutMs = Infinity;
    if (mode === "account") f.item.binding.exchangeAccountId = "not-account";
    expect(() => createAccountObservationHost(input)).toThrow("ACCOUNT_OBSERVATION_HOST_FAILED");
    expect(f.input.openCollector).not.toHaveBeenCalled(); expect(f.input.openCredentialService).not.toHaveBeenCalled();
  });
  it("snapshots mutable configuration before the first asynchronous boundary", async () => {
    const f = setup(); const host = createAccountObservationHost(f.input);
    f.item.readerLimits.pageSize = 99; f.item.binding.exchangeAccountId = "999";
    const work = host.run(new AbortController().signal); await vi.advanceTimersByTimeAsync(0);
    expect(lifecycle.construct.mock.calls[0][0].configured[0].binding.exchangeAccountId).toBe("123");
    await host.stop(); await work;
  });
  it("never opens after stop or a pre-aborted start", async () => {
    const f = setup(); const host = createAccountObservationHost(f.input); await host.stop();
    await expect(host.run(new AbortController().signal)).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await createAccountObservationHost(f.input).run(controller.signal);
    expect(f.input.openCollector).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["same-object", "same-sql", "same-login", "unsafe-role"])("rejects %s before opening a credential resource", async mode => {
    const f = setup();
    if (mode === "same-object") f.input.openReader.mockResolvedValue(f.collector);
    if (mode === "same-sql") f.reader.sql = f.collector.sql;
    if (mode === "same-login") f.reader.row.login = f.collector.row.login;
    if (mode === "unsafe-role") f.reader.row.safe_role = false;
    await expect(createAccountObservationHost(f.input).run(new AbortController().signal)).rejects.toThrow();
    expect(f.input.openCredentialService).not.toHaveBeenCalled(); expect(f.collector.dispose).toHaveBeenCalledTimes(1);
    expect(lifecycle.construct).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["reader-open", "credential-open", "constructor", "runtime"])("cleans earlier resources and sanitizes %s failure", async mode => {
    const f = setup(); const secret = new Error("https://private:password@host?token=secret");
    if (mode === "reader-open") f.input.openReader.mockRejectedValue(secret);
    if (mode === "credential-open") f.input.openCredentialService.mockRejectedValue(secret);
    if (mode === "constructor") lifecycle.construct.mockImplementation(() => { throw secret; });
    if (mode === "runtime") lifecycle.run.mockRejectedValue(secret);
    await expect(createAccountObservationHost(f.input).run(new AbortController().signal)).rejects.toThrow("ACCOUNT_OBSERVATION_HOST_FAILED");
    expect(f.collector.dispose).toHaveBeenCalledTimes(1);
    if (mode !== "reader-open") expect(f.reader.dispose).toHaveBeenCalledTimes(1);
    if (["constructor", "runtime"].includes(mode)) expect(f.credentials.dispose).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(f.input.report.mock.calls)).not.toMatch(/password|secret|private/);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["cancel", "timeout"])("closes a resource delivered after opening %s without starting runtime", async mode => {
    const f = setup(); let resolve!: (value: typeof f.reader) => void;
    f.input.openReader.mockImplementation(() => new Promise(done => { resolve = done; }));
    const host = createAccountObservationHost(f.input); const controller = new AbortController();
    const result = host.run(controller.signal).then(() => "STOPPED", () => "FAILED");
    await vi.advanceTimersByTimeAsync(0);
    if (mode === "cancel") controller.abort(); else await vi.advanceTimersByTimeAsync(501);
    expect(await result).toBe(mode === "cancel" ? "STOPPED" : "FAILED");
    resolve(f.reader); await vi.advanceTimersByTimeAsync(0);
    expect(f.reader.dispose).toHaveBeenCalledTimes(1); expect(f.collector.dispose).toHaveBeenCalledTimes(1);
    expect(f.input.openCredentialService).not.toHaveBeenCalled(); expect(lifecycle.construct).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("aborts a stalled role probe without opening the protected credential provider", async () => {
    const f = setup(); vi.mocked(f.collector.sql.begin).mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController(); const host = createAccountObservationHost(f.input);
    const work = host.run(controller.signal); await vi.advanceTimersByTimeAsync(0); controller.abort(); await work;
    expect(f.input.openReader).not.toHaveBeenCalled(); expect(f.input.openCredentialService).not.toHaveBeenCalled();
    expect(f.collector.dispose).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("closes a credential resource delivered after cancellation and reports late cleanup failure safely", async () => {
    const f = setup(); let deliver!: (resource: typeof f.credentials) => void;
    f.input.openCredentialService.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
    f.credentials.dispose.mockRejectedValue(new Error("late-secret"));
    const controller = new AbortController(); const host = createAccountObservationHost(f.input);
    const work = host.run(controller.signal); await vi.advanceTimersByTimeAsync(0); controller.abort(); await work;
    deliver(f.credentials); await vi.advanceTimersByTimeAsync(0);
    expect(f.credentials.dispose).toHaveBeenCalledTimes(1); expect(f.input.report).toHaveBeenCalledWith("HOST_CLEANUP_FAILED");
    expect(lifecycle.construct).not.toHaveBeenCalled(); expect(JSON.stringify(f.input.report.mock.calls)).not.toContain("late-secret");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("attempts every cleanup despite throwing diagnostics and a failed disposer", async () => {
    const f = setup(); f.credentials.dispose.mockRejectedValue(new Error("secret"));
    f.input.report.mockImplementation(() => { throw new Error("log-secret"); });
    const host = createAccountObservationHost(f.input); const result = host.run(new AbortController().signal).catch(error => error.message);
    await vi.advanceTimersByTimeAsync(0); await expect(host.stop()).rejects.toThrow("ACCOUNT_OBSERVATION_HOST_FAILED");
    expect(await result).toBe("ACCOUNT_OBSERVATION_HOST_FAILED");
    expect(f.reader.dispose).toHaveBeenCalledTimes(1); expect(f.collector.dispose).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounded shutdown does not report successful closure of an uncooperative resource", async () => {
    const f = setup(); f.reader.dispose.mockImplementation(() => new Promise(() => {}));
    const host = createAccountObservationHost(f.input); const result = host.run(new AbortController().signal).catch(error => error.message);
    await vi.advanceTimersByTimeAsync(0); const stop = host.stop().catch(error => error.message);
    await vi.advanceTimersByTimeAsync(501);
    expect(await result).toBe("ACCOUNT_OBSERVATION_HOST_FAILED"); expect(await stop).toBe("ACCOUNT_OBSERVATION_HOST_FAILED");
    expect(f.collector.dispose).toHaveBeenCalledTimes(1); expect(f.input.report).toHaveBeenCalledWith("HOST_CLEANUP_FAILED");
    expect(f.input.report).not.toHaveBeenCalledWith("HOST_STOPPED"); expect(vi.getTimerCount()).toBe(0);
  });
  it("restart needs a fresh composition and repeats all protected resource checks", async () => {
    const first = setup(); const second = setup();
    for (const f of [first, second]) {
      const host = createAccountObservationHost(f.input); const work = host.run(new AbortController().signal);
      await vi.advanceTimersByTimeAsync(0); await host.stop(); await work;
      expect(f.collector.sql.begin).toHaveBeenCalledTimes(1); expect(f.reader.sql.begin).toHaveBeenCalledTimes(1);
    }
    expect(lifecycle.construct).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});

describe("read-only PostgreSQL role probe contract (synthetic query executor)", () => {
  it.each(Object.keys(goodRow("reader_login")).filter(key => key !== "login"))("rejects false or unknown %s evidence", async key => {
    const f = pool("reader_login"); Object.assign(f.row, { [key]: false });
    await expect(probeObservationPool(f.sql, "reader")).rejects.toThrow("OBSERVATION_HOST_ROLE_REFUSED");
    Object.assign(f.row, { [key]: undefined });
    await expect(probeObservationPool(f.sql, "reader")).rejects.toThrow();
  });
  it("uses bounded readonly metadata without selecting ciphertext or setting a privileged role", async () => {
    const f = pool("reader_login"); expect(await probeObservationPool(f.sql, "reader")).toBe("reader_login");
    expect(f.statements.slice(0, 4)).toEqual(["SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '3000ms'",
      "SET LOCAL lock_timeout = '1000ms'", "SET LOCAL transaction_timeout = '5000ms'"]);
    const query = f.statements[4]; expect(query).toContain("pg_has_role"); expect(query).toContain("has_column_privilege");
    expect(query).not.toMatch(/SELECT\s+(encrypted_payload|wrapped_dek_key)|SET ROLE|service_role|\bBYPASSRLS\b/i);
  });
  it.each(["max", "connect_timeout", "max_lifetime", "prepare"])("rejects unbounded driver %s before query", async option => {
    const f = pool("reader_login"); Object.assign(f.sql.options, { [option]: option === "prepare" ? true : 100000 });
    await expect(probeObservationPool(f.sql, "reader")).rejects.toThrow(); expect(f.sql.begin).not.toHaveBeenCalled();
  });
});
