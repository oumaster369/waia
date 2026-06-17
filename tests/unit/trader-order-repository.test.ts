import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDb } from "@/db/client";
import {
  DuplicateOrderError,
  FillConflictError,
  IllegalOrderTransitionError,
  OrderNotFoundError,
  OrderVersionConflictError,
} from "@/lib/trader/execution";
import { createSqliteOrderRepository } from "@/lib/trader/execution/repository-adapters";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { migrateDatabaseFromEnv } from "@/tests/helpers/migrate-test-db";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const USER_A = "00000000-0000-4000-8000-0000000248a";

function baseCreateInput(
  overrides?: Partial<{
    clientOrderId: string;
    idempotencyKey: string;
    symbol: string;
    quantity: string;
  }>,
) {
  return {
    venue: "mock",
    executionMode: "mock" as const,
    symbol: overrides?.symbol ?? "BTCUSDT",
    side: "buy" as const,
    type: "limit" as const,
    price: "100",
    quantity: overrides?.quantity ?? "1",
    clientOrderId: overrides?.clientOrderId ?? crypto.randomUUID(),
    idempotencyKey: overrides?.idempotencyKey ?? crypto.randomUUID(),
    riskDecisionId: crypto.randomUUID(),
  };
}

describe("trader order repository (DEE-248)", () => {
  let orgA: string;
  let repo: ReturnType<typeof createSqliteOrderRepository>;

  beforeAll(() => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-order-repo-"));
    process.env.DATABASE_URL = `file:${path.join(tmpDir, "order-repo.sqlite")}`;
    migrateDatabaseFromEnv();
    const db = getDb();

    insertEmailPasswordUser(db, {
      id: USER_A,
      email: "order-repo-a@waia.invalid",
      password: "password123",
      identityLabel: "Order Repo Org A",
    });

    orgA = ensureUserCoreSeedSqlite(db, { userId: USER_A, displayName: "Order Repo Org A" });
    repo = createSqliteOrderRepository(db);
  });

  it("creates order with CREATED state, state_version 1, and initial event seq 0", async () => {
    const context = requireOrgContext(orgA);
    const input = baseCreateInput();
    const order = await repo.createOrder(context, input);

    expect(order.state).toBe("CREATED");
    expect(order.stateVersion).toBe(1);
    expect(order.clientOrderId).toBe(input.clientOrderId);

    const events = await repo.listEvents(context, order.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(0);
    expect(events[0]?.fromState).toBeNull();
    expect(events[0]?.toState).toBe("CREATED");
  });

  it("returns existing order on idempotent create with matching payload", async () => {
    const context = requireOrgContext(orgA);
    const input = baseCreateInput({
      clientOrderId: "client-idempotent-248",
      idempotencyKey: "idem-idempotent-248",
    });

    const first = await repo.createOrder(context, input);
    const second = await repo.createOrder(context, input);

    expect(second.id).toBe(first.id);
    expect(second.stateVersion).toBe(1);
  });

  it("throws DuplicateOrderError when keys match but payload differs", async () => {
    const context = requireOrgContext(orgA);
    const clientOrderId = "client-mismatch-248";
    const idempotencyKey = "idem-mismatch-248";

    await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId, idempotencyKey, symbol: "BTCUSDT" }),
    );

    await expect(
      repo.createOrder(
        context,
        baseCreateInput({ clientOrderId, idempotencyKey, symbol: "ETHUSDT" }),
      ),
    ).rejects.toThrow(DuplicateOrderError);
  });

  it("throws DuplicateOrderError on cross-key mismatch", async () => {
    const context = requireOrgContext(orgA);
    const clientOrderId = "client-cross-key-248";

    await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId, idempotencyKey: "idem-a-248" }),
    );

    await expect(
      repo.createOrder(context, baseCreateInput({ clientOrderId, idempotencyKey: "idem-b-248" })),
    ).rejects.toThrow(DuplicateOrderError);
  });

  it("transitions order with CAS, increments version, and appends event", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, baseCreateInput());

    const updated = await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });

    expect(updated.state).toBe("RISK_APPROVED");
    expect(updated.stateVersion).toBe(2);

    const events = await repo.listEvents(context, order.id);
    expect(events).toHaveLength(2);
    expect(events[1]?.seq).toBe(1);
    expect(events[1]?.fromState).toBe("CREATED");
    expect(events[1]?.toState).toBe("RISK_APPROVED");
  });

  it("rejects illegal transition without writing", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, baseCreateInput());

    await expect(
      repo.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: 1,
        toState: "FILLED",
      }),
    ).rejects.toThrow(IllegalOrderTransitionError);

    const unchanged = await repo.getOrderById(context, order.id);
    expect(unchanged?.state).toBe("CREATED");
    expect(unchanged?.stateVersion).toBe(1);

    const events = await repo.listEvents(context, order.id);
    expect(events).toHaveLength(1);
  });

  it("throws OrderVersionConflictError on stale version without new event", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, baseCreateInput());

    await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });

    await expect(
      repo.transitionOrder(context, {
        orderId: order.id,
        expectedStateVersion: 1,
        toState: "SENT_TO_EXCHANGE",
      }),
    ).rejects.toThrow(OrderVersionConflictError);

    const events = await repo.listEvents(context, order.id);
    expect(events).toHaveLength(2);
  });

  it("records fill idempotently and throws FillConflictError on payload mismatch", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, baseCreateInput());
    const executedAt = new Date("2026-01-15T12:00:00.000Z");

    const fill = await repo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "trade-248-1",
      price: "100",
      quantity: "0.5",
      fee: "0.01",
      feeAsset: "USDT",
      executedAt,
    });

    const retry = await repo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "trade-248-1",
      price: "100",
      quantity: "0.5",
      fee: "0.01",
      feeAsset: "USDT",
      executedAt,
    });

    expect(retry.id).toBe(fill.id);

    await expect(
      repo.recordFill(context, {
        orderId: order.id,
        exchangeTradeId: "trade-248-1",
        price: "101",
        quantity: "0.5",
        executedAt,
      }),
    ).rejects.toThrow(FillConflictError);
  });

  it("allows recordFill on terminal parent order", async () => {
    const context = requireOrgContext(orgA);
    const order = await repo.createOrder(context, baseCreateInput());

    await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });
    await repo.transitionOrder(context, {
      orderId: order.id,
      expectedStateVersion: 2,
      toState: "REJECTED",
    });

    const fill = await repo.recordFill(context, {
      orderId: order.id,
      exchangeTradeId: "late-trade-248",
      price: "100",
      quantity: "0.1",
      executedAt: new Date(),
    });

    expect(fill.orderId).toBe(order.id);
  });

  it("listOpenOrders includes RECONCILIATION_REQUIRED and excludes terminal states", async () => {
    const context = requireOrgContext(orgA);
    const openOrder = await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId: "open-248", idempotencyKey: "open-248" }),
    );

    await repo.transitionOrder(context, {
      orderId: openOrder.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });
    await repo.transitionOrder(context, {
      orderId: openOrder.id,
      expectedStateVersion: 2,
      toState: "SENT_TO_EXCHANGE",
    });
    await repo.transitionOrder(context, {
      orderId: openOrder.id,
      expectedStateVersion: 3,
      toState: "RECONCILIATION_REQUIRED",
    });

    const terminalOrder = await repo.createOrder(
      context,
      baseCreateInput({ clientOrderId: "terminal-248", idempotencyKey: "terminal-248" }),
    );
    await repo.transitionOrder(context, {
      orderId: terminalOrder.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });
    await repo.transitionOrder(context, {
      orderId: terminalOrder.id,
      expectedStateVersion: 2,
      toState: "REJECTED",
    });

    const open = await repo.listOpenOrders(context);
    const openIds = open.map((row) => row.id);

    expect(openIds).toContain(openOrder.id);
    expect(openIds).not.toContain(terminalOrder.id);
    expect(open.some((row) => row.state === "RECONCILIATION_REQUIRED")).toBe(true);
  });

  it("filters listOpenOrders by executionMode and venue after open-state filter", async () => {
    const context = requireOrgContext(orgA);
    await repo.createOrder(context, {
      ...baseCreateInput({
        clientOrderId: "filter-mock-248",
        idempotencyKey: "filter-mock-248",
      }),
      venue: "mock",
      executionMode: "mock",
    });
    await repo.createOrder(context, {
      ...baseCreateInput({
        clientOrderId: "filter-paper-248",
        idempotencyKey: "filter-paper-248",
      }),
      venue: "htx",
      executionMode: "paper",
    });

    const mockOpen = await repo.listOpenOrders(context, { executionMode: "mock", venue: "mock" });
    expect(mockOpen.every((row) => row.executionMode === "mock" && row.venue === "mock")).toBe(
      true,
    );
  });

  it("listOrders returns all org orders including terminal states", async () => {
    const context = requireOrgContext(orgA);
    const openOrder = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "list-all-open-265",
        idempotencyKey: "list-all-open-265",
      }),
    );
    const terminalOrder = await repo.createOrder(
      context,
      baseCreateInput({
        clientOrderId: "list-all-terminal-265",
        idempotencyKey: "list-all-terminal-265",
      }),
    );
    await repo.transitionOrder(context, {
      orderId: terminalOrder.id,
      expectedStateVersion: 1,
      toState: "RISK_APPROVED",
    });
    await repo.transitionOrder(context, {
      orderId: terminalOrder.id,
      expectedStateVersion: 2,
      toState: "REJECTED",
    });

    const all = await repo.listOrders(context);
    const allIds = all.map((row) => row.id);

    expect(allIds).toContain(openOrder.id);
    expect(allIds).toContain(terminalOrder.id);

    const openOnly = await repo.listOpenOrders(context);
    expect(openOnly.map((row) => row.id)).not.toContain(terminalOrder.id);
  });

  it("filters listOrders by executionMode and venue only", async () => {
    const context = requireOrgContext(orgA);
    await repo.createOrder(context, {
      ...baseCreateInput({
        clientOrderId: "list-orders-mock-265",
        idempotencyKey: "list-orders-mock-265",
      }),
      venue: "mock",
      executionMode: "mock",
    });
    await repo.createOrder(context, {
      ...baseCreateInput({
        clientOrderId: "list-orders-paper-265",
        idempotencyKey: "list-orders-paper-265",
      }),
      venue: "htx",
      executionMode: "paper",
    });

    const mockOrders = await repo.listOrders(context, { executionMode: "mock", venue: "mock" });
    expect(mockOrders.every((row) => row.executionMode === "mock" && row.venue === "mock")).toBe(
      true,
    );
  });

  it("throws OrderNotFoundError for missing order on transition and fill", async () => {
    const context = requireOrgContext(orgA);
    const missingId = crypto.randomUUID();

    await expect(
      repo.transitionOrder(context, {
        orderId: missingId,
        expectedStateVersion: 1,
        toState: "RISK_APPROVED",
      }),
    ).rejects.toThrow(OrderNotFoundError);

    await expect(
      repo.recordFill(context, {
        orderId: missingId,
        exchangeTradeId: "missing-fill",
        price: "1",
        quantity: "1",
        executedAt: new Date(),
      }),
    ).rejects.toThrow(OrderNotFoundError);
  });
});
