// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountObservationManifestDigest, ACCOUNT_OBSERVATION_ASSIGNMENT_MANIFEST_SCHEMA } from "@/lib/trader/account-observation/assignment-manifest";
import { createObservationConfiguration } from "@/lib/trader/account-observation/runtime";
import { createObservationCredentialStore } from "@/lib/trader/account-observation/credential-store";
import { createPostgresObservationAssignmentSource } from "@/lib/trader/account-observation/postgres-assignments";
import { createPostgresObservationReader } from "@/lib/trader/account-observation/postgres-reader";
import { createHtxV5ReadTransport } from "@/lib/trader/account-observation/derivatives/htx-v5-read-transport";
import type { HtxV5ObservationReader } from "@/lib/trader/account-observation/derivatives/htx-v5-reader";
import { AccountObservationReadFailure } from "@/lib/trader/account-observation/service";
import { parseHtxV5AssetMode } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { parseAccountObservationIdentityProbeEnv, runAccountObservationIdentityProbe, renderIdentityProbeRefusal,
  writeIdentityProbeRefusal, readManifestBounded, AccountObservationIdentityProbeFailure, type ProbeDependencies } from "@/scripts/trader/account-observation-identity-probe";
import type { Sql } from "postgres";
import type { HtxV5AccountObservation, ObservationBinding } from "@/lib/trader/account-observation/types";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";

const binding: ObservationBinding = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  credentialId: "00000000-0000-4000-8000-000000000002",
  exchangeAccountId: "123456",
  credentialRevision: "1",
  configurationRevision: "",
};
const releaseSha = "a".repeat(40);
const masterKey = Buffer.alloc(32, 7).toString("base64");
const readerUrl = "postgresql://waia_account_observation_reader_login:reader-pass@reader.example/db";
const credentialUrl = "postgresql://waia_account_observation_credential_login:credential-pass@credential.example/db";
const readerLimits = { pageSize: 100, maxPages: 2, maxRecords: 200, maxResponseBytes: 65536, tradeWindowMs: 60000 };

function manifestFixture(options: { htxV5?: { enabled: boolean; expectedHtxUid?: string; fillContracts?: string[] } } = {}) {
  const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 60000,
    maxBackoffMs: 120000, readTimeoutMs: 10000, leaseTtlMs: 240000,
    htxCoverage: { ...readerLimits, host: "api.huobi.pro" }, ...(options.htxV5 ? { htxV5: options.htxV5 } : {}) });
  const assigned = { ...binding, configurationRevision: config.revision };
  const body = {
    schemaVersion: ACCOUNT_OBSERVATION_ASSIGNMENT_MANIFEST_SCHEMA as typeof ACCOUNT_OBSERVATION_ASSIGNMENT_MANIFEST_SCHEMA,
    releaseSha,
    host: "api.huobi.pro" as const,
    intervalMs: 60000,
    iterationTimeoutMs: 300000,
    openTimeoutMs: 10000,
    shutdownTimeoutMs: 10000,
    assignments: [{ organizationId: assigned.organizationId, credentialId: assigned.credentialId,
      exchangeAccountId: assigned.exchangeAccountId, credentialRevision: assigned.credentialRevision,
      configurationRevision: config.revision, symbols: ["BTCUSDT"], pollIntervalMs: 60000,
      maxBackoffMs: 120000, readTimeoutMs: 10000, leaseTtlMs: 240000, readerLimits,
      ...(options.htxV5 ? { htxV5: options.htxV5 } : {}) }],
  };
  const digest = accountObservationManifestDigest(body);
  const text = JSON.stringify({ ...body, contentSha256: digest });
  const env = { WAIA_TRADER_CLI: "1", WAIA_RELEASE_SHA: releaseSha,
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST: "/private/manifest.json",
    WAIA_OBSERVATION_ASSIGNMENT_MANIFEST_SHA256: digest,
    WAIA_OBSERVATION_READER_DATABASE_URL: readerUrl,
    WAIA_OBSERVATION_CREDENTIAL_DATABASE_URL: credentialUrl,
    WAIA_OBSERVATION_MASTER_KEY: masterKey };
  return { assigned, config, digest, text, env };
}

