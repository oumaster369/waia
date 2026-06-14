import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { traderKillSwitches } from "@/db/schema";
import {
  OrgScopeError,
  orgScopedWhere,
  requireOrgContext,
} from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000206a";
const USER_B = "00000000-0000-4000-8000-0000000206b";

function insertOrgKillSwitch(
  organizationId: string,
  switchType: "EMERGENCY_STOP" | "CLOSE_ONLY" = "EMERGENCY_STOP",
) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.insert(traderKillSwitches)
    .values({
      id,
      organizationId,
      scopeType: "organization",
      scopeRef: "",
      switchType,
      enforcementMode: "REJECT",
      state: "ACTIVE",
      origin: "manual",
    })
    .run();
  return id;
}

function getOrgKillSwitchForScope(
  organizationId: string,
  switchType: "EMERGENCY_STOP" | "CLOSE_ONLY",
) {
  const db = getDb();
  return db
    .select()
    .from(traderKillSwitches)
    .where(
      and(
        orgScopedWhere(traderKillSwitches.organizationId, requireOrgContext(organizationId)),
        eq(traderKillSwitches.scopeType, "organization"),
        eq(traderKillSwitches.scopeRef, ""),
        eq(traderKillSwitches.switchType, switchType),
      ),
    )
    .all()[0];
}

describe("trader kill switches tenant isolation (DEE-206A / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let orgASwitchId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-kill-switch-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "kill-switch-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "kill-switch-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "kill-switch-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Kill Switch Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Kill Switch Org B" });

    orgASwitchId = insertOrgKillSwitch(orgA);
  });

  it("org B cannot read org A kill switch via org-scoped query", () => {
    const orgARow = getOrgKillSwitchForScope(orgA, "EMERGENCY_STOP");
    expect(orgARow).toBeDefined();
    expect(orgARow?.id).toBe(orgASwitchId);

    const crossOrgRead = getOrgKillSwitchForScope(orgB, "EMERGENCY_STOP");
    expect(crossOrgRead).toBeUndefined();
  });

  it("org B cannot mutate org A kill switch via org-scoped update", () => {
    const db = getDb();
    db.update(traderKillSwitches)
      .set({ state: "INACTIVE", reason: "cross-org tamper attempt" })
      .where(
        and(
          eq(traderKillSwitches.id, orgASwitchId),
          orgScopedWhere(traderKillSwitches.organizationId, requireOrgContext(orgB)),
        ),
      )
      .run();

    const orgARow = getOrgKillSwitchForScope(orgA, "EMERGENCY_STOP");
    expect(orgARow?.state).toBe("ACTIVE");
    expect(orgARow?.reason).toBe("");
  });

  it("org B can insert its own org-scoped kill switch without affecting org A", () => {
    const orgBSwitchId = insertOrgKillSwitch(orgB, "CLOSE_ONLY");

    const orgARow = getOrgKillSwitchForScope(orgA, "EMERGENCY_STOP");
    const orgBRow = getOrgKillSwitchForScope(orgB, "CLOSE_ONLY");

    expect(orgARow?.id).toBe(orgASwitchId);
    expect(orgBRow?.id).toBe(orgBSwitchId);
    expect(orgBRow?.organizationId).toBe(orgB);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
