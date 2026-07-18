/**
 * DEE-248 — Order repository Postgres parity (opt-in).
 *
 * Enable with: WAIA_PG_INTEGRATION=1 + DATABASE_URL_POSTGRES (see docs/postgres-development.md).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import * as pgSchema from "@/db/schema.postgres";
import {
  DuplicateOrderError,
  FillConflictError,
  OrderVersionConflictError,
} from "@/lib/trader/execution";
import { createPostgresOrderRepository } from "@/lib/trader/execution/repository-adapters";
import { ensureUserCoreSeedPostgres } from "@/lib/waia-core/provisioning/postgres";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { verifyHtrPostgresConnectionIdentity } from "@/lib/trader/readiness/htr-postgres-connection-preflight";
import { ensureAuthUsersSeed } from "@/tests/integration/htr-postgres-fixture-prelude";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const USER_A = "00000000-0000-4000-8022-000000024801";

function createInput(clientOrderId: string, idempotencyKey: string) {
  return {
    venue: "mock",
    executionMode: "mock" as const,
    symbol: "BTCUSDT",
    side: "buy" as const,
    type: "limit" as const,
    price: "100",
    quantity: "1",
    clientOrderId,
    idempotencyKey,
    riskDecisionId: crypto.randomUUID(),
  };
}

describe.skipIf(!integrationEnabled || !url)("postgres order repository parity (DEE-248)", () => {
  let orgA: string;
  let repo: ReturnType<typeof createPostgresOrderRepository>;

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
      displayName: "Order Repo Postgres Parity",
    });
    repo = createPostgresOrderRepository(db);
  });

  afterAll(async () => {
    await cleanup();
    await resetPostgresSingletonForTests();
  });

  it("creates order with initial event atomically", async () => {
    const context = requireOrgContext(orgA);
    const input = createInput("pg-create-248", "pg-create-248");
    const order = await repo.createOrder(context, input);

    expect(order.state).toBe("CREATED");
    expect(order.stateVersion).toBe(1);

    const events = await repo.listEvents(context, order.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(0);
  });

  it("returns existing on idempotent create and rejects payload mismatch", async () => {
    const context = requireOrgContext(orgA);
    const input = createInput("pg-idem-248", "pg-idem-248");
    const first = await repo.createOrder(context, input);
    const second = await repo.createOrder(context, input);
    expect(second.id).toBe(first.id);

    await expect(repo.createOrder(context, { ...input, symbol: "ETHUSDT" })).rejects.toThrow(
      DuplicateOrderError,
    );
  });

  it("transitions with CAS and appends monotonic event seq", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, createInput("pg-trans-248", "pg-trans-248"));

    const updated = await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });

    expect(updated.stateVersion).toBe(2);

    const events = await repo.listEvents(context, order.id);
    expect(events.map((event) => event.seq)).toEqual([0, 1]);
  });

  it("throws OrderVersionConflictError on stale version", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, createInput("pg-cas-248", "pg-cas-248"));

    await expect(
      repo.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: 99,
        toState: "RISK_APPROVED",
      }),
    ).rejects.toThrow(OrderVersionConflictError);

    const events = await repo.listEvents(context, order.id);
    expect(events).toHaveLength(1);
  });

  it("records fills idempotently and rejects fill payload mismatch", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, createInput("pg-fill-248", "pg-fill-248"));
    const executedAt = new Date("2026-02-01T10:00:00.000Z");

    const fill = await repo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "pg-trade-248",
      price: "100",
      quantity: "0.2",
      executedAt,
    });

    const retry = await repo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "pg-trade-248",
      price: "100",
      quantity: "0.2",
      executedAt,
    });

    expect(retry.id).toBe(fill.id);

    await expect(
      repo.recordFill(context, {
        orderId: order.id,
        exchangeTradeId: "pg-trade-248",
        price: "99",
        quantity: "0.2",
        executedAt,
      }),
    ).rejects.toThrow(FillConflictError);
  });

  it("listOpenOrders includes RECONCILIATION_REQUIRED", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, createInput("pg-open-248", "pg-open-248"));

    await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });
    await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 2,
      toState: "SENT_TO_EXCHANGE",
    });
    await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 3,
      toState: "RECONCILIATION_REQUIRED",
    });

    const open = await repo.listOpenOrders(context);
    expect(open.some((row) => row.id === order.id && row.state === "RECONCILIATION_REQUIRED")).toBe(
      true,
    );

    const db = getPostgresDrizzle();
    const rows = await db
      .select()
      .from(pgSchema.traderOrders)
      .where(eq(pgSchema.traderOrders.id, order.id));
    expect(rows[0]?.state).toBe("RECONCILIATION_REQUIRED");
  });
});
