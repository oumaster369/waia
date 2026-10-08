import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
const ports = vi.hoisted(() => ({ isCurrentAssignment: vi.fn(async () => true) }));
vi.mock("@/lib/trader/account-observation/postgres-reader", () => ({
  createPostgresObservationReader: () => ports,
}));
function assignment() {
  const config = createObservationConfiguration({
    symbols: ["BTCUSDT"],
    pollIntervalMs: 1000,
    maxBackoffMs: 8000,
    readTimeoutMs: 100,
    leaseTtlMs: 1000,
  });
  return {
    config,
    binding: {
      organizationId: "00000000-0000-4000-8000-000000000001",
      credentialId: "00000000-0000-4000-8000-000000000002",
      exchangeAccountId: "123",
      credentialRevision: "1",
      configurationRevision: config.revision,
    },
  };
}
const signal = () => new AbortController().signal;
const sql = {} as Sql;
describe("explicit assignments filtered by current read-only DB state", () => {
  beforeEach(() => {
    ports.isCurrentAssignment.mockReset().mockResolvedValue(true);
  });
  it("does no work on construction, copies inputs and checks DB again before opening", async () => {
    const a = assignment();
    const expected = structuredClone(a);
    const source = createPostgresObservationAssignmentSource(sql, [a]);
    a.binding.credentialRevision = "2";
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
    const list = await source.loadAssignments(signal());
    expect(list).toEqual([expected]);
    expect(Object.isFrozen(list)).toBe(true);
    expect(Object.isFrozen(list[0].binding)).toBe(true);
    expect(await source.authorizeOpen(expected.binding, signal())).toBe(true);
    ports.isCurrentAssignment.mockResolvedValue(false);
    expect(await source.authorizeOpen(expected.binding, signal())).toBe(false);
    expect(await source.loadAssignments(signal())).toEqual([]);
  });
  it.each([
    "organizationId",
    "credentialId",
    "exchangeAccountId",
    "credentialRevision",
    "configurationRevision",
  ] as const)("does not grant an unconfigured %s or auto-adopt a new revision", async (field) => {
    const a = assignment();
    const source = createPostgresObservationAssignmentSource(sql, [a]);
    const value = ["organizationId", "credentialId"].includes(field)
      ? "00000000-0000-4000-8000-000000000009"
      : "999";
    expect(await source.authorizeOpen({ ...a.binding, [field]: value }, signal())).toBe(false);
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
  });
  it("rejects duplicate accounts and unsigned configuration changes before querying", () => {
    const a = assignment();
    expect(() => createPostgresObservationAssignmentSource(sql, [a, a])).toThrow();
    expect(() =>
      createPostgresObservationAssignmentSource(sql, [
        { ...a, config: { ...a.config, maxBackoffMs: 9000 } },
      ]),
    ).toThrow();
    expect(() => createPostgresObservationAssignmentSource(sql, Array(21).fill(a))).toThrow();
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
  });
  it("does not reuse cached assignments after a database failure", async () => {
    const source = createPostgresObservationAssignmentSource(sql, [assignment()]);
    expect(await source.loadAssignments(signal())).toHaveLength(1);
    ports.isCurrentAssignment.mockRejectedValue(new Error("ACCOUNT_OBSERVATION_READ_FAILED"));
    await expect(source.loadAssignments(signal())).rejects.toThrow(
      "ACCOUNT_OBSERVATION_READ_FAILED",
    );
  });
  it("ignores a broken collector inventory and keeps manifest assignments", async () => {
    const collectorSql = {
      begin: async () => {
        throw new Error("synthetic-inventory");
      },
    } as never;
    const a = assignment();
    const source = createPostgresObservationAssignmentSource(sql, [a], collectorSql);
    const list = await source.loadAssignments(signal());
    expect(list).toHaveLength(1);
    expect(list[0]?.binding).toEqual(a.binding);
    expect(ports.isCurrentAssignment).toHaveBeenCalledTimes(1);
  });
  it("never inventories or grants dynamic accounts for a derivatives envelope at the 20-row boundary", async () => {
    const a = assignment();
    const { revision: _revision, ...parameters } = a.config;
    const config = createObservationConfiguration({ ...parameters, htxDerivativesFamilies: ["usdt_cross_shared"] });
    const configured = { binding: { ...a.binding, configurationRevision: config.revision }, config };
    const rows = Array.from({ length: 20 }, (_, index) => ({
      organization_id: a.binding.organizationId, credential_id: a.binding.credentialId,
      exchange_account_id: String(1000 + index), credential_revision: "1",
      configuration_revision: config.revision, symbols: ["BTCUSDT"],
    }));
    const begin = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(
      Object.assign(async () => rows, { unsafe: async () => undefined })));
    const source = createPostgresObservationAssignmentSource(sql, [configured], { begin } as unknown as Sql);
    expect(await source.loadAssignments(signal())).toEqual([configured]);
    expect(begin).not.toHaveBeenCalled();
    expect(await source.authorizeOpen({ ...configured.binding, exchangeAccountId: "1000" }, signal())).toBe(false);
  });
  it("collects enrolled inventory extras after reserving explicit assignments", async () => {
    const a = assignment();
    const extraOrg = "00000000-0000-4000-8000-000000000003";
    const extraCredential = "00000000-0000-4000-8000-000000000004";
    const collectorSql = {
      begin: async (
        run: (
          tx: ((strings: TemplateStringsArray) => Promise<unknown>) & {
            unsafe: () => Promise<void>;
          },
        ) => Promise<unknown>,
      ) => {
        const tx = Object.assign(
          async () => [
            {
              organization_id: extraOrg,
              credential_id: extraCredential,
              exchange_account_id: "456",
              credential_revision: "1",
              configuration_revision: a.config.revision,
              symbols: ["BTCUSDT"],
            },
          ],
          { unsafe: async () => undefined },
        );
        return run(tx);
      },
    } as never;
    const source = createPostgresObservationAssignmentSource(sql, [a], collectorSql);
    const list = await source.loadAssignments(signal());
    expect(list.map((item) => item.binding.exchangeAccountId)).toEqual(["123", "456"]);
    expect(list[1]?.binding.organizationId).toBe(extraOrg);
    expect(list[1]?.config.revision).toBe(a.config.revision);
  });
  it("retains an exact consented assignment but excludes its revision from inventory", async () => {
    const base = assignment();
    const { revision: _revision, ...parameters } = base.config;
    const consentId = "55555555-5555-4555-8555-555555555555";
    const consentConfig = createObservationConfiguration({ ...parameters, existingKeyReadConsentId: consentId });
    const consented = { ...base, config: consentConfig,
      binding: { ...base.binding, configurationRevision: consentConfig.revision } };
    const template = { ...base, binding: { ...base.binding,
      credentialId: "00000000-0000-4000-8000-000000000005", exchangeAccountId: "124" } };
    const rows = [
      { organization_id: base.binding.organizationId, credential_id: "00000000-0000-4000-8000-000000000006",
        exchange_account_id: "456", credential_revision: "1",
        configuration_revision: consentConfig.revision, symbols: ["BTCUSDT"] },
      { organization_id: base.binding.organizationId, credential_id: "00000000-0000-4000-8000-000000000007",
        exchange_account_id: "789", credential_revision: "1",
        configuration_revision: template.config.revision, symbols: ["BTCUSDT"] },
    ];
    const collectorSql = { begin: async (run: (tx: unknown) => Promise<unknown>) => run(
      Object.assign(async () => rows, { unsafe: async () => undefined })) } as never;
    const source = createPostgresObservationAssignmentSource(sql, [consented, template], collectorSql);

    const list = await source.loadAssignments(signal());
    expect(list.map(item => item.binding.exchangeAccountId)).toEqual(["123", "124", "789"]);
    expect(list[0]).toEqual(consented);
    expect(list[2]?.config).not.toHaveProperty("existingKeyReadConsentId");
    expect(list.some(item => item.binding.exchangeAccountId === "456")).toBe(false);
  });
  it("does not auto-apply a fixed external HTX UID to inventory accounts", async () => {
    const a = assignment();
    const { revision: _revision, ...parameters } = a.config;
    const config = createObservationConfiguration({ ...parameters, leaseTtlMs: 120_401,
      htxV5: { enabled: true, expectedHtxUid: "594179655" } });
    const configured = { ...a, config, binding: { ...a.binding, configurationRevision: config.revision } };
    const begin = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(
      Object.assign(async () => [{ organization_id: a.binding.organizationId,
        credential_id: "00000000-0000-4000-8000-000000000009", exchange_account_id: "456",
        credential_revision: "1", configuration_revision: config.revision, symbols: ["BTCUSDT"] }],
      { unsafe: async () => undefined })));
    const source = createPostgresObservationAssignmentSource(sql, [configured], { begin } as unknown as Sql);
    expect(await source.loadAssignments(signal())).toEqual([configured]);
    expect(begin).not.toHaveBeenCalled();
  });
  it.each([false, true])("reserves explicit accounts with a full spot inventory (futures first: %s)", async (futuresFirst) => {
    const spot = assignment();
    const { revision: _revision, ...parameters } = spot.config;
    const config = createObservationConfiguration({ ...parameters, htxDerivativesFamilies: ["usdt_cross_shared"] });
    const futures = { binding: { ...spot.binding, exchangeAccountId: "456", configurationRevision: config.revision }, config };
    const rows = Array.from({ length: 20 }, (_, index) => ({
      organization_id: spot.binding.organizationId, credential_id: spot.binding.credentialId,
      exchange_account_id: String(1000 + index), credential_revision: "1",
      configuration_revision: spot.config.revision, symbols: ["BTCUSDT"],
    }));
    const begin = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(
      Object.assign(async () => rows, { unsafe: async () => undefined })));
    const manifest = futuresFirst ? [futures, spot] : [spot, futures];
    const source = createPostgresObservationAssignmentSource(sql, manifest, { begin } as unknown as Sql);
    const result = await source.loadAssignments(signal());
    expect(result).toHaveLength(20);
    expect(result.slice(0, 2)).toEqual(manifest);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(result.slice(2).every(item => !item.config.htxDerivativesFamilies)).toBe(true);
    expect(await source.authorizeOpen(futures.binding, signal())).toBe(true);
    expect(await source.authorizeOpen({ ...spot.binding, exchangeAccountId: "1019" }, signal())).toBe(false);
  });
  it("discards cancelled late results and refuses overlapping loads", async () => {
    let finish!: (value: boolean) => void;
    ports.isCurrentAssignment.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const source = createPostgresObservationAssignmentSource(sql, [assignment()]);
    const stop = new AbortController();
    const loading = source.loadAssignments(stop.signal);
    await expect(source.loadAssignments(signal())).rejects.toThrow(
      "ACCOUNT_OBSERVATION_ASSIGNMENTS_BUSY",
    );
    stop.abort();
    const rejection = expect(loading).rejects.toThrow("ACCOUNT_OBSERVATION_ASSIGNMENTS_CANCELLED");
    finish(true);
    await rejection;
    ports.isCurrentAssignment.mockResolvedValue(true);
    expect(await source.loadAssignments(signal())).toHaveLength(1);
  });
  it("allows an empty list without discovering accounts and does no query after cancellation", async () => {
    const source = createPostgresObservationAssignmentSource(sql, []);
    expect(await source.loadAssignments(signal())).toEqual([]);
    const stop = new AbortController();
    stop.abort();
    await expect(source.loadAssignments(stop.signal)).rejects.toThrow();
    expect(ports.isCurrentAssignment).not.toHaveBeenCalled();
  });
});

// A finite optional capability never becomes a temporal gate on base observations.
it("retains an expired financial fixed assignment without inheriting its scope into inventory", async () => {
  const a = assignment(); const { revision: _revision, ...parameters } = a.config; void _revision;
  const config = createObservationConfiguration({ ...parameters, leaseTtlMs: 300000,
    htxV5: { enabled: true, expectedHtxUid: "456", financialHistory: { enabled: true,
      scopeId: "00000000-0000-4000-8000-000000000008", windowStartMs: 1, windowEndMs: 2,
      validFromMs: 2, validUntilMs: 3 } } });
  const current = { binding: { ...a.binding, configurationRevision: config.revision }, config };
  const begin = vi.fn(); ports.isCurrentAssignment.mockResolvedValue(true);
  const source = createPostgresObservationAssignmentSource(sql, [current], { begin } as never);
  expect(await source.loadAssignments(signal())).toEqual([current]);
  expect(await source.authorizeOpen(current.binding, signal())).toBe(true);
  expect(begin).not.toHaveBeenCalled();
  expect(await source.authorizeOpen({ ...current.binding, exchangeAccountId: "999" }, signal())).toBe(false);
});
