import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { createSqliteMiSourceProvenanceService } from "@/lib/trader/mi/source-provenance-service";
import { OrgScopeError, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-00000000a279a";
const USER_B = "00000000-0000-4000-8000-00000000b279b";

describe("trader mi source provenance tenant isolation (DEE-279 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-mi-source-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "mi-source-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "mi-source-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "MI Source Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "mi-source-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "MI Source Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "MI Source Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "MI Source Org B" });
  });

  it("org B cannot read org A sources via service", async () => {
    const db = getDb();
    const serviceA = createSqliteMiSourceProvenanceService(db);
    const serviceB = createSqliteMiSourceProvenanceService(db);

    const source = await serviceA.createSource(
      { organizationId: orgA },
      { venue: "htx", feedKind: "spot_ohlcv", symbol: "BTCUSDT" },
    );

    const orgBList = await serviceB.listSources({ organizationId: orgB });
    expect(orgBList.some((row) => row.id === source.id)).toBe(false);

    const crossRead = await serviceB.getCurrentTrust({ organizationId: orgB }, source.id);
    expect(crossRead).toBeNull();
  });

  it("org B cannot append trust to org A source", async () => {
    const db = getDb();
    const serviceA = createSqliteMiSourceProvenanceService(db);
    const serviceB = createSqliteMiSourceProvenanceService(db);

    const source = await serviceA.createSource(
      { organizationId: orgA },
      { venue: "htx", feedKind: "spot_ohlcv", symbol: "ETHUSDT" },
    );

    await expect(
      serviceB.appendTrustRevision(
        { organizationId: orgB },
        {
          sourceId: source.id,
          trustScore: "0.5",
          rationale: "cross-org attempt",
          recordedBy: USER_B,
          eventTime: new Date("2026-06-22T10:00:00.000Z"),
          ingestTime: new Date("2026-06-22T10:00:01.000Z"),
        },
      ),
    ).rejects.toThrow();
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
