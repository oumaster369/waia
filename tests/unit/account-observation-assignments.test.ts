import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
const ports = vi.hoisted(() => ({ isCurrentAssignment: vi.fn(async () => true) }));
vi.mock("@/lib/trader/account-observation/postgres-reader", () => ({ createPostgresObservationReader: () => ports }));
function assignment() {
  const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 1000,
    maxBackoffMs: 8000, readTimeoutMs: 100, leaseTtlMs: 1000 });
  return { config, binding: { organizationId: "00000000-0000-4000-8000-000000000001",
    credentialId: "00000000-0000-4000-8000-000000000002", exchangeAccountId: "123",
    credentialRevision: "1", configurationRevision: config.revision } };
}
const signal = () => new AbortController().signal;
const sql = {} as Sql;
describe("explicit assignments filtered by current read-only DB state", () => {
  beforeEach(() => { ports.isCurrentAssignment.mockReset().mockResolvedValue(true); });
  it("does no work on construction, copies inputs and checks DB again before opening", async () => {
    const a = assignment(); const expected = structuredClone(a);
    const source = createPostgresObservationAssignmentSource(sql, [a]);
    a.binding.credentialRevision = "2";
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
    const list = await source.loadAssignments(signal()); expect(list).toEqual([expected]);
    expect(Object.isFrozen(list)).toBe(true); expect(Object.isFrozen(list[0].binding)).toBe(true);
    expect(await source.authorizeOpen(expected.binding, signal())).toBe(true);
    ports.isCurrentAssignment.mockResolvedValue(false);
    expect(await source.authorizeOpen(expected.binding, signal())).toBe(false);
    expect(await source.loadAssignments(signal())).toEqual([]);
  });
  it.each(["organizationId", "credentialId", "exchangeAccountId", "credentialRevision", "configurationRevision"] as const)(
    "does not grant an unconfigured %s or auto-adopt a new revision", async field => {
      const a = assignment(); const source = createPostgresObservationAssignmentSource(sql, [a]);
      const value = ["organizationId", "credentialId"].includes(field)
        ? "00000000-0000-4000-8000-000000000009" : "999";
      expect(await source.authorizeOpen({ ...a.binding, [field]: value }, signal())).toBe(false);
      expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
    });
  it("rejects duplicate accounts and unsigned configuration changes before querying", () => {
    const a = assignment();
    expect(() => createPostgresObservationAssignmentSource(sql, [a, a])).toThrow();
    expect(() => createPostgresObservationAssignmentSource(sql, [{ ...a, config: { ...a.config, maxBackoffMs: 9000 } }])).toThrow();
    expect(() => createPostgresObservationAssignmentSource(sql, Array(21).fill(a))).toThrow();
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
  });
  it("does not reuse cached assignments after a database failure", async () => {
    const source = createPostgresObservationAssignmentSource(sql, [assignment()]);
    expect(await source.loadAssignments(signal())).toHaveLength(1);
    ports.isCurrentAssignment.mockRejectedValue(new Error("ACCOUNT_OBSERVATION_READ_FAILED"));
    await expect(source.loadAssignments(signal())).rejects.toThrow("ACCOUNT_OBSERVATION_READ_FAILED");
  });
  it("discards cancelled late results and refuses overlapping loads", async () => {
    let finish!: (value: boolean) => void;
    ports.isCurrentAssignment.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const source = createPostgresObservationAssignmentSource(sql, [assignment()]); const stop = new AbortController();
    const loading = source.loadAssignments(stop.signal);
    await expect(source.loadAssignments(signal())).rejects.toThrow("ACCOUNT_OBSERVATION_ASSIGNMENTS_BUSY");
    stop.abort(); const rejection = expect(loading).rejects.toThrow("ACCOUNT_OBSERVATION_ASSIGNMENTS_CANCELLED");
    finish(true); await rejection;
    ports.isCurrentAssignment.mockResolvedValue(true);
    expect(await source.loadAssignments(signal())).toHaveLength(1);
  });
  it("allows an empty list without discovering accounts and does no query after cancellation", async () => {
    const source = createPostgresObservationAssignmentSource(sql, []);
    expect(await source.loadAssignments(signal())).toEqual([]);
    const stop = new AbortController(); stop.abort();
    await expect(source.loadAssignments(stop.signal)).rejects.toThrow();
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
  });
});
