import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { exchangeCredentials } from "@/db/schema";
import type { WaiaDb } from "@/db/types";
import { insertCredentialRowSqlite } from "@/lib/trader/credentials/repository-sqlite";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000d191a";
const USER_B = "00000000-0000-4000-8000-00000000d191b";

/** Simulates an unsafe unscoped read — must never be used in production code. */
function unscopedCredentialIds(db: WaiaDb): string[] {
  return db
    .select({ id: exchangeCredentials.id })
    .from(exchangeCredentials)
    .all()
    .map((r) => r.id);
}

/** Correct org-scoped read for comparison. */
function scopedCredentialIds(db: WaiaDb, organizationId: string): string[] {
  const context = requireOrgContext(organizationId);
  return db
    .select({ id: exchangeCredentials.id })
    .from(exchangeCredentials)
    .where(orgScopedWhere(exchangeCredentials.organizationId, context))
    .all()
    .map((r) => r.id);
}

describe("tenant isolation deliberate leak probe (DEE-191 / WC-E6)", () => {
  let orgA: string;
  let orgB: string;
  let credentialAId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-iso-leak-probe-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "leak.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "leak-a@waia.invalid",
      password: "password123",
      identityLabel: "Leak A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "leak-b@waia.invalid",
      password: "password123",
      identityLabel: "Leak B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Leak A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Leak B" });

    const row = insertCredentialRowSqlite(
      db,
      { organizationId: orgA },
      {
        venue: "htx",
        exchangeAccountId: "acct-a",
        apiKeyMasked: "****",
        encryptedPayload: "cipher",
      },
    );
    credentialAId = row.id;
  });

  it("unscoped read would leak cross-org data (anti-pattern demonstration)", () => {
    const db = getDb();
    const leaked = unscopedCredentialIds(db);
    expect(leaked).toContain(credentialAId);
    expect(leaked.length).toBeGreaterThanOrEqual(1);
  });

  it("org-scoped read prevents cross-org leak (release gate contract)", () => {
    const db = getDb();
    const scopedB = scopedCredentialIds(db, orgB);
    expect(scopedB).not.toContain(credentialAId);
    expect(scopedB).toHaveLength(0);

    const scopedA = scopedCredentialIds(db, orgA);
    expect(scopedA).toEqual([credentialAId]);
  });

  it("deliberate wrong-org scope returns empty — simulates blocked leak", () => {
    const db = getDb();
    const wrongScope = scopedCredentialIds(db, orgB);
    const allIds = unscopedCredentialIds(db);
    expect(allIds.length).toBeGreaterThan(wrongScope.length);
  });
});
