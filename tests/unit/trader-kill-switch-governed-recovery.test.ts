import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLogs, organizationMembers, userPlatformRoles } from "@/db/schema";
import {
  DEFAULT_RECOVERY_COOLING_OFF_MS,
  KillSwitchAuthorizationError,
  KillSwitchConcurrencyError,
  KillSwitchValidationError,
  buildRecoveryPreview,
  createAutomaticTriggerDispatcher,
  createSqliteGovernedRecoveryService,
  createSqliteKillSwitchService,
  effectiveCoolingOffMs,
  type KillSwitchType,
} from "@/lib/trader/risk/kill-switch";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_OWNER = "00000000-0000-4000-8000-0000000246a";
const USER_MEMBER = "00000000-0000-4000-8000-0000000246b";
const USER_OTHER = "00000000-0000-4000-8000-0000000246c";
const ADMIN_USER = "00000000-0000-4000-8000-0000000246d";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };

const OWNER_ACTOR = { actorType: "user" as const, actorId: USER_OWNER };
const MEMBER_ACTOR = { actorType: "user" as const, actorId: USER_MEMBER };
const ADMIN_ACTOR = { actorType: "admin" as const, actorId: ADMIN_USER };

function orgTarget(organizationId: string) {
  return { scopeType: "organization" as const, organizationId };
}

function orgKey(switchType: KillSwitchType = "EMERGENCY_STOP") {
  return { scopeType: "organization" as const, scopeRef: null, switchType };
}

