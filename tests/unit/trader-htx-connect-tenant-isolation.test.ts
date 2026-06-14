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
  handleExchangeCredentialsGet,
  handleHtxConnectPost,
  type ConnectHandlerDeps,
} from "@/lib/trader/credentials/connect-handler";
import {
  createPostgresCredentialService,
  createSqliteCredentialService,
} from "@/lib/trader/credentials/credential-service";
import { createMasterKeyProvider } from "@/lib/trader/security/create-master-key-provider";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a236";
const USER_B = "00000000-0000-4000-8000-00000000b236";

const VALID_CREDS_A = {
  apiKey: "user-a-access-key",
  apiSecret: "user-a-secret-key",
};

const SPOT_ACCOUNT_ID = 200009;

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

describe("HTX connect API tenant isolation (DEE-236)", () => {
  let masterKeyBase64: string;
  let credentialId: string;

  beforeAll(async () => {
    masterKeyBase64 = randomMasterKeyBase64();

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-htx-connect-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "htx-connect-iso.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "htx-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "HTX Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "htx-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "HTX Org B",
    });

    grantTraderEntitlementSqlite(db, USER_A);
    grantTraderEntitlementSqlite(db, USER_B);

    const deps = createDepsForUser(USER_A);
    const result = await handleHtxConnectPost(
      new Request("http://localhost/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue: "htx", ...VALID_CREDS_A }),
      }),
      deps,
    );

    expect(result.status).toBe(200);
    credentialId = (result.body as { id: string }).id;
  });

  function createDepsForUser(userId: string): ConnectHandlerDeps {
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
    };
  }

  it("user B GET list does not include user A credentials", async () => {
    const result = await handleExchangeCredentialsGet(createDepsForUser(USER_B));
    expect(result.status).toBe(200);

    const body = result.body as { credentials: Array<{ id: string }> };
    expect(body.credentials.find((row) => row.id === credentialId)).toBeUndefined();
  });

  it("user A GET list includes their credential metadata only", async () => {
    const result = await handleExchangeCredentialsGet(createDepsForUser(USER_A));
    expect(result.status).toBe(200);

    const body = result.body as { credentials: Array<{ id: string; apiKeyMasked: string | null }> };
    const row = body.credentials.find((entry) => entry.id === credentialId);
    expect(row).toBeDefined();
    expect(row?.apiKeyMasked).toBe("user…-key");
    expect(JSON.stringify(body)).not.toContain(VALID_CREDS_A.apiSecret);
  });
});