function setup(options: { providerReady?: boolean; authorizations?: boolean[]; transportOverride?: ProbeDependencies["createTransport"];
  v5Observation?: unknown; v5Read?: HtxV5ObservationReader; htxV5?: boolean } = {}) {
  const fixture = manifestFixture(options.htxV5 ? { htxV5: { enabled: true, expectedHtxUid: "7654321" } } : {});
  const readerSql = (() => {}) as unknown as Sql;
  const credentialSql = (() => {}) as unknown as Sql;
  const closeReader = vi.fn(async () => {});
  const closeCredential = vi.fn(async () => {});
  const credential = { binding: fixture.assigned, apiKey: "synthetic-api-key", apiSecret: "synthetic-api-secret", dispose: vi.fn() };
  const authorizeOpen = vi.fn(async () => options.authorizations?.shift() ?? true);
  const source = {
    loadAssignments: vi.fn(async () => [{ binding: fixture.assigned, config: fixture.config }]),
    authorizeOpen,
  } as unknown as ReturnType<typeof createPostgresObservationAssignmentSource>;
  const reader = { resolveActiveBinding: vi.fn(async () => fixture.assigned) } as unknown as ReturnType<typeof createPostgresObservationReader>;
  const service = { getDecryptedCredentials: vi.fn(async () => ({ apiKey: credential.apiKey, apiSecret: credential.apiSecret })) };
  const store = {
    openCredential: vi.fn(async () => credential), dispose: vi.fn(), settled: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof createObservationCredentialStore>;
  const observation = options.v5Observation ?? { schemaVersion: "htx-v5-observation/v1", htxUid: "7654321",
    assetMode: { status: "COMPLETE", value: "1", readStartedAtMs: Date.now(), readCompletedAtMs: Date.now(),
      responseGeneratedAtMs: Date.now(), error: null }, balance: { status: "ERROR", value: null,
      readStartedAtMs: Date.now(), readCompletedAtMs: Date.now(), responseGeneratedAtMs: null, error: "READ_FAILED" },
    positions: { status: "ERROR", values: null, readStartedAtMs: Date.now(), readCompletedAtMs: Date.now(),
      responseGeneratedAtMs: null, error: "READ_FAILED", pageScope: null },
    openOrders: { status: "ERROR", values: null, readStartedAtMs: Date.now(), readCompletedAtMs: Date.now(),
      responseGeneratedAtMs: null, error: "READ_FAILED", pageScope: null },
    algoOrders: { status: "ERROR", values: null, readStartedAtMs: Date.now(), readCompletedAtMs: Date.now(),
      responseGeneratedAtMs: null, error: "READ_FAILED", pageScope: null },
    fills: { status: "NOT_CONFIGURED", values: null, readStartedAtMs: null, readCompletedAtMs: null,
      responseGeneratedAtMs: null, error: null, coverage: "NOT_CONFIGURED", contracts: [], windowStartMs: null,
      windowEndMs: null, pageScope: null } };
  const v5Reader = { read: vi.fn(async () => observation), dispose: vi.fn(), settled: vi.fn(async () => {}) };
  const fetchImpl = vi.fn<typeof fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/account/accounts")
      return new Response(JSON.stringify({ status: "ok", data: [{ id: 123456, type: "spot", state: "working" }] }));
    if (url.pathname === "/v2/user/uid") return new Response(JSON.stringify({ code: 200, data: 7654321 }));
    if (url.pathname === "/v2/user/api-key") return new Response(JSON.stringify({ code: 200,
      data: [{ accessKey: credential.apiKey, status: "normal", permission: "readOnly" }] }));
    if (url.pathname === "/v5/account/asset_mode") return new Response(JSON.stringify({ code: "200", ts: "1791057600000", data: { asset_mode: "1" } }));
    throw new Error("unexpected synthetic route");
  });
  const deps: ProbeDependencies = {
    readManifest: vi.fn(() => fixture.text),
    openReader: vi.fn(async () => ({ sql: readerSql, close: closeReader })),
    openCredential: vi.fn(async () => ({ sql: credentialSql, close: closeCredential })),
    probeReader: vi.fn(async () => "reader-login"),
    probeCredential: vi.fn(async () => "credential-login"),
    createProvider: vi.fn(async () => ({ isProductionReady: () => options.providerReady ?? true,
      decryptDataKey: async () => new Uint8Array() } as unknown as MasterKeyProvider)),
    createCredentialService: vi.fn(() => service),
    createAssignmentSource: vi.fn(() => source),
    createReader: vi.fn(() => reader),
    createStore: vi.fn(() => store),
    createTransport: vi.fn(options.transportOverride ?? (input => createHtxV5ReadTransport(input))),
    createV5Reader: vi.fn(() => options.v5Read ?? v5Reader as never),
    parseMode: parseHtxV5AssetMode,
    fetchImpl,
    now: () => Date.now(),
  };
  return { fixture, deps, fetchImpl, authorizeOpen, store, v5Reader, credential, closeReader, closeCredential };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-03T00:00:00Z")); });
