import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { auditLogs, traderKillSwitches } from "@/db/schema";
import {
  CANONICAL_AUTO_TRIGGER_REASONS,
  KILL_SWITCH_ALREADY_ACTIVE,
  KillSwitchAuthorizationError,
  KillSwitchConcurrencyError,
  createAutomaticTriggerDispatcher,
  createSqliteAutomaticTriggerDispatcher,
  createSqliteKillSwitchService,
  isAlreadyActiveError,
  triggerSignalToSwitchPlan,
  type KillSwitchTriggerSignal,
} from "@/lib/trader/risk/kill-switch";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000245a";
const USER_B = "00000000-0000-4000-8000-0000000245b";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };

function orgTarget(organizationId: string) {
  return { scopeType: "organization" as const, organizationId };
}

function countAuditRows(db: ReturnType<typeof getDb>): number {
  return db.select().from(auditLogs).all().length;
}

describe("kill switch automatic trigger (DEE-245)", () => {
  let orgA: string;
  let orgB: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-kill-switch-auto-trigger-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "kill-switch-auto-trigger.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "kill-switch-auto-a@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Auto Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "kill-switch-auto-b@waia.invalid",
      password: "password123",
      identityLabel: "Kill Switch Auto Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Kill Switch Auto Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Kill Switch Auto Org B" });
  });

  describe("triggerSignalToSwitchPlan", () => {
    it("maps each category to the correct switchType and default enforcement", () => {
      const org = orgTarget("org-1");
      const cases: Array<{
        signal: KillSwitchTriggerSignal;
        switchType: string;
        enforcementMode: string;
        reason: string;
      }> = [
        {
          signal: { category: "mismatch", target: org },
          switchType: "RECON_MISMATCH",
          enforcementMode: "STOP_ACCOUNT",
          reason: "auto:mismatch",
        },
        {
          signal: { category: "data_quality", target: org },
          switchType: "DATA_QUALITY",
          enforcementMode: "REJECT",
          reason: "auto:data_quality",
        },
        {
          signal: {
            category: "control_plane_loss",
            target: org,
          },
          switchType: "CONTROL_PLANE_LOSS",
          enforcementMode: "STOP_ACCOUNT",
          reason: "auto:control_plane_loss",
        },
        {
          signal: {
            category: "anomaly",
            anomalyType: "ABNORMAL_SLIPPAGE",
            target: org,
          },
          switchType: "ABNORMAL_SLIPPAGE",
          enforcementMode: "REJECT",
          reason: "auto:anomaly:ABNORMAL_SLIPPAGE",
        },
        {
          signal: {
            category: "anomaly",
            anomalyType: "UNKNOWN_POSITION",
            target: org,
          },
          switchType: "UNKNOWN_POSITION",
          enforcementMode: "STOP_ACCOUNT",
          reason: "auto:anomaly:UNKNOWN_POSITION",
        },
        {
          signal: {
            category: "anomaly",
            anomalyType: "STALE_STATE",
            target: org,
          },
          switchType: "STALE_STATE",
          enforcementMode: "CLOSE_ONLY",
          reason: "auto:anomaly:STALE_STATE",
        },
      ];

      for (const testCase of cases) {
        const plan = triggerSignalToSwitchPlan(testCase.signal);
        expect(plan.switchType).toBe(testCase.switchType);
        expect(plan.enforcementMode).toBe(testCase.enforcementMode);
        expect(plan.reason).toBe(testCase.reason);
        expect(plan.key).toEqual({
          scopeType: org.scopeType,
          scopeRef: null,
          switchType: testCase.switchType,
        });
      }
    });

    it("uses explicit enforcementMode override when provided", () => {
      const plan = triggerSignalToSwitchPlan({
        category: "mismatch",
        target: orgTarget("org-1"),
        enforcementMode: "CLOSE_ONLY",
      });
      expect(plan.enforcementMode).toBe("CLOSE_ONLY");
    });

    it("keeps detail out of canonical reason", () => {
      const plan = triggerSignalToSwitchPlan({
        category: "mismatch",
        target: orgTarget("org-1"),
        detail: "position delta exceeded threshold",
      });
      expect(plan.reason).toBe("auto:mismatch");
      expect(plan.reason).not.toContain("position delta");
      expect(CANONICAL_AUTO_TRIGGER_REASONS).toContain(plan.reason);
    });
  });

  describe("createAutomaticTriggerDispatcher", () => {
    it("exposes activate(signal) only and trips with origin automatic", async () => {
      const db = getDb();
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db);

      expect(typeof dispatcher.activate).toBe("function");
      expect(dispatcher.activate.length).toBe(1);

      const result = await dispatcher.activate({
        category: "mismatch",
        target: orgTarget(orgA),
      });

      expect(result.status).toBe("tripped");
      if (result.status !== "tripped") {
        return;
      }

      const row = db
        .select()
        .from(traderKillSwitches)
        .where(eq(traderKillSwitches.id, result.killSwitchId))
        .all()[0];

      expect(row?.state).toBe("ACTIVE");
      expect(row?.origin).toBe("automatic");
      expect(row?.switchType).toBe("RECON_MISMATCH");
      expect(row?.reason).toBe("auto:mismatch");

      const audit = db.select().from(auditLogs).where(eq(auditLogs.id, result.auditId)).all()[0];
      expect(audit?.action).toBe(traderAuditActions.killSwitchTripped);
      const metadata = JSON.parse(audit?.metadataJson ?? "{}") as { origin?: string };
      expect(metadata.origin).toBe("automatic");
    });

    it("returns already_active for ACTIVE switch without a second audit", async () => {
      const db = getDb();
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db);
      const signal: KillSwitchTriggerSignal = {
        category: "data_quality",
        target: orgTarget(orgA),
      };

      const first = await dispatcher.activate(signal);
      expect(first.status).toBe("tripped");

      const auditBefore = countAuditRows(db);
      const second = await dispatcher.activate(signal);
      expect(second).toEqual({ status: "already_active", switchType: "DATA_QUALITY" });
      expect(countAuditRows(db)).toBe(auditBefore);

      const row = db
        .select()
        .from(traderKillSwitches)
        .where(
          and(
            eq(traderKillSwitches.organizationId, orgA),
            eq(traderKillSwitches.switchType, "DATA_QUALITY"),
          ),
        )
        .all()[0];
      if (first.status === "tripped") {
        expect(row?.stateVersion).toBe(first.stateVersion);
      }
    });

    it("detects already-active via shared KILL_SWITCH_ALREADY_ACTIVE constant", () => {
      const error = new KillSwitchConcurrencyError(KILL_SWITCH_ALREADY_ACTIVE);
      expect(isAlreadyActiveError(error)).toBe(true);
      expect(isAlreadyActiveError(new KillSwitchConcurrencyError())).toBe(false);
      expect(isAlreadyActiveError(new Error(KILL_SWITCH_ALREADY_ACTIVE))).toBe(false);
    });

    it("re-arms CLEARING switch to ACTIVE with origin automatic", async () => {
      const db = getDb();
      const service = createSqliteKillSwitchService(db);
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db, { killSwitchService: service });
      const target = orgTarget(orgA);
      const key = {
        scopeType: "organization" as const,
        scopeRef: null,
        switchType: "CONTROL_PLANE_LOSS" as const,
      };

      const tripped = await service.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "STOP_ACCOUNT",
        origin: "manual",
      });
      const clearing = await service.beginClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: tripped.row.stateVersion },
      );
      expect(clearing.row.state).toBe("CLEARING");

      const auditBefore = countAuditRows(db);
      const result = await dispatcher.activate({
        category: "control_plane_loss",
        target,
      });

      expect(result.status).toBe("tripped");
      expect(countAuditRows(db)).toBe(auditBefore + 1);

      const row = db
        .select()
        .from(traderKillSwitches)
        .where(eq(traderKillSwitches.id, clearing.row.id))
        .all()[0];
      expect(row?.state).toBe("ACTIVE");
      expect(row?.origin).toBe("automatic");
    });

    it("re-arms INACTIVE switch to ACTIVE with origin automatic", async () => {
      const db = getDb();
      let now = Date.now();
      const service = createSqliteKillSwitchService(db, { nowMs: () => now });
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db, { killSwitchService: service });
      const target = orgTarget(orgA);
      const key = {
        scopeType: "organization" as const,
        scopeRef: null,
        switchType: "STALE_STATE" as const,
      };

      const tripped = await service.trip(SERVICE_ACTOR, requireOrgContext(orgA), target, key, {
        enforcementMode: "CLOSE_ONLY",
        origin: "manual",
      });
      const clearing = await service.beginClear(
        SERVICE_ACTOR,
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: tripped.row.stateVersion, coolingOffMs: 1 },
      );
      now += 1;
      const cleared = await service.finalizeClear(
        { actorType: "user", actorId: USER_A },
        requireOrgContext(orgA),
        target,
        key,
        { expectedStateVersion: clearing.row.stateVersion },
      );
      expect(cleared.row.state).toBe("INACTIVE");

      const auditBefore = countAuditRows(db);
      const result = await dispatcher.activate({
        category: "anomaly",
        anomalyType: "STALE_STATE",
        target,
      });

      expect(result.status).toBe("tripped");
      expect(countAuditRows(db)).toBe(auditBefore + 1);

      const row = db
        .select()
        .from(traderKillSwitches)
        .where(eq(traderKillSwitches.id, cleared.row.id))
        .all()[0];
      expect(row?.state).toBe("ACTIVE");
      expect(row?.origin).toBe("automatic");
      expect(row?.reason).toBe("auto:anomaly:STALE_STATE");
    });

    it("scopes org-target writes to the signal organization only", async () => {
      const db = getDb();
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db);

      const result = await dispatcher.activate({
        category: "anomaly",
        anomalyType: "UNKNOWN_POSITION",
        target: orgTarget(orgA),
      });
      expect(result.status).toBe("tripped");

      const orgARow = db
        .select()
        .from(traderKillSwitches)
        .where(
          and(
            eq(traderKillSwitches.organizationId, orgA),
            eq(traderKillSwitches.switchType, "UNKNOWN_POSITION"),
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
            eq(traderKillSwitches.switchType, "UNKNOWN_POSITION"),
          ),
        )
        .all()[0];
      expect(orgBRow).toBeUndefined();
    });

    it("rejects platform target for untrusted actor override", async () => {
      const db = getDb();
      const dispatcher = createAutomaticTriggerDispatcher({
        killSwitchService: createSqliteKillSwitchService(db),
        actor: { actorType: "user", actorId: USER_A },
      });

      await expect(
        dispatcher.activate({
          category: "control_plane_loss",
          target: { scopeType: "platform" },
        }),
      ).rejects.toThrow(KillSwitchAuthorizationError);
    });

    it("allows platform target for trusted service actor", async () => {
      const db = getDb();
      const dispatcher = createSqliteAutomaticTriggerDispatcher(db);

      const result = await dispatcher.activate({
        category: "control_plane_loss",
        target: { scopeType: "platform" },
      });

      expect(result.status).toBe("tripped");
      if (result.status !== "tripped") {
        return;
      }

      const row = db
        .select()
        .from(traderKillSwitches)
        .where(eq(traderKillSwitches.id, result.killSwitchId))
        .all()[0];
      expect(row?.scopeType).toBe("platform");
      expect(row?.origin).toBe("automatic");
    });
  });
});
