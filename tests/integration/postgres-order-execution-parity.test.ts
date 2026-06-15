/**
 * DEE-249 — Order execution Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { createPostgresOrderExecutionService } from "@/lib/trader/execution";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { createPostgresRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8000-0000000249d1";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

describe.skipIf(!integrationEnabled || !url)("postgres order execution parity (DEE-249)", () => {
  let orgA: string;
  let service: ReturnType<typeof createPostgresOrderExecutionService>;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM trader_risk_limits WHERE organization_id = $1`, [orgId]);
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
      displayName: "Order Exec Postgres Parity",
    });

    const limits = createPostgresRiskLimitsService(db);
    await limits.upsertLimitsForOrg(requireOrgContext(orgA), { ...DEFAULT_ORG_RISK_LIMITS });

    service = createPostgresOrderExecutionService(db);
  });

  afterAll(async () => {
    await cleanup();
    resetPostgresSingletonForTests();
  });

  it("submits limit order through postgres stack", async () => {
    const context = requireOrgContext(orgA);
    const result = await service.submitOrder(context, {
      clientOrderId: "pg-exec-limit-249",
      idempotencyKey: "pg-exec-idem-limit-249",
      executionMode: "mock",
      symbol: "BTC/USDT",
      side: "buy",
      type: "limit",
      price: "65000",
      quantity: "0.1",
      referencePrice: "65000",
      accountKey: "acct-pg",
      accountState: EMPTY_STATE,
    });

    expect(result.status).toBe("submitted");
    if (result.status === "submitted") {
      expect(result.order.state).toBe("ACCEPTED");
    }
  });
});