afterEach(() => vi.useRealTimers());

describe("protected HTX identity probe", () => {
  it("uses one read-only mode route, returns fresh UID/permission and drains without starting a scheduler", async () => {
    const f = setup();
    const pending = runAccountObservationIdentityProbe(f.fixture.env, f.deps);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result).toMatchObject({ htxUid: "7654321", permission: "readOnly", assetMode: "1",
      binding: f.fixture.assigned, releaseSha, manifestSha256: f.fixture.digest });
    const paths = f.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname);
    expect(paths.filter(path => path === "/v5/account/asset_mode")).toHaveLength(1);
    expect(paths.filter(path => path.startsWith("/v5/")).sort()).toEqual(["/v5/account/asset_mode"]);
    expect(paths).toHaveLength(7);
    expect(f.store.settled).toHaveBeenCalledOnce();
    expect(f.closeReader).toHaveBeenCalledOnce();
    expect(f.closeCredential).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("runs the bounded full V5 reader only with an exact manifest UID and returns parsed observation provenance", async () => {
    const f = setup({ htxV5: true });
    const env = { ...f.fixture.env, WAIA_OBSERVATION_PROBE_MODE: "v5-acceptance", WAIA_OBSERVATION_EXPECTED_HTX_UID: "7654321" };
    const pending = runAccountObservationIdentityProbe(env, f.deps);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result).toMatchObject({ schemaVersion: "waia.account_observation_v5_acceptance_probe.v1",
      htxUid: "7654321", expectedHtxUid: "7654321", permission: "readOnly",
      manifestSha256: f.fixture.digest, observation: { schemaVersion: "htx-v5-observation/v1", htxUid: "7654321" } });
    expect(f.deps.createV5Reader).toHaveBeenCalledOnce();
    expect(f.v5Reader.read).toHaveBeenCalledOnce();
    expect(f.v5Reader.dispose).toHaveBeenCalledOnce();
    expect(f.v5Reader.settled).toHaveBeenCalledOnce();
    expect(f.deps.createTransport).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.closeReader).toHaveBeenCalledOnce();
    expect(f.closeCredential).toHaveBeenCalledOnce();
    const serialized = JSON.stringify(result);
    for (const secret of [readerUrl, credentialUrl, masterKey, "synthetic-api-key", "synthetic-api-secret", "accessKeySha256"])
      expect(serialized).not.toContain(secret);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["missing expected UID", undefined],
    ["unexpected expected UID", "7654322"],
  ])("refuses V5 acceptance with %s before opening resources", async (_label, expectedUid) => {
    const f = setup({ htxV5: true });
    const env = { ...f.fixture.env, WAIA_OBSERVATION_PROBE_MODE: "v5-acceptance",
      ...(expectedUid ? { WAIA_OBSERVATION_EXPECTED_HTX_UID: expectedUid } : {}) };
    await expect(runAccountObservationIdentityProbe(env, f.deps)).rejects.toMatchObject({ code: "HTX_IDENTITY_MISMATCH" });
    expect(f.deps.openReader).not.toHaveBeenCalled();
    expect(f.deps.createV5Reader).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps the original identity mode schema when the mode is omitted", async () => {
    const f = setup();
    const pending = runAccountObservationIdentityProbe(f.fixture.env, f.deps);
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.schemaVersion).toBe("waia.account_observation_identity_probe.v1");
    expect("observation" in result).toBe(false);
    expect(f.deps.createV5Reader).not.toHaveBeenCalled();
  });

  it("bounds the full V5 read at 120 seconds and refuses success until cleanup has drained", async () => {
    let settle!: () => void;
    const reader: HtxV5ObservationReader = {
      read: vi.fn((signal: AbortSignal) => new Promise<HtxV5AccountObservation>((_, reject) => {
        signal.addEventListener("abort", () => reject(new AccountObservationReadFailure("READ_FAILED")), { once: true });
      })),
      dispose: vi.fn(),
      settled: () => new Promise<void>(resolve => { settle = resolve; }),
    };
    const f = setup({ htxV5: true, v5Read: reader });
    const env = { ...f.fixture.env, WAIA_OBSERVATION_PROBE_MODE: "v5-acceptance", WAIA_OBSERVATION_EXPECTED_HTX_UID: "7654321" };
    const result = runAccountObservationIdentityProbe(env, f.deps).then(
      value => ({ value }), error => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await vi.advanceTimersByTimeAsync(7_000);
    settle();
    await expect(result).resolves.toMatchObject({ error: { code: "CLEANUP_TIMEOUT" } });
    expect(reader.dispose).toHaveBeenCalledOnce();
    expect(f.closeReader).toHaveBeenCalledOnce();
    expect(f.closeCredential).toHaveBeenCalledOnce();
  });

  it("rejects missing CLI precondition before opening any resource", async () => {
    const f = setup();
    const env = { ...f.fixture.env, WAIA_TRADER_CLI: "0" };
    await expect(runAccountObservationIdentityProbe(env, f.deps)).rejects.toMatchObject({ code: "CLI_ENVIRONMENT" });
    expect(f.deps.openReader).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps URLs and the master key out of serialized runtime config", () => {
    const f = setup();
    const serialized = JSON.stringify(parseAccountObservationIdentityProbeEnv(f.fixture.env));
    expect(serialized).toContain(f.fixture.digest);
    for (const sensitive of [readerUrl, credentialUrl, masterKey, "reader-pass", "credential-pass"])
      expect(serialized).not.toContain(sensitive);
  });

  it("refuses current-key rotation after the mode response and emits no stale identity", async () => {
    const transportOverride: ProbeDependencies["createTransport"] = input => ({
      readAssetMode: async () => ({ body: JSON.stringify({ code: "200", ts: "1791057600000", data: { asset_mode: "1" } }),
        identity: { binding: input.credential.binding, accessKeySha256: "b".repeat(64), htxUid: "7654321",
          permission: "readOnly" as const, checkedAt: Date.now() }, receivedAt: Date.now() }),
      dispose: vi.fn(), settled: async () => {},
    }) as unknown as ReturnType<typeof createHtxV5ReadTransport>;
    const f = setup({ authorizations: [true, false], transportOverride });
    await expect(runAccountObservationIdentityProbe(f.fixture.env, f.deps)).rejects.toMatchObject({ code: "ASSIGNMENT_STALE" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an unavailable protected credential before any venue request", async () => {
    const f = setup({ providerReady: false });
    await expect(runAccountObservationIdentityProbe(f.fixture.env, f.deps)).rejects.toMatchObject({ code: "CREDENTIAL_REFUSED" });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects trade permission before the V5 mode request", async () => {
    const f = setup();
    const original = f.fetchImpl.getMockImplementation()!;
    f.fetchImpl.mockImplementation(async input => {
      const url = new URL(String(input));
      if (url.pathname === "/v2/user/api-key") return new Response(JSON.stringify({ code: 200,
        data: [{ accessKey: "synthetic-api-key", status: "normal", permission: "readOnly,trade" }] }));
      return original(input);
    });
    await expect(runAccountObservationIdentityProbe(f.fixture.env, f.deps)).rejects.toMatchObject({ code: "HTX_PERMISSION_DENIED" });
    expect(f.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).not.toContain("/v5/account/asset_mode");
  });

  it.each([
    ["TIMEOUT", "HTX_TIMEOUT"], ["RATE_LIMITED", "HTX_RATE_LIMITED"],
    ["PERMISSION_DENIED", "HTX_PERMISSION_DENIED"], ["READ_FAILED", "HTX_READ_FAILED"],
    ["INVALID_RESPONSE", "HTX_INVALID_RESPONSE"], ["IDENTITY_MISMATCH", "HTX_IDENTITY_MISMATCH"],
  ] as const)("maps strict transport %s to the fixed diagnostic %s", async (transportCode, refusal) => {
    const transportOverride: ProbeDependencies["createTransport"] = () => ({
      readAssetMode: async () => { throw new AccountObservationReadFailure(transportCode); },
      dispose: vi.fn(), settled: async () => {},
    }) as unknown as ReturnType<typeof createHtxV5ReadTransport>;
    const f = setup({ transportOverride });
    await expect(runAccountObservationIdentityProbe(f.fixture.env, f.deps)).rejects.toMatchObject({ code: refusal });
    expect(f.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toHaveLength(0);
  });

  it.each([
    ["unknown data code", Object.assign(new Error("private response URL/body"), { code: "HTX_TIMEOUT" })],
    ["transparent data proxy", new Proxy(new AccountObservationReadFailure("TIMEOUT"), {})],
    ["accessor code", Object.defineProperty(new AccountObservationReadFailure("TIMEOUT"), "code", { get: () => "TIMEOUT" })],
    ["proxy descriptor", new Proxy(new AccountObservationReadFailure("TIMEOUT"), {
      getOwnPropertyDescriptor: () => { throw new Error("private proxy trap"); },
    })],
  ])("maps a %s transport error to generic refusal", async (_label, transportError) => {
    const transportOverride: ProbeDependencies["createTransport"] = () => ({
      readAssetMode: async () => { throw transportError; },
      dispose: vi.fn(), settled: async () => {},
    }) as unknown as ReturnType<typeof createHtxV5ReadTransport>;
    const f = setup({ transportOverride });
    await expect(runAccountObservationIdentityProbe(f.fixture.env, f.deps)).rejects.toMatchObject({ code: "VENUE_REFUSED" });
  });

  it("refuses transparent transport proxies without reading their code accessor", async () => {
    let getterCalls = 0;
    const failure = Object.defineProperty(new AccountObservationReadFailure("TIMEOUT"), "code", {
      get: () => { getterCalls += 1; return "TIMEOUT"; },
    });
    const transparentProxy = new Proxy(failure, {});
    const transportOverride: ProbeDependencies["createTransport"] = () => ({
      readAssetMode: async () => { throw transparentProxy; },
      dispose: vi.fn(), settled: async () => {},
    }) as unknown as ReturnType<typeof createHtxV5ReadTransport>;
    const f = setup({ transportOverride });
    await expect(runAccountObservationIdentityProbe(f.fixture.env, f.deps)).rejects.toMatchObject({ code: "VENUE_REFUSED" });
    expect(getterCalls).toBe(0);
  });

  it("distinguishes strict asset-mode parse failure", async () => {
    const f = setup();
    const deps = { ...f.deps, parseMode: (() => { throw new Error("private response body"); }) as ProbeDependencies["parseMode"] };
    await expect(runAccountObservationIdentityProbe(f.fixture.env, deps)).rejects.toMatchObject({ code: "ASSET_MODE_INVALID_RESPONSE" });
  });

  it("maps sensitive dependency failures to fixed redacted JSON", () => {
    const output = renderIdentityProbeRefusal(new Error("postgres://private/key synthetic-api-secret response-body"));
    expect(output).toBe(JSON.stringify({ schemaVersion: "waia.account_observation_identity_probe.v1", refusal: "FAILED" }));
    expect(output).not.toContain("private");
    expect(output).not.toContain("synthetic-api-secret");
  });

  it("does not invoke a forged refusal-code accessor", () => {
    const forged = new AccountObservationIdentityProbeFailure("FAILED");
    Object.defineProperty(forged, "code", { get() { throw new Error("secret getter"); } });
    expect(renderIdentityProbeRefusal(forged)).toBe(JSON.stringify({
      schemaVersion: "waia.account_observation_identity_probe.v1", refusal: "FAILED",
    }));
    const protoForgery = Object.create(AccountObservationIdentityProbeFailure.prototype) as Error & { code: string };
    Object.defineProperty(protoForgery, "code", { get: () => "CLEANUP_TIMEOUT" });
    expect(renderIdentityProbeRefusal(protoForgery)).toContain('"refusal":"FAILED"');
  });

  it("refuses transparent identity failure proxies without reading their code accessor", () => {
    expect(renderIdentityProbeRefusal(new Proxy(new AccountObservationIdentityProbeFailure("TIMEOUT"), {})))
      .toContain('"refusal":"FAILED"');
    let getterCalls = 0;
    const failure = Object.defineProperty(new AccountObservationIdentityProbeFailure("FAILED"), "code", {
      get: () => { getterCalls += 1; return "CLEANUP_TIMEOUT"; },
    });
    expect(renderIdentityProbeRefusal(new Proxy(failure, {}))).toBe(JSON.stringify({
      schemaVersion: "waia.account_observation_identity_probe.v1", refusal: "FAILED",
    }));
    expect(getterCalls).toBe(0);
  });

  it("reads only bounded regular manifest files", () => {
    const directory = mkdtempSync(join(tmpdir(), "waia-identity-probe-"));
    const path = join(directory, "oversized.json");
    try {
      writeFileSync(path, Buffer.alloc(65537, 0x20));
      expect(() => readManifestBounded(path)).toThrowError(AccountObservationIdentityProbeFailure);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("forces a failed CLI exit after a cleanup refusal is written", () => {
    const priorExitCode = process.exitCode;
    const chunks: string[] = [];
    const exit = vi.fn();
    const output = { write(chunk: string, callback?: () => void) { chunks.push(chunk); callback?.(); return true; } };
    try {
      writeIdentityProbeRefusal(Object.assign(new Error("ignored"), { code: "CLEANUP_TIMEOUT" }), output as never, exit);
      expect(chunks).toEqual([JSON.stringify({ schemaVersion: "waia.account_observation_identity_probe.v1", refusal: "FAILED" }) + "\n"]);
      expect(exit).not.toHaveBeenCalled();
      writeIdentityProbeRefusal(new AccountObservationIdentityProbeFailure("CLEANUP_TIMEOUT"), output as never, exit);
      expect(chunks[1]).toBe(JSON.stringify({ schemaVersion: "waia.account_observation_identity_probe.v1", refusal: "CLEANUP_TIMEOUT" }) + "\n");
      expect(exit).toHaveBeenCalledWith(1);
      expect(process.exitCode).toBe(1);
    } finally { process.exitCode = priorExitCode; }
  });

  it("forces exit if stdout never calls back", async () => {
    const priorExitCode = process.exitCode;
    const exit = vi.fn();
    try {
      writeIdentityProbeRefusal(new AccountObservationIdentityProbeFailure("CLEANUP_FAILED"),
        { write: () => true } as never, exit);
      expect(process.exitCode).toBe(1);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(250);
      expect(exit).toHaveBeenCalledWith(1);
    } finally { process.exitCode = priorExitCode; }
  });

  it("does not start the protected store when provider startup resolves after the deadline", async () => {
    const f = setup();
    let resolveProvider!: (provider: MasterKeyProvider) => void;
    const deps = { ...f.deps, createProvider: vi.fn(() => new Promise<MasterKeyProvider>(resolve => { resolveProvider = resolve; })) };
    const provider = { isProductionReady: () => true, decryptDataKey: async () => new Uint8Array() } as unknown as MasterKeyProvider;
    const result = runAccountObservationIdentityProbe(f.fixture.env, deps).then(
      value => ({ value }), error => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(45_000);
    resolveProvider(provider);
    await vi.runOnlyPendingTimersAsync();
    await expect(result).resolves.toMatchObject({ error: { code: "TIMEOUT" } });
    expect(deps.createStore).not.toHaveBeenCalled();
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });

  it("waits for transport settlement after timeout and never reports success while cleanup is pending", async () => {
    let settle!: () => void;
    const transportOverride: ProbeDependencies["createTransport"] = () => ({
      readAssetMode: (_signal: AbortSignal) => new Promise((_, reject) => {
        _signal.addEventListener("abort", () => reject(new Error("private transport error")), { once: true });
      }),
      dispose: vi.fn(),
      settled: () => new Promise<void>(resolve => { settle = resolve; }),
    }) as unknown as ReturnType<typeof createHtxV5ReadTransport>;
    const g = setup({ transportOverride });
    const result = runAccountObservationIdentityProbe(g.fixture.env, g.deps).then(
      value => ({ value }), error => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(7_000);
    settle();
    await expect(result).resolves.toMatchObject({ error: { code: "CLEANUP_TIMEOUT" } });
    expect(g.closeReader).toHaveBeenCalledOnce();
    expect(g.closeCredential).toHaveBeenCalledOnce();
  });
});
