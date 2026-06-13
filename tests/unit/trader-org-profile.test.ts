import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { traderOrgProfiles } from "@/db/schema";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { ensureTraderOrgProfileSqlite } from "@/lib/trader/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_ID = "00000000-0000-4000-8000-00000000d193";

describe("trader org profile provisioning (DEE-193)", () => {
  let organizationId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-org-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "org.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_ID,
      email: "trader-org@waia.invalid",
      password: "password123",
      identityLabel: "Trader Org User",
    });
    organizationId = ensureUserCoreSeedSqlite(db, {
      userId: USER_ID,
      displayName: "Trader Org User",
    });
  });

  it("creates one trader_org_profiles row on first ensure", () => {
    const db = getDb();
    const first = ensureTraderOrgProfileSqlite(db, { organizationId });
    expect(first.created).toBe(true);
    expect(first.profileId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );

    const rows = db
      .select({ id: traderOrgProfiles.id })
      .from(traderOrgProfiles)
      .where(eq(traderOrgProfiles.organizationId, organizationId))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("is idempotent on re-run", () => {
    const db = getDb();
    const second = ensureTraderOrgProfileSqlite(db, { organizationId });
    expect(second.created).toBe(false);

    const rows = db
      .select({ id: traderOrgProfiles.id })
      .from(traderOrgProfiles)
      .where(eq(traderOrgProfiles.organizationId, organizationId))
      .all();
    expect(rows).toHaveLength(1);
    expect(second.profileId).toBe(rows[0]?.id);
  });
});
