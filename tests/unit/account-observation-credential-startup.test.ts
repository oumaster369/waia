// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql } from "postgres";
import { observationPoolLimits, probeObservationCredentialPool } from "@/lib/trader/account-observation/host-role-probe";
import { runAccountObservationCollector } from "@/scripts/trader/account-observation-collector-host";
import { MANIFEST_RELEASE_SHA, sealManifest } from "./account-observation-manifest-fixtures";

const ports = vi.hoisted(() => ({ open: vi.fn(), provider: vi.fn(), reader: vi.fn(), runtime: vi.fn() }));
vi.mock("postgres", () => ({ default: (...args: unknown[]) => ports.open(...args) }));
vi.mock("@/lib/trader/security/secrets-store-master-key-provider", () => ({
  SecretsStoreMasterKeyProvider: { create: (...args: unknown[]) => ports.provider(...args) },
}));
vi.mock("@/lib/trader/account-observation/credential-read-boundary", () => ({
  createObservationCredentialReader: (...args: unknown[]) => ports.reader(...args),
}));
vi.mock("@/lib/trader/account-observation/configured-runtime", () => ({
  createConfiguredHtxObservationRuntime: (...args: unknown[]) => ports.runtime(...args),
}));
const LOGIN = "waia_account_observation_credential_login";
const required = ["original_session", "supported", "safe_login", "safe_role", "membership",
  "exclusive_role", "no_direct_acl", "no_ownership", "no_create", "exact_projection", "rls"];
function pool(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = { login: LOGIN, ...Object.fromEntries(required.map(key => [key, true])),
    can_set: true, no_ciphertext: true, no_destructive: true, reader_no_writes: true, forced_rls: true,
    inventory_execute_only: true,
    ...overrides };
  const statements: string[] = [];
  const tx = vi.fn(async (chunks: TemplateStringsArray) => {
    statements.push(chunks.join("?"));
    return chunks.join("?").includes("AS login") ? [row] : [];
  });
  const end = vi.fn(async () => {});
  const begin = vi.fn(async (callback: (sql: unknown) => unknown) => callback(tx));
  const sql = Object.assign(vi.fn(), { options: { ...observationPoolLimits }, begin, end }) as unknown as Sql;
  return { sql, begin, end, row, statements };
}
function entry() {
  const manifest = sealManifest();
  const collector = pool({ login: "waia_account_observer_login" });
  const reader = pool({ login: "waia_account_observation_reader_login" });
  const credential = pool();
  const pools = [collector, reader, credential];
  ports.open.mockImplementation(() => pools[ports.open.mock.calls.length - 1].sql);
  const controller = new AbortController();
  const report = vi.fn();
  const fetchImpl = vi.fn<typeof fetch>();
  const env = {
    WAIA_TRADER_CLI: "1", WAIA_RELEASE_SHA: MANIFEST_RELEASE_SHA,
    WAIA_OBSERVATION_OWNER_ID: "startup-unit", WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/synthetic/manifest.json",
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: manifest.digest,
    WAIA_OBSERVATION_COLLECTOR_DATABASE_URL: "postgres://waia_account_observer_login:synthetic@unit.invalid/db",
    WAIA_OBSERVATION_READER_DATABASE_URL: "postgres://waia_account_observation_reader_login:synthetic@unit.invalid/db",
    WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: `postgres://${LOGIN}:synthetic@unit.invalid/db`,
    WAIA_OBSERVATION_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
  };
  return { pools, credential, controller, report, fetchImpl,
    run: () => runAccountObservationCollector({ env, signal: controller.signal,
      readManifest: () => manifest.text, fetchImpl, report }) };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  ports.provider.mockResolvedValue({ synthetic: true });
  ports.reader.mockReturnValue({ getDecryptedCredentials: vi.fn() });
  ports.runtime.mockReturnValue({ dispose: vi.fn(), run: async (signal: AbortSignal) => {
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
  } });
});
afterEach(() => { vi.useRealTimers(); });

