import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { OrgScopeError } from "@/lib/waia-core/scope/org-context";
import {
  getTraderOrgProfileSqlite,
  insertTraderOrgProfileSqlite,
} from "@/lib/trader/persistence/org-profile";
import { ensureTraderOrgProfileSqlite } from "@/lib/trader/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000d1a1";
const USER_B = "00000000-0000-4000-8000-00000000d1b1";

describe("trader tenant isolation gate (DEE-193 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let profileAId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-trader-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "iso.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "trader-a@waia.invalid",
      password: "password123",
      identityLabel: "Trader A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "trader-b@waia.invalid",
      password: "password123",
      identityLabel: "Trader B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Trader A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Trader B" });

    const ensured = ensureTraderOrgProfileSqlite(db, { organizationId: orgA });
    profileAId = ensured.profileId;
  });

  it("org-scoped read returns profile only for owning organization", () => {
    const db = getDb();
    expect(getTraderOrgProfileSqlite(db, { organizationId: orgA })?.id).toBe(profileAId);
    expect(getTraderOrgProfileSqlite(db, { organizationId: orgB })).toBeNull();
  });

  it("rejects unscoped org context", () => {
    const db = getDb();
    expect(() => getTraderOrgProfileSqlite(db, { organizationId: "" })).toThrow(OrgScopeError);
  });

  it("cannot read org B profile when querying with org A scope", () => {
    const db = getDb();
    insertTraderOrgProfileSqlite(db, orgB);
    const scopedToA = getTraderOrgProfileSqlite(db, { organizationId: orgA });
    const scopedToB = getTraderOrgProfileSqlite(db, { organizationId: orgB });
    expect(scopedToA?.organizationId).toBe(orgA);
    expect(scopedToB?.organizationId).toBe(orgB);
    expect(scopedToA?.id).not.toBe(scopedToB?.id);
  });
});
