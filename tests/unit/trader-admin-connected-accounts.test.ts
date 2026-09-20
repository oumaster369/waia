import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { exchangeCredentials, organizations, userPlatformRoles } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { eq } from "drizzle-orm";
import type { AdminRouteHandlerDeps } from "@/lib/trader/admin-route-shared";
import { handleAdminConnectedAccountsGet } from "@/lib/trader/credentials/admin-connected-accounts-handler";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d901";
const ADMIN_ID = "00000000-0000-4000-8000-00000000d902";
const BUSINESS_ORG = "00000000-0000-4000-8000-00000000b901";
const ACTIVE_CREDENTIAL = "00000000-0000-4000-8000-00000000c901";
const BUSINESS_CREDENTIAL = "00000000-0000-4000-8000-00000000c902";
const REVOKED_CREDENTIAL = "00000000-0000-4000-8000-00000000c903";

function createDeps(getUserId: () => Promise<string | null>): AdminRouteHandlerDeps {
  return {
    getUserId,
    getRuntimeDb: getWaiaRuntimeDb,
    disposeRuntimeDb: disposeWaiaRuntimeDb,
  };
}

describe("admin connected HTX accounts", () => {
  let db: WaiaDb;
  let adminOrgId: string;
  let userOrgId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-connected-accounts-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "connected-accounts.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "connected-user@waia.invalid",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_ID,
      email: "connected-admin@waia.invalid",
      password: "password123",
    });
    userOrgId = ensureUserCoreSeedSqlite(db, { userId: USER_ID, displayName: "Route User" });
    ensureUserCoreSeedSqlite(db, { userId: ADMIN_ID, displayName: "Route Admin" });
    adminOrgId = personalOrganizationIdFromUserId(ADMIN_ID);
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_ID))
      .run();

    const now = new Date();
    db.insert(organizations)
      .values({
        id: BUSINESS_ORG,
        ownerUserId: ADMIN_ID,
        kind: "business",
        name: "Treasury business",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    db.insert(exchangeCredentials)
      .values([
        {
          id: ACTIVE_CREDENTIAL,
          organizationId: adminOrgId,
          venue: "htx",
          exchangeAccountId: "73750148",
          apiKeyMasked: "abc…xyz",
          encryptedPayload: "ciphertext-must-not-leak",
          payloadKeyVersion: "v1",
          wrappedDekKeyVersion: "v1",
          wrappedDekKey: "wrapped-dek-must-not-leak",
          permissionMetadata: null,
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
        {
          id: BUSINESS_CREDENTIAL,
          organizationId: BUSINESS_ORG,
          venue: "htx",
          exchangeAccountId: "biz-htx",
          apiKeyMasked: null,
          encryptedPayload: "ciphertext-must-not-leak",
          status: "active",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        },
        {
          id: REVOKED_CREDENTIAL,
          organizationId: userOrgId,
          venue: "htx",
          exchangeAccountId: "revoked-htx",
          apiKeyMasked: null,
          encryptedPayload: "ciphertext-must-not-leak",
          status: "revoked",
          createdAt: now,
          updatedAt: now,
          revokedAt: now,
        },
      ])
      .run();
  });

  it("returns 401 when unauthenticated", async () => {
    const result = await handleAdminConnectedAccountsGet(createDeps(async () => null));
    expect(result.status).toBe(401);
  });

  it("returns 403 for a non-admin", async () => {
    const result = await handleAdminConnectedAccountsGet(createDeps(async () => USER_ID));
    expect(result.status).toBe(403);
  });

  it("lists only personal-org active HTX cabinets and never returns ciphertext", async () => {
    const result = await handleAdminConnectedAccountsGet(createDeps(async () => ADMIN_ID));
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      accounts: [
        {
          organizationId: adminOrgId,
          accountName: "connected-admin's workspace",
          credentialId: ACTIVE_CREDENTIAL,
          exchangeAccountId: "73750148",
          venue: "htx",
          status: "active",
          updatedAt: expect.any(String),
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toMatch(/ciphertext|wrapped-dek|apiSecret/i);
  });
});
