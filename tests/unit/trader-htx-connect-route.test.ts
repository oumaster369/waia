import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { POST as connectRoutePost } from "@/app/api/trader/exchange-credentials/connect/route";
import {
  DELETE as exchangeCredentialDelete,
  isCredentialMutationSameOrigin,
} from "@/app/api/trader/exchange-credentials/[credentialId]/route";
import { GET as exchangeCredentialsGet } from "@/app/api/trader/exchange-credentials/route";
import { getDb } from "@/db/client";
import { auditLogs, organizationEntitlements } from "@/db/schema";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaDb } from "@/db/types";
import * as sessionUser from "@/lib/auth/session-user";
import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";
import { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import {
  handleExchangeCredentialsGet,
  handleExchangeCredentialDelete,
  handleHtxConnectPost,
  type ConnectHandlerDeps,
} from "@/lib/trader/credentials/connect-handler";
import { HTX_CONNECT_ERROR_CODES } from "@/lib/trader/credentials/connect-api.types";
import {
  createPostgresCredentialService,
  createSqliteCredentialService,
} from "@/lib/trader/credentials/credential-service";
import { DevMasterKeyProvider } from "@/lib/trader/security/dev-master-key-provider";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { traderAuditActions } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_WITH_TRADER = "00000000-0000-4000-8000-00000000e236";
const USER_NO_TRADER = "00000000-0000-4000-8000-00000000f236";

const VALID_CREDS = {
  apiKey: "test-access-key",
  apiSecret: "test-secret-key",
};

const SPOT_ACCOUNT_ID = 100009;

function randomMasterKeyBase64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockFetch(handlers: Record<string, (url: URL) => Response | Promise<Response>>) {
  const sortedPatterns = Object.keys(handlers).sort((a, b) => b.length - a.length);
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    for (const pattern of sortedPatterns) {
      if (url.pathname.includes(pattern) || url.pathname === pattern) {
        return handlers[pattern]!(url);
      }
    }
    throw new Error(`Unhandled HTX mock fetch: ${url.toString()}`);
  }) as unknown as typeof fetch;
}

function defaultHtxHandlers(overrides: Record<string, (url: URL) => Response> = {}) {
  const base: Record<string, (url: URL) => Response> = {
    "/v1/account/accounts": () =>
      jsonResponse({
        status: "ok",
        data: [{ id: SPOT_ACCOUNT_ID, type: "spot", state: "working" }],
      }),
    "/v2/user/uid": () => jsonResponse({ code: 200, data: 63628520 }),
    "/v2/user/api-key": () =>
      jsonResponse({
        code: 200,
        data: [
          {
            accessKey: VALID_CREDS.apiKey,
            permission: "readOnly",
            status: "normal",
          },
        ],
      }),
  };
  return createMockFetch({ ...base, ...overrides });
}

function grantTraderEntitlementSqlite(db: WaiaDb, userId: string): void {
  const organizationId = personalOrganizationIdFromUserId(userId);
  ensureUserCoreSeedSqlite(db, { userId, displayName: "Trader User" });
  db.insert(organizationEntitlements)
    .values({
      id: crypto.randomUUID(),
      organizationId,
      entitlementKey: "trader",
      enabled: true,
      sourceModule: "trader",
    })
    .run();
}

function connectPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/trader/exchange-credentials/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("HTX connect API (DEE-236)", () => {
  let masterKeyBase64: string;

  beforeAll(() => {
    masterKeyBase64 = randomMasterKeyBase64();
    process.env.AI_TRADER_MASTER_KEY_DEV = masterKeyBase64;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-htx-connect-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "htx-connect.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_WITH_TRADER,
      email: "htx-trader@waia.invalid",
      password: "password123",
      identityLabel: "HTX Trader",
    });
    insertEmailPasswordUser(db, {
      id: USER_NO_TRADER,
      email: "htx-no-trader@waia.invalid",
      password: "password123",
      identityLabel: "No Trader",
    });

    ensureUserCoreSeedSqlite(db, { userId: USER_NO_TRADER, displayName: "No Trader" });
    grantTraderEntitlementSqlite(db, USER_WITH_TRADER);
  });

  async function createReadyProvider() {
    return createMasterKeyProvider({
      injectSecretGetter: async () => masterKeyBase64,
      productionReady: true,
    });
  }

  function createDeps(overrides: Partial<ConnectHandlerDeps> = {}): ConnectHandlerDeps {
    const mockFetch = overrides.createConnector ? undefined : defaultHtxHandlers();

    return {
      getUserId: async () => USER_WITH_TRADER,
      hasTraderAccess: async (userId) => {
        const db = getDb();
        const orgId = personalOrganizationIdFromUserId(userId);
        const row = db
          .select()
          .from(organizationEntitlements)
          .where(eq(organizationEntitlements.organizationId, orgId))
          .all()
          .find((entry) => entry.entitlementKey === "trader");
        return row?.enabled === true;
      },
      getRuntimeDb: getWaiaRuntimeDb,
      disposeRuntimeDb: disposeWaiaRuntimeDb,
      createProvider: () => createReadyProvider(),
      createConnector: (config) =>
        new HtxExchangeConnector({
          ...config,
          restHost: HTX_DEFAULT_REST_HOST,
          fetchImpl: mockFetch!,
        }),
      createCredentialService: (runtime, createProvider) => {
        if (runtime.kind === "sqlite") {
          return createSqliteCredentialService(runtime.db, { createProvider });
        }
        return createPostgresCredentialService(runtime.db, { createProvider });
      },
      ...overrides,
    };
  }

  it("returns 401 when session is missing (handler)", async () => {
    const result = await handleHtxConnectPost(
      connectPostRequest({ venue: "htx", ...VALID_CREDS }),
      createDeps({ getUserId: async () => null }),
    );
    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      error: { code: HTX_CONNECT_ERROR_CODES.UNAUTHORIZED, message: "Session required." },
    });
  });

  it("returns 401 when session is missing (route)", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const response = await connectRoutePost(connectPostRequest({ venue: "htx", ...VALID_CREDS }));
    expect(response.status).toBe(401);
  });

  it("returns 403 when trader entitlement is missing", async () => {
    const result = await handleHtxConnectPost(
      connectPostRequest({ venue: "htx", ...VALID_CREDS }),
      createDeps({ getUserId: async () => USER_NO_TRADER }),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: { code: HTX_CONNECT_ERROR_CODES.FORBIDDEN, message: "Trader entitlement required." },
    });
  });

  it("returns 400 for malformed JSON body", async () => {
    const result = await handleHtxConnectPost(
      new Request("http://localhost/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
      createDeps(),
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_CONNECT_ERROR_CODES.INVALID_BODY,
    );
  });

  it("returns 400 for unsupported venue", async () => {
    const result = await handleHtxConnectPost(
      connectPostRequest({ venue: "binance", ...VALID_CREDS }),
      createDeps(),
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_CONNECT_ERROR_CODES.UNSUPPORTED_VENUE,
    );
  });

  it("returns 400 for empty apiKey", async () => {
    const result = await handleHtxConnectPost(
      connectPostRequest({ venue: "htx", apiKey: "  ", apiSecret: "secret" }),
      createDeps(),
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_CONNECT_ERROR_CODES.INVALID_CREDENTIALS,
    );
  });

  it("returns 503 when master key is not production-ready without HTX fetch", async () => {
    const mockFetch = defaultHtxHandlers();
    const result = await handleHtxConnectPost(
      connectPostRequest({ venue: "htx", ...VALID_CREDS }),
      createDeps({
        createProvider: async () => DevMasterKeyProvider.create(),
        createConnector: (config) =>
          new HtxExchangeConnector({
            ...config,
            restHost: HTX_DEFAULT_REST_HOST,
            fetchImpl: mockFetch,
          }),
      }),
    );
    expect(result.status).toBe(503);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_CONNECT_ERROR_CODES.MASTER_KEY_NOT_READY,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when HTX validation fails", async () => {
    const mockFetch = defaultHtxHandlers({
      "/v1/account/accounts": () =>
        jsonResponse({
          status: "ok",
          data: [{ id: SPOT_ACCOUNT_ID, type: "margin", state: "working" }],
        }),
    });

    const result = await handleHtxConnectPost(
      connectPostRequest({ venue: "htx", ...VALID_CREDS }),
      createDeps({
        createConnector: (config) =>
          new HtxExchangeConnector({
            ...config,
            restHost: HTX_DEFAULT_REST_HOST,
            fetchImpl: mockFetch,
          }),
      }),
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_CONNECT_ERROR_CODES.CREDENTIAL_VALIDATION_FAILED,
    );
  });

  it("stores credentials and returns metadata only on success", async () => {
    const result = await handleHtxConnectPost(
      connectPostRequest({
        venue: "htx",
        ...VALID_CREDS,
        accountLabel: "Primary HTX",
      }),
      createDeps(),
    );

    expect(result.status).toBe(200);
    const body = result.body as Record<string, unknown>;
    expect(body.id).toBeTruthy();
    expect(body.venue).toBe("htx");
    expect(body.exchangeAccountId).toBe(String(SPOT_ACCOUNT_ID));
    expect(body.apiKeyMasked).toBe("test…-key");
    expect(body.status).toBe("active");
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("apiSecret");
    expect(JSON.stringify(body)).not.toContain(VALID_CREDS.apiSecret);

    const db = getDb();
    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.credentialCreated))
      .all();
    expect(audits.some((row) => row.entityId === body.id)).toBe(true);
  });

  it("replaces existing credentials and emits rotated audit", async () => {
    const deps = createDeps();
    const listed = await handleExchangeCredentialsGet(deps);
    const active = (listed.body as { credentials: Array<{ id: string; status: string }> })
      .credentials.find((row) => row.status === "active");
    expect(active).toBeDefined();

    const second = await handleHtxConnectPost(
      connectPostRequest({
        venue: "htx",
        apiKey: "replacement-key",
        apiSecret: "replacement-secret",
        replacementCredentialId: active!.id,
      }),
      createDeps({
        createConnector: (config) =>
          new HtxExchangeConnector({
            ...config,
            restHost: HTX_DEFAULT_REST_HOST,
            fetchImpl: defaultHtxHandlers({
              "/v2/user/api-key": () =>
                jsonResponse({
                  code: 200,
                  data: [
                    {
                      accessKey: "replacement-key",
                      permission: "readOnly",
                      status: "normal",
                    },
                  ],
                }),
            }),
          }),
      }),
    );

    expect(second.status).toBe(200);

    const db = getDb();
    const rotated = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.credentialRotated))
      .all();
    expect(rotated.length).toBeGreaterThan(0);
  });

  it("fails closed when a replacement uses a stale credential id", async () => {
    const result = await handleHtxConnectPost(
      connectPostRequest({
        venue: "htx",
        ...VALID_CREDS,
        replacementCredentialId: "stale-session-credential-id",
      }),
      createDeps(),
    );
    expect(result.status).toBe(409);
    expect(JSON.stringify(result.body)).not.toContain(VALID_CREDS.apiKey);
    expect(JSON.stringify(result.body)).not.toContain(VALID_CREDS.apiSecret);
  });

  it("rejects destructive disconnect with missing or foreign Origin", async () => {
    const context = { params: Promise.resolve({ credentialId: crypto.randomUUID() }) };
    for (const request of [
      new Request("https://trader.waia.life/api/trader/exchange-credentials/example", {
        method: "DELETE",
      }),
      new Request("https://trader.waia.life/api/trader/exchange-credentials/example", {
        method: "DELETE",
        headers: { Origin: "https://foreign.example" },
      }),
    ]) {
      const response = await exchangeCredentialDelete(request, context);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: {
          code: HTX_CONNECT_ERROR_CODES.CSRF_INVALID,
          message: "Request origin is not allowed.",
        },
      });
    }
  });

  it("accepts the direct request origin and configured trusted-proxy origin", () => {
    expect(
      isCredentialMutationSameOrigin(
        new Request("https://trader.waia.life/api/trader/exchange-credentials/example", {
          method: "DELETE",
          headers: { Origin: "https://trader.waia.life" },
        }),
      ),
    ).toBe(true);
    expect(
      isCredentialMutationSameOrigin(
        new Request("http://internal-worker/api/trader/exchange-credentials/example", {
          method: "DELETE",
          headers: { Origin: "http://trader.localhost:3000" },
        }),
      ),
    ).toBe(true);
  });

  it("disconnect replay is idempotent, emits one audit and does not disclose secrets", async () => {
    const listed = await handleExchangeCredentialsGet(createDeps());
    const active = (listed.body as { credentials: Array<{ id: string; status: string }> })
      .credentials.find((row) => row.status === "active");
    expect(active).toBeDefined();

    const first = await handleExchangeCredentialDelete(active!.id, createDeps());
    const second = await handleExchangeCredentialDelete(active!.id, createDeps());
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toMatchObject({ id: active!.id, status: "revoked" });
    expect(second.body).toMatchObject({ id: active!.id, status: "revoked" });
    expect(JSON.stringify([first.body, second.body])).not.toContain(VALID_CREDS.apiSecret);
    const revokeAudits = getDb()
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, active!.id))
      .all()
      .filter((row) => row.action === traderAuditActions.credentialRevoked);
    expect(revokeAudits).toHaveLength(1);
  });

  it("disconnect fails closed for an unknown or cross-tenant credential id", async () => {
    const result = await handleExchangeCredentialDelete(crypto.randomUUID(), createDeps());
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: { code: HTX_CONNECT_ERROR_CODES.CREDENTIAL_NOT_FOUND, message: "Credential not found." },
    });
  });

  it("GET lists credential metadata for entitled user", async () => {
    const listResult = await handleExchangeCredentialsGet(createDeps());
    expect(listResult.status).toBe(200);

    const body = listResult.body as { credentials: Array<Record<string, unknown>> };
    expect(body.credentials.length).toBeGreaterThan(0);
    for (const row of body.credentials) {
      expect(row).not.toHaveProperty("apiSecret");
      expect(row).not.toHaveProperty("encryptedPayload");
      expect(JSON.stringify(row)).not.toContain(VALID_CREDS.apiSecret);
    }
  });

  it("GET route returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const response = await exchangeCredentialsGet();
    expect(response.status).toBe(401);
  });
});
