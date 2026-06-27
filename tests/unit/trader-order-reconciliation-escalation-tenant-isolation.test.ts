import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { traderKillSwitches } from "@/db/schema";
import { emptyReconciliationCounts, processReconciliationEscalation } from "@/lib/trader/execution";
import { createSqliteAutomaticTriggerDispatcher } from "@/lib/trader/risk/kill-switch";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000251b";
const USER_B = "00000000-0000-4000-8000-0000000251c";
const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);

describe("trader order reconciliation escalation tenant isolation (DEE-251 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-recon-esc-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-recon-esc-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-recon-esc-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Esc Iso Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "order-recon-esc-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Order Recon Esc Iso Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Order Recon Esc Iso Org A",
    });
    orgB = ensureUserCoreSeedSqlite(db, {
      userId: USER_B,
      displayName: "Order Recon Esc Iso Org B",
    });
  });

  it("org B escalation context cannot trip org A kill switch from org A report", async () => {
    const db = getDb();
    const dispatcher = createSqliteAutomaticTriggerDispatcher(db);

    const report = {
      organizationId: orgA,
      runStartedAt: new Date(NOW),
      outcomes: [
        {
          clientOrderId: "iso-esc-client-a",
          classification: "NOT_FOUND_AT_VENUE" as const,
          recordedFills: [],
          markedReconciliationRequired: true,
        },
      ],
      counts: { ...emptyReconciliationCounts(), NOT_FOUND_AT_VENUE: 1 },
    };

    await expect(
      processReconciliationEscalation(requireOrgContext(orgB), report, dispatcher),
    ).rejects.toThrow(/org mismatch/i);

    const orgARow = db
      .select()
      .from(traderKillSwitches)
      .where(
        and(
          eq(traderKillSwitches.organizationId, orgA),
          eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
        ),
      )
      .all()[0];

    expect(orgARow?.state).not.toBe("ACTIVE");
  });

  it("org A escalation trips only org A switch", async () => {
    const db = getDb();
    const dispatcher = createSqliteAutomaticTriggerDispatcher(db);

    const report = {
      organizationId: orgA,
      runStartedAt: new Date(NOW),
      outcomes: [
        {
          clientOrderId: "iso-esc-client-a",
          classification: "NOT_FOUND_AT_VENUE" as const,
          recordedFills: [],
          markedReconciliationRequired: true,
        },
      ],
      counts: { ...emptyReconciliationCounts(), NOT_FOUND_AT_VENUE: 1 },
    };

    await processReconciliationEscalation(requireOrgContext(orgA), report, dispatcher);

    const orgARow = db
      .select()
      .from(traderKillSwitches)
      .where(
        and(
          eq(traderKillSwitches.organizationId, orgA),
          eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
        ),
      )
      .all()[0];
    expect(orgARow?.state).toBe("ACTIVE");

    const orgBRow = db
      .select()
      .from(traderKillSwitches)
      .where(
        and(
          eq(traderKillSwitches.organizationId, orgB),
          eq(traderKillSwitches.switchType, "RECON_MISMATCH"),
        ),
      )
      .all()[0];
    expect(orgBRow).toBeUndefined();
  });
});
