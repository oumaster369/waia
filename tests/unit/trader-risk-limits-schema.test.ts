import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import {
  getLimitsRowForScopeSqlite,
  insertLimitsRowForScopeSqlite,
} from "@/lib/trader/risk/limits/repository-sqlite";
import { normalizeAndValidateRiskLimitsInput } from "@/lib/trader/risk/limits/validate-limits";
import { normalizedConfigToRowInput } from "@/lib/trader/risk/limits/types";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a239";
const USER_B = "00000000-0000-4000-8000-00000000b239";

describe("trader_risk_limits schema + repository (DEE-239)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-risk-limits-schema-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "risk-limits-schema.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "risk-limits-schema-a@waia.invalid",
      password: "password123",
      identityLabel: "Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "risk-limits-schema-b@waia.invalid",
      password: "password123",
      identityLabel: "Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Org B" });
  });

  it("persists org-scoped limits with empty-string scope_ref sentinel", () => {
    const db = getDb();
    const normalized = normalizeAndValidateRiskLimitsInput(DEFAULT_ORG_RISK_LIMITS);
    const row = insertLimitsRowForScopeSqlite(
      db,
      requireOrgContext(orgA),
      { scopeType: "organization", scopeRef: null },
      normalizedConfigToRowInput(normalized, 1),
    );

    expect(row.organizationId).toBe(orgA);
    expect(row.scopeType).toBe("organization");
    expect(row.scopeRef).toBe("");
    expect(row.configVersion).toBe(1);
  });

  it("returns null for cross-org scoped read", () => {
    const db = getDb();
    const orgARow = getLimitsRowForScopeSqlite(db, requireOrgContext(orgA), {
      scopeType: "organization",
      scopeRef: null,
    });
    expect(orgARow).not.toBeNull();

    const crossOrgRead = getLimitsRowForScopeSqlite(db, requireOrgContext(orgB), {
      scopeType: "organization",
      scopeRef: null,
    });
    expect(crossOrgRead).toBeNull();
  });

  it("requires organization context", () => {
    expect(() => requireOrgContext(undefined)).toThrow(OrgScopeError);
  });
});
