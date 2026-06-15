import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import { OrderNotFoundError, OrderVersionConflictError } from "@/lib/trader/execution";
import { createSqliteOrderRepository } from "@/lib/trader/execution/repository-adapters";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000248b";
const USER_B = "00000000-0000-4000-8000-0000000248c";

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

describe("trader order repository tenant isolation (DEE-248 / ADR-0007)", () => {
  let orgA: string;
  let orgB: string;
  let orgAOrderId: string;
  let repo: ReturnType<typeof createSqliteOrderRepository>;

  beforeAll(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-repo-iso-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-repo-isolation.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-repo-iso-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Repo Iso Org A",
    });
    insertEmailPasswordUser(db, {
      id: USER_B,
      email: "order-repo-iso-b@waia.invalid",
      password: "password123",
      identityLabel: "Order Repo Iso Org B",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Order Repo Iso Org A" });
    orgB = ensureUserCoreSeedSqlite(db, { userId: USER_B, displayName: "Order Repo Iso Org B" });
    repo = createSqliteOrderRepository(db);

    const orderA = await repo.createOrder(
      requireOrgContext(orgA),
      createInput("iso-client-a", "iso-idem-a"),
    );
    orgAOrderId = orderA.id;
  });

  it("org B cannot read org A order", async () => {
    const row = await repo.getOrderById(requireOrgContext(orgB), orgAOrderId);
    expect(row).toBeNull();
  });

  it("org B cannot transition org A order", async () => {
    await expect(
      repo.transitionOrder(requireOrgContext(orgB), {
        orderId: orgAOrderId,
        expectedStateVersion: 1,
        toState: "RISK_APPROVED",
      }),
    ).rejects.toThrow(OrderNotFoundError);
  });

  it("org B cannot record fill on org A order", async () => {
    await expect(
      repo.recordFill(requireOrgContext(orgB), {
        orderId: orgAOrderId,
        exchangeTradeId: "iso-fill-b",
        price: "100",
        quantity: "1",
        executedAt: new Date(),
      }),
    ).rejects.toThrow(OrderNotFoundError);
  });

  it("org-scoped list and child reads exclude other organizations", async () => {
    const orgBOrder = await repo.createOrder(
      requireOrgContext(orgB),
      createInput("iso-client-b", "iso-idem-b"),
    );

    const orgAOpen = await repo.listOpenOrders(requireOrgContext(orgA));
    const orgBOpen = await repo.listOpenOrders(requireOrgContext(orgB));

    expect(orgAOpen.some((row) => row.id === orgAOrderId)).toBe(true);
    expect(orgAOpen.some((row) => row.id === orgBOrder.id)).toBe(false);
    expect(orgBOpen.some((row) => row.id === orgBOrder.id)).toBe(true);
    expect(orgBOpen.some((row) => row.id === orgAOrderId)).toBe(false);

    const orgAEvents = await repo.listEvents(requireOrgContext(orgA), orgAOrderId);
    const orgBFillsOnA = await repo.listFills(requireOrgContext(orgB), orgAOrderId);

    expect(orgAEvents.length).toBeGreaterThan(0);
    expect(orgBFillsOnA).toHaveLength(0);
  });

  it("org B transition on org A order does not change org A row", async () => {
    try {
      await repo.transitionOrder(requireOrgContext(orgB), {
        orderId: orgAOrderId,
        expectedStateVersion: 1,
        toState: "RISK_APPROVED",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(OrderNotFoundError);
    }

    const orgARow = await repo.getOrderById(requireOrgContext(orgA), orgAOrderId);
    expect(orgARow?.state).toBe("CREATED");
    expect(orgARow?.stateVersion).toBe(1);
  });

  it("stale version conflict is scoped to owning org context", async () => {
    await expect(
      repo.transitionOrder(requireOrgContext(orgB), {
        orderId: orgAOrderId,
        expectedStateVersion: 99,
        toState: "RISK_APPROVED",
      }),
    ).rejects.toThrow(OrderNotFoundError);

    await expect(
      repo.transitionOrder(requireOrgContext(orgA), {
        orderId: orgAOrderId,
        expectedStateVersion: 99,
        toState: "RISK_APPROVED",
      }),
    ).rejects.toThrow(OrderVersionConflictError);
  });
});
