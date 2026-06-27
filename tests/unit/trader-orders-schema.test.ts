import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  orderExecutionModeEnum,
  orderStateEnum,
  organizations,
  traderFills,
  traderOrderEvents,
  traderOrders,
} from "@/db/schema";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000247a";

function baseOrderRow(
  organizationId: string,
  overrides: Partial<typeof traderOrders.$inferInsert> = {},
): typeof traderOrders.$inferInsert {
  return {
    id: crypto.randomUUID(),
    organizationId,
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
    ...overrides,
  };
}

describe("trader_orders schema (DEE-247)", () => {
  let orgA: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-orders-schema-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "orders-schema.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "orders-schema-a@waia.invalid",
      password: "password123",
      identityLabel: "Orders Schema Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, {
      userId: USER_A,
      displayName: "Orders Schema Org A",
    });
  });

  it("inserts order with CREATED state and default state_version", () => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(traderOrders).values(baseOrderRow(orgA, { id })).run();

    const row = db.select().from(traderOrders).where(eq(traderOrders.id, id)).all()[0];

    expect(row?.state).toBe("CREATED");
    expect(row?.stateVersion).toBe(1);
    expect(row?.filledQuantity).toBe("0");
    expect(row?.executionMode).toBe("mock");
    expect(row?.createdAt).toBeInstanceOf(Date);
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it("allows null price for market orders", () => {
    const db = getDb();
    const id = crypto.randomUUID();
    db.insert(traderOrders)
      .values(
        baseOrderRow(orgA, {
          id,
          type: "market",
          price: null,
        }),
      )
      .run();

    const row = db.select().from(traderOrders).where(eq(traderOrders.id, id)).all()[0];
    expect(row?.type).toBe("market");
    expect(row?.price).toBeNull();
  });

  it("rejects duplicate client_order_id for the same organization", () => {
    const db = getDb();
    const clientOrderId = crypto.randomUUID();

    db.insert(traderOrders).values(baseOrderRow(orgA, { clientOrderId })).run();

    expect(() =>
      db.insert(traderOrders).values(baseOrderRow(orgA, { clientOrderId })).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects duplicate idempotency_key for the same organization", () => {
    const db = getDb();
    const idempotencyKey = crypto.randomUUID();

    db.insert(traderOrders).values(baseOrderRow(orgA, { idempotencyKey })).run();

    expect(() =>
      db.insert(traderOrders).values(baseOrderRow(orgA, { idempotencyKey })).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("persists all canonical order states", () => {
    const db = getDb();

    for (const state of orderStateEnum) {
      const id = crypto.randomUUID();
      db.insert(traderOrders).values(baseOrderRow(orgA, { id, state })).run();

      const row = db.select().from(traderOrders).where(eq(traderOrders.id, id)).all()[0];
      expect(row?.state).toBe(state);
    }
  });

  it("persists all execution_mode values", () => {
    const db = getDb();

    for (const executionMode of orderExecutionModeEnum) {
      const id = crypto.randomUUID();
      db.insert(traderOrders).values(baseOrderRow(orgA, { id, executionMode })).run();

      const row = db.select().from(traderOrders).where(eq(traderOrders.id, id)).all()[0];
      expect(row?.executionMode).toBe(executionMode);
    }
  });

  it("rejects insert without execution_mode", () => {
    const db = getDb();
    const withoutMode = { ...baseOrderRow(orgA) } as Partial<typeof traderOrders.$inferInsert>;
    delete withoutMode.executionMode;

    expect(() =>
      db
        .insert(traderOrders)
        .values(withoutMode as typeof traderOrders.$inferInsert)
        .run(),
    ).toThrow();
  });

  it("appends order events with monotonic seq", () => {
    const db = getDb();
    const orderId = crypto.randomUUID();
    db.insert(traderOrders)
      .values(baseOrderRow(orgA, { id: orderId }))
      .run();

    const eventId = crypto.randomUUID();
    db.insert(traderOrderEvents)
      .values({
        id: eventId,
        organizationId: orgA,
        orderId,
        seq: 0,
        fromState: null,
        toState: "CREATED",
        eventType: "transition",
        occurredAt: new Date(),
      })
      .run();

    expect(() =>
      db
        .insert(traderOrderEvents)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgA,
          orderId,
          seq: 0,
          fromState: "CREATED",
          toState: "RISK_APPROVED",
          eventType: "transition",
          occurredAt: new Date(),
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);

    const event = db
      .select()
      .from(traderOrderEvents)
      .where(eq(traderOrderEvents.id, eventId))
      .all()[0];
    expect(event?.toState).toBe("CREATED");
  });

  it("records fills with idempotent exchange_trade_id per order", () => {
    const db = getDb();
    const orderId = crypto.randomUUID();
    db.insert(traderOrders)
      .values(baseOrderRow(orgA, { id: orderId }))
      .run();

    const tradeId = "trade-001";
    db.insert(traderFills)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgA,
        orderId,
        exchangeTradeId: tradeId,
        price: "100",
        quantity: "0.5",
        executedAt: new Date(),
      })
      .run();

    expect(() =>
      db
        .insert(traderFills)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgA,
          orderId,
          exchangeTradeId: tradeId,
          price: "100",
          quantity: "0.5",
          executedAt: new Date(),
        })
        .run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("cascades delete when organization is removed", () => {
    const db = getDb();
    const userId = "00000000-0000-4000-8000-0000000247b";
    insertEmailPasswordUser(db, {
      id: userId,
      email: "orders-schema-cascade@waia.invalid",
      password: "password123",
      identityLabel: "Orders Cascade Org",
    });
    const orgId = ensureUserCoreSeedSqlite(db, {
      userId,
      displayName: "Orders Cascade Org",
    });

    const orderId = crypto.randomUUID();
    db.insert(traderOrders)
      .values(baseOrderRow(orgId, { id: orderId }))
      .run();
    db.insert(traderOrderEvents)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        orderId,
        seq: 0,
        toState: "CREATED",
        eventType: "transition",
        occurredAt: new Date(),
      })
      .run();
    db.insert(traderFills)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgId,
        orderId,
        exchangeTradeId: "trade-cascade",
        price: "1",
        quantity: "1",
        executedAt: new Date(),
      })
      .run();

    db.delete(organizations).where(eq(organizations.id, orgId)).run();

    expect(db.select().from(traderOrders).where(eq(traderOrders.id, orderId)).all()).toHaveLength(
      0,
    );
    expect(
      db.select().from(traderOrderEvents).where(eq(traderOrderEvents.orderId, orderId)).all(),
    ).toHaveLength(0);
    expect(
      db.select().from(traderFills).where(eq(traderFills.orderId, orderId)).all(),
    ).toHaveLength(0);
  });

  it("rejects child event when organization_id mismatches parent order", () => {
    const db = getDb();
    const userB = "00000000-0000-4000-8000-0000000247c";
    insertEmailPasswordUser(db, {
      id: userB,
      email: "orders-schema-cross@waia.invalid",
      password: "password123",
      identityLabel: "Orders Cross Org B",
    });
    const orgB = ensureUserCoreSeedSqlite(db, {
      userId: userB,
      displayName: "Orders Cross Org B",
    });

    const orderId = crypto.randomUUID();
    db.insert(traderOrders)
      .values(baseOrderRow(orgA, { id: orderId }))
      .run();

    expect(() =>
      db
        .insert(traderOrderEvents)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgB,
          orderId,
          seq: 0,
          toState: "CREATED",
          eventType: "transition",
          occurredAt: new Date(),
        })
        .run(),
    ).toThrow();
  });

  it("rejects child fill when organization_id mismatches parent order", () => {
    const db = getDb();
    const userB = "00000000-0000-4000-8000-0000000247d";
    insertEmailPasswordUser(db, {
      id: userB,
      email: "orders-fill-cross@waia.invalid",
      password: "password123",
      identityLabel: "Orders Fill Cross Org B",
    });
    const orgB = ensureUserCoreSeedSqlite(db, {
      userId: userB,
      displayName: "Orders Fill Cross Org B",
    });

    const orderId = crypto.randomUUID();
    db.insert(traderOrders)
      .values(baseOrderRow(orgA, { id: orderId }))
      .run();

    expect(() =>
      db
        .insert(traderFills)
        .values({
          id: crypto.randomUUID(),
          organizationId: orgB,
          orderId,
          exchangeTradeId: "trade-cross",
          price: "1",
          quantity: "1",
          executedAt: new Date(),
        })
        .run(),
    ).toThrow();
  });
});
