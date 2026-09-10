import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { createObservationConfiguration, createPostgresAccountObservationRuntime } from "@/lib/trader/account-observation/runtime";
import type { ObservationAssignment } from "@/lib/trader/account-observation/runtime";
import { createHash } from "node:crypto";

const ports = vi.hoisted(() => ({ claimDue: vi.fn(async () => null) }));
vi.mock("@/lib/trader/account-observation/postgres-repository", () => ({
  createPostgresObservationRepository: () => ports,
}));
const parameters = { symbols: ["BTCUSDT"], pollIntervalMs: 1000, maxBackoffMs: 8000,
  readTimeoutMs: 100, leaseTtlMs: 1000 };
const assignment = (): ObservationAssignment => {
  const config = createObservationConfiguration(parameters);
  return { config, binding: { organizationId: "00000000-0000-4000-8000-000000000001",
    credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "account",
    credentialRevision: "1", configurationRevision: config.revision } };
};
describe("explicit recurring PostgreSQL observation composition", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
  afterEach(() => vi.useRealTimers());
  it("binds every configuration parameter and rejects unsafe timing/symbols", () => {
    const c = createObservationConfiguration(parameters);
    expect(createObservationConfiguration({ ...parameters })).toEqual(c);
    expect(createObservationConfiguration({ ...parameters, maxBackoffMs: 9000 }).revision).not.toBe(c.revision);
    expect(Object.isFrozen(c.symbols)).toBe(true);
    expect(() => createObservationConfiguration({ ...parameters, symbols: ["BTCUSDT", "BTCUSDT"] })).toThrow();
    expect(() => createObservationConfiguration({ ...parameters, readTimeoutMs: 1000 })).toThrow();
  });
  it("retains legacy digest bytes for the generic reader, and canonically seals all HTX coverage", () => {
    expect(createObservationConfiguration(parameters).revision).toBe("sha256:" +
      createHash("sha256").update(JSON.stringify(parameters)).digest("hex"));
    const htxCoverage = { host: "api.huobi.pro" as const, pageSize: 10, maxPages: 2,
      maxRecords: 20, maxResponseBytes: 8192, tradeWindowMs: 60_000 };
    const config = createObservationConfiguration({ ...parameters, htxCoverage });
    expect(config.revision).not.toBe(createObservationConfiguration(parameters).revision);
    expect(createObservationConfiguration({ ...parameters, htxCoverage: { tradeWindowMs: 60_000,
      maxResponseBytes: 8192, maxRecords: 20, maxPages: 2, pageSize: 10, host: "api.huobi.pro" } })).toEqual(config);
    for (const mutation of [{ pageSize: 11 }, { maxPages: 3 }, { maxRecords: 21 },
      { maxResponseBytes: 8193 }, { tradeWindowMs: 61_000 }, { host: "api-aws.huobi.pro" as const }]) {
      expect(createObservationConfiguration({ ...parameters, htxCoverage: { ...htxCoverage, ...mutation } }).revision)
        .not.toBe(config.revision);
    }
    htxCoverage.pageSize = 500;
    expect(config.htxCoverage?.pageSize).toBe(10); expect(Object.isFrozen(config.htxCoverage)).toBe(true);
    expect(() => createObservationConfiguration({ ...parameters,
      htxCoverage: { ...htxCoverage, maxResponseBytes: 1048577 } })).toThrow();
  });
  it("starts only when awaited, recurs without a browser, and stops cleanly", async () => {
    const stop = new AbortController(); const openReader = vi.fn(); const loadAssignments = vi.fn(async () => [assignment()]);
    const runtime = createPostgresAccountObservationRuntime({ sql: {} as Sql, loadAssignments, openReader,
      report: vi.fn(), ownerId: "local-proof" });
    expect(loadAssignments).not.toHaveBeenCalled();
    const work = runtime.run(stop.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.claimDue).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ports.claimDue).toHaveBeenCalledTimes(2);
    expect(openReader).not.toHaveBeenCalled();
    stop.abort(); await work; expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["configuration", "duplicate-account", "invalid-binding"])("rejects %s before any lease or credential open", async mode => {
    const a = assignment(); let list = [a];
    if (mode === "configuration") list = [{ ...a, config: { ...a.config, maxBackoffMs: 9000 } }];
    if (mode === "duplicate-account") list = [a, { ...a, binding: { ...a.binding,
      credentialId: "00000000-0000-4000-8000-000000000003" } }];
    if (mode === "invalid-binding") list = [{ ...a, binding: { ...a.binding, credentialRevision: "invalid" } }];
    const stop = new AbortController(); const report = vi.fn(); const openReader = vi.fn();
    const runtime = createPostgresAccountObservationRuntime({ sql: {} as Sql,
      loadAssignments: async () => list, openReader, report });
    const work = runtime.run(stop.signal); await vi.advanceTimersByTimeAsync(0);
    expect(report).toHaveBeenCalledWith("ASSIGNMENTS_FAILED");
    expect(ports.claimDue).not.toHaveBeenCalled(); expect(openReader).not.toHaveBeenCalled();
    stop.abort(); await work;
  });
});
