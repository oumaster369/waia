import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { POST as syncTradesRoutePost } from "@/app/api/trader/exchange-credentials/[credentialId]/sync-trades/route";
import { GET as tradeHistorySnapshotsGet } from "@/app/api/trader/trade-history-snapshots/route";
import { getDb } from "@/db/client";
import { auditLogs, organizationEntitlements } from "@/db/schema";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaDb } from "@/db/types";
import * as sessionUser from "@/lib/auth/session-user";
import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";
import { HtxExchangeConnector } from "@/lib/trader/connectors/htx/htx-exchange-connector";
import {
  handleTradeHistorySnapshotsGet,
  handleTradeHistorySyncPost,
  type TradeHistorySyncHandlerDeps,
} from "@/lib/trader/trade-history/sync-handler";
import { HTX_TRADE_HISTORY_SYNC_ERROR_CODES } from "@/lib/trader/trade-history/sync-api.types";
import {
  createPostgresTradeHistorySnapshotService,
  createSqliteTradeHistorySnapshotService,
} from "@/lib/trader/trade-history/trade-history-snapshot-service";
import {
  createPostgresCredentialService,
  createSqliteCredentialService,
} from "@/lib/trader/credentials/credential-service";
import { handleHtxConnectPost } from "@/lib/trader/credentials/connect-handler";
import { CredentialDecryptError } from "@/lib/trader/credentials/errors";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { MasterKeyNotReadyError } from "@/lib/trader/security/errors";
import { traderAuditActions } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

vi.mock("@/lib/auth/session-user", () => ({
  getOptionalSessionUserId: vi.fn(),
}));

const USER_WITH_TRADER = "00000000-0000-4000-8000-000000003503";
const USER_NO_TRADER = "00000000-0000-4000-8000-000000003504";
const SYNC_SYMBOL = "BTC/USDT";

const VALID_CREDS = {
  apiKey: "test-access-key",
  apiSecret: "test-secret-key",
};

const SPOT_ACCOUNT_ID = 100351;

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
    "/v1/order/matchresults": () =>
      jsonResponse({
        status: "ok",
        data: [
          {
            id: 1,
            symbol: "btcusdt",
            "order-id": 9001,
            "trade-id": 8001,
            price: "50000",
            "created-at": Date.now(),
            type: "buy-market",
            "filled-amount": "0.01",
            "filled-fees": "0.00001",
            "fee-currency": "btc",
          },
        ],
      }),
    [`/accounts/${SPOT_ACCOUNT_ID}/balance`]: () =>
      jsonResponse({
        status: "ok",
        data: {
          id: SPOT_ACCOUNT_ID,
          type: "spot",
          state: "working",
          list: [{ currency: "btc", type: "trade", balance: "1.5" }],
        },
      }),
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

function syncTradesPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/trader/exchange-credentials/sync-trades", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("HTX trade history sync API (DEE-350)", () => {
  let masterKeyBase64: string;
  let credentialId: string;

  beforeAll(async () => {
    masterKeyBase64 = randomMasterKeyBase64();
    process.env.AI_TRADER_MASTER_KEY_DEV = masterKeyBase64;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-htx-trade-sync-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "htx-trade-sync.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_WITH_TRADER,
      email: "htx-trade-trader@waia.invalid",
      password: "password123",
      identityLabel: "HTX Trade Trader",
    });
    insertEmailPasswordUser(db, {
      id: USER_NO_TRADER,
      email: "htx-trade-no-trader@waia.invalid",
      password: "password123",
      identityLabel: "No Trader",
    });

    ensureUserCoreSeedSqlite(db, { userId: USER_NO_TRADER, displayName: "No Trader" });
    grantTraderEntitlementSqlite(db, USER_WITH_TRADER);

    const connectDeps = createDeps();
    const connectResult = await handleHtxConnectPost(
      connectPostRequest({ venue: "htx", ...VALID_CREDS }),
      connectDeps,
    );
    expect(connectResult.status).toBe(200);
    credentialId = (connectResult.body as { id: string }).id;
  });

  async function createReadyProvider() {
    return createMasterKeyProvider({
      injectSecretGetter: async () => masterKeyBase64,
      productionReady: true,
    });
  }

  function createDeps(
    overrides: Partial<TradeHistorySyncHandlerDeps> = {},
  ): TradeHistorySyncHandlerDeps {
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
      createTradeHistorySnapshotService: (runtime) => {
        if (runtime.kind === "sqlite") {
          return createSqliteTradeHistorySnapshotService(runtime.db);
        }
        return createPostgresTradeHistorySnapshotService(runtime.db);
      },
      ...overrides,
    };
  }

  it("returns 401 when session is missing (handler)", async () => {
    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps({ getUserId: async () => null }),
    );
    expect(result.status).toBe(401);
    expect(result.body).toEqual({
      error: {
        code: HTX_TRADE_HISTORY_SYNC_ERROR_CODES.UNAUTHORIZED,
        message: "Session required.",
      },
    });
  });

  it("returns 401 when session is missing (route)", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const response = await syncTradesRoutePost(syncTradesPostRequest({ symbol: SYNC_SYMBOL }), {
      params: Promise.resolve({ credentialId }),
    });
    expect(response.status).toBe(401);
  });

  it("returns 403 when trader entitlement is missing", async () => {
    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps({ getUserId: async () => USER_NO_TRADER }),
    );
    expect(result.status).toBe(403);
    expect(result.body).toEqual({
      error: {
        code: HTX_TRADE_HISTORY_SYNC_ERROR_CODES.FORBIDDEN,
        message: "Trader entitlement required.",
      },
    });
  });

  it("returns 400 when symbol is missing", async () => {
    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({}),
      createDeps(),
    );
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_TRADE_HISTORY_SYNC_ERROR_CODES.INVALID_SYMBOL,
    );
  });

  it("returns 404 for unknown credential", async () => {
    const result = await handleTradeHistorySyncPost(
      "00000000-0000-4000-8000-000000009999",
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps(),
    );
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_TRADE_HISTORY_SYNC_ERROR_CODES.CREDENTIAL_NOT_FOUND,
    );
  });

  it("returns 503 MASTER_KEY_NOT_READY without HTX fetch", async () => {
    const mockFetch = defaultHtxHandlers();
    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps({
        createCredentialService: (runtime) => {
          const base =
            runtime.kind === "sqlite"
              ? createSqliteCredentialService(runtime.db, {
                  createProvider: () => createReadyProvider(),
                })
              : createPostgresCredentialService(runtime.db, {
                  createProvider: () => createReadyProvider(),
                });
          return {
            ...base,
            async getDecryptedCredentials(context, id) {
              void context;
              void id;
              throw new MasterKeyNotReadyError();
            },
          };
        },
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
      HTX_TRADE_HISTORY_SYNC_ERROR_CODES.MASTER_KEY_NOT_READY,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 503 DECRYPT_UNAVAILABLE without HTX fetch", async () => {
    const mockFetch = defaultHtxHandlers();
    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps({
        createCredentialService: (runtime) => {
          const base =
            runtime.kind === "sqlite"
              ? createSqliteCredentialService(runtime.db, {
                  createProvider: () => createReadyProvider(),
                })
              : createPostgresCredentialService(runtime.db, {
                  createProvider: () => createReadyProvider(),
                });
          return {
            ...base,
            async getDecryptedCredentials(context, id) {
              void context;
              void id;
              throw new CredentialDecryptError();
            },
          };
        },
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
      HTX_TRADE_HISTORY_SYNC_ERROR_CODES.DECRYPT_UNAVAILABLE,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 502 when HTX validation fails", async () => {
    const mockFetch = defaultHtxHandlers({
      "/v1/account/accounts": () =>
        jsonResponse({
          status: "ok",
          data: [{ id: SPOT_ACCOUNT_ID, type: "margin", state: "working" }],
        }),
    });

    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps({
        createConnector: (config) =>
          new HtxExchangeConnector({
            ...config,
            restHost: HTX_DEFAULT_REST_HOST,
            fetchImpl: mockFetch,
          }),
      }),
    );
    expect(result.status).toBe(502);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_TRADE_HISTORY_SYNC_ERROR_CODES.TRADE_HISTORY_SYNC_VALIDATION_FAILED,
    );
  });

  it("returns 502 when HTX trade history fetch fails", async () => {
    const mockFetch = defaultHtxHandlers({
      "/v1/order/matchresults": () => jsonResponse({ status: "error", "err-code": "fail" }, 500),
    });

    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps({
        createConnector: (config) =>
          new HtxExchangeConnector({
            ...config,
            restHost: HTX_DEFAULT_REST_HOST,
            fetchImpl: mockFetch,
          }),
      }),
    );
    expect(result.status).toBe(502);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_TRADE_HISTORY_SYNC_ERROR_CODES.TRADE_HISTORY_FETCH_FAILED,
    );
  });

  it("syncs trade history and returns snapshot without secrets", async () => {
    const result = await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps(),
    );
    expect(result.status).toBe(200);

    const body = result.body as Record<string, unknown>;
    expect(body.id).toBeTruthy();
    expect(body.credentialId).toBe(credentialId);
    expect(body.venue).toBe("htx");
    expect(body.symbol).toBe(SYNC_SYMBOL);
    expect(body.tradeCount).toBe(1);
    expect(Array.isArray(body.trades)).toBe(true);
    expect(body).not.toHaveProperty("apiKey");
    expect(body).not.toHaveProperty("apiSecret");
    expect(body).not.toHaveProperty("encryptedPayload");
    expect(JSON.stringify(body)).not.toContain(VALID_CREDS.apiSecret);

    const db = getDb();
    const audits = db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, traderAuditActions.tradeHistorySnapshotCreated))
      .all();
    expect(audits.some((row) => row.entityId === body.id)).toBe(true);
  });

  it("GET lists snapshots latest-first with symbol filter", async () => {
    await handleTradeHistorySyncPost(
      credentialId,
      syncTradesPostRequest({ symbol: SYNC_SYMBOL }),
      createDeps(),
    );

    const listResult = await handleTradeHistorySnapshotsGet(
      new Request(
        `http://localhost/api/trader/trade-history-snapshots?credentialId=${credentialId}&symbol=${encodeURIComponent(SYNC_SYMBOL)}&limit=5`,
      ),
      createDeps(),
    );
    expect(listResult.status).toBe(200);

    const body = listResult.body as { snapshots: Array<Record<string, unknown>> };
    expect(body.snapshots.length).toBeGreaterThan(0);
    expect(body.snapshots.length).toBeLessThanOrEqual(5);
    for (const row of body.snapshots) {
      expect(row.credentialId).toBe(credentialId);
      expect(row.symbol).toBe(SYNC_SYMBOL);
      expect(row).not.toHaveProperty("apiSecret");
      expect(JSON.stringify(row)).not.toContain(VALID_CREDS.apiSecret);
    }

    if (body.snapshots.length >= 2) {
      const first = new Date(String(body.snapshots[0]!.syncedAt)).getTime();
      const second = new Date(String(body.snapshots[1]!.syncedAt)).getTime();
      expect(first).toBeGreaterThanOrEqual(second);
    }
  });

  it("GET route returns 401 without session", async () => {
    vi.mocked(sessionUser.getOptionalSessionUserId).mockResolvedValue(null);
    const response = await tradeHistorySnapshotsGet(
      new Request("http://localhost/api/trader/trade-history-snapshots"),
    );
    expect(response.status).toBe(401);
  });
});
