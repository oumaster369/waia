import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  getCredentialRowByIdSqlite,
  insertCredentialRowSqlite,
  listCredentialRowsForOrgSqlite,
  revokeCredentialRowSqlite,
} from "@/lib/trader/credentials/repository-sqlite";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a233";
const USER_B = "00000000-0000-4000-8000-00000000b233";

describe("exchange_credentials schema + repository (DEE-233)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-ex-cred-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "exchange-credentials.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "ex-cred-a@waia.invalid",
      password: "password123",
      identityLabel: "Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "ex-cred-b@waia.invalid",
      password: "password123",
      identityLabel: "Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Org B" });
  });

  it("persists opaque ciphertext fields without interpretation", () => {
    const db = getDb();
    const row = insertCredentialRowSqlite(db, requireOrgContext(orgA), {
      venue: "htx",
      exchangeAccountId: "spot-123",
      apiKeyMasked: "abcd…wxyz",
      encryptedPayload: "opaque-ciphertext-placeholder",
      payloadKeyVersion: null,
      wrappedDekKeyVersion: "v1",
      wrappedDekKey: "opaque-wrapped-dek-placeholder",
      permissionMetadata: JSON.stringify({ read: true }),
    });

    expect(row.organizationId).toBe(orgA);
    expect(row.encryptedPayload).toBe("opaque-ciphertext-placeholder");
    expect(row.wrappedDekKey).toBe("opaque-wrapped-dek-placeholder");
    expect(row.status).toBe("active");
  });

  it("lists rows only for the requested organization", () => {
    const db = getDb();
    const orgARows = listCredentialRowsForOrgSqlite(db, requireOrgContext(orgA));
    const orgBRows = listCredentialRowsForOrgSqlite(db, requireOrgContext(orgB));

    expect(orgARows.length).toBeGreaterThan(0);
    expect(orgARows.every((row) => row.organizationId === orgA)).toBe(true);
    expect(orgBRows).toHaveLength(0);
  });

  it("denies cross-org read by credential id", () => {
    const db = getDb();
    const orgARow = listCredentialRowsForOrgSqlite(db, requireOrgContext(orgA))[0];
    expect(orgARow).toBeDefined();

    const crossOrgRead = getCredentialRowByIdSqlite(db, requireOrgContext(orgB), orgARow!.id);
    expect(crossOrgRead).toBeNull();
  });

  it("denies cross-org revoke", () => {
    const db = getDb();
    const orgARow = listCredentialRowsForOrgSqlite(db, requireOrgContext(orgA))[0];
    expect(orgARow).toBeDefined();

    const revoked = revokeCredentialRowSqlite(db, requireOrgContext(orgB), orgARow!.id);
    expect(revoked).toBeNull();

    const stillActive = getCredentialRowByIdSqlite(db, requireOrgContext(orgA), orgARow!.id);
    expect(stillActive?.status).toBe("active");
  });

  it("revokes within the same organization", () => {
    const db = getDb();
    const created = insertCredentialRowSqlite(db, requireOrgContext(orgB), {
      venue: "htx",
      exchangeAccountId: "spot-999",
      encryptedPayload: "placeholder-b",
    });

    const revoked = revokeCredentialRowSqlite(db, requireOrgContext(orgB), created.id);
    expect(revoked?.status).toBe("revoked");
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });

  it("rejects missing organization context on insert", () => {
    const db = getDb();
    expect(() =>
      insertCredentialRowSqlite(db, requireOrgContext(undefined), {
        venue: "htx",
        exchangeAccountId: "bad",
      }),
    ).toThrow(OrgScopeError);
  });
});
