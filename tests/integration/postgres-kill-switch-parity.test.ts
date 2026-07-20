/**
 * DEE-243 — Kill switch Postgres repository + service parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import {
  createPostgresAutomaticTriggerDispatcher,
  createPostgresGovernedRecoveryService,
  createPostgresKillSwitchService,
} from "@/lib/trader/risk/kill-switch";
import { killSwitchReasonCodes } from "@/lib/trader/risk/reason-codes";
import { createPostgresRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { traderAuditActions } from "@/lib/trader/types";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { seedHtrPostgresUser } from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-000000024301";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };
const OWNER_ACTOR = { actorType: "user" as const, actorId: USER_A };

describe.skipIf(!integrationEnabled || !url)("postgres kill switch parity (DEE-243)", () => {
  let orgA: string;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      await sql.unsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete`);
      await sql.unsafe(
        `DELETE FROM audit_logs WHERE organization_id = $1 OR entity_id IN (
        SELECT id::text FROM trader_kill_switches WHERE organization_id = $1 OR organization_id IS NULL
      )`,
        [orgId],
      );
      await sql.unsafe(`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_block_delete`);
      await sql.unsafe(
        `DELETE FROM trader_kill_switches WHERE organization_id = $1 OR organization_id IS NULL`,
        [orgId],
      );
      await sql.unsafe(`DELETE FROM organization_members WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM organizations WHERE id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM user_platform_roles WHERE user_id = $1`, [USER_A]);
      await sql.unsafe(`DELETE FROM profiles WHERE user_id = $1`, [USER_A]);
      await sql.unsafe(`DELETE FROM users WHERE id = $1`, [USER_A]);
      await sql.unsafe(`DELETE FROM auth.users WHERE id = $1`, [USER_A]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  beforeAll(async () => {
    await verifyHtrPostgresConnectionIdentity();
    await cleanup();
    orgA = await seedHtrPostgresUser(url!, USER_A, "Kill Switch Postgres Parity");

    const db = getPostgresDrizzle();
  });

  afterAll(async () => {
    await cleanup();
    await resetPostgresSingletonForTests();
  });

  it("trips org switch with CAS state_version and writes audit", async () => {
    const db = getPostgresDrizzle();
    const service = createPostgresKillSwitchService(db);

    const result = await service.trip(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      { scopeType: "organization", organizationId: orgA },
      { scopeType: "organization", scopeRef: null, switchType: "EMERGENCY_STOP" },
      { enforcementMode: "REJECT", origin: "manual", reason: "pg parity trip" },
    );

    expect(result.row.state).toBe("ACTIVE");
    expect(result.row.stateVersion).toBe(1);

    const auditRows = await db
      .select()
      .from(pgSchema.auditLogs)
      .where(eq(pgSchema.auditLogs.id, result.auditId));

    expect(auditRows[0]?.action).toBe(traderAuditActions.killSwitchTripped);
    expect(auditRows[0]?.organizationId).toBe(orgA);
  });

  it("resolves effective state with platform-inclusive read", async () => {
    const db = getPostgresDrizzle();
    const service = createPostgresKillSwitchService(db);

    await service.trip(
      SERVICE_ACTOR,
      null,
      { scopeType: "platform" },
      { scopeType: "platform", scopeRef: null, switchType: "PAUSE" },
      { enforcementMode: "STOP_ACCOUNT", origin: "manual", reason: "platform stop" },
    );

    const effective = await service.getEffectiveState(requireOrgContext(orgA));
    expect(effective.blocked).toBe(true);
    expect(effective.enforcementMode).toBe("STOP_ACCOUNT");
    expect(effective.contributors.some((c) => c.scopeType === "platform")).toBe(true);
  });

  it("risk engine enforces tripped org switch via postgres resolver (DEE-244)", async () => {
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(
        `DELETE FROM trader_kill_switches WHERE organization_id = $1 OR organization_id IS NULL`,
        [orgA],
      );
    } finally {
      await sql.end({ timeout: 5 });
    }

    const db = getPostgresDrizzle();
    const killSwitchService = createPostgresKillSwitchService(db);

    await killSwitchService.trip(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      { scopeType: "organization", organizationId: orgA },
      { scopeType: "organization", scopeRef: null, switchType: "CLOSE_ONLY" },
      { enforcementMode: "CLOSE_ONLY", origin: "manual", reason: "engine enforcement parity" },
    );

    const engine = createPostgresRiskEngineService(db);
    const result = await engine.evaluateOrderRequest({
      context: requireOrgContext(orgA),
      order: {
        clientOrderId: "pg-engine-1",
        symbol: "BTC/USDT",
        side: "buy",
        type: "limit",
        price: "100",
        quantity: "0.1",
      },
      referencePrice: "100",
      accountKey: "acct-pg-1",
    });

    expect(result.decision.outcome).toBe("CLOSE_ONLY");
    expect(result.decision.reasonCodes).toEqual([killSwitchReasonCodes.killSwitchActive]);
    expect(result.configVersion).toBeNull();
    expect(result.decision.snapshot.checksApplied).toEqual([]);
  });

  it("automatic trigger dispatcher trips org switch with origin automatic (DEE-245)", async () => {
    const db = getPostgresDrizzle();
    const dispatcher = createPostgresAutomaticTriggerDispatcher(db);

    const result = await dispatcher.activate({
      category: "mismatch",
      target: { scopeType: "organization", organizationId: orgA },
    });

    expect(result.status).toBe("tripped");
    if (result.status !== "tripped") {
      return;
    }

    const switchRows = await db
      .select()
      .from(pgSchema.traderKillSwitches)
      .where(eq(pgSchema.traderKillSwitches.id, result.killSwitchId));

    expect(switchRows[0]?.state).toBe("ACTIVE");
    expect(switchRows[0]?.origin).toBe("automatic");
    expect(switchRows[0]?.reason).toBe("auto:mismatch");

    const auditRows = await db
      .select()
      .from(pgSchema.auditLogs)
      .where(eq(pgSchema.auditLogs.id, result.auditId));

    expect(auditRows[0]?.action).toBe(traderAuditActions.killSwitchTripped);
    expect(auditRows).toHaveLength(1);
  });

  it("governed recovery requestClear -> confirmClear with owner actor (DEE-246)", async () => {
    const db = getPostgresDrizzle();
    let now = Date.now();
    const killSwitchService = createPostgresKillSwitchService(db, { nowMs: () => now });
    const recovery = createPostgresGovernedRecoveryService(db, { nowMs: () => now });
    const target = { scopeType: "organization" as const, organizationId: orgA };
    const key = {
      scopeType: "organization" as const,
      scopeRef: null,
      switchType: "PAUSE" as const,
    };

    const tripped = await killSwitchService.trip(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      target,
      key,
      { enforcementMode: "REJECT", origin: "manual", reason: "pg recovery parity" },
    );

    const clearing = await recovery.requestClear(
      SERVICE_ACTOR,
      requireOrgContext(orgA),
      target,
      key,
      { expectedStateVersion: tripped.row.stateVersion, coolingOffMs: 1 },
    );
    expect(clearing.row.state).toBe("CLEARING");

    now += 1;

    const preview = await recovery.previewRecovery(requireOrgContext(orgA), target, key);
    expect(preview.confirmable).toBe(true);

    const cleared = await recovery.confirmClear(OWNER_ACTOR, requireOrgContext(orgA), target, key, {
      expectedStateVersion: preview.stateVersion,
    });
    expect(cleared.row.state).toBe("INACTIVE");

    const auditRows = await db
      .select()
      .from(pgSchema.auditLogs)
      .where(eq(pgSchema.auditLogs.id, cleared.auditId));

    expect(auditRows[0]?.action).toBe(traderAuditActions.killSwitchCleared);
  });
});
