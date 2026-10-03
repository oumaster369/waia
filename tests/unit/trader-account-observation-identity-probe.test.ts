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
import { parseHtxV5AssetMode } from "@/lib/trader/account-observation/derivatives/htx-v5-read-contract";
import { parseAccountObservationIdentityProbeEnv, runAccountObservationIdentityProbe, renderIdentityProbeRefusal,
  writeIdentityProbeRefusal, readManifestBounded, AccountObservationIdentityProbeFailure, type ProbeDependencies } from "@/scripts/trader/account-observation-identity-probe";
import type { Sql } from "postgres";
import type { ObservationBinding } from "@/lib/trader/account-observation/types";
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

function manifestFixture() {
  const config = createObservationConfiguration({ symbols: ["BTCUSDT"], pollIntervalMs: 60000,
    maxBackoffMs: 120000, readTimeoutMs: 10000, leaseTtlMs: 240000,
    htxCoverage: { ...readerLimits, host: "api.huobi.pro" } });
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
      maxBackoffMs: 120000, readTimeoutMs: 10000, leaseTtlMs: 240000, readerLimits }],
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

function setup(options: { providerReady?: boolean; authorizations?: boolean[]; transportOverride?: ProbeDependencies["createTransport"] } = {}) {
  const fixture = manifestFixture();
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
    createTransport: options.transportOverride ?? (input => createHtxV5ReadTransport(input)),
    parseMode: parseHtxV5AssetMode,
    fetchImpl,
    now: () => Date.now(),
  };
  return { fixture, deps, fetchImpl, authorizeOpen, store, credential, closeReader, closeCredential };
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
    await expect(runAccountObservationIdentityProbe(f.fixture.env, f.deps)).rejects.toMatchObject({ code: "VENUE_REFUSED" });
    expect(f.fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).not.toContain("/v5/account/asset_mode");
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
