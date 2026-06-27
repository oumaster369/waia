import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { organizationEntitlements } from "@/db/schema";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import type { WaiaDb } from "@/db/types";
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
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a351";
const USER_B = "00000000-0000-4000-8000-00000000b351";
const SYNC_SYMBOL = "BTC/USDT";

const VALID_CREDS_A = {
  apiKey: "user-a-access-key",
  apiSecret: "user-a-secret-key",
};

const SPOT_ACCOUNT_ID = 200351;

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

function createMockFetch() {
  return async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    if (url.pathname.includes("/v1/order/matchresults")) {
      return jsonResponse({
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
      });
    }
    if (url.pathname.includes("/balance")) {
      return jsonResponse({
        status: "ok",
        data: {
          id: SPOT_ACCOUNT_ID,
          type: "spot",
          state: "working",
          list: [{ currency: "btc", type: "trade", balance: "0.5" }],
        },
      });
    }
    if (url.pathname.includes("/v1/account/accounts")) {
      return jsonResponse({
        status: "ok",
        data: [{ id: SPOT_ACCOUNT_ID, type: "spot", state: "working" }],
      });
    }
    if (url.pathname.includes("/v2/user/uid")) {
      return jsonResponse({ code: 200, data: 63628520 });
    }
    if (url.pathname.includes("/v2/user/api-key")) {
      return jsonResponse({
        code: 200,
        data: [
          {
            accessKey: VALID_CREDS_A.apiKey,
            permission: "readOnly",
            status: "normal",
          },
        ],
      });
    }
    throw new Error(`Unhandled HTX mock fetch: ${url.toString()}`);
  };
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

describe("HTX trade history sync tenant isolation (DEE-350)", () => {
  let masterKeyBase64: string;
  let credentialId: string;

  beforeAll(async () => {
    masterKeyBase64 = randomMasterKeyBase64();
    process.env.AI_TRADER_MASTER_KEY_DEV = masterKeyBase64;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-htx-trade-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "htx-trade-iso.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "htx-trade-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "HTX Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "htx-trade-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "HTX Org B",
    });

    grantTraderEntitlementSqlite(db, USER_A);
    grantTraderEntitlementSqlite(db, USER_B);

    const connectResult = await handleHtxConnectPost(
      new Request("http://localhost/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue: "htx", ...VALID_CREDS_A }),
      }),
      createDepsForUser(USER_A),
    );
    expect(connectResult.status).toBe(200);
    credentialId = (connectResult.body as { id: string }).id;

    const syncResult = await handleTradeHistorySyncPost(
      credentialId,
      new Request("http://localhost/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: SYNC_SYMBOL }),
      }),
      createDepsForUser(USER_A),
    );
    expect(syncResult.status).toBe(200);
  });

  function createDepsForUser(userId: string): TradeHistorySyncHandlerDeps {
    const mockFetch = createMockFetch();
    return {
      getUserId: async () => userId,
      hasTraderAccess: async () => true,
      getRuntimeDb: getWaiaRuntimeDb,
      disposeRuntimeDb: disposeWaiaRuntimeDb,
      createProvider: () =>
        createMasterKeyProvider({
          injectSecretGetter: async () => masterKeyBase64,
          productionReady: true,
        }),
      createConnector: (config) =>
        new HtxExchangeConnector({
          ...config,
          restHost: HTX_DEFAULT_REST_HOST,
          fetchImpl: mockFetch,
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
    };
  }

  it("user B GET list does not include user A snapshots", async () => {
    const result = await handleTradeHistorySnapshotsGet(
      new Request("http://localhost/api/trader/trade-history-snapshots"),
      createDepsForUser(USER_B),
    );
    expect(result.status).toBe(200);

    const body = result.body as { snapshots: Array<{ credentialId: string }> };
    expect(body.snapshots.find((row) => row.credentialId === credentialId)).toBeUndefined();
  });

  it("user A GET list includes their snapshots only", async () => {
    const result = await handleTradeHistorySnapshotsGet(
      new Request(
        `http://localhost/api/trader/trade-history-snapshots?credentialId=${credentialId}&symbol=${encodeURIComponent(SYNC_SYMBOL)}`,
      ),
      createDepsForUser(USER_A),
    );
    expect(result.status).toBe(200);

    const body = result.body as {
      snapshots: Array<{ credentialId: string; symbol: string; trades: unknown[] }>;
    };
    expect(body.snapshots.length).toBeGreaterThan(0);
    expect(body.snapshots.every((row) => row.credentialId === credentialId)).toBe(true);
    expect(body.snapshots.every((row) => row.symbol === SYNC_SYMBOL)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(VALID_CREDS_A.apiSecret);
  });

  it("user B cannot sync user A credential", async () => {
    const result = await handleTradeHistorySyncPost(
      credentialId,
      new Request("http://localhost/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: SYNC_SYMBOL }),
      }),
      createDepsForUser(USER_B),
    );
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe(
      HTX_TRADE_HISTORY_SYNC_ERROR_CODES.CREDENTIAL_NOT_FOUND,
    );
  });
});
