import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  OrgLiveTradingNotPermittedError,
  createSqliteOrgLiveEnableService,
} from "@/lib/trader/live";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000212e";
const USER_B = "00000000-0000-4000-8000-0000000212f";

describe("trader live tenant isolation (DEE-212 / BP-7)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-live-tenant-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "live-tenant.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();
    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "live-tenant-a@example.com",
      password: "password123",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "live-tenant-b@example.com",
      password: "password123",
    });
    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Tenant A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Tenant B" });
    process.env.WAIA_TRADER_ORG0_ORGANIZATION_ID = orgA;
  });

  it("org B cannot read org A live-enable state", async () => {
    const db = getDb();
    const service = createSqliteOrgLiveEnableService(db);
    await service.requestEnable({ actorType: "admin", actorId: "op" }, requireOrgContext(orgA), {
      maxNotionalCap: "10",
    });

    const orgBState = await service.getState(requireOrgContext(orgB));
    expect(orgBState).toBeNull();
  });

  it("org B is denied Org-0 live path when allowlist is org A only", async () => {
    const { isOrg0Organization } = await import("@/lib/trader/live/org0-allowlist");
    expect(isOrg0Organization(orgA)).toBe(true);
    expect(isOrg0Organization(orgB)).toBe(false);

    const { OrgLiveTradingNotPermittedError: Err } = await import("@/lib/trader/live/errors");
    expect(new Err(orgB)).toBeInstanceOf(OrgLiveTradingNotPermittedError);
  });
});