describe("credential pool catalog admission (synthetic executor; native SQL proved separately)", () => {
  it("uses one bounded read-only transaction and returns only the exact login", async () => {
    const f = pool();
    await expect(probeObservationCredentialPool(f.sql)).resolves.toBe(LOGIN);
    expect(f.begin).toHaveBeenCalledTimes(1);
    expect(f.statements.slice(0, 4)).toEqual(["SET TRANSACTION READ ONLY", "SET LOCAL statement_timeout = '3000ms'",
      "SET LOCAL lock_timeout = '1000ms'", "SET LOCAL transaction_timeout = '5000ms'"]);
    expect(f.statements).toHaveLength(5);
  });
  it.each(required)("refuses false or absent %s evidence", async key => {
    for (const value of [false, undefined, "true"]) {
      await expect(probeObservationCredentialPool(pool({ [key]: value }).sql)).rejects.toThrow("OBSERVATION_CREDENTIAL_ROLE_REFUSED");
    }
  });
  it.each(["", "other", "WAIA_ACCOUNT_OBSERVATION_CREDENTIAL_LOGIN"])("refuses actual login %s", async login => {
    await expect(probeObservationCredentialPool(pool({ login }).sql)).rejects.toThrow("OBSERVATION_CREDENTIAL_ROLE_REFUSED");
  });
  it.each([{ max: 3 }, { prepare: true }, { connect_timeout: 4 }, { max_lifetime: 301 }, { max: 0 }, { connect_timeout: NaN }, { max_lifetime: NaN }])("refuses unbounded options %j before SQL", async options => {
    const f = pool(); Object.assign(f.sql.options, options);
    await expect(probeObservationCredentialPool(f.sql)).rejects.toThrow();
    expect(f.begin).not.toHaveBeenCalled();
  });
  it("refuses multiple or absent rows and sanitizes catalog failures", async () => {
    for (const output of [[], [{ login: LOGIN }, { login: LOGIN }]]) {
      const f = pool(); f.begin.mockResolvedValue(output);
      await expect(probeObservationCredentialPool(f.sql)).rejects.toThrow("OBSERVATION_CREDENTIAL_ROLE_REFUSED");
    }
    const f = pool(); f.begin.mockRejectedValue(new Error("private SQL payload"));
    await expect(probeObservationCredentialPool(f.sql)).rejects.toThrow(/^OBSERVATION_CREDENTIAL_ROLE_REFUSED$/);
  });
});

describe("actual registered CLI private factory and host startup", () => {
  it("attests before provider/reader/runtime, then closes all three resources", async () => {
    const f = entry(); const run = f.run(); await vi.advanceTimersByTimeAsync(0);
    expect(f.report).toHaveBeenCalledWith("HOST_STARTED");
    expect(f.credential.begin.mock.invocationCallOrder[0]).toBeLessThan(ports.provider.mock.invocationCallOrder[0]);
    expect(ports.provider.mock.invocationCallOrder[0]).toBeLessThan(ports.reader.mock.invocationCallOrder[0]);
    expect(ports.reader.mock.invocationCallOrder[0]).toBeLessThan(ports.runtime.mock.invocationCallOrder[0]);
    f.controller.abort(); await run;
    for (const p of f.pools) expect(p.end).toHaveBeenCalledTimes(1);
    expect(f.fetchImpl).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("refuses unsafe third-pool evidence before provider initialization or HOST_STARTED", async () => {
    const f = entry(); f.credential.row.safe_login = false;
    await expect(f.run()).rejects.toThrow(/^ACCOUNT_OBSERVATION_HOST_FAILED$/);
    expect(ports.provider).not.toHaveBeenCalled(); expect(ports.reader).not.toHaveBeenCalled();
    expect(ports.runtime).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalledWith("HOST_STARTED");
    for (const p of f.pools) expect(p.end).toHaveBeenCalledTimes(1);
  });
  it.each(["catalog", "provider", "reader"])("closes all opened resources after %s failure without secret diagnostics", async stage => {
    const f = entry(); const error = new Error("private:password@host");
    if (stage === "catalog") f.credential.begin.mockRejectedValue(error);
    if (stage === "provider") ports.provider.mockRejectedValue(error);
    if (stage === "reader") ports.reader.mockImplementation(() => { throw error; });
    await expect(f.run()).rejects.toThrow(/^ACCOUNT_OBSERVATION_HOST_FAILED$/);
    for (const p of f.pools) expect(p.end).toHaveBeenCalledTimes(1);
    expect(f.report).not.toHaveBeenCalledWith("HOST_STARTED");
    expect(JSON.stringify(f.report.mock.calls)).not.toContain("password");
  });
  it.each([ ["probe", "cancel"], ["provider", "cancel"], ["probe", "timeout"], ["provider", "timeout"] ])(
    "%s pending during %s refuses late startup and closes late SQL", async (stage, mode) => {
    const f = entry(); let deliver!: () => void;
    if (stage === "probe") f.credential.begin.mockImplementation(async callback => {
      await new Promise<void>(resolve => { deliver = resolve; });
      return callback(async (chunks: TemplateStringsArray) => chunks.join("?").includes("AS login") ? [f.credential.row] : []);
    });
    else ports.provider.mockImplementation(async () => {
      await new Promise<void>(resolve => { deliver = resolve; }); return { synthetic: true };
    });
    const work = f.run().then(() => "STOPPED", () => "FAILED"); await vi.advanceTimersByTimeAsync(0);
    if (mode === "cancel") f.controller.abort(); else await vi.advanceTimersByTimeAsync(15001);
    expect(await work).toBe(mode === "cancel" ? "STOPPED" : "FAILED");
    deliver(); await vi.advanceTimersByTimeAsync(0);
    expect(ports.reader).not.toHaveBeenCalled(); expect(ports.runtime).not.toHaveBeenCalled();
    if (stage === "probe") expect(ports.provider).not.toHaveBeenCalled();
    expect(f.report).not.toHaveBeenCalledWith("HOST_STARTED");
    for (const p of f.pools) expect(p.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pre-aborted entry opens no SQL resource", async () => {
    const f = entry(); f.controller.abort(); await f.run();
    expect(ports.open).not.toHaveBeenCalled(); expect(ports.provider).not.toHaveBeenCalled();
  });
});
