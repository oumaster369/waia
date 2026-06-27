import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLogs, userPlatformRoles } from "@/db/schema";
import {
  KillSwitchAuthorizationError,
  KillSwitchConcurrencyError,
  KillSwitchCoolingOffNotElapsedError,
  createSqliteKillSwitchService,
} from "@/lib/trader/risk/kill-switch";
import { traderAuditActions } from "@/lib/trader/types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000243c";
const ADMIN_USER = "00000000-0000-4000-8000-0000000243d";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };
const OWNER_ACTOR = (userId: string) => ({ actorType: "user" as const, actorId: userId });

const ORG_KEY = {
  scopeType: "organization" as const,
  scopeRef: null,
  switchType: "EMERGENCY_STOP" as const,
};

describe("kill switch service (DEE-243)", () => {
  let orgA: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-kill-switch-service-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "kill-switch-service.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "kill-switch-service-a@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Service Org A",
    });
    insertEmailPasswordUser(db, {
      id: ADMIN_USER,
      email: "kill-switch-service-admin@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Admin",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Kill Switch Service Org A",
    });

    ensureUserCoreSeedSqlite(db, {
      userId: ADMIN_USER,
      displayName: "Kill Switch Admin",
    });

    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_USER))
      .run();
  });

  it("trips org switch, increments state_version, and writes audit", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);

    const result = await service.trip(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      { scopeType: "organization", organizationId: orgA },
      ORG_KEY,
      { enforcementMode: "REJECT", origin: "manual", reason: "manual trip" },
    );

    expect(result.row.state).toBe("ACTIVE");
    expect(result.row.stateVersion).toBe(1);
    expect(result.previousState).toBeNull();

    const audit = db.select().from(auditLogs).where(eq(auditLogs.id, result.auditId)).all()[0];

    expect(audit?.action).toBe(traderAuditActions.killSwitchTripped);
    expect(audit?.organizationId).toBe(orgA);
  });

  it("escalates ACTIVE switch and preserves created_at", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);
    const target = { scopeType: "organization" as const, organizationId: orgA };
    const key = { ...ORG_KEY, switchType: "PAUSE" as const };

    const tripped = await service.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
      enforcementMode: "REJECT",
      origin: "manual",
    });

    const escalated = await service.escalate(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
      enforcementMode: "STOP_ACCOUNT",
      expectedStateVersion: tripped.row.stateVersion,
    });

    expect(escalated.row.stateVersion).toBe(2);
    expect(escalated.row.enforcementMode).toBe("STOP_ACCOUNT");
    expect(escalated.row.createdAt.getTime()).toBe(tripped.row.createdAt.getTime());
    expect(escalated.row.updatedAt.getTime()).toBeGreaterThanOrEqual(
      tripped.row.updatedAt.getTime(),
    );
  });

  it("runs clear lifecycle and rejects stale expectedStateVersion", async () => {
    const db = getDb();
    let now = Date.now();
    const service = createSqliteKillSwitchService(db, { nowMs: () => now });
    const target = { scopeType: "organization" as const, organizationId: orgA };
    const key = { ...ORG_KEY, switchType: "CLOSE_ONLY" as const };

    const tripped = await service.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
      enforcementMode: "CLOSE_ONLY",
      origin: "manual",
    });

    const clearing = await service.beginClear(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
      expectedStateVersion: tripped.row.stateVersion,
      coolingOffMs: 1_000,
    });
    expect(clearing.row.state).toBe("CLEARING");

    const cancelled = await service.cancelClear(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      target,
      key,
      {
        expectedStateVersion: clearing.row.stateVersion,
      },
    );
    expect(cancelled.row.state).toBe("ACTIVE");

    const clearingAgain = await service.beginClear(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      target,
      key,
      {
        expectedStateVersion: cancelled.row.stateVersion,
        coolingOffMs: 1_000,
      },
    );
    expect(clearingAgain.row.state).toBe("CLEARING");

    await expect(
      service.finalizeClear(OWNER_ACTOR(USER_A), requireOrgContext(orgA), target, key, {
        expectedStateVersion: clearingAgain.row.stateVersion,
      }),
    ).rejects.toThrow(KillSwitchCoolingOffNotElapsedError);

    now += 1_000;

    const cleared = await service.finalizeClear(
      OWNER_ACTOR(USER_A),
      requireOrgContext(orgA),
      target,
      key,
      {
        expectedStateVersion: clearingAgain.row.stateVersion,
      },
    );
    expect(cleared.row.state).toBe("INACTIVE");

    await expect(
      service.finalizeClear(OWNER_ACTOR(USER_A), requireOrgContext(orgA), target, key, {
        expectedStateVersion: tripped.row.stateVersion,
      }),
    ).rejects.toThrow(KillSwitchConcurrencyError);
  });

  it("rejects service actor on finalizeClear", async () => {
    const db = getDb();
    let now = Date.now();
    const service = createSqliteKillSwitchService(db, { nowMs: () => now });
    const target = { scopeType: "organization" as const, organizationId: orgA };
    const key = { ...ORG_KEY, switchType: "DATA_QUALITY" as const };

    const tripped = await service.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
      enforcementMode: "REJECT",
      origin: "manual",
    });
    const clearing = await service.beginClear(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
      expectedStateVersion: tripped.row.stateVersion,
      coolingOffMs: 1,
    });
    now += 1;

    await expect(
      service.finalizeClear(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        expectedStateVersion: clearing.row.stateVersion,
      }),
    ).rejects.toThrow(KillSwitchAuthorizationError);
  });

  it("allows admin human actor for platform scope and writes null org audit", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);
    const key = {
      scopeType: "platform" as const,
      scopeRef: null,
      switchType: "EMERGENCY_STOP" as const,
    };

    const result = await service.trip(
      { actorType: "admin", actorId: ADMIN_USER },
      null,
      { scopeType: "platform" },
      key,
      { enforcementMode: "STOP_ACCOUNT", origin: "manual", reason: "platform halt" },
    );

    const audit = db.select().from(auditLogs).where(eq(auditLogs.id, result.auditId)).all()[0];

    expect(audit?.organizationId).toBeNull();
  });

  it("rejects org owner for platform scope writes", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);

    await expect(
      service.trip(
        { actorType: "user", actorId: USER_A },
        null,
        { scopeType: "platform" },
        {
          scopeType: "platform",
          scopeRef: null,
          switchType: "PAUSE",
        },
        { enforcementMode: "REJECT", origin: "manual" },
      ),
    ).rejects.toThrow(KillSwitchAuthorizationError);
  });

  it("getEffectiveState delegates to resolver", async () => {
    const db = getDb();
    const service = createSqliteKillSwitchService(db);
    const effective = await service.getEffectiveState(requireOrgContext(orgA));
    expect(effective.blocked).toBe(true);
  });
});
