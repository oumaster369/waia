import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { traderFills, traderOrderEvents, traderOrders } from "@/db/schema";
import {
  OrgScopeError,
  orgScopedWhere,
  requireOrgContext,
} from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000247e";
const USER_B = "00000000-0000-4000-8000-0000000247f";

function insertOrgOrder(organizationId: string) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.insert(traderOrders)
    .values({
      id,
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
    })
    .run();
  return id;
}

function getOrgOrder(organizationId: string, orderId: string) {
  const db = getDb();
  return db
    .select()
    .from(traderOrders)
    .where(
      and(
        eq(traderOrders.id, orderId),
        orgScopedWhere(traderOrders.organizationId, requireOrgContext(organizationId)),
      ),
    )
    .all()[0];
}

describe("trader orders tenant isolation (DEE-247 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let orgAOrderId: string;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-orders-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "orders-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "orders-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Orders Iso Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "orders-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Orders Iso Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Orders Iso Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Orders Iso Org B" });

    orgAOrderId = insertOrgOrder(orgA);
  });

  it("org B cannot read org A order via org-scoped query", () => {
    const orgARow = getOrgOrder(orgA, orgAOrderId);
    expect(orgARow).toBeDefined();
    expect(orgARow?.id).toBe(orgAOrderId);

    const crossOrgRead = getOrgOrder(orgB, orgAOrderId);
    expect(crossOrgRead).toBeUndefined();
  });

  it("org B cannot mutate org A order via org-scoped update", () => {
    const db = getDb();
    db.update(traderOrders)
      .set({ state: "FILLED", filledQuantity: "999" })
      .where(
        and(
          eq(traderOrders.id, orgAOrderId),
          orgScopedWhere(traderOrders.organizationId, requireOrgContext(orgB)),
        ),
      )
      .run();

    const orgARow = getOrgOrder(orgA, orgAOrderId);
    expect(orgARow?.state).toBe("CREATED");
    expect(orgARow?.filledQuantity).toBe("0");
  });

  it("org B can insert its own order without affecting org A visibility", () => {
    const orgBOrderId = insertOrgOrder(orgB);

    const orgARow = getOrgOrder(orgA, orgAOrderId);
    const orgBRow = getOrgOrder(orgB, orgBOrderId);

    expect(orgARow?.id).toBe(orgAOrderId);
    expect(orgBRow?.id).toBe(orgBOrderId);
    expect(orgBRow?.organizationId).toBe(orgB);
  });

  it("org-scoped queries on events and fills exclude other organizations", () => {
    const db = getDb();
    db.insert(traderOrderEvents)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgA,
        orderId: orgAOrderId,
        seq: 0,
        toState: "CREATED",
        eventType: "transition",
        occurredAt: new Date(),
      })
      .run();
    db.insert(traderFills)
      .values({
        id: crypto.randomUUID(),
        organizationId: orgA,
        orderId: orgAOrderId,
        exchangeTradeId: "iso-trade-1",
        price: "100",
        quantity: "1",
        executedAt: new Date(),
      })
      .run();

    const orgAEvents = db
      .select()
      .from(traderOrderEvents)
      .where(orgScopedWhere(traderOrderEvents.organizationId, requireOrgContext(orgA)))
      .all();
    const orgBEvents = db
      .select()
      .from(traderOrderEvents)
      .where(orgScopedWhere(traderOrderEvents.organizationId, requireOrgContext(orgB)))
      .all();

    expect(orgAEvents.length).toBeGreaterThan(0);
    expect(orgBEvents).toHaveLength(0);

    const orgAFills = db
      .select()
      .from(traderFills)
      .where(orgScopedWhere(traderFills.organizationId, requireOrgContext(orgA)))
      .all();
    const orgBFills = db
      .select()
      .from(traderFills)
      .where(orgScopedWhere(traderFills.organizationId, requireOrgContext(orgB)))
      .all();

    expect(orgAFills.length).toBeGreaterThan(0);
    expect(orgBFills).toHaveLength(0);
  });

  it("empty organization id throws OrgScopeError", () => {
    expect(() => requireOrgContext("")).toThrow(OrgScopeError);
  });
});
