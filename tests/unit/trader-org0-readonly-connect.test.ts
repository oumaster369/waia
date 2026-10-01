import { afterEach, describe, expect, it, vi } from "vitest";

import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import type { CredentialService, CredentialMetadata } from "@/lib/trader/credentials/types";
import { assertAdminConsoleSameOrigin } from "@/lib/trader/admin-console/auth";
import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import {
  handleOrg0ReadOnlyConnectGet,
  handleOrg0ReadOnlyConnectPost,
  createProductionOrg0ReadOnlyConnectDeps,
  type Org0ReadOnlyConnectDeps,
} from "@/lib/trader/credentials/org0-readonly-connect-handler";

const ORG0 = "00000000-0000-4000-8000-000000001196";
const USER = "00000000-0000-4000-8000-000000001197";
const ACCOUNT = "73737331";
const ENDPOINT_URL = "https://trader.example.test/api/trader/admin/org0-readonly-connect";

function metadata(id = "00000000-0000-4000-8000-000000001198"): CredentialMetadata {
  return { id, venue: "htx", exchangeAccountId: ACCOUNT, apiKeyMasked: "****KEY",
    status: "active", permissionMetadata: { version: 1, scopes: ["read"] },
    createdAt: new Date("2026-10-01T00:00:00.000Z"), updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    revokedAt: null };
}

function request(body: unknown): Request {
  return new Request(ENDPOINT_URL, { method: "POST", headers: { origin: "https://trader.example.test",
    "content-type": "application/json" }, body: JSON.stringify(body) });
}

function fixture(options: {
  userId?: string | null; trader?: boolean; admin?: boolean; member?: boolean;
  org0?: string | null; backend?: "postgres" | "sqlite";
  validation?: { valid: boolean; accountId?: string; warnings?: readonly string[] };
  accountInfo?: { accountId: string; permissions: readonly string[]; venue?: string; marketType?: string };
  rows?: CredentialMetadata[];
  allowSecondCheck?: boolean;
  storeError?: unknown;
} = {}) {
  const calls = { venue: vi.fn(), store: vi.fn(), dispose: vi.fn(), membership: vi.fn(), permission: vi.fn() };
  const rows = options.rows ?? [];
  const validation = options.validation ?? { valid: true, accountId: ACCOUNT };
  const info = options.accountInfo ?? { accountId: ACCOUNT, venue: "htx", marketType: "spot", permissions: ["read"] };
  const connector = {
    validateCredentials: async () => { calls.venue(); return validation; },
    getAccountInfo: async () => info,
  } as unknown as HtxExchangeConnector;
  const service = {
    listCredentialMetadata: async () => rows,
    storeCredentials: async (_context: unknown, input: unknown) => {
      calls.store(input);
      if (options.storeError) throw options.storeError;
      return metadata();
    },
  } as unknown as CredentialService;
  const runtime = { kind: options.backend ?? "postgres", db: {} } as WaiaRuntimeDb;
  const deps: Org0ReadOnlyConnectDeps = {
    getUserId: async () => options.userId === undefined ? USER : options.userId,
    hasTraderAccess: async () => options.trader !== false,
    getRuntimeDb: async () => runtime,
    disposeRuntimeDb: async () => { calls.dispose(); },
    resolveOrg0: () => options.org0 === undefined ? ORG0 : options.org0,
    checkAdminPermission: async () => { calls.permission(); return { allowed: options.admin !== false &&
      (options.allowSecondCheck !== false || calls.permission.mock.calls.length < 2), role: "admin", enforced: true }; },
    assertOrgMembership: async () => { calls.membership(); if (options.member === false) throw new OrgScopeError("ORG_MEMBERSHIP_REQUIRED"); },
    assertSameOrigin: req => req.headers.get("origin") === new URL(req.url).origin ? null :
      { status: 403, outcome: "client_error", body: { error: { code: "ADMIN_CONSOLE_ORIGIN_REJECTED", message: "Origin rejected." } } },
    createProvider: async () => ({ isProductionReady: () => true }) as never,
    createConnector: config => { expect(config.expectedSpotAccountId).toBe(ACCOUNT); return connector; },
    createCredentialService: () => service,
  };
  return { deps, calls };
}

const keys = { apiKey: "synthetic-KEY", apiSecret: "synthetic-SECRET", expectedActiveCredentialId: null };