describe("kill switch governed recovery (DEE-246)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-kill-switch-recovery-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "kill-switch-recovery.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    for (const [id, email, label] of [
      [USER_OWNER, "recovery-owner@waia.invalid", "Recovery Owner"],
      [USER_MEMBER, "recovery-member@waia.invalid", "Recovery Member"],
      [USER_OTHER, "recovery-other@waia.invalid", "Recovery Other Org"],
      [ADMIN_USER, "recovery-admin@waia.invalid", "Recovery Admin"],
    ] as const) {
      insertEmailPasswordUser(db, {
        id,
        email,
        password: "password123",
        identityLabel: label,
      });
    }

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_OWNER, displayName: "Recovery Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_OTHER, displayName: "Recovery Org B" });

    db.insert(organizationMembers)
      .values({
        id: randomUUID(),
        organizationId: orgA,
        userId: USER_MEMBER,
        memberRole: "member",
        createdAt: new Date(),
      })
      .run();

    ensureUserCoreSeedSqlite(db, { userId: ADMIN_USER, displayName: "Recovery Admin Org" });
    db.update(userPlatformRoles)
      .set({ role: "admin" })
      .where(eq(userPlatformRoles.userId, ADMIN_USER))
      .run();
  });

  describe("cooling-off policy helpers", () => {
    it("falls back to DEFAULT_RECOVERY_COOLING_OFF_MS when unset", () => {
      expect(effectiveCoolingOffMs(null)).toBe(DEFAULT_RECOVERY_COOLING_OFF_MS);
      expect(effectiveCoolingOffMs(undefined)).toBe(DEFAULT_RECOVERY_COOLING_OFF_MS);
    });

    it("uses explicit override when provided", () => {
      expect(effectiveCoolingOffMs(5_000)).toBe(5_000);
    });
  });

  describe("requestClear validation", () => {
    it("rejects invalid coolingOffMs overrides", async () => {
      const db = getDb();
      const now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const target = orgTarget(orgA);
      const key = orgKey("CONTROL_PLANE_LOSS");

      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });

      for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await expect(
          recovery.requestClear(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
            expectedStateVersion: tripped.row.stateVersion,
            coolingOffMs: invalid as number,
          }),
        ).rejects.toThrow(KillSwitchValidationError);
      }
    });
  });

  describe("governed recovery workflow", () => {
    it("requestClear -> previewRecovery -> confirmClear with owner actor", async () => {
      const db = getDb();
      let now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const target = orgTarget(orgA);
      const key = orgKey("CLOSE_ONLY");

      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "CLOSE_ONLY",
        origin: "manual",
        reason: "recovery flow",
      });

      const clearing = await recovery.requestClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: tripped.row.stateVersion, coolingOffMs: 2_000 },
      );
      expect(clearing.row.state).toBe("CLEARING");

      const previewBefore = await recovery.previewRecovery(requireOrgContext(orgA), target, key);
      expect(previewBefore.state).toBe("CLEARING");
      expect(previewBefore.coolingOffMs).toBe(2_000);
      expect(previewBefore.confirmable).toBe(false);
      expect(previewBefore.remainingMs).toBeGreaterThan(0);
      expect(previewBefore.stateVersion).toBe(clearing.row.stateVersion);

      now += 2_000;

      const previewAfter = await recovery.previewRecovery(requireOrgContext(orgA), target, key);
      expect(previewAfter.confirmable).toBe(true);
      expect(previewAfter.remainingMs).toBe(0);

      const cleared = await recovery.confirmClear(
        OWNER_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: previewAfter.stateVersion },
      );
      expect(cleared.row.state).toBe("INACTIVE");

      const audit = db.select().from(auditLogs).where(eq(auditLogs.id, cleared.auditId)).all()[0];
      expect(audit?.action).toBe(traderAuditActions.killSwitchCleared);
      const metadata = JSON.parse(audit?.metadataJson ?? "{}") as Record<string, unknown>;
      expect(metadata.coolingOffMs).toBe(2_000);
      expect(metadata.eligibleAt).toBeTruthy();
      expect(metadata.confirmedAt).toBeTruthy();
      expect(metadata.recoveryActor).toEqual(OWNER_ACTOR);
    });

    it("cancelClear reverses CLEARING to ACTIVE", async () => {
      const db = getDb();
      const now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const target = orgTarget(orgA);
      const key = orgKey("STALE_STATE");

      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });
      const clearing = await recovery.requestClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: tripped.row.stateVersion, coolingOffMs: 5_000 },
      );

      const cancelled = await recovery.cancelClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: clearing.row.stateVersion },
      );
      expect(cancelled.row.state).toBe("ACTIVE");
    });

    it("uses default cooling-off when override omitted", async () => {
      const db = getDb();
      const now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const target = orgTarget(orgA);
      const key = orgKey("EMERGENCY_STOP");

      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });
      await recovery.requestClear(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        expectedStateVersion: tripped.row.stateVersion,
      });

      const preview = await recovery.previewRecovery(requireOrgContext(orgA), target, key);
      expect(preview.coolingOffMs).toBe(DEFAULT_RECOVERY_COOLING_OFF_MS);
    });
  });

  describe("human-accountable confirm gate", () => {
    it("rejects non-owner org member on confirmClear", async () => {
      const db = getDb();
      let now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const target = orgTarget(orgA);
      const key = orgKey("DATA_QUALITY");

      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });
      const clearing = await recovery.requestClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: tripped.row.stateVersion, coolingOffMs: 1 },
      );
      now += 1;

      await expect(
        recovery.confirmClear(MEMBER_ACTOR, requireOrgContext(orgA), target, key, {
          expectedStateVersion: clearing.row.stateVersion,
        }),
      ).rejects.toThrow(KillSwitchAuthorizationError);
    });

    it("rejects service/system/agent actors on confirmClear", async () => {
      const db = getDb();
      let now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const target = orgTarget(orgA);
      const key = orgKey("PAUSE");

      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });
      const clearing = await recovery.requestClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: tripped.row.stateVersion, coolingOffMs: 1 },
      );
      now += 1;

      await expect(
        recovery.confirmClear(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
          expectedStateVersion: clearing.row.stateVersion,
        }),
      ).rejects.toThrow(KillSwitchAuthorizationError);

      await expect(
        recovery.confirmClear(
          { actorType: "agent", actorId: USER_OWNER },
          requireOrgContext(orgA),
          target,
          key,
          { expectedStateVersion: clearing.row.stateVersion },
        ),
      ).rejects.toThrow(KillSwitchAuthorizationError);
    });

    it("allows platform admin human on platform-scope confirmClear", async () => {
      const db = getDb();
      let now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const target = { scopeType: "platform" as const };
      const key = { scopeType: "platform" as const, scopeRef: null, switchType: "PAUSE" as const };

      const tripped = await killSwitch.trip(ADMIN_ACTOR, null, target, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });
      const clearing = await recovery.requestClear(ADMIN_ACTOR, null, target, key, {
        expectedStateVersion: tripped.row.stateVersion,
        coolingOffMs: 1,
      });
      now += 1;

      const cleared = await recovery.confirmClear(ADMIN_ACTOR, null, target, key, {
        expectedStateVersion: clearing.row.stateVersion,
      });
      expect(cleared.row.state).toBe("INACTIVE");
    });
  });

  describe("review -> confirm binding", () => {
    it("rejects confirm when expectedStateVersion does not match preview", async () => {
      const db = getDb();
      let now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const target = orgTarget(orgA);
      const key = orgKey("RECON_MISMATCH");

      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });
      await recovery.requestClear(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        expectedStateVersion: tripped.row.stateVersion,
        coolingOffMs: 1,
      });
      now += 1;

      const preview = await recovery.previewRecovery(requireOrgContext(orgA), target, key);
      await expect(
        recovery.confirmClear(OWNER_ACTOR, requireOrgContext(orgA), target, key, {
          expectedStateVersion: preview.stateVersion - 1,
        }),
      ).rejects.toThrow(KillSwitchConcurrencyError);
    });
  });

  describe("automatic re-trip aborts recovery", () => {
    it("bumps stateVersion and blocks stale confirm after re-trip during CLEARING", async () => {
      const db = getDb();
      let now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const dispatcher = createAutomaticTriggerDispatcher({
        killSwitchService: killSwitch,
        actor: SERVICE_ACTOR,
      });
      const target = orgTarget(orgA);
      const key = {
        scopeType: "organization" as const,
        scopeRef: null,
        switchType: "RECON_MISMATCH" as const,
      };

      await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "STOP_ACCOUNT",
        origin: "manual",
      });

      const row = await killSwitch.get(requireOrgContext(orgA), target, key);
      expect(row).not.toBeNull();
      const clearing = await recovery.requestClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: row!.stateVersion, coolingOffMs: 1 },
      );
      expect(clearing.row.state).toBe("CLEARING");
      now += 1;

      const previewBeforeRetrip = await recovery.previewRecovery(
        requireOrgContext(orgA),
        target,
        key,
      );
      expect(previewBeforeRetrip.confirmable).toBe(true);

      await dispatcher.activate({ category: "mismatch", target });

      await expect(
        recovery.confirmClear(OWNER_ACTOR, requireOrgContext(orgA), target, key, {
          expectedStateVersion: previewBeforeRetrip.stateVersion,
        }),
      ).rejects.toThrow(KillSwitchConcurrencyError);

      const afterRetrip = await killSwitch.get(requireOrgContext(orgA), target, key);
      expect(afterRetrip?.state).toBe("ACTIVE");
    });
  });

  describe("tenant isolation", () => {
    it("org owner cannot confirm another org switch", async () => {
      const db = getDb();
      let now = Date.now();
      const recovery = createSqliteGovernedRecoveryService(db, { nowMs: () => now });
      const killSwitch = createSqliteKillSwitchService(db, { nowMs: () => now });
      const targetB = orgTarget(orgB);
      const key = orgKey("STALE_STATE");

      const tripped = await killSwitch.trip(SERVICE_ACTOR, requireOrgContext(orgB), targetB, key, {
        enforcementMode: "REJECT",
        origin: "manual",
      });
      const clearing = await recovery.requestClear(
        SERVICE_ACTOR,
        requireOrgContext(orgB),
        targetB,
        key,
        { expectedStateVersion: tripped.row.stateVersion, coolingOffMs: 1 },
      );
      now += 1;

      await expect(
        recovery.confirmClear(OWNER_ACTOR, requireOrgContext(orgA), targetB, key, {
          expectedStateVersion: clearing.row.stateVersion,
        }),
      ).rejects.toThrow(KillSwitchAuthorizationError);
    });
  });

  describe("buildRecoveryPreview", () => {
    it("is a pure single-switch view model without contributors", () => {
      const now = Date.now();
      const preview = buildRecoveryPreview(
        {
          id: "ks-1",
          organizationId: orgA,
          scopeType: "organization",
          scopeRef: null,
          switchType: "PAUSE",
          enforcementMode: "REJECT",
          state: "CLEARING",
          origin: "manual",
          reason: "test",
          clearingStartedAt: new Date(now - 500),
          coolingOffMs: 1_000,
          trippedAt: new Date(now - 5_000),
          clearedAt: null,
          stateVersion: 3,
          createdAt: new Date(now - 10_000),
          updatedAt: new Date(now - 500),
        },
        now,
      );

      expect(preview).toMatchObject({
        switchType: "PAUSE",
        scopeType: "organization",
        state: "CLEARING",
        coolingOffMs: 1_000,
        confirmable: false,
        stateVersion: 3,
      });
      expect(preview).not.toHaveProperty("contributors");
    });
  });
});
