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
import { createPostgresKillSwitchService } from "@/lib/trader/risk/kill-switch";
import { killSwitchReasonCodes } from "@/lib/trader/risk/reason-codes";
import { createPostgresRiskEngineService } from "@/lib/trader/risk/risk-engine-service";
import { traderAuditActions } from "@/lib/trader/types";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000243f1";
const SERVICE_ACTOR = { actorType: "service" as const, actorId: null };

describe.skipIf(!integrationEnabled || !url)("postgres kill switch parity (DEE-243)", () => {
  let orgA: string;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      await sql.unsafe(`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_block_delete`);
      await sql.unsafe(
        `DELETE FROM audit_logs WHERE organization_id = $1 OR entity_id IN (
        SELECT id FROM trader_kill_switches WHERE organization_id = $1 OR organization_id IS NULL
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
    await cleanup();
    const sql = postgres(url!, { max: 1 });
    try {
      await sql.unsafe(`INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`, [
        USER_A,
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }

    const db = getPostgresDrizzle();
    orgA = await ensureUserCoreSeedPostgres(db, {
      userId: USER_A,
      displayName: "Kill Switch Postgres Parity",
    });
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
});