describe("Org0 read-only Admin connect boundary", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("resolves Org0 only from server configuration", () => {
    vi.stubEnv("WAIA_TRADER_ORG0_ORGANIZATION_ID", ORG0);
    expect(createProductionOrg0ReadOnlyConnectDeps().resolveOrg0()).toBe(ORG0);
  });
  it.each([
    [{ userId: null }, 401],
    [{ trader: false }, 403],
    [{ admin: false }, 403],
    [{ member: false }, 403],
    [{ org0: null }, 503],
    [{ backend: "sqlite" }, 503],
  ] as const)("refuses missing prerequisite %j before venue access", async (options, status) => {
    const { deps, calls } = fixture(options);
    const result = await handleOrg0ReadOnlyConnectPost(request(keys), deps);
    expect(result.status).toBe(status);
    expect(calls.venue).not.toHaveBeenCalled();
    expect(calls.store).not.toHaveBeenCalled();
  });

  it("returns only fixed target and active matching masked metadata", async () => {
    const foreign = { ...metadata(), id: crypto.randomUUID(), exchangeAccountId: "999" };
    const { deps, calls } = fixture({ rows: [foreign, metadata()] });
    const result = await handleOrg0ReadOnlyConnectGet(deps);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ target: { organizationId: ORG0, exchangeAccountId: ACCOUNT,
      requiredPermission: "read" }, credential: { id: metadata().id, apiKeyMasked: "****KEY" } });
    expect(JSON.stringify(result.body)).not.toMatch(/apiSecret|encryptedPayload|synthetic-SECRET/);
    expect(calls.venue).not.toHaveBeenCalled();
  });

  it("does not echo unexpected stored metadata or free-text warnings", async () => {
    const row = { ...metadata(), permissionMetadata: { version: 1, marketType: "spot",
      exchangeAccountId: ACCOUNT, scopes: ["read"], warnings: ["synthetic-sensitive-note"],
      accountLabel: "synthetic-sensitive-label", withdrawForbidden: true, transferForbidden: true,
      unexpectedSecret: "synthetic-sensitive-extra" } };
    const result = await handleOrg0ReadOnlyConnectGet(fixture({ rows: [row] }).deps);
    expect(result.status).toBe(200);
    const wire = JSON.stringify(result.body);
    expect(wire).not.toContain("synthetic-sensitive");
    expect(result.body).toMatchObject({ credential: { permissionMetadata: { scopes: ["read"] } } });
  });

  it("stores only a freshly verified exact account/read scope via optimistic canonical service", async () => {
    const { deps, calls } = fixture();
    const result = await handleOrg0ReadOnlyConnectPost(request(keys), deps);
    expect(result.status).toBe(200);
    expect(calls.venue).toHaveBeenCalledOnce();
    expect(calls.permission).toHaveBeenCalledTimes(2);
    expect(calls.membership).toHaveBeenCalledTimes(2);
    expect(calls.store).toHaveBeenCalledWith(expect.objectContaining({ venue: "htx",
      exchangeAccountId: ACCOUNT, expectedActiveCredentialId: null, actorType: "admin",
      actorId: USER, orgLiveEnabled: false,
      permissionMetadata: expect.objectContaining({ scopes: ["read"], transferForbidden: true,
        withdrawForbidden: true }) }));
    expect(JSON.stringify(result.body)).not.toContain(keys.apiSecret);
    expect(JSON.stringify(result.body)).not.toContain(keys.apiKey);
  });

  it.each([
    [{ validation: { valid: true, accountId: "999" } }, 400],
    [{ accountInfo: { accountId: ACCOUNT, venue: "htx", marketType: "spot", permissions: ["read", "trade"] } }, 400],
    [{ accountInfo: { accountId: ACCOUNT, venue: "htx", marketType: "spot", permissions: ["withdraw"] } }, 400],
    [{ accountInfo: { accountId: ACCOUNT, venue: "htx", marketType: "spot", permissions: ["read", "read"] } }, 400],
    [{ accountInfo: { accountId: "999", venue: "htx", marketType: "spot", permissions: ["read"] } }, 400],
    [{ allowSecondCheck: false }, 403],
  ] as const)("refuses unverified identity, scope or lost authority %j", async (options, status) => {
    const { deps, calls } = fixture(options);
    expect((await handleOrg0ReadOnlyConnectPost(request(keys), deps)).status).toBe(status);
    expect(calls.store).not.toHaveBeenCalled();
  });

  it("refuses target injection, stale replacement and cross-origin before storage", async () => {
    const f = fixture({ rows: [metadata()] });
    expect((await handleOrg0ReadOnlyConnectPost(request({ ...keys, organizationId: ORG0 }), f.deps)).status).toBe(400);
    expect((await handleOrg0ReadOnlyConnectPost(request(keys), f.deps)).status).toBe(409);
    const foreignOrigin = new Request(ENDPOINT_URL, { method: "POST", headers: { origin: "https://evil.example.test",
      "content-type": "application/json" }, body: JSON.stringify(keys) });
    expect((await handleOrg0ReadOnlyConnectPost(foreignOrigin, f.deps)).status).toBe(403);
    expect(f.calls.store).not.toHaveBeenCalled();
  });

  it("maps only the exact active-credential uniqueness race to refresh conflict", async () => {
    const active = Object.assign(new Error("synthetic active unique"), {
      code: "23505", constraint_name: "exchange_credentials_active_org_venue_account_unique",
    });
    const wrapped = new Error("Drizzle insert failed", { cause: active });
    const raced = fixture({ storeError: wrapped });
    expect((await handleOrg0ReadOnlyConnectPost(request(keys), raced.deps)).status).toBe(409);
    expect(raced.calls.store).toHaveBeenCalledOnce();

    for (const storeError of [
      Object.assign(new Error("other unique"), { code: "23505", constraint_name: "unrelated_unique" }),
      Object.assign(new Error("other SQL failure"), { code: "23514",
        constraint_name: "exchange_credentials_active_org_venue_account_unique" }),
    ]) {
      const unrelated = fixture({ storeError });
      await expect(handleOrg0ReadOnlyConnectPost(request(keys), unrelated.deps)).rejects.toBe(storeError);
    }
  });

  it("uses the actual Admin same-origin rule for absent Origin, foreign Origin and non-JSON POST", async () => {
    const f = fixture();
    const deps = { ...f.deps, assertSameOrigin: assertAdminConsoleSameOrigin };
    const invalid = [
      new Request(ENDPOINT_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(keys) }),
      new Request(ENDPOINT_URL, { method: "POST", headers: { origin: "https://evil.example.test",
        "content-type": "application/json" }, body: JSON.stringify(keys) }),
      new Request(ENDPOINT_URL, { method: "POST", headers: { origin: "https://trader.example.test",
        "content-type": "text/plain" }, body: JSON.stringify(keys) }),
    ];
    for (const candidate of invalid) {
      expect((await handleOrg0ReadOnlyConnectPost(candidate, deps)).status).toBe(403);
    }
    expect(f.calls.venue).not.toHaveBeenCalled();
    expect(f.calls.store).not.toHaveBeenCalled();
  });

  it("stops a chunked body at the byte limit without collecting or validating the key", async () => {
    const f = fixture();
    let cancelled = false;
    let index = 0;
    const chunks = [new TextEncoder().encode('{"apiKey":"'), new Uint8Array(5000).fill(65)];
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { if (index < chunks.length) controller.enqueue(chunks[index++]!); },
      cancel() { cancelled = true; },
    });
    const candidate = new Request(ENDPOINT_URL, { method: "POST", headers: {
      origin: "https://trader.example.test", "content-type": "application/json",
    }, body, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(candidate.headers.get("content-length")).toBeNull();
    expect((await handleOrg0ReadOnlyConnectPost(candidate, f.deps)).status).toBe(400);
    expect(cancelled).toBe(true);
    expect(f.calls.venue).not.toHaveBeenCalled();
  });

  it("refuses when server Org0 configuration changes after fresh venue validation", async () => {
    const f = fixture();
    let reads = 0;
    const deps = { ...f.deps, resolveOrg0: () => ++reads === 1 ? ORG0 : "00000000-0000-4000-8000-000000001199" };
    expect((await handleOrg0ReadOnlyConnectPost(request(keys), deps)).status).toBe(403);
    expect(f.calls.venue).toHaveBeenCalledOnce();
    expect(f.calls.store).not.toHaveBeenCalled();
  });
});
