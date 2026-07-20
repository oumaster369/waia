import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { getLimitsRowForScopeSqlite } from "@/lib/trader/risk/limits/repository-sqlite";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a239";
const USER_B = "00000000-0000-4000-8000-00000000b239";

describe("trader risk limits tenant isolation (DEE-239 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-risk-limits-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "risk-limits-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "risk-limits-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Risk Limits Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "risk-limits-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Risk Limits Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Risk Limits Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Risk Limits Org B" });

    const service = createSqliteRiskLimitsService(db);
    await service.getOrCreateLimitsForOrg(requireOrgContext(orgA));
  });

  it("org B cannot read org A limits via service", async () => {
    const db = getDb();
    const service = createSqliteRiskLimitsService(db);

    await expect(service.getLimitsForOrg(requireOrgContext(orgB))).resolves.toBeNull();
  });

  it("org B upsert creates its own limits without mutating org A", async () => {
    const db = getDb();
    const service = createSqliteRiskLimitsService(db);

    const orgBLimits = await service.upsertLimitsForOrg(requireOrgContext(orgB), {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxNotional: "5000",
    });
    const orgALimits = await service.getLimitsForOrg(requireOrgContext(orgA));

    expect(orgBLimits.maxNotional).toBe("5000");
    expect(orgALimits?.maxNotional).toBe("10000");
  });

  it("repository cross-org scoped get returns null", () => {
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
    expect(crossOrgRead?.organizationId).toBe(orgB);
    expect(crossOrgRead?.id).not.toBe(orgARow!.id);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });

  it("M2 portfolio limit columns remain org-scoped", async () => {
    const db = getDb();
    const service = createSqliteRiskLimitsService(db);

    await service.upsertLimitsForOrg(requireOrgContext(orgA), {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxRiskPerTradePct: "0.02",
      maxPortfolioRiskPct: "0.10",
      maxConcurrentPositions: 5,
    });
    const orgBLimits = await service.upsertLimitsForOrg(requireOrgContext(orgB), {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxRiskPerTradePct: "0.005",
      maxPortfolioRiskPct: "0.02",
      maxConcurrentPositions: 1,
    });
    const orgALimits = await service.getLimitsForOrg(requireOrgContext(orgA));

    expect(orgBLimits.maxRiskPerTradePct).toBe("0.005");
    expect(orgBLimits.maxPortfolioRiskPct).toBe("0.02");
    expect(orgBLimits.maxConcurrentPositions).toBe(1);
    expect(orgALimits?.maxRiskPerTradePct).toBe("0.02");
    expect(orgALimits?.maxPortfolioRiskPct).toBe("0.1");
    expect(orgALimits?.maxConcurrentPositions).toBe(5);
  });
});
