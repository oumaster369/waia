import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { organizationEntitlements } from "@/db/schema";
import { checkEntitlementSqlite } from "@/lib/waia-core/entitlements/resolve";
import { hasModuleEntitlementSqlite } from "@/lib/waia-core/entitlements/authoritative";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import type { WaiaDb } from "@/db/types";

const USER_NO_TRADER = "00000000-0000-4000-8000-00000000d0a1";
const USER_WITH_TRADER = "00000000-0000-4000-8000-00000000d0a2";

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

describe("authoritative module entitlement (AT-E1 S1)", () => {
  let db: WaiaDb;
  let orgNoTrader: string;
  let orgWithTrader: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-ent-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "ent.sqlite")}`;
    migrateDatabaseFromEnv();
    db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_NO_TRADER,
      email: "no-trader@waia.invalid",
      password: "password123",
      identityLabel: "No Trader",
    });
    insertEmailPasswordUser(db, {
      id: USER_WITH_TRADER,
      email: "with-trader@waia.invalid",
      password: "password123",
      identityLabel: "With Trader",
    });

    orgNoTrader = ensureUserCoreSeedSqlite(db, {
      userId: USER_NO_TRADER,
      displayName: "No Trader",
    });
    grantTraderEntitlementSqlite(db, USER_WITH_TRADER);
    orgWithTrader = personalOrganizationIdFromUserId(USER_WITH_TRADER);
  });

  afterEach(() => {
    delete process.env.WAIA_CORE_ENFORCEMENT;
    delete process.env.WAIA_CORE_SHADOW;
  });

  it("denies trader entitlement when only twin baseline is provisioned", () => {
    expect(
      hasModuleEntitlementSqlite(db, { organizationId: orgNoTrader, entitlementKey: "trader" }),
    ).toBe(false);
  });

  it("allows when trader entitlement row is enabled", () => {
    expect(
      hasModuleEntitlementSqlite(db, { organizationId: orgWithTrader, entitlementKey: "trader" }),
    ).toBe(true);
  });

  it("denies when trader entitlement exists but is disabled", () => {
    db.update(organizationEntitlements)
      .set({ enabled: false })
      .where(
        and(
          eq(organizationEntitlements.organizationId, orgWithTrader),
          eq(organizationEntitlements.entitlementKey, "trader"),
        ),
      )
      .run();

    expect(
      hasModuleEntitlementSqlite(db, { organizationId: orgWithTrader, entitlementKey: "trader" }),
    ).toBe(false);
  });

  it("authoritative check denies without trader even when WAIA_CORE_ENFORCEMENT=0", () => {
    process.env.WAIA_CORE_ENFORCEMENT = "0";
    process.env.WAIA_CORE_SHADOW = "1";

    expect(
      hasModuleEntitlementSqlite(db, { organizationId: orgNoTrader, entitlementKey: "trader" }),
    ).toBe(false);

    const shadow = checkEntitlementSqlite(db, {
      organizationId: orgNoTrader,
      entitlementKey: "trader",
      actorUserId: USER_NO_TRADER,
    });
    expect(shadow.allowed).toBe(true);
  });

  it("hasTraderAccessForUser mirrors authoritative entitlement for personal org", async () => {
    process.env.WAIA_CORE_ENFORCEMENT = "0";

    await expect(hasTraderAccessForUser(USER_NO_TRADER)).resolves.toBe(false);

    db.update(organizationEntitlements)
      .set({ enabled: true })
      .where(
        and(
          eq(organizationEntitlements.organizationId, orgWithTrader),
          eq(organizationEntitlements.entitlementKey, "trader"),
        ),
      )
      .run();

    await expect(hasTraderAccessForUser(USER_WITH_TRADER)).resolves.toBe(true);
  });
});
