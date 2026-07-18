/**
 * DEE-247 — Trader orders Postgres schema parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { ensureAuthUsersSeed } from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-000000024701";

describe.skipIf(!integrationEnabled || !url)("postgres trader orders parity (DEE-247)", () => {
  let orgA: string;

  async function cleanup(): Promise<void> {
    const sql = postgres(url!, { max: 1 });
    try {
      const orgId = personalOrganizationIdFromUserId(USER_A);
      await sql.unsafe(`DELETE FROM trader_fills WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM trader_order_events WHERE organization_id = $1`, [orgId]);
      await sql.unsafe(`DELETE FROM trader_orders WHERE organization_id = $1`, [orgId]);
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
    await ensureAuthUsersSeed(url!, [USER_A]);

    const db = getPostgresDrizzle();
    orgA = await ensureUserCoreSeedPostgres(db, {
      userId: USER_A,
      displayName: "Orders Postgres Parity",
    });
  });

  afterAll(async () => {
    await cleanup();
    resetPostgresSingletonForTests();
  });

  it("inserts order, event, and fill with execution_mode and state enums", async () => {
    const db = getPostgresDrizzle();
    const orderId = crypto.randomUUID();

    await db.insert(pgSchema.traderOrders).values({
      id: orderId,
      organizationId: orgA,
      venue: "mock",
      executionMode: "mock",
      symbol: "BTCUSDT",
      side: "buy",
      type: "limit",
      price: "100",
      quantity: "1",
      state: "CREATED",
      clientOrderId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      riskDecisionId: crypto.randomUUID(),
    });

    await db.insert(pgSchema.traderOrderEvents).values({
      id: crypto.randomUUID(),
      organizationId: orgA,
      orderId,
      seq: 0,
      toState: "CREATED",
      eventType: "transition",
      occurredAt: new Date(),
    });

    await db.insert(pgSchema.traderFills).values({
      id: crypto.randomUUID(),
      organizationId: orgA,
      orderId,
      exchangeTradeId: "pg-trade-1",
      price: "100",
      quantity: "1",
      executedAt: new Date(),
    });

    const rows = await db
      .select()
      .from(pgSchema.traderOrders)
      .where(eq(pgSchema.traderOrders.id, orderId));

    expect(rows[0]?.state).toBe("CREATED");
    expect(rows[0]?.executionMode).toBe("mock");
    expect(rows[0]?.stateVersion).toBe(1);
  });

  it("rejects cross-org event insert via composite foreign key", async () => {
    const db = getPostgresDrizzle();
    const orderId = crypto.randomUUID();
    const otherOrgId = crypto.randomUUID();

    await db.insert(pgSchema.traderOrders).values({
      id: orderId,
      organizationId: orgA,
      venue: "mock",
      executionMode: "mock",
      symbol: "ETHUSDT",
      side: "sell",
      type: "market",
      quantity: "1",
      state: "CREATED",
      clientOrderId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      riskDecisionId: crypto.randomUUID(),
    });

    await expect(
      db.insert(pgSchema.traderOrderEvents).values({
        id: crypto.randomUUID(),
        organizationId: otherOrgId,
        orderId,
        seq: 0,
        toState: "CREATED",
        eventType: "transition",
        occurredAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
